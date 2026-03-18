/**
 * TTS Service - Multi provider (Edge / CapCut)
 * Provider được xác định qua options.provider hoặc prefix của options.voice.
 */

import { spawn } from 'child_process';
import { app } from 'electron';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import WebSocket, { RawData } from 'ws';
import { AppSettingsService } from '../appSettings';
import { getProxyManager } from '../proxy/proxyManager';
import { checkPythonModuleAvailability } from '../../utils/pythonRuntime';
import {
  AudioFile,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
  DEFAULT_VOICE,
  SubtitleEntry,
  TTSOptions,
  TTSProgress,
  TTSProvider,
  TTSResult,
  TTSTestVoiceRequest,
  TTSTestVoiceResponse,
  TTS_VOICE_CATALOG,
  VoiceInfo,
} from '../../../shared/types/caption';
import type { ProxyConfig } from '../../../shared/types/proxy';

const PROVIDER_PREFIX_PATTERN = /^(edge|capcut):(.*)$/i;
const DEFAULT_CAPCUT_WS_URL = 'wss://sami-normal-sg.capcutapi.com/internal/api/v1/ws';
const DEFAULT_CAPCUT_USER_AGENT = 'Cronet/TTNetVersion:e159bc05 2022-08-16 QuicVersion:68cae75d 2021-08-12';
const DEFAULT_CAPCUT_X_SS_DP = '359289';
const MAX_TTS_RETRIES = 3;
const DEFAULT_EDGE_TTS_BATCH_SIZE = 50;
const MIN_EDGE_TTS_BATCH_SIZE = 1;
const MAX_EDGE_TTS_BATCH_SIZE = 500;

interface CapCutRuntimeConfig {
  wsUrl: string;
  appKey: string;
  token: string;
  headers: Record<string, string>;
}

interface ResolvedVoiceSelection {
  provider: TTSProvider;
  voiceId: string;
  canonicalValue: string;
  voiceInfo?: VoiceInfo;
}

interface SingleGenerateResult {
  success: boolean;
  error?: string;
}

interface EdgeAsyncioItem {
  index: number;
  text: string;
  outputPath: string;
  startMs: number;
  durationMs: number;
  filename: string;
}

interface EdgeAsyncioJob {
  proxyId?: string | null;
  proxyUrl?: string | null;
  items: EdgeAsyncioItem[];
  voice: string;
  rate: string;
  volume: string;
  outputFormat: 'wav' | 'mp3';
}

interface TTSTestVoiceSampleOptions extends TTSTestVoiceRequest {
  text: string;
  voice: string;
}

type SingleGenerator = (args: {
  text: string;
  outputPath: string;
  voiceId: string;
  rate: string;
  volume: string;
  outputFormat: 'wav' | 'mp3';
}) => Promise<SingleGenerateResult>;

function getAudioMimeByFormat(format: 'wav' | 'mp3'): string {
  return format === 'wav' ? 'audio/wav' : 'audio/mpeg';
}

/**
 * Lấy catalog voice hợp nhất.
 */
export function getAvailableVoices(): VoiceInfo[] {
  return TTS_VOICE_CATALOG.map((voice) => ({ ...voice }));
}

function getFirstVoiceByProvider(provider: TTSProvider): VoiceInfo | undefined {
  return TTS_VOICE_CATALOG.find((voice) => voice.provider === provider);
}

function isTtsProvider(value: unknown): value is TTSProvider {
  return value === 'edge' || value === 'capcut';
}

/**
 * Chuẩn hóa giá trị voice về canonical format: "<provider>:<voiceId>".
 */
export function normalizeVoiceSelection(
  voice: string | undefined | null,
  providerHint?: TTSProvider
): string {
  const trimmed = typeof voice === 'string' ? voice.trim() : '';
  const matched = trimmed.match(PROVIDER_PREFIX_PATTERN);
  if (matched) {
    const provider = matched[1].toLowerCase() as TTSProvider;
    const voiceId = matched[2].trim();
    if (voiceId) {
      return `${provider}:${voiceId}`;
    }
  }

  if (trimmed) {
    const provider = providerHint && isTtsProvider(providerHint) ? providerHint : 'edge';
    return `${provider}:${trimmed}`;
  }

  if (providerHint && isTtsProvider(providerHint)) {
    const fallbackByProvider = getFirstVoiceByProvider(providerHint);
    if (fallbackByProvider) {
      return `${providerHint}:${fallbackByProvider.voiceId || fallbackByProvider.name}`;
    }
  }

  const fallback = DEFAULT_VOICE.trim();
  if (fallback.match(PROVIDER_PREFIX_PATTERN)) {
    return fallback;
  }
  return `edge:${fallback}`;
}

/**
 * Resolve voice/provider từ options.
 */
export function resolveVoiceSelection(options: Partial<TTSOptions>): ResolvedVoiceSelection {
  const canonical = normalizeVoiceSelection(options.voice, options.provider);
  const matched = canonical.match(PROVIDER_PREFIX_PATTERN);
  const provider: TTSProvider = matched?.[1]?.toLowerCase() === 'capcut' ? 'capcut' : 'edge';
  const voiceIdRaw = matched?.[2]?.trim() || '';
  const fallbackVoice = getFirstVoiceByProvider(provider);
  const voiceId = voiceIdRaw || fallbackVoice?.voiceId || fallbackVoice?.name || 'vi-VN-HoaiMyNeural';
  const voiceInfo = TTS_VOICE_CATALOG.find(
    (voice) => voice.provider === provider && (voice.voiceId === voiceId || voice.name === voiceId)
  );

  return {
    provider,
    voiceId,
    canonicalValue: `${provider}:${voiceId}`,
    voiceInfo,
  };
}

/**
 * Tạo tên file an toàn từ index và text.
 */
export function getSafeFilename(index: number, text: string, ext: string = 'wav'): string {
  const safeText = text
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\s-]/g, '')
    .replace(/\s+/g, '_')
    .trim();
  return `${index.toString().padStart(3, '0')}_${safeText || 'audio'}.${ext}`;
}

function sanitizeTextForTts(text: string): string {
  if (!text) return '';
  // Remove lone surrogate code units to avoid UTF-8 encode errors.
  return text.replace(/[\uD800-\uDFFF]/g, '');
}

function fixMojibake(text: string): string {
  if (!text) return text;
  const suspect = /Ã|Â|á»/;
  if (!suspect.test(text)) {
    return text;
  }
  const fixed = Buffer.from(text, 'latin1').toString('utf8');
  if (!suspect.test(fixed)) {
    return fixed;
  }
  return text;
}

function parseExtraCapCutHeaders(envValue: string | undefined): Record<string, string> {
  if (!envValue) return {};
  try {
    const parsed = JSON.parse(envValue);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof rawValue === 'string' && key.trim()) {
        result[key] = rawValue;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function normalizeHeaderMap(headers: Record<string, string> | null | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const cleanKey = key.trim();
    const cleanValue = typeof value === 'string' ? value.trim() : '';
    if (!cleanKey || !cleanValue) {
      continue;
    }
    normalized[cleanKey] = cleanValue;
  }
  return normalized;
}

function resolveEdgeTtsWorkerPath(): string {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(process.resourcesPath || '', 'tts', 'python', 'edge_tts_worker.py'),
    path.join(appPath, 'src', 'main', 'services', 'tts', 'python', 'edge_tts_worker.py'),
    path.join(process.cwd(), 'src', 'main', 'services', 'tts', 'python', 'edge_tts_worker.py'),
    path.join(appPath, 'out', 'main', 'services', 'tts', 'python', 'edge_tts_worker.py'),
    path.join(appPath, 'dist', 'main', 'src', 'main', 'services', 'tts', 'python', 'edge_tts_worker.py'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function toProxyUrl(proxy: ProxyConfig): string {
  const scheme = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http';
  if (proxy.username) {
    const username = encodeURIComponent(proxy.username);
    const password = encodeURIComponent(proxy.password || '');
    return `${scheme}://${username}:${password}@${proxy.host}:${proxy.port}`;
  }
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

function normalizeSecretValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEdgeTtsBatchSize(value: number | undefined): number {
  const raw = Number.isFinite(value) ? Math.round(value as number) : DEFAULT_EDGE_TTS_BATCH_SIZE;
  return Math.min(MAX_EDGE_TTS_BATCH_SIZE, Math.max(MIN_EDGE_TTS_BATCH_SIZE, raw));
}

function shouldPersistCapcutSecrets(
  current: {
    appKey: string | null;
    token: string | null;
    wsUrl: string | null;
    userAgent: string | null;
    xSsDp: string | null;
    extraHeaders: Record<string, string> | null;
  },
  next: {
    appKey: string;
    token: string;
    wsUrl: string;
    userAgent: string;
    xSsDp: string;
    extraHeaders: Record<string, string>;
  }
): boolean {
  if (current.appKey !== next.appKey) return true;
  if (current.token !== next.token) return true;
  if (current.wsUrl !== next.wsUrl) return true;
  if (current.userAgent !== next.userAgent) return true;
  if (current.xSsDp !== next.xSsDp) return true;

  const currentHeaders = normalizeHeaderMap(current.extraHeaders || {});
  const nextHeaders = normalizeHeaderMap(next.extraHeaders || {});
  const currentJson = JSON.stringify(Object.keys(currentHeaders).sort().reduce<Record<string, string>>((acc, key) => {
    acc[key] = currentHeaders[key];
    return acc;
  }, {}));
  const nextJson = JSON.stringify(Object.keys(nextHeaders).sort().reduce<Record<string, string>>((acc, key) => {
    acc[key] = nextHeaders[key];
    return acc;
  }, {}));
  return currentJson !== nextJson;
}

function loadCapCutRuntimeConfig(): { ok: true; config: CapCutRuntimeConfig } | { ok: false; error: string } {
  const allSettings = AppSettingsService.getAll();
  const savedSecrets = allSettings.capcutTtsSecrets || {
    appKey: null,
    token: null,
    wsUrl: null,
    userAgent: null,
    xSsDp: null,
    extraHeaders: null,
  };

  const appKey = normalizeSecretValue(savedSecrets.appKey) || normalizeSecretValue(process.env.CAPCUT_TTS_APPKEY);
  const token = normalizeSecretValue(savedSecrets.token) || normalizeSecretValue(process.env.CAPCUT_TTS_TOKEN);
  const wsUrl =
    normalizeSecretValue(savedSecrets.wsUrl) ||
    normalizeSecretValue(process.env.CAPCUT_TTS_WS_URL) ||
    DEFAULT_CAPCUT_WS_URL;
  const userAgent =
    normalizeSecretValue(savedSecrets.userAgent) ||
    normalizeSecretValue(process.env.CAPCUT_TTS_USER_AGENT) ||
    DEFAULT_CAPCUT_USER_AGENT;
  const xSsDp =
    normalizeSecretValue(savedSecrets.xSsDp) ||
    normalizeSecretValue(process.env.CAPCUT_TTS_X_SS_DP) ||
    DEFAULT_CAPCUT_X_SS_DP;
  const extraHeaders = {
    ...normalizeHeaderMap(savedSecrets.extraHeaders),
    ...parseExtraCapCutHeaders(process.env.CAPCUT_TTS_HEADERS_JSON),
  };

  const missing: string[] = [];
  if (!appKey) missing.push('CAPCUT_TTS_APPKEY');
  if (!token) missing.push('CAPCUT_TTS_TOKEN');
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Thiếu cấu hình CapCut TTS: ${missing.join(', ')}`,
    };
  }
  const safeAppKey = appKey as string;
  const safeToken = token as string;

  if (shouldPersistCapcutSecrets(savedSecrets, {
    appKey: safeAppKey,
    token: safeToken,
    wsUrl,
    userAgent,
    xSsDp,
    extraHeaders,
  })) {
    AppSettingsService.update({
      capcutTtsSecrets: {
        appKey: safeAppKey,
        token: safeToken,
        wsUrl,
        userAgent,
        xSsDp,
        extraHeaders: Object.keys(extraHeaders).length > 0 ? extraHeaders : null,
      },
    });
  }

  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    'X-SS-DP': xSsDp,
    ...extraHeaders,
  };

  return {
    ok: true,
    config: {
      wsUrl,
      appKey: safeAppKey,
      token: safeToken,
      headers,
    },
  };
}

function extractCapCutTaskError(eventPayload: unknown, rawEvent: Record<string, unknown>): string {
  const payload = eventPayload && typeof eventPayload === 'object'
    ? (eventPayload as Record<string, unknown>)
    : {};
  const code = payload.code ?? payload.status_code ?? rawEvent.code ?? rawEvent.status_code;
  const message = payload.error_message
    ?? payload.message
    ?? payload.msg
    ?? rawEvent.error
    ?? rawEvent.message
    ?? 'CapCut TaskFailed';

  if (typeof code === 'number' || typeof code === 'string') {
    return `CapCut error ${String(code)}: ${String(message)}`;
  }
  return String(message);
}

function parseCapCutPayload(rawPayload: unknown): Record<string, unknown> {
  if (typeof rawPayload === 'string') {
    try {
      const parsed = JSON.parse(rawPayload);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  if (rawPayload && typeof rawPayload === 'object') {
    return rawPayload as Record<string, unknown>;
  }
  return {};
}

function rawDataToBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw.map((item) => rawDataToBuffer(item as RawData)));
  }
  return Buffer.from(raw as ArrayBufferLike);
}

interface CapCutBatchSocketResult {
  audioBuffers: Buffer[];
  taskFinished: boolean;
  taskFailed: boolean;
  lastError: string;
}

async function requestCapCutBatchAudio(args: {
  texts: string[];
  voiceId: string;
  outputFormat: 'wav' | 'mp3';
  config: CapCutRuntimeConfig;
}): Promise<CapCutBatchSocketResult> {
  const { texts, voiceId, outputFormat, config } = args;
  return new Promise((resolve) => {
    const total = texts.length;
    const chunkBuckets: Buffer[][] = Array.from({ length: total }, () => []);

    let settled = false;
    let currentIndex = -1;
    let taskFinished = false;
    let taskFailed = false;
    let lastError = '';

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const audioBuffers = chunkBuckets.map((parts) => (parts.length > 0 ? Buffer.concat(parts) : Buffer.alloc(0)));
      resolve({
        audioBuffers,
        taskFinished,
        taskFailed,
        lastError,
      });
    };

    const timeoutMs = Math.max(90000, texts.length * 2000);
    const timeoutId = setTimeout(() => {
      taskFailed = true;
      lastError = `CapCut timeout sau ${Math.round(timeoutMs / 1000)} giây.`;
      ws.close();
    }, timeoutMs);

    const ws = new WebSocket(config.wsUrl, {
      headers: config.headers,
      handshakeTimeout: 15000,
    });

    ws.on('open', () => {
      const audioConfig: Record<string, unknown> = {
        bit_rate: 64000,
        sample_rate: 24000,
        speech_rate: 0,
        enable_split: false,
        enable_timestamp: false,
        format: outputFormat,
      };

      const startTaskPayload = {
        audio_config: audioConfig,
        speaker: voiceId,
        texts,
      };

      const startTask = {
        appkey: config.appKey,
        event: 'StartTask',
        namespace: 'TTS',
        token: config.token,
        payload: JSON.stringify(startTaskPayload),
        version: 'sdk_v1',
      };
      ws.send(JSON.stringify(startTask));
    });

    ws.on('message', (rawMessage: RawData, isBinary: boolean) => {
      if (isBinary) {
        if (currentIndex >= 0 && currentIndex < total) {
          const chunk = rawDataToBuffer(rawMessage);
          if (chunk.length > 0) {
            chunkBuckets[currentIndex].push(chunk);
          }
        }
        return;
      }

      const rawText = Buffer.isBuffer(rawMessage) ? rawMessage.toString('utf-8') : String(rawMessage);
      let parsedEvent: Record<string, unknown>;
      try {
        parsedEvent = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        return;
      }

      const event = parsedEvent.event;

      if (event === 'TaskStarted') {
        const finishTask = {
          appkey: config.appKey,
          event: 'FinishTask',
          namespace: 'TTS',
          token: config.token,
          version: 'sdk_v1',
        };
        ws.send(JSON.stringify(finishTask));
        return;
      }

      if (event === 'TTSResponse') {
        const payload = parseCapCutPayload(parsedEvent.payload);
        const nextIndex = payload.index;
        if (typeof nextIndex === 'number' && Number.isFinite(nextIndex) && nextIndex >= 0 && nextIndex < total) {
          currentIndex = nextIndex;
        }
        return;
      }

      if (event === 'TaskFailed') {
        taskFailed = true;
        const payload = parseCapCutPayload(parsedEvent.payload);
        lastError = extractCapCutTaskError(payload, parsedEvent);
        ws.close();
        return;
      }

      if (event === 'TaskFinished') {
        taskFinished = true;
        ws.close();
        return;
      }

      const statusCode = parsedEvent.status_code;
      if (
        (typeof statusCode === 'number' || typeof statusCode === 'string')
        && String(statusCode) !== '20000000'
      ) {
        taskFailed = true;
        lastError = `CapCut status_code=${String(statusCode)}`;
      }
    });

    ws.on('error', (error: Error) => {
      taskFailed = true;
      lastError = `CapCut websocket error: ${error.message}`;
    });

    ws.on('close', () => {
      settle();
    });
  });
}

/**
 * Tạo một file audio từ text sử dụng edge-tts CLI.
 * Giữ tên hàm cũ để compatibility.
 */
export async function generateSingleAudio(
  text: string,
  outputPath: string,
  voice: string = DEFAULT_VOICE,
  rate: string = DEFAULT_RATE,
  volume: string = DEFAULT_VOLUME
): Promise<SingleGenerateResult> {
  const resolvedVoice = resolveVoiceSelection({ voice, provider: 'edge' });
  return generateSingleAudioEdge({
    text,
    outputPath,
    voiceId: resolvedVoice.voiceId,
    rate,
    volume,
  });
}

/**
 * Tạo sample audio test voice cho Step 4 bằng file tạm, sau đó trả về data URI.
 */
export async function testVoiceSample(options: TTSTestVoiceSampleOptions): Promise<TTSTestVoiceResponse> {
  const sampleText = (options.text || '').trim();
  if (!sampleText) {
    throw new Error('Text test giọng không được để trống.');
  }

  const outputFormat: 'wav' | 'mp3' = options.outputFormat === 'wav' ? 'wav' : 'mp3';
  const voiceSelection = resolveVoiceSelection({
    voice: options.voice,
    provider: normalizeVoiceSelection(options.voice).startsWith('capcut:') ? 'capcut' : 'edge',
  });
  const rate = options.rate || DEFAULT_RATE;
  const volume = options.volume || DEFAULT_VOLUME;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nauchaoheo-tts-preview-'));
  const outputPath = path.join(
    tmpRoot,
    `preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${outputFormat}`
  );

  try {
    let generated: SingleGenerateResult;
    if (voiceSelection.provider === 'capcut') {
      const cfgResult = loadCapCutRuntimeConfig();
      if (!cfgResult.ok) {
        throw new Error(cfgResult.error);
      }
      generated = await generateSingleAudioCapCut({
        text: sampleText,
        outputPath,
        voiceId: voiceSelection.voiceId,
        rate: DEFAULT_RATE,
        volume: DEFAULT_VOLUME,
        outputFormat,
      }, cfgResult.config);
    } else {
      generated = await generateSingleAudioEdge({
        text: sampleText,
        outputPath,
        voiceId: voiceSelection.voiceId,
        rate,
        volume,
      });
    }

    if (!generated.success) {
      throw new Error(generated.error || 'Tạo audio test thất bại.');
    }

    const fileBuffer = await fs.readFile(outputPath);
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('Audio test rỗng.');
    }

    const mime = getAudioMimeByFormat(outputFormat);
    const durationMs = await getAudioDuration(outputPath);
    return {
      audioDataUri: `data:${mime};base64,${fileBuffer.toString('base64')}`,
      mime,
      ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
      provider: voiceSelection.provider,
      voice: voiceSelection.canonicalValue,
    };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function generateSingleAudioEdge(args: {
  text: string;
  outputPath: string;
  voiceId: string;
  rate: string;
  volume: string;
}): Promise<SingleGenerateResult> {
  const { text, outputPath, voiceId, rate, volume } = args;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: SingleGenerateResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const safeText = text.replace(/"/g, '\\"');
    const argsList = [
      '--voice', voiceId,
      '--rate', rate,
      '--volume', volume,
      '--text', `"${safeText}"`,
      '--write-media', `"${outputPath}"`,
    ];

    const proc = spawn('edge-tts', argsList, {
      windowsHide: true,
      shell: true,
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        try {
          const stats = await fs.stat(outputPath);
          if (stats.size > 0) {
            settle({ success: true });
          } else {
            settle({ success: false, error: 'File created but empty' });
          }
        } catch {
          settle({ success: false, error: 'File not created' });
        }
        return;
      }
      settle({ success: false, error: stderr || `Exit code: ${code}` });
    });

    proc.on('error', (err) => {
      settle({ success: false, error: `Spawn error: ${err.message}` });
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
      settle({ success: false, error: 'Timeout' });
    }, 30000);
  });
}

async function generateSingleAudioCapCut(
  args: {
    text: string;
    outputPath: string;
    voiceId: string;
    rate: string;
    volume: string;
    outputFormat: 'wav' | 'mp3';
  },
  config: CapCutRuntimeConfig
): Promise<SingleGenerateResult> {
  const { text, outputPath, voiceId, rate: _rate, volume: _volume, outputFormat } = args;
  return new Promise((resolve) => {
    let settled = false;
    let currentIndex = 0;
    let taskFinished = false;
    let taskFailed = false;
    let lastError = '';
    const chunkMap = new Map<number, Buffer[]>();

    const settle = (result: SingleGenerateResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const appendChunk = (index: number, raw: RawData) => {
      const chunk = rawDataToBuffer(raw);
      if (chunk.length === 0) {
        return;
      }
      const list = chunkMap.get(index) ?? [];
      list.push(chunk);
      chunkMap.set(index, list);
    };

    const collectAudioBuffer = (): Buffer => {
      const indexes = Array.from(chunkMap.keys()).sort((a, b) => a - b);
      const merged: Buffer[] = [];
      for (const idx of indexes) {
        const parts = chunkMap.get(idx) ?? [];
        if (parts.length > 0) {
          merged.push(Buffer.concat(parts));
        }
      }
      return merged.length > 0 ? Buffer.concat(merged) : Buffer.alloc(0);
    };

    const finalize = async () => {
      if (taskFailed) {
        settle({ success: false, error: lastError || 'CapCut TaskFailed' });
        return;
      }

      const audioBuffer = collectAudioBuffer();
      if (audioBuffer.length <= 0) {
        const reason = lastError || (taskFinished
          ? 'CapCut không trả dữ liệu audio.'
          : 'Kết nối CapCut đóng trước khi hoàn tất task.');
        settle({ success: false, error: reason });
        return;
      }

      try {
        await fs.writeFile(outputPath, audioBuffer);
        settle({ success: true });
      } catch (error) {
        settle({ success: false, error: `Không thể ghi file audio: ${String(error)}` });
      }
    };

    const timeoutId = setTimeout(() => {
      taskFailed = true;
      lastError = 'CapCut timeout sau 90 giây.';
      ws.close();
    }, 90000);

    const ws = new WebSocket(config.wsUrl, {
      headers: config.headers,
      handshakeTimeout: 15000,
    });

    ws.on('open', () => {
      const audioConfig: Record<string, unknown> = {
        bit_rate: 64000,
        sample_rate: 24000,
        speech_rate: 0,
        enable_split: false,
        enable_timestamp: false,
        format: outputFormat,
      };

      const startTaskPayload = {
        audio_config: audioConfig,
        speaker: voiceId,
        texts: [text],
      };

      const startTask = {
        appkey: config.appKey,
        event: 'StartTask',
        namespace: 'TTS',
        token: config.token,
        payload: JSON.stringify(startTaskPayload),
        version: 'sdk_v1',
      };
      ws.send(JSON.stringify(startTask));
    });

    ws.on('message', (rawMessage: RawData, isBinary: boolean) => {
      if (isBinary) {
        appendChunk(currentIndex, rawMessage);
        return;
      }

      const rawText = Buffer.isBuffer(rawMessage) ? rawMessage.toString('utf-8') : String(rawMessage);
      let parsedEvent: Record<string, unknown>;
      try {
        parsedEvent = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        return;
      }

      const event = parsedEvent.event;
      if (event === 'TaskStarted') {
        const finishTask = {
          appkey: config.appKey,
          event: 'FinishTask',
          namespace: 'TTS',
          token: config.token,
          version: 'sdk_v1',
        };
        ws.send(JSON.stringify(finishTask));
        return;
      }

      if (event === 'TTSResponse') {
        const payload = parseCapCutPayload(parsedEvent.payload);
        const nextIndex = payload.index;
        if (typeof nextIndex === 'number' && Number.isFinite(nextIndex) && nextIndex >= 0) {
          currentIndex = nextIndex;
        }
        return;
      }

      if (event === 'TaskFailed') {
        taskFailed = true;
        const payload = parseCapCutPayload(parsedEvent.payload);
        lastError = extractCapCutTaskError(payload, parsedEvent);
        ws.close();
        return;
      }

      if (event === 'TaskFinished') {
        taskFinished = true;
        ws.close();
      }
    });

    ws.on('error', (error: Error) => {
      taskFailed = true;
      lastError = `CapCut websocket error: ${error.message}`;
    });

    ws.on('close', () => {
      void finalize();
    });
  });
}

async function generateBatchAudioWithProvider(
  entries: SubtitleEntry[],
  options: Partial<TTSOptions>,
  voiceSelection: ResolvedVoiceSelection,
  providerGenerator: SingleGenerator,
  progressCallback?: (progress: TTSProgress) => void
): Promise<TTSResult> {
  const {
    rate = DEFAULT_RATE,
    volume = DEFAULT_VOLUME,
    outputFormat = 'wav',
    outputDir,
    maxConcurrent = 5,
  } = options;

  if (!outputDir) {
    return {
      success: false,
      audioFiles: [],
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir: '',
      errors: ['outputDir is required'],
    };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const providerLabel = voiceSelection.provider.toUpperCase();
  const audioFiles: AudioFile[] = [];
  const errors: string[] = [];
  let completed = 0;

  console.log(`[TTS] Provider: ${voiceSelection.provider}, voice: ${voiceSelection.canonicalValue}`);
  console.log(`[TTS] Bắt đầu tạo ${entries.length} audio files`);

  for (let i = 0; i < entries.length; i += maxConcurrent) {
    const batch = entries.slice(i, i + maxConcurrent);

    const batchPromises = batch.map(async (entry) => {
      const text = entry.translatedText || entry.text;
      const filename = getSafeFilename(entry.index, text, outputFormat);
      const outputPath = path.join(outputDir, filename);

      try {
        const existing = await fs.stat(outputPath);
        if (existing.size > 0) {
          completed++;
          progressCallback?.({
            current: completed,
            total: entries.length,
            status: 'generating',
            currentFile: filename,
            message: `[${providerLabel}] Skip (existed): ${filename}`,
          });
          return {
            index: entry.index,
            path: outputPath,
            startMs: entry.startMs,
            durationMs: entry.durationMs,
            success: true,
          } as AudioFile;
        }
      } catch {
        // File chưa tồn tại => tạo mới.
      }

      let result = await providerGenerator({
        text,
        outputPath,
        voiceId: voiceSelection.voiceId,
        rate,
        volume,
        outputFormat,
      });

      let retryCount = 0;
      while (!result.success && retryCount < MAX_TTS_RETRIES) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`[TTS] [${providerLabel}] lỗi ${filename}, retry ${retryCount}/${MAX_TTS_RETRIES}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        result = await providerGenerator({
          text,
          outputPath,
          voiceId: voiceSelection.voiceId,
          rate,
          volume,
          outputFormat,
        });
      }

      completed++;
      progressCallback?.({
        current: completed,
        total: entries.length,
        status: 'generating',
        currentFile: filename,
        message: result.success
          ? `[${providerLabel}] Đã tạo: ${filename}`
          : `[${providerLabel}] Lỗi: ${filename}`,
      });

      if (result.success) {
        return {
          index: entry.index,
          path: outputPath,
          startMs: entry.startMs,
          durationMs: entry.durationMs,
          success: true,
        } as AudioFile;
      }

      const errorText = result.error || 'Unknown error';
      errors.push(`${filename}: ${errorText}`);
      return {
        index: entry.index,
        path: outputPath,
        startMs: entry.startMs,
        durationMs: entry.durationMs,
        success: false,
        error: errorText,
      } as AudioFile;
    });

    const batchResults = await Promise.all(batchPromises);
    audioFiles.push(...batchResults);

    if (i + maxConcurrent < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  audioFiles.sort((a, b) => a.startMs - b.startMs);
  const totalGenerated = audioFiles.filter((file) => file.success).length;
  const totalFailed = audioFiles.filter((file) => !file.success).length;

  progressCallback?.({
    current: entries.length,
    total: entries.length,
    status: 'completed',
    currentFile: '',
    message: `[${providerLabel}] Hoàn thành: ${totalGenerated}/${entries.length} files`,
  });

  return {
    success: totalFailed === 0,
    audioFiles,
    totalGenerated,
    totalFailed,
    outputDir,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// export async function generateBatchAudioEdge(
//   entries: SubtitleEntry[],
//   options: Partial<TTSOptions>,
//   progressCallback?: (progress: TTSProgress) => void
// ): Promise<TTSResult> {
//   const voiceSelection = resolveVoiceSelection({ ...options, provider: 'edge' });
//   return generateBatchAudioWithProvider(
//     entries,
//     options,
//     voiceSelection,
//     ({ text, outputPath, voiceId, rate, volume }) =>
//       generateSingleAudioEdge({ text, outputPath, voiceId, rate, volume }),
//     progressCallback
//   );
// }

export async function generateBatchAudioEdge(
  entries: SubtitleEntry[],
  options: Partial<TTSOptions>,
  progressCallback?: (progress: TTSProgress) => void
): Promise<TTSResult> {
  return generateAsyncioAudioWithProvider(entries, options, progressCallback);
}

async function runEdgeTtsWorker(
  jobs: EdgeAsyncioJob[],
  runtime: { command: string; baseArgs: string[] },
  workerPath: string,
  timeoutMs?: number,
): Promise<{ results: Map<number, { success: boolean; error?: string }>; errors: string[] }> {
  const payload = { jobs, ...(timeoutMs ? { timeoutMs } : {}) };
  const errors: string[] = [];
  const results = new Map<number, { success: boolean; error?: string }>();

  return new Promise((resolve) => {
    let doneReceived = false;
    let stderr = '';
    let buffer = '';

    console.log(`[TTS][EDGE][asyncio] Spawn worker: ${runtime.command} ${runtime.baseArgs.join(' ')} ${workerPath}`);
    console.log(`[TTS][EDGE][asyncio] Jobs=${jobs.length}, totalItems=${jobs.reduce((sum, job) => sum + job.items.length, 0)}`);

    const proc = spawn(runtime.command, [...runtime.baseArgs, workerPath], {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    proc.stdout?.on('data', (data) => {
      buffer += data.toString();
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event?.event === 'progress' && typeof event.index === 'number') {
            // progress event: just capture last known error/success
            if (typeof event.success === 'boolean') {
              results.set(event.index, { success: event.success, error: event.error });
              if (!event.success) {
                console.warn(
                  `[TTS][EDGE][asyncio] Failed index=${event.index} file=${event.filename || 'n/a'} ` +
                  `proxyId=${event.proxyId || 'direct'} error=${event.error || 'unknown'}`
                );
              }
            }
            continue;
          }
          if (event?.event === 'done' && Array.isArray(event.results)) {
            for (const item of event.results) {
              if (typeof item.index === 'number') {
                results.set(item.index, { success: !!item.success, error: item.error });
              }
            }
            doneReceived = true;
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (!doneReceived) {
        const err = (stderr || `Python worker exited with code ${code ?? 'unknown'}`).trim();
        if (err) errors.push(err);
      }
      if (stderr.trim()) {
        console.warn(`[TTS][EDGE][asyncio] Worker stderr:\n${stderr.trim()}`);
      }
      console.log(`[TTS][EDGE][asyncio] Worker closed code=${code ?? 'unknown'} done=${doneReceived}`);
      resolve({ results, errors });
    });

    proc.on('error', (err) => {
      errors.push(`Spawn error: ${err.message}`);
      resolve({ results, errors });
    });

    proc.stdin?.write(Buffer.from(JSON.stringify(payload), 'utf8'));
    proc.stdin?.end();
  });
}

export async function generateAsyncioAudioWithProvider(
  entries: SubtitleEntry[],
  options: Partial<TTSOptions>,
  progressCallback?: (progress: TTSProgress) => void
): Promise<TTSResult> {
  const voiceSelection = resolveVoiceSelection({ ...options, provider: 'edge' });
  const outputFormat: 'wav' | 'mp3' = options.outputFormat === 'mp3' ? 'mp3' : 'wav';
  const {
    rate = DEFAULT_RATE,
    volume = DEFAULT_VOLUME,
    outputDir,
  } = options;
  const effectiveBatchSize = normalizeEdgeTtsBatchSize(options.edgeTtsBatchSize);

  console.log(`[TTS][EDGE][asyncio] Start entries=${entries.length}, voice=${voiceSelection.voiceId}, format=${outputFormat}`);
  console.log(`[TTS][EDGE][asyncio] Batch size=${effectiveBatchSize}`);

  if (!outputDir) {
    return {
      success: false,
      audioFiles: [],
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir: '',
      errors: ['outputDir is required'],
    };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const availability = await checkPythonModuleAvailability(['edge_tts']);
  if (!availability.success || !availability.runtime) {
    const error = availability.error || 'Thiếu module Python edge_tts.';
    console.error(`[TTS][EDGE][asyncio] Python runtime/module check failed: ${error}`);
    return {
      success: false,
      audioFiles: entries.map((entry) => ({
        index: entry.index,
        path: path.join(outputDir, getSafeFilename(entry.index, entry.translatedText || entry.text, outputFormat)),
        startMs: entry.startMs,
        durationMs: entry.durationMs,
        success: false,
        error,
      })),
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir,
      errors: [error],
    };
  }

  const workerPath = resolveEdgeTtsWorkerPath();
  if (!existsSync(workerPath)) {
    console.error(`[TTS][EDGE][asyncio] Worker not found: ${workerPath}`);
    return {
      success: false,
      audioFiles: [],
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir,
      errors: [`Không tìm thấy edge_tts_worker.py (${workerPath})`],
    };
  }

  const providerLabel = 'EDGE';
  const audioFiles: AudioFile[] = [];
  const errors: string[] = [];
  let completed = 0;

  const pendingItems: EdgeAsyncioItem[] = [];
  for (const entry of entries) {
    const rawText = entry.translatedText || entry.text;
    const normalizedText = fixMojibake(rawText);
    const cleanText = sanitizeTextForTts(normalizedText);
    const filename = getSafeFilename(entry.index, cleanText, outputFormat);
    const outputPath = path.join(outputDir, filename);

    try {
      const existing = await fs.stat(outputPath);
      if (existing.size > 0) {
        audioFiles.push({
          index: entry.index,
          path: outputPath,
          startMs: entry.startMs,
          durationMs: entry.durationMs,
          success: true,
        });
        completed++;
        progressCallback?.({
          current: completed,
          total: entries.length,
          status: 'generating',
          currentFile: filename,
          message: `[${providerLabel}] Skip (existed): ${filename}`,
        });
        continue;
      }
    } catch {
      // File chưa tồn tại => đưa vào danh sách xử lý
    }

    pendingItems.push({
      index: entry.index,
      text: cleanText,
      outputPath,
      startMs: entry.startMs,
      durationMs: entry.durationMs,
      filename,
    });
    console.log(`[TTS][EDGE][asyncio] Text#${entry.index}: ${cleanText.slice(0, 160)}`);
  }

  const proxyManager = getProxyManager();
  const proxyContext = proxyManager.getProxyContext('tts');
  const useProxySetting = proxyContext.mode !== 'off';
  const useRotatingEndpoint = useProxySetting && proxyContext.mode === 'rotating-endpoint';
  if (useRotatingEndpoint && proxyManager.getAvailableProxies(undefined, 'tts').length === 0) {
    return {
      success: false,
      audioFiles: [],
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir,
      errors: ['Rotating endpoint không hợp lệ hoặc không khả dụng cho Edge TTS'],
    };
  }
  const preferredType = proxyContext.typePreference === 'any' ? undefined : proxyContext.typePreference;
  const hasPreferredProxy = !useRotatingEndpoint
    && useProxySetting
    && proxyManager.getAvailableProxies(preferredType, 'tts').length > 0;
  console.log(
    `[TTS][EDGE][asyncio] useProxy=${useProxySetting}`
    + (useRotatingEndpoint
      ? ` (rotating-endpoint=${proxyContext.rotatingEndpointMasked || 'configured'})`
      : (preferredType ? ` (${preferredType}-only)` : (hasPreferredProxy ? ' (proxy)' : '')))
  );
  if (useProxySetting && !hasPreferredProxy && !useRotatingEndpoint) {
    console.warn('[TTS][EDGE][asyncio] Không có proxy theo typePreference khả dụng, fallback dùng proxy thường nếu có.');
  }

  const buildJobs = (items: EdgeAsyncioItem[]): EdgeAsyncioJob[] => {
    const jobs: EdgeAsyncioJob[] = [];
    let i = 0;
    while (i < items.length) {
      const chunk = items.slice(i, i + effectiveBatchSize);
      let proxy: ProxyConfig | null = null;
      if (useProxySetting) {
        if (useRotatingEndpoint) {
          proxy = proxyManager.getNextProxy(undefined, 'tts');
        } else {
          proxy = proxyManager.getNextProxy(preferredType, 'tts');
          if (!proxy && preferredType) {
            proxy = proxyManager.getNextProxy(undefined, 'tts');
          }
        }
      }
      if (proxy) {
        console.log(`[TTS][EDGE][asyncio] Assign proxy ${proxy.host}:${proxy.port} -> items ${chunk.length}`);
      } else {
        console.log(`[TTS][EDGE][asyncio] Assign direct (no proxy) -> items ${chunk.length}`);
      }
      jobs.push({
        proxyId: proxy?.id || null,
        proxyUrl: proxy ? toProxyUrl(proxy) : null,
        items: chunk,
        voice: voiceSelection.voiceId,
        rate,
        volume,
        outputFormat,
      });
      i += effectiveBatchSize;
    }
    if (jobs.length === 0 && items.length > 0) {
      jobs.push({
        proxyId: null,
        proxyUrl: null,
        items,
        voice: voiceSelection.voiceId,
        rate,
        volume,
        outputFormat,
      });
    }
    return jobs;
  };

  let remaining = pendingItems.slice();
  let attempt = 0;

  while (remaining.length > 0 && attempt <= MAX_TTS_RETRIES) {
    attempt++;
    console.log(`[TTS][EDGE][asyncio] Attempt ${attempt}/${MAX_TTS_RETRIES + 1}, remaining=${remaining.length}`);
    const jobs = buildJobs(remaining);
    const runResult = await runEdgeTtsWorker(jobs, availability.runtime, workerPath);
    if (runResult.errors.length > 0) {
      console.warn(`[TTS][EDGE][asyncio] Worker errors: ${runResult.errors.join(' | ')}`);
      errors.push(...runResult.errors);
    }

    const nextRemaining: EdgeAsyncioItem[] = [];
    for (const job of jobs) {
      let jobFailedReason: string | undefined;
      let jobFailed = false;

      for (const item of job.items) {
        const result = runResult.results.get(item.index);
        let itemSuccess = !!result?.success;
        let itemError = result?.error;

        if (itemSuccess) {
          try {
            const stats = await fs.stat(item.outputPath);
            if (stats.size <= 0) {
              throw new Error('file rỗng');
            }
          } catch (error) {
            itemSuccess = false;
            itemError = `Worker báo success nhưng file output không hợp lệ (${item.outputPath}): ${String(error)}`;
          }
        }

        if (itemSuccess) {
          audioFiles.push({
            index: item.index,
            path: item.outputPath,
            startMs: item.startMs,
            durationMs: item.durationMs,
            success: true,
          });
          completed++;
          progressCallback?.({
            current: completed,
            total: entries.length,
            status: 'generating',
            currentFile: item.filename,
            message: `[${providerLabel}] Đã tạo: ${item.filename}`,
          });
        } else {
          if (!jobFailedReason && itemError) {
            jobFailedReason = itemError;
          }
          jobFailed = true;
          if (attempt <= MAX_TTS_RETRIES) {
            nextRemaining.push(item);
          } else {
            const errorText = itemError || 'Unknown error';
            errors.push(`${item.filename}: ${errorText}`);
            audioFiles.push({
              index: item.index,
              path: item.outputPath,
              startMs: item.startMs,
              durationMs: item.durationMs,
              success: false,
              error: errorText,
            });
            completed++;
            progressCallback?.({
              current: completed,
              total: entries.length,
              status: 'generating',
              currentFile: item.filename,
              message: `[${providerLabel}] Lỗi: ${item.filename}`,
            });
          }
        }
      }

      if (job.proxyId) {
        if (jobFailed) {
          proxyManager.markProxyFailed(job.proxyId, jobFailedReason);
        } else {
          proxyManager.markProxySuccess(job.proxyId);
        }
      }
    }

    remaining = nextRemaining;
    if (remaining.length > 0 && attempt <= MAX_TTS_RETRIES) {
      console.log(`[TTS][EDGE][asyncio] Requeue ${remaining.length} items for next attempt.`);
    }
  }

  audioFiles.sort((a, b) => a.startMs - b.startMs);
  const totalGenerated = audioFiles.filter((file) => file.success).length;
  const totalFailed = audioFiles.filter((file) => !file.success).length;

  progressCallback?.({
    current: entries.length,
    total: entries.length,
    status: 'completed',
    currentFile: '',
    message: `[${providerLabel}] Hoàn thành: ${totalGenerated}/${entries.length} files`,
  });

  return {
    success: totalFailed === 0,
    audioFiles,
    totalGenerated,
    totalFailed,
    outputDir,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function generateBatchAudioCapCut(
  entries: SubtitleEntry[],
  options: Partial<TTSOptions>,
  progressCallback?: (progress: TTSProgress) => void
): Promise<TTSResult> {
  const voiceSelection = resolveVoiceSelection({ ...options, provider: 'capcut' });
  const cfgResult = loadCapCutRuntimeConfig();

  const outputDir = options.outputDir || '';
  if (!cfgResult.ok) {
    return {
      success: false,
      audioFiles: entries.map((entry) => ({
        index: entry.index,
        path: outputDir
          ? path.join(outputDir, getSafeFilename(entry.index, entry.translatedText || entry.text, options.outputFormat || 'wav'))
          : '',
        startMs: entry.startMs,
        durationMs: entry.durationMs,
        success: false,
        error: cfgResult.error,
      })),
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir,
      errors: [cfgResult.error],
    };
  }

  const outputFormat = options.outputFormat || 'wav';
  if (!outputDir) {
    return {
      success: false,
      audioFiles: [],
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir: '',
      errors: ['outputDir is required'],
    };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const providerLabel = 'CAPCUT';
  const audioFiles: AudioFile[] = [];
  const errors: string[] = [];
  const pending: Array<{
    entry: SubtitleEntry;
    filename: string;
    outputPath: string;
    text: string;
  }> = [];

  let completed = 0;

  for (const entry of entries) {
    const text = fixMojibake(entry.translatedText || entry.text);
    const filename = getSafeFilename(entry.index, text, outputFormat);
    const outputPath = path.join(outputDir, filename);

    try {
      const existing = await fs.stat(outputPath);
      if (existing.size > 0) {
        audioFiles.push({
          index: entry.index,
          path: outputPath,
          startMs: entry.startMs,
          durationMs: entry.durationMs,
          success: true,
        });
        completed++;
        progressCallback?.({
          current: completed,
          total: entries.length,
          status: 'generating',
          currentFile: filename,
          message: `[${providerLabel}] Skip (existed): ${filename}`,
        });
        continue;
      }
    } catch {
      // Chưa có file, sẽ đưa vào batch socket.
    }

    pending.push({ entry, filename, outputPath, text });
  }

  if (pending.length > 0) {
    const finalBuffers: Buffer[] = Array.from({ length: pending.length }, () => Buffer.alloc(0));
    let unresolvedLocalIndexes: number[] = pending.map((_, idx) => idx);
    let lastBatchError = '';
    const maxBatchAttempts = Math.max(1, MAX_TTS_RETRIES + 1);
    const missingSubtitleIndexes: number[] = [];
    const missingSocketResponseIndexes: number[] = [];

    for (let attempt = 1; attempt <= maxBatchAttempts; attempt++) {
      if (unresolvedLocalIndexes.length === 0) {
        break;
      }

      const attemptItems = unresolvedLocalIndexes.map((localIndex) => pending[localIndex]);
      console.log(
        `[TTS] [${providerLabel}] Batch socket attempt ${attempt}/${maxBatchAttempts}: ${attemptItems.length} dòng`
      );

      const batchResult = await requestCapCutBatchAudio({
        texts: attemptItems.map((item) => item.text),
        voiceId: voiceSelection.voiceId,
        outputFormat,
        config: cfgResult.config,
      });

      if (batchResult.lastError) {
        lastBatchError = batchResult.lastError;
      }

      const nextUnresolved: number[] = [];
      for (let idx = 0; idx < attemptItems.length; idx++) {
        const localIndex = unresolvedLocalIndexes[idx];
        const audioBuffer = batchResult.audioBuffers[idx] || Buffer.alloc(0);
        if (audioBuffer.length > 0) {
          finalBuffers[localIndex] = audioBuffer;
        } else {
          nextUnresolved.push(localIndex);
        }
      }

      unresolvedLocalIndexes = nextUnresolved;
      if (unresolvedLocalIndexes.length > 0 && attempt < maxBatchAttempts) {
        console.warn(
          `[TTS] [${providerLabel}] Socket attempt ${attempt} còn thiếu ${unresolvedLocalIndexes.length} dòng, sẽ gửi lại batch thiếu.`
        );
      }
    }

    for (let idx = 0; idx < pending.length; idx++) {
      const item = pending[idx];
      const audioBuffer = finalBuffers[idx];
      let success = false;
      let errorText: string | undefined;

      if (audioBuffer.length > 0) {
        try {
          await fs.writeFile(item.outputPath, audioBuffer);
          success = true;
        } catch (error) {
          errorText = `Không thể ghi file audio: ${String(error)}`;
        }
      } else {
        errorText = lastBatchError
          ? `Thiếu audio sau ${maxBatchAttempts} lần batch socket. ${lastBatchError}`
          : `Thiếu audio sau ${maxBatchAttempts} lần batch socket.`;
        missingSubtitleIndexes.push(item.entry.index);
        missingSocketResponseIndexes.push(idx + 1);
      }

      if (!success && errorText) {
        errors.push(`${item.filename}: ${errorText}`);
      }

      audioFiles.push({
        index: item.entry.index,
        path: item.outputPath,
        startMs: item.entry.startMs,
        durationMs: item.entry.durationMs,
        success,
        error: success ? undefined : errorText,
      });

      completed++;
      progressCallback?.({
        current: completed,
        total: entries.length,
        status: 'generating',
        currentFile: item.filename,
        message: success
          ? `[${providerLabel}] Đã tạo: ${item.filename}`
          : `[${providerLabel}] Lỗi: ${item.filename}`,
      });
    }

    if (missingSubtitleIndexes.length > 0) {
      const subtitleIndexes = Array.from(new Set(missingSubtitleIndexes)).sort((a, b) => a - b);
      const socketIndexes = Array.from(new Set(missingSocketResponseIndexes)).sort((a, b) => a - b);
      errors.unshift(
        `[${providerLabel}] Thiếu audio ở subtitle index: ${subtitleIndexes.join(', ')} ` +
        `(socket indexes: ${socketIndexes.join(', ')})`
      );
    }
  }

  audioFiles.sort((a, b) => a.startMs - b.startMs);
  const totalGenerated = audioFiles.filter((file) => file.success).length;
  const totalFailed = audioFiles.filter((file) => !file.success).length;

  progressCallback?.({
    current: entries.length,
    total: entries.length,
    status: 'completed',
    currentFile: '',
    message: `[${providerLabel}] Hoàn thành: ${totalGenerated}/${entries.length} files`,
  });

  return {
    success: totalFailed === 0,
    audioFiles,
    totalGenerated,
    totalFailed,
    outputDir,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Dispatcher cũ - giữ nguyên tên để không đổi IPC contract.
 */
export async function generateBatchAudio(
  entries: SubtitleEntry[],
  options: Partial<TTSOptions>,
  progressCallback?: (progress: TTSProgress) => void
): Promise<TTSResult> {
  const voiceSelection = resolveVoiceSelection(options);
  if (voiceSelection.provider === 'capcut') {
    return generateBatchAudioCapCut(entries, options, progressCallback);
  }
  return generateBatchAudioEdge(entries, options, progressCallback);
}

/**
 * Lấy thời lượng thực tế của file audio (milliseconds) bằng ffprobe.
 */
export async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath],
      {
        windowsHide: true,
        shell: false,
      }
    );

    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      const duration = Number.parseFloat(stdout.trim());
      if (Number.isFinite(duration)) {
        resolve(Math.round(duration * 1000));
      } else {
        resolve(0);
      }
    });

    proc.on('error', () => {
      resolve(0);
    });
  });
}
