import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import styles from './CaptionTranslator.module.css';
import { Button } from '../common/Button';
import folderIconUrl from '../../../../../resources/icons/folder.svg';
import videoIconUrl from '../../../../../resources/icons/video.svg';
import { Input } from '../common/Input';
import { RadioButton } from '../common/RadioButton';
import { Checkbox } from '../common/Checkbox';
import { useProjectContext } from '../../context/ProjectContext';
import {
  GEMINI_MODELS,
  VOICES,
  RATE_OPTIONS,
  VOLUME_OPTIONS,
  LINES_PER_FILE_OPTIONS,
  normalizeVoiceValue,
} from '../../config/captionConfig';
import {
  HardsubTimingMetrics,
  Step,
  SubtitleEntry,
  ThumbnailFolderItem,
  ThumbnailPreviewContextKey,
} from './CaptionTypes';
import { useCaptionSettings } from './hooks/useCaptionSettings';
import { useCaptionFileManagement } from './hooks/useCaptionFileManagement';
import { useCaptionProcessing } from './hooks/useCaptionProcessing';
import { useHardsubSettings } from './hooks/useHardsubSettings';
import { ensureCaptionFontLoaded } from './hooks/captionFontLoader';
import {
  getInputPaths,
  getSessionPathForInputPath,
  readCaptionSession,
  scheduleSessionSettingsRetry,
  syncSessionWithProjectSettings,
  updateCaptionSession,
} from './hooks/captionSessionStore';
import { HardsubSettingsPanel } from './components/HardsubSettingsPanel';
import { BulkApplyResult, ThumbnailListPanel } from './components/ThumbnailListPanel';
import { ThumbnailPreviewPanel } from './components/ThumbnailPreviewPanel';
import { Step3BulkFileItem, Step3BulkMultiFolderModal } from './components/Step3BulkMultiFolderModal';
import { SubtitlePreview } from './SubtitlePreview';
import { calculateHardsubTiming } from '@shared/utils/hardsubTiming';
import { AlertCircle, Download, Eye } from 'lucide-react';
import {
  CaptionProjectSettingsValues,
  CaptionSessionV1,
  CoverQuad,
  TranslationBatchReport as SharedTranslationBatchReport,
  VoiceInfo,
} from '@shared/types/caption';

type TtsVoiceProvider = 'edge' | 'capcut';
type TtsVoiceTier = 'free' | 'pro';
type CommonConfigTab = 'render' | 'typography' | 'audio';
type LayoutSwitchValue = 'landscape' | 'portrait';
type InspectorPane = 'step' | 'common' | 'snapshot' | 'thumbnail' | 'batch3';
type Step3BatchState = NonNullable<CaptionSessionV1['data']['step3BatchState']>;
type Step3BatchStatus = 'waiting' | 'running' | 'success' | 'failed';
type Step3RuntimePhase = 'waiting' | 'running' | 'success' | 'failed';
type Step3BatchRuntimeEntry = {
  phase: Step3RuntimePhase;
  queuedAtMs: number | null;
  dispatchAtMs: number | null;
  completedAtMs: number | null;
  nextAllowedAtMs: number | null;
  error?: string;
};
type Step3BatchViewRow = {
  batchIndex: number;
  status: Step3BatchStatus;
  attempts: number;
  expectedLines: number;
  translatedLines: number;
  lineSummaryLabel: string;
  missingLines: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
  timeLabel: string;
  timeMetaLabel: string;
  missingLabel: string;
  error?: string;
  transportLabel: string;
};
type Step3BatchViewModel = {
  totalBatches: number;
  waitingBatches: number;
  completedBatches: number;
  failedBatches: number;
  runningBatchIndex: number | null;
  missingBatchIndexes: number[];
  updatedAtLabel: string;
  rows: Step3BatchViewRow[];
};
const COMMON_COLOR_HISTORY_LIMIT = 12;
const COMMON_COLOR_HISTORY_STORAGE_PREFIX = 'caption.common.colorHistory.v1';
const SUBTITLE_FONT_SIZE_MIN = 1;
const SUBTITLE_FONT_SIZE_MAX = 200;
const SUBTITLE_FONT_SIZE_DEFAULT = 21;
const THUMBNAIL_FONT_SIZE_MIN = 8;
const THUMBNAIL_FONT_SIZE_MAX = 200;
const THUMBNAIL_FONT_SIZE_DEFAULT = 48;
const STEP3_DEFAULT_LINES_PER_BATCH = 50;
const EDGE_TTS_BATCH_SIZE_MIN = 1;
const EDGE_TTS_BATCH_SIZE_MAX = 500;
const VIDEO_VOLUME_PERCENT_MIN = 0;
const VIDEO_VOLUME_PERCENT_MAX = 200;
const AUDIO_VOLUME_PERCENT_MIN = 0;
const AUDIO_VOLUME_PERCENT_MAX = 400;
const VOLUME_MULTIPLIER_STEP = 0.01;
const STEP4_VOICE_TEST_DEFAULT_TEXT = 'kiểm thử giọng đọc';
const DRAFT_DURATION_FILTER_DEFAULT_MINUTES = 10;

const DEFAULT_COVER_QUAD: CoverQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

interface TtsUiVoiceOption {
  value: string;
  label: string;
  provider: TtsVoiceProvider;
  tier: TtsVoiceTier;
}

type SessionTimingSnapshot = {
  step4SrtScale?: number;
  step7AudioSpeed?: number;
  audioEffectiveSpeed?: number;
  videoSubBaseDuration?: number;
  videoSpeedMultiplier?: number;
  videoMarkerSec?: number;
};

type SessionStepTimingMeta = {
  status?: string;
  startedAt?: string;
  endedAt?: string;
};

type Step3RuntimeTimer = {
  apiLabel: string;
  tokenLabel: string;
  apiStartedAtMs: number | null;
  apiEndedAtMs: number | null;
  tokenStartedAtMs: number | null;
  tokenEndedAtMs: number | null;
};

type StepInspectionViewMode = 'summary' | 'json';
type StepInspectionTone = 'default' | 'warning' | 'error' | 'muted';

type StepInspectionSummaryItem = {
  label: string;
  value: string;
  tone?: StepInspectionTone;
  mono?: boolean;
};

type StepInspectionViewModel = {
  step: Step;
  stepKey: `step${Step}`;
  summaryItems: StepInspectionSummaryItem[];
  stepItems: StepInspectionSummaryItem[];
  artifacts: Array<{
    role: string;
    path: string;
    kind: string;
    note?: string;
  }>;
  maskedJsonPayload: Record<string, unknown>;
};

type StepInspectionCache = {
  sessionPath: string;
  updatedAt: string;
  session: CaptionSessionV1;
};

type ParsedThumbnailBulkApplyRow = {
  indexZeroBased: number;
  text1: string;
  text2?: string;
  hasText2: boolean;
};

type ThumbnailBulkParseMode = 'json_lines' | 'json_plan';

type ThumbnailBulkParseResult =
  | {
      ok: true;
      mode: ThumbnailBulkParseMode;
      sourceCount: number;
      rows: ParsedThumbnailBulkApplyRow[];
      notes: string[];
    }
  | {
      ok: false;
      errorLine: number;
      errorMessage: string;
    };

type PersistThumbnailSessionOverrides = {
  thumbnailText?: string;
  thumbnailTextsByOrder?: string[];
  thumbnailTextsSecondaryByOrder?: string[];
  hardsubTextPrimary?: string;
  hardsubTextSecondary?: string;
  hardsubTextsByOrder?: string[];
  hardsubTextsSecondaryByOrder?: string[];
};
type DraftDurationFilterMode = 'all' | 'above' | 'below';

const SENSITIVE_KEY_PATTERN = /(token|api[_-]?key|secret|password|authorization|cookie)/i;

function getPathBaseName(pathValue: string): string {
  const clean = (pathValue || '').trim();
  if (!clean) {
    return '';
  }
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || clean;
}

function shortenMiddle(value: string, maxLength = 56): string {
  const text = (value || '').trim();
  if (!text || text.length <= maxLength) {
    return text || '--';
  }
  const keep = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${text.slice(0, keep)}...${text.slice(text.length - keep)}`;
}

function formatIsoDisplay(value: string | undefined): string {
  if (!value) {
    return '--';
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return value;
  }
  try {
    return new Date(ms).toLocaleString('vi-VN', { hour12: false });
  } catch {
    return value;
  }
}

function formatStepDuration(startedAt: string | undefined, endedAt: string | undefined, status: string | undefined, nowMs: number): string {
  const startMs = parseIsoToMs(startedAt);
  if (startMs === null) {
    return '--';
  }
  const endMs = parseIsoToMs(endedAt);
  if (endMs !== null && endMs >= startMs) {
    return formatElapsedMs(endMs - startMs);
  }
  if (status === 'running') {
    return formatElapsedMs(Math.max(0, nowMs - startMs));
  }
  return '--';
}

function formatNumberList(values: number[], limit = 40): string {
  if (!Array.isArray(values) || values.length === 0) {
    return '--';
  }
  const normalized = values
    .filter((item): item is number => Number.isFinite(item))
    .map((item) => Math.trunc(item));
  if (normalized.length === 0) {
    return '--';
  }
  if (normalized.length <= limit) {
    return normalized.join(', ');
  }
  const head = normalized.slice(0, limit).join(', ');
  return `${head} ... (+${normalized.length - limit})`;
}

function maskSensitiveString(value: string): string {
  const text = (value || '').trim();
  if (!text) {
    return text;
  }
  if (text.length <= 8) {
    return '***';
  }
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function maskSensitive(value: unknown, keyHint = ''): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return SENSITIVE_KEY_PATTERN.test(keyHint) ? maskSensitiveString(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return SENSITIVE_KEY_PATTERN.test(keyHint) ? '***' : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitive(item, keyHint));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      out[key] = maskSensitive(item, key);
    });
    return out;
  }
  return value;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nearlyEqual(a: number | undefined, b: number | undefined, epsilon = 0.005): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') {
    return false;
  }
  return Math.abs(a - b) <= epsilon;
}

function readTimingSnapshotFromSession(session: Pick<CaptionSessionV1, 'timing' | 'data'>): SessionTimingSnapshot | null {
  const timing = (session.timing && typeof session.timing === 'object')
    ? session.timing as Record<string, unknown>
    : {};
  const data = (session.data && typeof session.data === 'object')
    ? session.data as Record<string, unknown>
    : {};
  const renderTimingPayload = (data.renderTimingPayload && typeof data.renderTimingPayload === 'object')
    ? data.renderTimingPayload as Record<string, unknown>
    : null;
  const afterScale = (renderTimingPayload?.afterScale && typeof renderTimingPayload.afterScale === 'object')
    ? renderTimingPayload.afterScale as Record<string, unknown>
    : null;

  const snapshot: SessionTimingSnapshot = {
    step4SrtScale: toFiniteNumber(timing.step4SrtScale) ?? toFiniteNumber(afterScale?.step4SrtScale),
    step7AudioSpeed: toFiniteNumber(timing.step7AudioSpeed) ?? toFiniteNumber(afterScale?.step7AudioSpeedInput),
    audioEffectiveSpeed: toFiniteNumber(timing.audioEffectiveSpeed) ?? toFiniteNumber(afterScale?.audioEffectiveSpeed),
    videoSubBaseDuration: toFiniteNumber(timing.videoSubBaseDuration) ?? toFiniteNumber(afterScale?.videoWithSubtitleDurationAfterStep4ScaleSec),
    videoSpeedMultiplier: toFiniteNumber(timing.videoSpeedMultiplier) ?? toFiniteNumber(afterScale?.videoSpeedNeeded),
    videoMarkerSec: toFiniteNumber(timing.videoMarkerSec) ?? toFiniteNumber(afterScale?.videoMarkerSec),
  };

  const hasAnyValue = Object.values(snapshot).some((value) => typeof value === 'number');
  return hasAnyValue ? snapshot : null;
}

function parseIsoToMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function formatElapsedMs(elapsedMs: number): string {
  const safeSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function toEpochMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

function formatEpochDisplay(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--';
  }
  try {
    return new Date(value).toLocaleTimeString('vi-VN', { hour12: false });
  } catch {
    return '--';
  }
}

function formatEtaDisplay(nextAllowedAtMs: number | null, nowMs: number): string {
  if (typeof nextAllowedAtMs !== 'number' || !Number.isFinite(nextAllowedAtMs)) {
    return 'ETA --';
  }
  const remainMs = Math.max(0, nextAllowedAtMs - nowMs);
  const atLabel = formatEpochDisplay(nextAllowedAtMs);
  if (remainMs <= 0) {
    return `ETA ${atLabel} (ngay)`;
  }
  return `ETA ${atLabel} (còn ${formatElapsedMs(remainMs)})`;
}

function parseStep3RuntimeHints(message: string): { apiLabel?: string; tokenLabel?: string } {
  const text = (message || '').trim();
  if (!text) {
    return {};
  }
  const apiMatch = text.match(/\[(api|impit|gemini_webapi_queue|grok_ui)\]/i);
  const tokenMatch = text.match(/\[token:([^\]]+)\]/i);
  return {
    apiLabel: apiMatch?.[1]?.toLowerCase(),
    tokenLabel: tokenMatch?.[1]?.trim(),
  };
}

const FALLBACK_TTS_VOICES: TtsUiVoiceOption[] = VOICES.map((voice) => ({
  value: normalizeVoiceValue(voice.value),
  label: voice.label,
  provider: 'edge',
  tier: 'free',
}));

function parseProviderFromVoiceValue(value: string): TtsVoiceProvider {
  if (value.toLowerCase().startsWith('capcut:')) {
    return 'capcut';
  }
  return 'edge';
}

function toUiVoiceOption(voice: VoiceInfo): TtsUiVoiceOption {
  const provider = voice.provider === 'capcut' ? 'capcut' : 'edge';
  const voiceId = (voice.voiceId || voice.name || '').trim();
  const canonical = normalizeVoiceValue(voice.value || `${provider}:${voiceId}`);
  const tier: TtsVoiceTier = voice.tier === 'pro' ? 'pro' : 'free';
  const providerLabel = provider === 'capcut' ? 'CapCut' : 'Edge';
  const tierSuffix = provider === 'capcut' && tier === 'pro' ? ' [PRO]' : '';
  const displayName = (voice.displayName || voice.name || canonical).trim();
  return {
    value: canonical,
    label: `${displayName} (${providerLabel})${tierSuffix}`,
    provider,
    tier,
  };
}

function ensureVoiceOptionExists(
  options: TtsUiVoiceOption[],
  selectedVoice: string
): TtsUiVoiceOption[] {
  const normalized = normalizeVoiceValue(selectedVoice);
  if (options.some((option) => option.value === normalized)) {
    return options;
  }
  const provider = parseProviderFromVoiceValue(normalized);
  return [
    ...options,
    {
      value: normalized,
      label: `${normalized} (Saved)`,
      provider,
      tier: 'free',
    },
  ];
}

function normalizeHexColor(value: string): string | null {
  const raw = (value || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(raw)) {
    return raw;
  }
  if (/^#[0-9A-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function mergeRecentColors(colors: string[], nextColor: string): string[] {
  const normalized = normalizeHexColor(nextColor);
  if (!normalized) {
    return colors;
  }
  const next = [normalized, ...colors.filter((item) => item !== normalized)];
  return next.slice(0, COMMON_COLOR_HISTORY_LIMIT);
}

function formatPercentDisplay(value: number | undefined, fallback = 0): string {
  const safe = Number.isFinite(value) ? (value as number) : fallback;
  const rounded = Math.round(safe * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

function percentToMultiplierDisplayValue(valuePercent: number | undefined, fallbackPercent = 100): number {
  const safePercent = Number.isFinite(valuePercent) ? (valuePercent as number) : fallbackPercent;
  return Math.round((safePercent / 100) * 100) / 100;
}

function multiplierToPercentValue(
  multiplier: number,
  minPercent: number,
  maxPercent: number,
  fallbackPercent: number
): number {
  const safeMultiplier = Number.isFinite(multiplier) ? multiplier : fallbackPercent / 100;
  const percent = Math.round(safeMultiplier * 10000) / 100;
  const bounded = Math.max(minPercent, Math.min(maxPercent, percent));
  return Math.round(bounded * 100) / 100;
}

function formatMultiplierDisplay(multiplier: number | undefined, fallback = 1): string {
  const safe = Number.isFinite(multiplier) ? (multiplier as number) : fallback;
  const rounded = Math.round(safe * 100) / 100;
  if (Number.isInteger(rounded)) {
    return `${rounded}`;
  }
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const wildcard = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${wildcard}$`, 'i');
}

function parseIndexTarget(input: string): { ok: true; indexes: number[] } | { ok: false; error: string } {
  const segments = input.split(',').map((part) => part.trim()).filter(Boolean);
  if (!segments.length) {
    return { ok: false, error: 'target rỗng.' };
  }
  const out = new Set<number>();
  for (const segment of segments) {
    const match = segment.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) {
      return { ok: false, error: `target "${segment}" không hợp lệ.` };
    }
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
      return { ok: false, error: `target "${segment}" phải >= 1.` };
    }
    if (end < start) {
      return { ok: false, error: `target "${segment}" có range ngược.` };
    }
    for (let idx = start; idx <= end; idx++) {
      out.add(idx - 1);
    }
  }
  return { ok: true, indexes: Array.from(out).sort((a, b) => a - b) };
}

function parseThumbnailBulkJsonLines(raw: string): ThumbnailBulkParseResult {
  const lines = raw.split(/\r?\n/);
  const rows: ParsedThumbnailBulkApplyRow[] = [];
  let nonEmptyLineCount = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNumber = idx + 1;
    const sourceLine = lines[idx];
    const trimmed = sourceLine.trim();
    if (!trimmed) {
      continue;
    }
    nonEmptyLineCount += 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'JSON không hợp lệ.';
      return {
        ok: false,
        errorLine: lineNumber,
        errorMessage: message,
      };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        errorLine: lineNumber,
        errorMessage: 'Mỗi dòng phải là object JSON dạng {"text1":"...","text2":"..."}',
      };
    }

    const row = parsed as Record<string, unknown>;
    if (typeof row.text1 !== 'string' || !row.text1.trim()) {
      return {
        ok: false,
        errorLine: lineNumber,
        errorMessage: 'Thiếu text1 hoặc text1 không phải string.',
      };
    }

    if (Object.prototype.hasOwnProperty.call(row, 'text2') && typeof row.text2 !== 'string') {
      return {
        ok: false,
        errorLine: lineNumber,
        errorMessage: 'text2 phải là string khi có khai báo.',
      };
    }

    const parsedLine: ParsedThumbnailBulkApplyRow = {
      indexZeroBased: rows.length,
      text1: row.text1.trim(),
      hasText2: Object.prototype.hasOwnProperty.call(row, 'text2'),
    };
    if (parsedLine.hasText2) {
      parsedLine.text2 = (row.text2 as string).trim();
    }
    rows.push(parsedLine);
  }

  return {
    ok: true,
    mode: 'json_lines',
    sourceCount: nonEmptyLineCount,
    rows,
    notes: [],
  };
}

function isJsonPlanPayload(parsed: unknown): boolean {
  if (Array.isArray(parsed)) {
    return true;
  }
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  const payload = parsed as Record<string, unknown>;
  return Array.isArray(payload.blocks) || Array.isArray(payload.items) || Array.isArray(payload.rows) || Object.prototype.hasOwnProperty.call(payload, 'defaultText2');
}

function parseThumbnailBulkJsonPlan(
  payload: unknown,
  folderItems: ThumbnailFolderItem[]
): ThumbnailBulkParseResult {
  const root = (payload && typeof payload === 'object' && !Array.isArray(payload))
    ? payload as Record<string, unknown>
    : {};
  const blocks = Array.isArray(payload)
    ? payload as unknown[]
    : Array.isArray(root.blocks)
      ? root.blocks as unknown[]
      : Array.isArray(root.items)
        ? root.items as unknown[]
        : Array.isArray(root.rows)
          ? root.rows as unknown[]
          : null;

  if (!blocks) {
    return {
      ok: false,
      errorLine: 1,
      errorMessage: 'JSON plan cần mảng "blocks" (hoặc "items"/"rows").',
    };
  }

  const defaultText2 = typeof root.defaultText2 === 'string' ? root.defaultText2.trim() : undefined;
  const rowsByIndex = new Map<number, ParsedThumbnailBulkApplyRow>();
  const notes: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockLabel = `Block #${i + 1}`;
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      return {
        ok: false,
        errorLine: i + 1,
        errorMessage: `${blockLabel} phải là object JSON.`,
      };
    }
    const row = block as Record<string, unknown>;

    let indexes: number[] = [];
    if (typeof row.index === 'number' && Number.isFinite(row.index)) {
      const indexZero = Math.trunc(row.index) - 1;
      if (indexZero < 0) {
        return {
          ok: false,
          errorLine: i + 1,
          errorMessage: `${blockLabel}: index phải >= 1.`,
        };
      }
      indexes = [indexZero];
    } else if (typeof row.target === 'string' && row.target.trim()) {
      const parsedTarget = parseIndexTarget(row.target.trim());
      if (!parsedTarget.ok) {
        return {
          ok: false,
          errorLine: i + 1,
          errorMessage: `${blockLabel}: ${parsedTarget.error}`,
        };
      }
      indexes = parsedTarget.indexes;
    } else if (typeof row.match === 'string' && row.match.trim()) {
      const matcher = wildcardToRegExp(row.match.trim());
      indexes = folderItems
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => matcher.test(item.folderName) || matcher.test(item.folderPath))
        .map(({ idx }) => idx);
      if (!indexes.length) {
        notes.push(`${blockLabel}: không match folder nào (${row.match}).`);
      }
    } else {
      return {
        ok: false,
        errorLine: i + 1,
        errorMessage: `${blockLabel}: thiếu target/index/match để map video.`,
      };
    }

    const hasText2 = Object.prototype.hasOwnProperty.call(row, 'text2');
    if (hasText2 && typeof row.text2 !== 'string') {
      return {
        ok: false,
        errorLine: i + 1,
        errorMessage: `${blockLabel}: text2 phải là string khi có khai báo.`,
      };
    }
    const text2Value = hasText2 ? (row.text2 as string).trim() : undefined;

    const hasTemplate = typeof row.text1Template === 'string' && row.text1Template.trim().length > 0;
    const hasText1 = typeof row.text1 === 'string' && row.text1.trim().length > 0;
    const hasEpisodeStart = typeof row.episodeStart === 'number' && Number.isFinite(row.episodeStart);
    const episodeStart = hasEpisodeStart ? Math.trunc(row.episodeStart as number) : 1;

    if (!hasTemplate && !hasText1 && !hasEpisodeStart) {
      return {
        ok: false,
        errorLine: i + 1,
        errorMessage: `${blockLabel}: cần text1 hoặc text1Template hoặc episodeStart.`,
      };
    }

    const orderedIndexes = Array.from(new Set(indexes)).sort((a, b) => a - b);
    orderedIndexes.forEach((indexZeroBased, localPos) => {
      if (indexZeroBased < 0 || indexZeroBased >= folderItems.length) {
        return;
      }
      let text1 = '';
      if (hasText1) {
        text1 = (row.text1 as string).trim();
      } else {
        const template = hasTemplate ? (row.text1Template as string) : 'Tập {n}';
        const valueN = episodeStart + localPos;
        text1 = template.replace(/\{n\}/g, String(valueN)).trim();
      }
      if (!text1) {
        return;
      }
      rowsByIndex.set(indexZeroBased, {
        indexZeroBased,
        text1,
        hasText2,
        ...(hasText2 ? { text2: text2Value } : {}),
      });
    });
  }

  if (typeof defaultText2 === 'string') {
    rowsByIndex.forEach((value, key) => {
      if (!value.hasText2) {
        rowsByIndex.set(key, {
          ...value,
          hasText2: true,
          text2: defaultText2,
        });
      }
    });
  }

  return {
    ok: true,
    mode: 'json_plan',
    sourceCount: blocks.length,
    rows: Array.from(rowsByIndex.values()).sort((a, b) => a.indexZeroBased - b.indexZeroBased),
    notes,
  };
}

function parseThumbnailBulkInput(raw: string, folderItems: ThumbnailFolderItem[]): ThumbnailBulkParseResult {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return {
      ok: true,
      mode: 'json_lines',
      sourceCount: 0,
      rows: [],
      notes: [],
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (isJsonPlanPayload(parsed)) {
      return parseThumbnailBulkJsonPlan(parsed, folderItems);
    }
  } catch {
    // Fallback to JSON lines parser below.
  }

  return parseThumbnailBulkJsonLines(raw);
}

function resolveSharedPrimaryTextFromStep7(step7: Record<string, unknown>): string {
  if (typeof step7.thumbnailText === 'string') return step7.thumbnailText;
  return '';
}

function resolveSharedSecondaryTextFromStep7(step7: Record<string, unknown>): string {
  if (typeof step7.thumbnailTextSecondary === 'string') return step7.thumbnailTextSecondary;
  return '';
}

type CaptionLayoutProfile = NonNullable<CaptionProjectSettingsValues['layoutProfiles']>['landscape'];

function sanitizeCaptionLayoutProfile(profile?: CaptionLayoutProfile): CaptionLayoutProfile | undefined {
  if (!profile) {
    return profile;
  }
  const {
    logoPath: _logoPath,
    thumbnailTextSecondary: _thumbnailTextSecondary,
    hardsubTextPrimary: _hardsubTextPrimary,
    hardsubTextSecondary: _hardsubTextSecondary,
    hardsubPortraitTextPrimary: _hardsubPortraitTextPrimary,
    hardsubPortraitTextSecondary: _hardsubPortraitTextSecondary,
    ...rest
  } = profile;
  return rest as CaptionLayoutProfile;
}

function sanitizeCaptionDefaults(settings: CaptionProjectSettingsValues): CaptionProjectSettingsValues {
  const {
    audioDir: _audioDir,
    logoPath: _logoPath,
    thumbnailText: _thumbnailText,
    thumbnailTextSecondary: _thumbnailTextSecondary,
    thumbnailTextsByOrder: _thumbnailTextsByOrder,
    thumbnailTextsSecondaryByOrder: _thumbnailTextsSecondaryByOrder,
    thumbnailTextSecondaryByOrder: _thumbnailTextSecondaryByOrder,
    hardsubTextPrimary: _hardsubTextPrimary,
    hardsubTextSecondary: _hardsubTextSecondary,
    hardsubTextsByOrder: _hardsubTextsByOrder,
    hardsubTextsSecondaryByOrder: _hardsubTextsSecondaryByOrder,
    hardsubPortraitTextPrimary: _hardsubPortraitTextPrimary,
    hardsubPortraitTextSecondary: _hardsubPortraitTextSecondary,
    layoutProfiles,
    ...rest
  } = settings;

  const sanitizedLayoutProfiles = layoutProfiles
    ? {
        landscape: sanitizeCaptionLayoutProfile(layoutProfiles.landscape),
        portrait: sanitizeCaptionLayoutProfile(layoutProfiles.portrait),
      }
    : undefined;

  return {
    ...rest,
    ...(sanitizedLayoutProfiles ? { layoutProfiles: sanitizedLayoutProfiles } : {}),
  };
}

export function CaptionTranslator() {
  // Project output paths
  const { paths, projectId } = useProjectContext();
  const captionFolder = paths?.caption ?? null;

  // 1. Settings Hook
  const settings = useCaptionSettings();
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<TtsUiVoiceOption[]>(() =>
    ensureVoiceOptionExists(FALLBACK_TTS_VOICES, settings.voice)
  );
  const [commonColorHistory, setCommonColorHistory] = useState<string[]>([]);
  const commonColorHistoryStorageKey = useMemo(
    () => `${COMMON_COLOR_HISTORY_STORAGE_PREFIX}:${projectId || 'global'}`,
    [projectId]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(commonColorHistoryStorageKey);
      if (!raw) {
        setCommonColorHistory([]);
        return;
      }
      const parsed = JSON.parse(raw);
      const source = Array.isArray(parsed) ? parsed : [];
      const normalized = source
        .map((item) => normalizeHexColor(String(item)))
        .filter((item): item is string => Boolean(item));
      const deduped: string[] = [];
      for (const color of normalized) {
        if (!deduped.includes(color)) {
          deduped.push(color);
        }
      }
      setCommonColorHistory(deduped.slice(0, COMMON_COLOR_HISTORY_LIMIT));
    } catch {
      setCommonColorHistory([]);
    }
  }, [commonColorHistoryStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(commonColorHistoryStorageKey, JSON.stringify(commonColorHistory));
    } catch {
      // Ignore persistence errors in renderer.
    }
  }, [commonColorHistoryStorageKey, commonColorHistory]);

  useEffect(() => {
    const candidates = [
      settings.style?.fontColor,
      settings.thumbnailTextPrimaryColor,
      settings.thumbnailTextSecondaryColor,
      settings.portraitTextPrimaryColor,
      settings.portraitTextSecondaryColor,
    ];
    setCommonColorHistory((prev) => {
      if (prev.length > 0) {
        return prev;
      }
      let next: string[] = [];
      for (const candidate of candidates) {
        const normalized = normalizeHexColor(candidate || '');
        if (normalized) {
          next = mergeRecentColors(next, normalized);
        }
      }
      return next;
    });
  }, [
    settings.style?.fontColor,
    settings.thumbnailTextPrimaryColor,
    settings.thumbnailTextSecondaryColor,
    settings.portraitTextPrimaryColor,
    settings.portraitTextSecondaryColor,
  ]);

  const rememberCommonColor = useCallback((rawColor: string): string | null => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) {
      return null;
    }
    setCommonColorHistory((prev) => mergeRecentColors(prev, normalized));
    return normalized;
  }, []);

  const applySubtitleFontColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setStyle((s: any) => ({ ...s, fontColor: normalized }));
  }, [settings.setStyle]);

  const commitSubtitleFontColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setStyle((s: any) => ({ ...s, fontColor: normalized }));
    rememberCommonColor(normalized);
  }, [rememberCommonColor, settings.setStyle]);

  const applyThumbnailTextPrimaryColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setThumbnailTextPrimaryColor(normalized);
  }, [settings.setThumbnailTextPrimaryColor]);

  const commitThumbnailTextPrimaryColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setThumbnailTextPrimaryColor(normalized);
    rememberCommonColor(normalized);
  }, [rememberCommonColor, settings.setThumbnailTextPrimaryColor]);

  const applyThumbnailTextSecondaryColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setThumbnailTextSecondaryColor(normalized);
  }, [settings.setThumbnailTextSecondaryColor]);

  const commitThumbnailTextSecondaryColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setThumbnailTextSecondaryColor(normalized);
    rememberCommonColor(normalized);
  }, [rememberCommonColor, settings.setThumbnailTextSecondaryColor]);
  const applyPortraitTextPrimaryColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setPortraitTextPrimaryColor(normalized);
  }, [settings.setPortraitTextPrimaryColor]);
  const commitPortraitTextPrimaryColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setPortraitTextPrimaryColor(normalized);
    rememberCommonColor(normalized);
  }, [rememberCommonColor, settings.setPortraitTextPrimaryColor]);
  const applyPortraitTextSecondaryColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setPortraitTextSecondaryColor(normalized);
  }, [settings.setPortraitTextSecondaryColor]);
  const commitPortraitTextSecondaryColor = useCallback((rawColor: string) => {
    const normalized = normalizeHexColor(rawColor);
    if (!normalized) return;
    settings.setPortraitTextSecondaryColor(normalized);
    rememberCommonColor(normalized);
  }, [rememberCommonColor, settings.setPortraitTextSecondaryColor]);

  const renderColorHistory = useCallback((
    currentColor: string,
    onPick: (color: string) => void
  ) => {
    if (commonColorHistory.length === 0) return null;
    const activeColor = normalizeHexColor(currentColor);
    return (
      <div className={styles.colorHistoryBlock}>
        <div className={styles.colorHistoryLabel}>Màu đã dùng gần đây</div>
        <div className={styles.colorHistoryRow}>
          {commonColorHistory.map((color) => (
            <button
              key={color}
              type="button"
              className={`${styles.colorSwatchBtn} ${activeColor === color ? styles.colorSwatchBtnActive : ''}`}
              style={{ backgroundColor: color }}
              title={`Dùng màu ${color}`}
              aria-label={`Dùng màu ${color}`}
              onClick={() => onPick(color)}
            />
          ))}
        </div>
      </div>
    );
  }, [commonColorHistory]);

  const subtitleFontSizeValue = clampInteger(
    Number(settings.subtitleFontSizeRel),
    SUBTITLE_FONT_SIZE_MIN,
    SUBTITLE_FONT_SIZE_MAX,
    SUBTITLE_FONT_SIZE_DEFAULT
  );
  const thumbnailTextPrimaryFontSizeValue = clampInteger(
    Number(settings.thumbnailTextPrimaryFontSizeRel),
    THUMBNAIL_FONT_SIZE_MIN,
    THUMBNAIL_FONT_SIZE_MAX,
    THUMBNAIL_FONT_SIZE_DEFAULT
  );
  const thumbnailTextSecondaryFontSizeValue = clampInteger(
    Number(settings.thumbnailTextSecondaryFontSizeRel),
    THUMBNAIL_FONT_SIZE_MIN,
    THUMBNAIL_FONT_SIZE_MAX,
    THUMBNAIL_FONT_SIZE_DEFAULT
  );
  const portraitTextPrimaryFontSizeValue = clampInteger(
    Number(settings.portraitTextPrimaryFontSizeRel),
    THUMBNAIL_FONT_SIZE_MIN,
    THUMBNAIL_FONT_SIZE_MAX,
    THUMBNAIL_FONT_SIZE_DEFAULT
  );
  const portraitTextSecondaryFontSizeValue = clampInteger(
    Number(settings.portraitTextSecondaryFontSizeRel),
    THUMBNAIL_FONT_SIZE_MIN,
    THUMBNAIL_FONT_SIZE_MAX,
    THUMBNAIL_FONT_SIZE_DEFAULT
  );

  const [subtitleFontSizeInput, setSubtitleFontSizeInput] = useState(String(subtitleFontSizeValue));
  const [thumbnailTextPrimaryFontSizeInput, setThumbnailTextPrimaryFontSizeInput] = useState(String(thumbnailTextPrimaryFontSizeValue));
  const [thumbnailTextSecondaryFontSizeInput, setThumbnailTextSecondaryFontSizeInput] = useState(String(thumbnailTextSecondaryFontSizeValue));
  const [portraitTextPrimaryFontSizeInput, setPortraitTextPrimaryFontSizeInput] = useState(String(portraitTextPrimaryFontSizeValue));
  const [portraitTextSecondaryFontSizeInput, setPortraitTextSecondaryFontSizeInput] = useState(String(portraitTextSecondaryFontSizeValue));

  useEffect(() => {
    setSubtitleFontSizeInput(String(subtitleFontSizeValue));
  }, [subtitleFontSizeValue]);

  useEffect(() => {
    setThumbnailTextPrimaryFontSizeInput(String(thumbnailTextPrimaryFontSizeValue));
  }, [thumbnailTextPrimaryFontSizeValue]);

  useEffect(() => {
    setThumbnailTextSecondaryFontSizeInput(String(thumbnailTextSecondaryFontSizeValue));
  }, [thumbnailTextSecondaryFontSizeValue]);
  useEffect(() => {
    setPortraitTextPrimaryFontSizeInput(String(portraitTextPrimaryFontSizeValue));
  }, [portraitTextPrimaryFontSizeValue]);
  useEffect(() => {
    setPortraitTextSecondaryFontSizeInput(String(portraitTextSecondaryFontSizeValue));
  }, [portraitTextSecondaryFontSizeValue]);

  const commitSubtitleFontSizeInput = useCallback(() => {
    const parsed = Number(subtitleFontSizeInput.trim());
    const normalized = clampInteger(
      parsed,
      SUBTITLE_FONT_SIZE_MIN,
      SUBTITLE_FONT_SIZE_MAX,
      subtitleFontSizeValue
    );
    settings.setSubtitleFontSizeRel(normalized);
    setSubtitleFontSizeInput(String(normalized));
  }, [settings.setSubtitleFontSizeRel, subtitleFontSizeInput, subtitleFontSizeValue]);

  const commitThumbnailTextPrimaryFontSizeInput = useCallback(() => {
    const parsed = Number(thumbnailTextPrimaryFontSizeInput.trim());
    const normalized = clampInteger(
      parsed,
      THUMBNAIL_FONT_SIZE_MIN,
      THUMBNAIL_FONT_SIZE_MAX,
      thumbnailTextPrimaryFontSizeValue
    );
    settings.setThumbnailTextPrimaryFontSize(normalized);
    setThumbnailTextPrimaryFontSizeInput(String(normalized));
  }, [
    settings.setThumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryFontSizeInput,
    thumbnailTextPrimaryFontSizeValue,
  ]);

  const commitThumbnailTextSecondaryFontSizeInput = useCallback(() => {
    const parsed = Number(thumbnailTextSecondaryFontSizeInput.trim());
    const normalized = clampInteger(
      parsed,
      THUMBNAIL_FONT_SIZE_MIN,
      THUMBNAIL_FONT_SIZE_MAX,
      thumbnailTextSecondaryFontSizeValue
    );
    settings.setThumbnailTextSecondaryFontSize(normalized);
    setThumbnailTextSecondaryFontSizeInput(String(normalized));
  }, [
    settings.setThumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryFontSizeInput,
    thumbnailTextSecondaryFontSizeValue,
  ]);
  const commitPortraitTextPrimaryFontSizeInput = useCallback(() => {
    const parsed = Number(portraitTextPrimaryFontSizeInput.trim());
    const normalized = clampInteger(
      parsed,
      THUMBNAIL_FONT_SIZE_MIN,
      THUMBNAIL_FONT_SIZE_MAX,
      portraitTextPrimaryFontSizeValue
    );
    settings.setPortraitTextPrimaryFontSize(normalized);
    setPortraitTextPrimaryFontSizeInput(String(normalized));
  }, [
    portraitTextPrimaryFontSizeInput,
    portraitTextPrimaryFontSizeValue,
    settings.setPortraitTextPrimaryFontSize,
  ]);
  const commitPortraitTextSecondaryFontSizeInput = useCallback(() => {
    const parsed = Number(portraitTextSecondaryFontSizeInput.trim());
    const normalized = clampInteger(
      parsed,
      THUMBNAIL_FONT_SIZE_MIN,
      THUMBNAIL_FONT_SIZE_MAX,
      portraitTextSecondaryFontSizeValue
    );
    settings.setPortraitTextSecondaryFontSize(normalized);
    setPortraitTextSecondaryFontSizeInput(String(normalized));
  }, [
    portraitTextSecondaryFontSizeInput,
    portraitTextSecondaryFontSizeValue,
    settings.setPortraitTextSecondaryFontSize,
  ]);

  useEffect(() => {
    const normalizedVoice = normalizeVoiceValue(settings.voice);
    if (normalizedVoice !== settings.voice) {
      settings.setVoice(normalizedVoice);
      return;
    }
    setTtsVoiceOptions((current) => ensureVoiceOptionExists(current, normalizedVoice));
  }, [settings.voice, settings.setVoice]);

  useEffect(() => {
    let cancelled = false;

    const loadTtsVoices = async () => {
      try {
        const response = await window.electronAPI.tts.getVoices();
        if (!response?.success || !Array.isArray(response.data) || response.data.length === 0) {
          if (!cancelled) {
            setTtsVoiceOptions(ensureVoiceOptionExists(FALLBACK_TTS_VOICES, settings.voice));
          }
          return;
        }

        const deduped = new Map<string, TtsUiVoiceOption>();
        for (const voice of response.data) {
          const mapped = toUiVoiceOption(voice);
          if (!deduped.has(mapped.value)) {
            deduped.set(mapped.value, mapped);
          }
        }

        const nextOptions = Array.from(deduped.values());
        if (!cancelled) {
          setTtsVoiceOptions(ensureVoiceOptionExists(nextOptions, settings.voice));
        }
      } catch (error) {
        console.warn('[CaptionTranslator] Không thể tải voice list từ main process', error);
        if (!cancelled) {
          setTtsVoiceOptions(ensureVoiceOptionExists(FALLBACK_TTS_VOICES, settings.voice));
        }
      }
    };

    loadTtsVoices();
    return () => {
      cancelled = true;
    };
  }, []);

  const edgeVoiceOptions = useMemo(
    () => ttsVoiceOptions.filter((voice) => voice.provider === 'edge'),
    [ttsVoiceOptions]
  );
  const capCutVoiceOptions = useMemo(
    () => ttsVoiceOptions.filter((voice) => voice.provider === 'capcut'),
    [ttsVoiceOptions]
  );
  const isCapCutVoiceSelected = useMemo(
    () => normalizeVoiceValue(settings.voice).startsWith('capcut:'),
    [settings.voice]
  );
  const selectedVoiceLabel = useMemo(
    () => ttsVoiceOptions.find((voice) => voice.value === settings.voice)?.label || settings.voice,
    [settings.voice, ttsVoiceOptions]
  );
  const [step4VoiceTestText, setStep4VoiceTestText] = useState(STEP4_VOICE_TEST_DEFAULT_TEXT);
  const [step4VoiceTestState, setStep4VoiceTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [step4VoiceTestMessage, setStep4VoiceTestMessage] = useState('');
  const [isStep4VoiceTestPlaying, setIsStep4VoiceTestPlaying] = useState(false);
  const step4VoiceTestAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopStep4VoiceTestPlayback = useCallback(() => {
    const audio = step4VoiceTestAudioRef.current;
    if (!audio) {
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    setIsStep4VoiceTestPlaying(false);
  }, []);

  const playStep4VoiceTestAudio = useCallback(async (audioDataUri: string) => {
    if (!audioDataUri) {
      throw new Error('Audio sample rỗng.');
    }
    const audio = step4VoiceTestAudioRef.current;
    if (!audio) {
      throw new Error('Không thể khởi tạo audio test.');
    }
    if (audio.src !== audioDataUri) {
      audio.src = audioDataUri;
    }
    audio.currentTime = 0;
    await audio.play();
  }, []);

  useEffect(() => {
    const audio = new Audio();
    const handlePlay = () => setIsStep4VoiceTestPlaying(true);
    const handlePause = () => setIsStep4VoiceTestPlaying(false);
    const handleEnded = () => setIsStep4VoiceTestPlaying(false);
    const handleError = () => {
      setIsStep4VoiceTestPlaying(false);
      setStep4VoiceTestState('error');
      setStep4VoiceTestMessage('Không thể phát audio test.');
    };
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    step4VoiceTestAudioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      step4VoiceTestAudioRef.current = null;
    };
  }, []);

  // 2. File Management Hook
  const fileManager = useCaptionFileManagement({
    inputType: settings.inputType,
  });
  const [draftDurationFilterMode, setDraftDurationFilterMode] = useState<DraftDurationFilterMode>('all');
  const [draftDurationFilterMinutes, setDraftDurationFilterMinutes] = useState<number>(
    DRAFT_DURATION_FILTER_DEFAULT_MINUTES
  );
  const selectedInputPaths = useMemo(
    () => getInputPaths('draft', fileManager.filePath),
    [fileManager.filePath]
  );
  const draftDurationFilterThresholdMinutes = useMemo(
    () => (Number.isFinite(draftDurationFilterMinutes) && draftDurationFilterMinutes >= 0 ? draftDurationFilterMinutes : 0),
    [draftDurationFilterMinutes]
  );
  const draftDurationFilterStats = useMemo(() => {
    const nextFilteredPaths: string[] = [];
    let missingDurationCount = 0;
    let excludedByThresholdCount = 0;

    if (draftDurationFilterMode === 'all') {
      return {
        filteredPaths: selectedInputPaths,
        missingDurationCount: 0,
        excludedByThresholdCount: 0,
      };
    }

    for (const folderPath of selectedInputPaths) {
      const durationSec = fileManager.folderVideos[folderPath]?.duration;
      if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
        missingDurationCount += 1;
        continue;
      }
      const durationMinutes = durationSec / 60;
      const isMatched = draftDurationFilterMode === 'above'
        ? durationMinutes >= draftDurationFilterThresholdMinutes
        : durationMinutes <= draftDurationFilterThresholdMinutes;
      if (isMatched) {
        nextFilteredPaths.push(folderPath);
      } else {
        excludedByThresholdCount += 1;
      }
    }

    return {
      filteredPaths: nextFilteredPaths,
      missingDurationCount,
      excludedByThresholdCount,
    };
  }, [
    draftDurationFilterMode,
    draftDurationFilterThresholdMinutes,
    fileManager.folderVideos,
    selectedInputPaths,
  ]);
  const filteredDraftInputPaths = draftDurationFilterStats.filteredPaths;
  const prevFilteredDraftPathsRef = useRef<string[]>([]);
  const prevDraftFilePathRef = useRef<string>('');
  const [selectedDraftRunPaths, setSelectedDraftRunPaths] = useState<string[]>([]);
  const selectedDraftRunSet = useMemo(() => new Set(selectedDraftRunPaths), [selectedDraftRunPaths]);

  useEffect(() => {
    if (settings.inputType !== 'draft') {
      prevFilteredDraftPathsRef.current = [];
      prevDraftFilePathRef.current = '';
      setSelectedDraftRunPaths([]);
      return;
    }
    const currentFilePath = fileManager.filePath || '';
    const prevFilePath = prevDraftFilePathRef.current;
    if (currentFilePath !== prevFilePath) {
      prevDraftFilePathRef.current = currentFilePath;
      prevFilteredDraftPathsRef.current = filteredDraftInputPaths;
      setSelectedDraftRunPaths(filteredDraftInputPaths);
      return;
    }
    setSelectedDraftRunPaths((prev) => {
      const prevSelected = new Set(prev);
      const prevFiltered = new Set(prevFilteredDraftPathsRef.current);
      const next: string[] = [];
      for (const path of filteredDraftInputPaths) {
        if (prevFiltered.has(path)) {
          if (prevSelected.has(path)) {
            next.push(path);
          }
        } else {
          next.push(path);
        }
      }
      prevFilteredDraftPathsRef.current = filteredDraftInputPaths;
      return next;
    });
  }, [filteredDraftInputPaths, settings.inputType, fileManager.filePath]);
  
  const toggleDraftRunPath = useCallback((path: string) => {
    setSelectedDraftRunPaths((prev) => {
      const prevSet = new Set(prev);
      if (prevSet.has(path)) {
        return prev.filter((item) => item !== path);
      }
      return [...prev, path];
    });
  }, []);

  const handleSelectAllDraftRuns = useCallback(() => {
    setSelectedDraftRunPaths([...filteredDraftInputPaths]);
  }, [filteredDraftInputPaths]);

  const handleClearDraftRuns = useCallback(() => {
    setSelectedDraftRunPaths([]);
  }, []);

  const processingInputPaths = useMemo(
    () => (settings.inputType === 'draft'
      ? selectedDraftRunPaths
      : getInputPaths(settings.inputType, fileManager.filePath)),
    [settings.inputType, selectedDraftRunPaths, fileManager.filePath]
  );
  const isStep3MultiFolderMode = settings.inputType === 'draft' && processingInputPaths.length > 1;

  const hardsubSettings = useHardsubSettings({
    inputType: settings.inputType,
    filePath: fileManager.filePath,
    folderVideos: fileManager.folderVideos,
    thumbnailEnabled: settings.thumbnailFrameTimeSec !== null && settings.thumbnailFrameTimeSec !== undefined,
  });
  const thumbnailSessionHydrationKey = useMemo(
    () => `${projectId || ''}::${settings.inputType}::${fileManager.filePath || ''}`,
    [projectId, settings.inputType, fileManager.filePath]
  );
  const thumbnailSessionHydratedKeyRef = useRef<string | null>(null);
  const thumbnailHydrationReadyTimerRef = useRef<number | null>(null);
  const [isThumbnailSessionHydrating, setIsThumbnailSessionHydrating] = useState(false);
  const [thumbnailSessionHydrationRevision, setThumbnailSessionHydrationRevision] = useState(0);
  const [thumbnailManualSaveState, setThumbnailManualSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [thumbnailManualSaveMessage, setThumbnailManualSaveMessage] = useState('');
  const [thumbnailBulkExportState, setThumbnailBulkExportState] = useState<{
    status: 'idle' | 'running' | 'success' | 'error';
    message?: string;
    detail?: string;
  }>({ status: 'idle', message: '' });

  const projectSettingsSnapshot = useMemo<CaptionProjectSettingsValues>(() => ({
    fontSizeScaleVersion: settings.fontSizeScaleVersion,
    subtitleFontSizeRel: settings.subtitleFontSizeRel,
    inputType: settings.inputType,
    geminiModel: settings.geminiModel,
    translateMethod: settings.translateMethod,
    voice: settings.voice,
    rate: settings.rate,
    volume: settings.volume,
    edgeTtsBatchSize: settings.edgeTtsBatchSize,
    srtSpeed: settings.srtSpeed,
    splitByLines: settings.splitByLines,
    linesPerFile: settings.linesPerFile,
    numberOfParts: settings.numberOfParts,
    enabledSteps: Array.from(settings.enabledSteps.values()),
    audioDir: settings.audioDir,
    autoFitAudio: settings.autoFitAudio,
    trimAudioEnabled: settings.trimAudioEnabled,
    hardwareAcceleration: settings.hardwareAcceleration,
    style: settings.style,
    renderMode: settings.renderMode,
    renderResolution: settings.renderResolution,
    renderContainer: settings.renderContainer,
    blackoutTop: settings.blackoutTop,
    coverMode: settings.coverMode,
    coverQuad: settings.coverQuad,
    coverFeatherPx: settings.coverFeatherPx,
    coverFeatherHorizontalPx: settings.coverFeatherHorizontalPx,
    coverFeatherVerticalPx: settings.coverFeatherVerticalPx,
    coverFeatherHorizontalPercent: settings.coverFeatherHorizontalPercent,
    coverFeatherVerticalPercent: settings.coverFeatherVerticalPercent,
    audioSpeed: settings.audioSpeed,
    renderAudioSpeed: settings.renderAudioSpeed,
    videoVolume: settings.videoVolume,
    audioVolume: settings.audioVolume,
    thumbnailFontName: settings.thumbnailFontName,
    thumbnailFontSize: settings.thumbnailFontSize,
    thumbnailFontSizeRel: settings.thumbnailFontSizeRel,
    thumbnailTextPrimaryFontName: settings.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: settings.thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryFontSizeRel: settings.thumbnailTextPrimaryFontSizeRel,
    thumbnailTextPrimaryColor: settings.thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName: settings.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: settings.thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryFontSizeRel: settings.thumbnailTextSecondaryFontSizeRel,
    thumbnailTextSecondaryColor: settings.thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio: settings.thumbnailLineHeightRatio,
    thumbnailText: hardsubSettings.thumbnailText,
    thumbnailTextSecondary: hardsubSettings.thumbnailTextSecondary,
    thumbnailTextsByOrder: hardsubSettings.thumbnailTextsByOrder,
    thumbnailTextsSecondaryByOrder: hardsubSettings.thumbnailTextsSecondaryByOrder,
    hardsubTextPrimary: hardsubSettings.videoText,
    hardsubTextSecondary: hardsubSettings.videoTextSecondary,
    hardsubTextsByOrder: hardsubSettings.videoTextsByOrder,
    hardsubTextsSecondaryByOrder: hardsubSettings.videoTextsSecondaryByOrder,
    hardsubPortraitTextPrimary: hardsubSettings.videoText,
    hardsubPortraitTextSecondary: hardsubSettings.videoTextSecondary,
    thumbnailTextPrimaryPosition: settings.thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition: settings.thumbnailTextSecondaryPosition,
    portraitTextPrimaryFontName: settings.portraitTextPrimaryFontName,
    portraitTextPrimaryFontSize: settings.portraitTextPrimaryFontSize,
    portraitTextPrimaryFontSizeRel: settings.portraitTextPrimaryFontSizeRel,
    portraitTextPrimaryColor: settings.portraitTextPrimaryColor,
    portraitTextSecondaryFontName: settings.portraitTextSecondaryFontName,
    portraitTextSecondaryFontSize: settings.portraitTextSecondaryFontSize,
    portraitTextSecondaryFontSizeRel: settings.portraitTextSecondaryFontSizeRel,
    portraitTextSecondaryColor: settings.portraitTextSecondaryColor,
    portraitTextPrimaryPosition: settings.portraitTextPrimaryPosition,
    portraitTextSecondaryPosition: settings.portraitTextSecondaryPosition,
    subtitlePosition: settings.subtitlePosition,
    thumbnailFrameTimeSec: settings.thumbnailFrameTimeSec,
    thumbnailDurationSec: settings.thumbnailDurationSec,
    logoPath: settings.logoPath,
    logoPosition: settings.logoPosition,
    logoScale: settings.logoScale,
    portraitForegroundCropPercent: settings.portraitForegroundCropPercent,
    layoutProfiles: settings.layoutProfiles,
    processingMode: settings.processingMode,
  }), [
    settings.fontSizeScaleVersion,
    settings.subtitleFontSizeRel,
    settings.inputType,
    settings.geminiModel,
    settings.translateMethod,
    settings.voice,
    settings.rate,
    settings.volume,
    settings.edgeTtsBatchSize,
    settings.srtSpeed,
    settings.splitByLines,
    settings.linesPerFile,
    settings.numberOfParts,
    settings.enabledSteps,
    settings.audioDir,
    settings.autoFitAudio,
    settings.trimAudioEnabled,
    settings.hardwareAcceleration,
    settings.style,
    settings.renderMode,
    settings.renderResolution,
    settings.renderContainer,
    settings.blackoutTop,
    settings.coverMode,
    settings.coverQuad,
    settings.coverFeatherPx,
    settings.coverFeatherHorizontalPx,
    settings.coverFeatherVerticalPx,
    settings.coverFeatherHorizontalPercent,
    settings.coverFeatherVerticalPercent,
    settings.audioSpeed,
    settings.renderAudioSpeed,
    settings.videoVolume,
    settings.audioVolume,
    settings.thumbnailFontName,
    settings.thumbnailFontSize,
    settings.thumbnailFontSizeRel,
    settings.thumbnailTextPrimaryFontName,
    settings.thumbnailTextPrimaryFontSize,
    settings.thumbnailTextPrimaryFontSizeRel,
    settings.thumbnailTextPrimaryColor,
    settings.thumbnailTextSecondaryFontName,
    settings.thumbnailTextSecondaryFontSize,
    settings.thumbnailTextSecondaryFontSizeRel,
    settings.thumbnailTextSecondaryColor,
    settings.thumbnailLineHeightRatio,
    hardsubSettings.thumbnailText,
    hardsubSettings.thumbnailTextSecondary,
    hardsubSettings.thumbnailTextsByOrder,
    hardsubSettings.thumbnailTextsSecondaryByOrder,
    hardsubSettings.videoText,
    hardsubSettings.videoTextSecondary,
    hardsubSettings.videoTextsByOrder,
    hardsubSettings.videoTextsSecondaryByOrder,
    settings.thumbnailTextPrimaryPosition,
    settings.thumbnailTextSecondaryPosition,
    settings.portraitTextPrimaryFontName,
    settings.portraitTextPrimaryFontSize,
    settings.portraitTextPrimaryFontSizeRel,
    settings.portraitTextPrimaryColor,
    settings.portraitTextSecondaryFontName,
    settings.portraitTextSecondaryFontSize,
    settings.portraitTextSecondaryFontSizeRel,
    settings.portraitTextSecondaryColor,
    settings.portraitTextPrimaryPosition,
    settings.portraitTextSecondaryPosition,
    settings.subtitlePosition,
    settings.thumbnailFrameTimeSec,
    settings.thumbnailDurationSec,
    settings.logoPath,
    settings.logoPosition,
    settings.logoScale,
    settings.portraitForegroundCropPercent,
    settings.layoutProfiles,
    settings.processingMode,
  ]);

  // Chỉ hydrate field theo folder từ session: thumbnail text/list.
  useEffect(() => {
    const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
    thumbnailSessionHydratedKeyRef.current = null;
    if (thumbnailHydrationReadyTimerRef.current) {
      window.clearTimeout(thumbnailHydrationReadyTimerRef.current);
      thumbnailHydrationReadyTimerRef.current = null;
    }
    setIsThumbnailSessionHydrating(true);
    if (!inputPaths.length) {
      setIsThumbnailSessionHydrating(false);
      return;
    }
    let cancelled = false;
    const currentHydrationKey = thumbnailSessionHydrationKey;
    const hydrateFolderFields = async () => {
      if (inputPaths.length > 1) {
        const texts: string[] = [];
        const secondaryTexts: string[] = [];
        const videoTexts: string[] = [];
        const videoSecondaryTexts: string[] = [];
        for (const inputPath of inputPaths) {
          const sessionPath = getSessionPathForInputPath(settings.inputType, inputPath);
          const session = await readCaptionSession(sessionPath, {
            projectId,
            inputType: settings.inputType,
            sourcePath: inputPath,
            folderPath: inputPath,
          });
          const step7 = (session.settings.step7Render || {}) as Record<string, unknown>;
          texts.push(resolveSharedPrimaryTextFromStep7(step7));
          const secondaryText = resolveSharedSecondaryTextFromStep7(step7);
          secondaryTexts.push(secondaryText);
          videoTexts.push(typeof step7.hardsubTextPrimary === 'string' ? step7.hardsubTextPrimary : '');
          videoSecondaryTexts.push(typeof step7.hardsubTextSecondary === 'string' ? step7.hardsubTextSecondary : '');
        }
        if (!cancelled) {
          hardsubSettings.setThumbnailTextSecondary('');
          hardsubSettings.setThumbnailTextsByOrder(texts);
          hardsubSettings.setSecondaryStateFromSession(secondaryTexts);
          hardsubSettings.setVideoTextsByOrder(videoTexts);
          hardsubSettings.setVideoTextsSecondaryByOrder(videoSecondaryTexts);
        }
        return;
      }

      const firstPath = inputPaths[0];
      const sessionPath = getSessionPathForInputPath(settings.inputType, firstPath);
      const session = await readCaptionSession(sessionPath, {
        projectId,
        inputType: settings.inputType,
        sourcePath: firstPath,
        folderPath: settings.inputType === 'draft' ? firstPath : firstPath.replace(/[^/\\]+$/, ''),
      });
      const step7 = (session.settings.step7Render || {}) as Record<string, unknown>;
      if (!cancelled) {
        hardsubSettings.setThumbnailText(resolveSharedPrimaryTextFromStep7(step7));
        const secondaryFromSession = resolveSharedSecondaryTextFromStep7(step7);
        hardsubSettings.setThumbnailTextSecondary(secondaryFromSession);
        hardsubSettings.setVideoText(typeof step7.hardsubTextPrimary === 'string' ? step7.hardsubTextPrimary : '');
        hardsubSettings.setVideoTextSecondary(
          typeof step7.hardsubTextSecondary === 'string' ? step7.hardsubTextSecondary : ''
        );
      }
    };

    hydrateFolderFields()
      .catch((error) => {
        console.warn('[CaptionTranslator] Không thể hydrate field theo folder từ session', error);
      })
      .finally(() => {
        if (cancelled) return;
        thumbnailSessionHydratedKeyRef.current = currentHydrationKey;
        setThumbnailSessionHydrationRevision((prev) => prev + 1);
        thumbnailHydrationReadyTimerRef.current = window.setTimeout(() => {
          if (!cancelled) {
            setIsThumbnailSessionHydrating(false);
          }
          thumbnailHydrationReadyTimerRef.current = null;
        }, 0);
      });
    return () => {
      cancelled = true;
      if (thumbnailHydrationReadyTimerRef.current) {
        window.clearTimeout(thumbnailHydrationReadyTimerRef.current);
        thumbnailHydrationReadyTimerRef.current = null;
      }
      setIsThumbnailSessionHydrating(false);
    };
  }, [fileManager.filePath, projectId, settings.inputType, thumbnailSessionHydrationKey]);

  // Đồng bộ mirror settings revision từ project-default vào từng session folder.
  useEffect(() => {
    if (!settings.isHydrated) {
      return;
    }
    const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
    if (!inputPaths.length) return;

    const syncAll = async () => {
      for (const inputPath of inputPaths) {
        const sessionPath = getSessionPathForInputPath(settings.inputType, inputPath);
        const fallback = {
          projectId,
          inputType: settings.inputType,
          sourcePath: inputPath,
          folderPath: settings.inputType === 'draft' ? inputPath : inputPath.replace(/[^/\\]+$/, ''),
        };
        try {
          await syncSessionWithProjectSettings(
            sessionPath,
            {
              projectSettings: projectSettingsSnapshot,
              revision: settings.settingsRevision,
              updatedAt: settings.settingsUpdatedAt,
              source: 'project_default',
            },
            fallback
          );
        } catch (error) {
          await updateCaptionSession(
            sessionPath,
            (session) => ({
              ...session,
              syncState: 'pending',
            }),
            fallback
          );
          scheduleSessionSettingsRetry(sessionPath, async () => {
            await syncSessionWithProjectSettings(
              sessionPath,
              {
                projectSettings: projectSettingsSnapshot,
                revision: settings.settingsRevision,
                updatedAt: settings.settingsUpdatedAt,
                source: 'project_default',
              },
              fallback
            );
          });
        }
      }
    };

    syncAll().catch((error) => {
      console.warn('[CaptionTranslator] Không thể sync revision settings vào session', error);
    });
  }, [
    fileManager.filePath,
    projectId,
    settings.inputType,
    settings.isHydrated,
    settings.settingsRevision,
    settings.settingsUpdatedAt,
  ]);

  const persistThumbnailTextToSessions = useCallback(async (
    overrides?: PersistThumbnailSessionOverrides
  ): Promise<boolean> => {
    const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
    if (!inputPaths.length) return false;
    const isHydrated = thumbnailSessionHydratedKeyRef.current === thumbnailSessionHydrationKey;
    const isManualPersist = !!overrides;
    if ((!isHydrated || isThumbnailSessionHydrating) && !isManualPersist) return false;

    const multiFolderTexts = overrides?.thumbnailTextsByOrder ?? hardsubSettings.thumbnailTextsByOrder;
    const multiFolderSecondaryTexts = overrides?.thumbnailTextsSecondaryByOrder ?? hardsubSettings.thumbnailTextsSecondaryByOrder;
    const multiFolderVideoTexts = overrides?.hardsubTextsByOrder ?? hardsubSettings.videoTextsByOrder;
    const multiFolderVideoSecondaryTexts = overrides?.hardsubTextsSecondaryByOrder ?? hardsubSettings.videoTextsSecondaryByOrder;

    if (inputPaths.length > 1) {
      const normalizedTexts = inputPaths.map((_, idx) => String(multiFolderTexts[idx] || '').trim());
      const normalizedSecondaryTexts = inputPaths.map((_, idx) => (
        String(multiFolderSecondaryTexts[idx] ?? '').trim()
      ));
      const normalizedVideoTexts = inputPaths.map((_, idx) => String(multiFolderVideoTexts[idx] || '').trim());
      const normalizedVideoSecondaryTexts = inputPaths.map((_, idx) => (
        String(multiFolderVideoSecondaryTexts[idx] ?? '').trim()
      ));

      for (let i = 0; i < inputPaths.length; i++) {
        const inputPath = inputPaths[i];
        const text = normalizedTexts[i];
        const secondaryText = normalizedSecondaryTexts[i];
        const videoText = normalizedVideoTexts[i];
        const videoSecondaryText = normalizedVideoSecondaryTexts[i];
        const sessionPath = getSessionPathForInputPath(settings.inputType, inputPath);
        await updateCaptionSession(
          sessionPath,
          (session) => ({
            ...session,
            settings: {
              ...session.settings,
              step7Render: {
                ...(session.settings.step7Render || {}),
                thumbnailText: text,
                thumbnailTextSecondary: secondaryText,
                hardsubTextPrimary: videoText,
                hardsubTextSecondary: videoSecondaryText,
                hardsubTextsByOrder: normalizedVideoTexts,
                hardsubTextsSecondaryByOrder: normalizedVideoSecondaryTexts,
                hardsubPortraitTextPrimary: videoText,
                hardsubPortraitTextSecondary: videoSecondaryText,
                thumbnailTextPrimaryFontName: settings.thumbnailTextPrimaryFontName,
                thumbnailTextPrimaryFontSize: settings.thumbnailTextPrimaryFontSize,
                thumbnailTextPrimaryColor: settings.thumbnailTextPrimaryColor,
                thumbnailTextSecondaryFontName: settings.thumbnailTextSecondaryFontName,
                thumbnailTextSecondaryFontSize: settings.thumbnailTextSecondaryFontSize,
                thumbnailTextSecondaryColor: settings.thumbnailTextSecondaryColor,
                thumbnailLineHeightRatio: settings.thumbnailLineHeightRatio,
                thumbnailTextPrimaryPosition: settings.thumbnailTextPrimaryPosition,
                thumbnailTextSecondaryPosition: settings.thumbnailTextSecondaryPosition,
                portraitTextPrimaryFontName: settings.portraitTextPrimaryFontName,
                portraitTextPrimaryFontSize: settings.portraitTextPrimaryFontSize,
                portraitTextPrimaryColor: settings.portraitTextPrimaryColor,
                portraitTextSecondaryFontName: settings.portraitTextSecondaryFontName,
                portraitTextSecondaryFontSize: settings.portraitTextSecondaryFontSize,
                portraitTextSecondaryColor: settings.portraitTextSecondaryColor,
                portraitTextPrimaryPosition: settings.portraitTextPrimaryPosition,
                portraitTextSecondaryPosition: settings.portraitTextSecondaryPosition,
              },
            },
          }),
          {
            projectId,
            inputType: settings.inputType,
            sourcePath: inputPath,
            folderPath: inputPath,
          }
        );
      }
      return true;
    }

    const inputPath = inputPaths[0];
    const sessionPath = getSessionPathForInputPath(settings.inputType, inputPath);
    const sharedPrimaryText = ((overrides?.thumbnailText ?? hardsubSettings.thumbnailText) || '').trim();
    const sharedSecondaryText = (hardsubSettings.thumbnailTextSecondary || '').trim();
    const sharedVideoPrimaryText = ((overrides?.hardsubTextPrimary ?? hardsubSettings.videoText) || '').trim();
    const sharedVideoSecondaryText = ((overrides?.hardsubTextSecondary ?? hardsubSettings.videoTextSecondary) || '').trim();
    await updateCaptionSession(
      sessionPath,
      (session) => ({
        ...session,
        settings: {
          ...session.settings,
          step7Render: {
            ...(session.settings.step7Render || {}),
            thumbnailText: sharedPrimaryText,
            thumbnailTextSecondary: sharedSecondaryText,
            hardsubTextPrimary: sharedVideoPrimaryText,
            hardsubTextSecondary: sharedVideoSecondaryText,
            hardsubTextsByOrder: [sharedVideoPrimaryText],
            hardsubTextsSecondaryByOrder: [sharedVideoSecondaryText],
            hardsubPortraitTextPrimary: sharedVideoPrimaryText,
            hardsubPortraitTextSecondary: sharedVideoSecondaryText,
            thumbnailTextPrimaryFontName: settings.thumbnailTextPrimaryFontName,
            thumbnailTextPrimaryFontSize: settings.thumbnailTextPrimaryFontSize,
            thumbnailTextPrimaryColor: settings.thumbnailTextPrimaryColor,
            thumbnailTextSecondaryFontName: settings.thumbnailTextSecondaryFontName,
            thumbnailTextSecondaryFontSize: settings.thumbnailTextSecondaryFontSize,
            thumbnailTextSecondaryColor: settings.thumbnailTextSecondaryColor,
            thumbnailLineHeightRatio: settings.thumbnailLineHeightRatio,
            thumbnailTextPrimaryPosition: settings.thumbnailTextPrimaryPosition,
            thumbnailTextSecondaryPosition: settings.thumbnailTextSecondaryPosition,
            portraitTextPrimaryFontName: settings.portraitTextPrimaryFontName,
            portraitTextPrimaryFontSize: settings.portraitTextPrimaryFontSize,
            portraitTextPrimaryColor: settings.portraitTextPrimaryColor,
            portraitTextSecondaryFontName: settings.portraitTextSecondaryFontName,
            portraitTextSecondaryFontSize: settings.portraitTextSecondaryFontSize,
            portraitTextSecondaryColor: settings.portraitTextSecondaryColor,
            portraitTextPrimaryPosition: settings.portraitTextPrimaryPosition,
            portraitTextSecondaryPosition: settings.portraitTextSecondaryPosition,
          },
        },
      }),
      {
        projectId,
        inputType: settings.inputType,
        sourcePath: inputPath,
        folderPath: settings.inputType === 'draft' ? inputPath : inputPath.replace(/[^/\\]+$/, ''),
      }
    );
    return true;
  }, [
    fileManager.filePath,
    projectId,
    settings.inputType,
    hardsubSettings.thumbnailText,
    hardsubSettings.thumbnailTextsByOrder,
    hardsubSettings.thumbnailTextsSecondaryByOrder,
    hardsubSettings.thumbnailTextSecondary,
    hardsubSettings.videoText,
    hardsubSettings.videoTextsByOrder,
    hardsubSettings.videoTextsSecondaryByOrder,
    hardsubSettings.videoTextSecondary,
    settings.thumbnailTextPrimaryFontName,
    settings.thumbnailTextPrimaryFontSize,
    settings.thumbnailTextPrimaryColor,
    settings.thumbnailTextSecondaryFontName,
    settings.thumbnailTextSecondaryFontSize,
    settings.thumbnailTextSecondaryColor,
    settings.portraitTextPrimaryFontName,
    settings.portraitTextPrimaryFontSizeRel,
    settings.portraitTextPrimaryColor,
    settings.portraitTextSecondaryFontName,
    settings.portraitTextSecondaryFontSizeRel,
    settings.portraitTextSecondaryColor,
    settings.thumbnailLineHeightRatio,
    settings.thumbnailTextPrimaryPosition,
    settings.thumbnailTextSecondaryPosition,
    settings.portraitTextPrimaryFontName,
    settings.portraitTextPrimaryFontSize,
    settings.portraitTextPrimaryColor,
    settings.portraitTextSecondaryFontName,
    settings.portraitTextSecondaryFontSize,
    settings.portraitTextSecondaryColor,
    settings.portraitTextPrimaryPosition,
    settings.portraitTextSecondaryPosition,
    thumbnailSessionHydrationKey,
    isThumbnailSessionHydrating,
  ]);

  // Persist thumbnail text theo folder (không ghi vào project default).
  useEffect(() => {
    persistThumbnailTextToSessions().catch((error) => {
      console.warn('[CaptionTranslator] Không thể lưu thumbnail text theo folder', error);
    });
  }, [persistThumbnailTextToSessions, thumbnailSessionHydrationRevision]);

  useEffect(() => {
    if (thumbnailManualSaveState !== 'success' && thumbnailManualSaveState !== 'error') {
      return;
    }
    const timer = window.setTimeout(() => {
      setThumbnailManualSaveState('idle');
      setThumbnailManualSaveMessage('');
    }, 2200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [thumbnailManualSaveState]);

  const step7ThumbnailPanelData = useMemo(() => {
    const selectedSet = new Set(selectedDraftRunPaths);
    const sourceItems = settings.inputType === 'draft'
      ? hardsubSettings.thumbnailFolderItems.filter((item) => selectedSet.has(item.folderPath))
      : hardsubSettings.thumbnailFolderItems;

    const sourceIndexes: number[] = [];
    const items = sourceItems.map((item, visibleIdx) => {
      const sourceIdx = Math.max(0, item.index - 1);
      sourceIndexes.push(sourceIdx);
      return {
        ...item,
        index: visibleIdx + 1,
      };
    });

    return { items, sourceIndexes };
  }, [
    selectedDraftRunPaths,
    hardsubSettings.thumbnailFolderItems,
    settings.inputType,
  ]);
  const step7VisibleFolderCount = step7ThumbnailPanelData.items.length;
  const step7VisibleMissingThumbnailText = useMemo(
    () => step7ThumbnailPanelData.items.some((item) => item.hasError),
    [step7ThumbnailPanelData.items]
  );
  const mapStep7VisibleIndexToSourceIndex = useCallback((visibleIndexZeroBased: number) => {
    if (!Number.isInteger(visibleIndexZeroBased) || visibleIndexZeroBased < 0) {
      return -1;
    }
    const sourceIdx = step7ThumbnailPanelData.sourceIndexes[visibleIndexZeroBased];
    return Number.isInteger(sourceIdx) && sourceIdx >= 0 ? sourceIdx : -1;
  }, [step7ThumbnailPanelData.sourceIndexes]);
  const handleStep7ItemTextChange = useCallback((visibleIndexZeroBased: number, value: string) => {
    const sourceIdx = mapStep7VisibleIndexToSourceIndex(visibleIndexZeroBased);
    if (sourceIdx < 0) return;
    hardsubSettings.updateThumbnailTextByOrder(sourceIdx, value);
  }, [hardsubSettings, mapStep7VisibleIndexToSourceIndex]);
  const handleStep7ItemSecondaryTextChange = useCallback((visibleIndexZeroBased: number, value: string) => {
    const sourceIdx = mapStep7VisibleIndexToSourceIndex(visibleIndexZeroBased);
    if (sourceIdx < 0) return;
    hardsubSettings.setThumbnailTextSecondaryByOrder(sourceIdx, value);
  }, [hardsubSettings, mapStep7VisibleIndexToSourceIndex]);
  const handleStep7ItemVideoTextChange = useCallback((visibleIndexZeroBased: number, value: string) => {
    const sourceIdx = mapStep7VisibleIndexToSourceIndex(visibleIndexZeroBased);
    if (sourceIdx < 0) return;
    hardsubSettings.updateVideoTextByOrder(sourceIdx, value);
  }, [hardsubSettings, mapStep7VisibleIndexToSourceIndex]);
  const handleStep7ItemVideoSecondaryTextChange = useCallback((visibleIndexZeroBased: number, value: string) => {
    const sourceIdx = mapStep7VisibleIndexToSourceIndex(visibleIndexZeroBased);
    if (sourceIdx < 0) return;
    hardsubSettings.setVideoTextSecondaryByOrder(sourceIdx, value);
  }, [hardsubSettings, mapStep7VisibleIndexToSourceIndex]);
  const handleApplySecondaryGlobalText = useCallback(() => {
    const value = hardsubSettings.thumbnailTextSecondary || '';
    hardsubSettings.applyText2GlobalToAll(value);
  }, [hardsubSettings]);
  const handleSyncVideoText1 = useCallback(() => {
    hardsubSettings.syncVideoText1FromThumbnail();
  }, [hardsubSettings]);
  const handleSyncVideoText2 = useCallback(() => {
    hardsubSettings.syncVideoText2FromThumbnail();
  }, [hardsubSettings]);

  const handleManualSaveThumbnailTexts = useCallback(() => {
    const folderCount = step7VisibleFolderCount;
    setThumbnailManualSaveState('saving');
    setThumbnailManualSaveMessage('Đang lưu Text1/Text2...');
    void (async () => {
      try {
        const saved = await persistThumbnailTextToSessions({
          thumbnailTextsByOrder: hardsubSettings.thumbnailTextsByOrder,
          thumbnailTextsSecondaryByOrder: hardsubSettings.thumbnailTextsSecondaryByOrder,
          hardsubTextsByOrder: hardsubSettings.videoTextsByOrder,
          hardsubTextsSecondaryByOrder: hardsubSettings.videoTextsSecondaryByOrder,
        });
        if (!saved) {
          setThumbnailManualSaveState('error');
          setThumbnailManualSaveMessage('Lưu thất bại: dữ liệu session chưa hydrate xong, thử lại sau vài giây.');
          return;
        }
        setThumbnailManualSaveState('success');
        setThumbnailManualSaveMessage(`Đã lưu Text1/Text2 cho ${folderCount} folder.`);
      } catch (error) {
        setThumbnailManualSaveState('error');
        setThumbnailManualSaveMessage(
          `Lưu thất bại: ${error instanceof Error ? error.message : String(error || 'Unknown error')}`
        );
      }
    })();
  }, [
    step7VisibleFolderCount,
    hardsubSettings.thumbnailTextsByOrder,
    hardsubSettings.thumbnailTextsSecondaryByOrder,
    hardsubSettings.videoTextsByOrder,
    hardsubSettings.videoTextsSecondaryByOrder,
    persistThumbnailTextToSessions,
  ]);

  const resolveThumbnailLayoutOverrides = useCallback((mode: 'landscape' | 'portrait') => {
    const profile = settings.layoutProfiles?.[mode];
    if (!profile || typeof profile !== 'object') {
      return {
        thumbnailTextPrimaryPosition: undefined,
        thumbnailTextSecondaryPosition: undefined,
        renderResolution: undefined,
      };
    }
    const record = profile as unknown as Record<string, unknown>;
    const readPoint = (value: unknown) => {
      if (!value || typeof value !== 'object') return undefined;
      const typed = value as { x?: unknown; y?: unknown };
      if (typeof typed.x !== 'number' || typeof typed.y !== 'number') return undefined;
      if (!Number.isFinite(typed.x) || !Number.isFinite(typed.y)) return undefined;
      return { x: typed.x, y: typed.y };
    };
    const renderResolution = record.renderResolution;
    const normalizedResolution =
      renderResolution === 'original'
      || renderResolution === '1080p'
      || renderResolution === '720p'
      || renderResolution === '540p'
      || renderResolution === '360p'
        ? renderResolution
        : undefined;
    return {
      thumbnailTextPrimaryPosition: readPoint(record.thumbnailTextPrimaryPosition),
      thumbnailTextSecondaryPosition: readPoint(record.thumbnailTextSecondaryPosition),
      renderResolution: normalizedResolution,
    };
  }, [settings.layoutProfiles]);

  const processingThumbnailPayload = useMemo(() => {
    if (settings.inputType !== 'draft') {
      return {
        thumbnailText: hardsubSettings.thumbnailText,
        thumbnailTextsByOrder: hardsubSettings.thumbnailTextsByOrder,
        thumbnailTextSecondary: hardsubSettings.thumbnailTextSecondary,
        thumbnailTextsSecondaryByOrder: hardsubSettings.thumbnailTextsSecondaryByOrder,
      };
    }

    const orderIndexByPath = new Map<string, number>();
    hardsubSettings.selectedDraftPaths.forEach((path, idx) => {
      orderIndexByPath.set(path, idx);
    });

    const thumbnailTextsByOrder = selectedDraftRunPaths.map((path) => {
      const idx = orderIndexByPath.get(path);
      return idx !== undefined ? (hardsubSettings.thumbnailTextsByOrder[idx] || '') : '';
    });
    const thumbnailTextsSecondaryByOrder = selectedDraftRunPaths.map((path) => {
      const idx = orderIndexByPath.get(path);
      return idx !== undefined ? (hardsubSettings.thumbnailTextsSecondaryByOrder[idx] || '') : '';
    });
    return {
      thumbnailText: thumbnailTextsByOrder[0] || hardsubSettings.thumbnailText,
      thumbnailTextsByOrder,
      thumbnailTextSecondary: thumbnailTextsSecondaryByOrder[0] || hardsubSettings.thumbnailTextSecondary || '',
      thumbnailTextsSecondaryByOrder,
    };
  }, [
    selectedDraftRunPaths,
    hardsubSettings.selectedDraftPaths,
    hardsubSettings.thumbnailText,
    hardsubSettings.thumbnailTextsByOrder,
    hardsubSettings.thumbnailTextSecondary,
    hardsubSettings.thumbnailTextsSecondaryByOrder,
    settings.inputType,
  ]);

  const processingVideoPayload = useMemo(() => {
    if (settings.inputType !== 'draft') {
      return {
        hardsubTextPrimary: hardsubSettings.videoText,
        hardsubTextSecondary: hardsubSettings.videoTextSecondary,
        hardsubTextsByOrder: hardsubSettings.videoTextsByOrder,
        hardsubTextsSecondaryByOrder: hardsubSettings.videoTextsSecondaryByOrder,
      };
    }
    const videoTextsByOrder = selectedDraftRunPaths.map((path) => {
      const idx = hardsubSettings.selectedDraftPaths.findIndex((draftPath) => draftPath === path);
      return idx >= 0 ? (hardsubSettings.videoTextsByOrder[idx] || '') : '';
    });
    const videoTextsSecondaryByOrder = selectedDraftRunPaths.map((path) => {
      const idx = hardsubSettings.selectedDraftPaths.findIndex((draftPath) => draftPath === path);
      return idx >= 0 ? (hardsubSettings.videoTextsSecondaryByOrder[idx] || '') : '';
    });
    return {
      hardsubTextPrimary: videoTextsByOrder[0] || hardsubSettings.videoText,
      hardsubTextsByOrder: videoTextsByOrder,
      hardsubTextSecondary: videoTextsSecondaryByOrder[0] || hardsubSettings.videoTextSecondary || '',
      hardsubTextsSecondaryByOrder: videoTextsSecondaryByOrder,
    };
  }, [
    selectedDraftRunPaths,
    hardsubSettings.selectedDraftPaths,
    hardsubSettings.videoText,
    hardsubSettings.videoTextsByOrder,
    hardsubSettings.videoTextSecondary,
    hardsubSettings.videoTextsSecondaryByOrder,
    settings.inputType,
  ]);

  // 4. Processing Hook
  const processing = useCaptionProcessing({
    projectId,
    entries: fileManager.entries,
    setEntries: fileManager.setEntries,
    filePath: fileManager.filePath,
    inputPathsOverride: settings.inputType === 'draft' ? selectedDraftRunPaths : undefined,
    inputType: settings.inputType,
    captionFolder,
    settings: {
      ...settings,
      thumbnailText: processingThumbnailPayload.thumbnailText,
      thumbnailTextsByOrder: processingThumbnailPayload.thumbnailTextsByOrder,
      thumbnailTextSecondary: processingThumbnailPayload.thumbnailTextSecondary,
      thumbnailTextsSecondaryByOrder: processingThumbnailPayload.thumbnailTextsSecondaryByOrder,
      hardsubTextPrimary: processingVideoPayload.hardsubTextPrimary,
      hardsubTextSecondary: processingVideoPayload.hardsubTextSecondary,
      hardsubTextsByOrder: processingVideoPayload.hardsubTextsByOrder,
      hardsubTextsSecondaryByOrder: processingVideoPayload.hardsubTextsSecondaryByOrder,
      hardsubPortraitTextPrimary: processingVideoPayload.hardsubTextPrimary,
      hardsubPortraitTextSecondary: processingVideoPayload.hardsubTextSecondary,
    },
    enabledSteps: settings.enabledSteps,
    setEnabledSteps: settings.setEnabledSteps,
  });

  const handleBulkExportThumbnails = useCallback(() => {
    if (processing.status === 'running') {
      return;
    }
    const frameTimeSec = settings.thumbnailFrameTimeSec;
    if (frameTimeSec === null || frameTimeSec === undefined) {
      setThumbnailBulkExportState({
        status: 'error',
        message: 'Chưa đặt thời điểm frame thumbnail.',
      });
      return;
    }
    const inputPaths = selectedDraftRunPaths;
    if (inputPaths.length === 0) {
      setThumbnailBulkExportState({
        status: 'error',
        message: 'Không có folder nào để xuất thumbnail.',
      });
      return;
    }

    setThumbnailBulkExportState({
      status: 'running',
      message: `Đang xuất 0/${inputPaths.length}...`,
    });

    void (async () => {
      const errors: string[] = [];
      let successCount = 0;
      let processed = 0;

      const landscapeOverrides = resolveThumbnailLayoutOverrides('landscape');
      const portraitOverrides = resolveThumbnailLayoutOverrides('portrait');

      for (const folderPath of inputPaths) {
        processed += 1;
        setThumbnailBulkExportState({
          status: 'running',
          message: `Đang xuất ${processed}/${inputPaths.length} folder... (OK ${successCount})`,
        });

        const folderIdx = hardsubSettings.selectedDraftPaths.findIndex((path) => path === folderPath);
        if (folderIdx < 0) {
          errors.push(`[${folderPath}] Không tìm thấy index folder trong session.`);
          continue;
        }

        const videoInfo = fileManager.folderVideos[folderPath];
        let videoPath = videoInfo?.fullPath || '';
        let durationSec = videoInfo?.duration || 0;
        if (!videoPath) {
          try {
            // @ts-ignore
            const res = await window.electronAPI.captionVideo.findBestVideoInFolders([folderPath]);
            if (res?.success && res.data?.videoPath) {
              videoPath = res.data.videoPath;
              durationSec = res.data.metadata?.duration || durationSec;
            }
          } catch (error) {
            console.warn('[ThumbnailBulk] Không tìm được video:', folderPath, error);
          }
        }
        if (videoPath && durationSec <= 0) {
          try {
            // @ts-ignore
            const metaRes = await window.electronAPI.captionVideo.getVideoMetadata(videoPath);
            if (metaRes?.success && metaRes.data?.duration) {
              durationSec = metaRes.data.duration;
            }
          } catch (error) {
            console.warn('[ThumbnailBulk] Không lấy được metadata video:', videoPath, error);
          }
        }
        if (!videoPath) {
          errors.push(`[${folderPath}] Không tìm thấy video gốc.`);
          continue;
        }

        const textPrimary = (hardsubSettings.thumbnailTextsByOrder[folderIdx] || '').trim();
        const textSecondary = ((hardsubSettings.thumbnailTextsSecondaryByOrder[folderIdx] || '').trim()
          || (hardsubSettings.thumbnailTextSecondary || '').trim());
        if (!textPrimary) {
          errors.push(`[${folderPath}] Thiếu Text1.`);
          continue;
        }

        const safeTimeSec = durationSec > 0
          ? Math.max(0, Math.min(frameTimeSec, Math.max(0, durationSec - 0.1)))
          : Math.max(0, frameTimeSec);

        const baseOptions = {
          videoPath,
          thumbnailTimeSec: safeTimeSec,
          thumbnailText: textPrimary,
          thumbnailTextSecondary: textSecondary,
          thumbnailFontName: settings.thumbnailFontName,
          thumbnailFontSize: settings.thumbnailFontSize,
          thumbnailTextPrimaryFontName: settings.thumbnailTextPrimaryFontName,
          thumbnailTextPrimaryFontSize: settings.thumbnailTextPrimaryFontSize,
          thumbnailTextPrimaryColor: settings.thumbnailTextPrimaryColor,
          thumbnailTextSecondaryFontName: settings.thumbnailTextSecondaryFontName,
          thumbnailTextSecondaryFontSize: settings.thumbnailTextSecondaryFontSize,
          thumbnailTextSecondaryColor: settings.thumbnailTextSecondaryColor,
          thumbnailLineHeightRatio: settings.thumbnailLineHeightRatio,
        };

        // @ts-ignore
        const api = window.electronAPI.captionVideo;
        const renderWithRetry = async (payload: any) => {
          const first = await api.renderThumbnailFile(payload);
          if (first?.success && first?.data?.success) {
            return first;
          }
          return api.renderThumbnailFile(payload);
        };

        const render16x9 = await renderWithRetry({
          ...baseOptions,
          renderMode: 'hardsub',
          renderResolution: landscapeOverrides.renderResolution || settings.renderResolution,
          thumbnailTextPrimaryPosition: landscapeOverrides.thumbnailTextPrimaryPosition || settings.thumbnailTextPrimaryPosition,
          thumbnailTextSecondaryPosition: landscapeOverrides.thumbnailTextSecondaryPosition || settings.thumbnailTextSecondaryPosition,
          fileName: 'thumbnail_16x9.png',
        });
        if (!render16x9?.success || !render16x9?.data?.success) {
          errors.push(`[${folderPath}] 16:9 lỗi: ${render16x9?.error || render16x9?.data?.error || 'unknown'}`);
        }

        const render9x16 = await renderWithRetry({
          ...baseOptions,
          renderMode: 'hardsub_portrait_9_16',
          renderResolution: portraitOverrides.renderResolution || settings.renderResolution,
          thumbnailTextPrimaryPosition: portraitOverrides.thumbnailTextPrimaryPosition || settings.thumbnailTextPrimaryPosition,
          thumbnailTextSecondaryPosition: portraitOverrides.thumbnailTextSecondaryPosition || settings.thumbnailTextSecondaryPosition,
          fileName: 'thumbnail_9x16.png',
        });
        if (!render9x16?.success || !render9x16?.data?.success) {
          errors.push(`[${folderPath}] 9:16 lỗi: ${render9x16?.error || render9x16?.data?.error || 'unknown'}`);
        }

        if (render16x9?.success && render16x9?.data?.success && render9x16?.success && render9x16?.data?.success) {
          successCount += 1;
        }
      }

      const failedCount = inputPaths.length - successCount;
      const summary = `Xuất xong: ${successCount}/${inputPaths.length} folder`;
      setThumbnailBulkExportState({
        status: failedCount > 0 ? 'error' : 'success',
        message: failedCount > 0 ? `${summary} (lỗi ${failedCount})` : summary,
        detail: errors.length > 0 ? errors.join('\n') : undefined,
      });
    })();
  }, [
    fileManager.folderVideos,
    selectedDraftRunPaths,
    hardsubSettings.selectedDraftPaths,
    hardsubSettings.thumbnailTextsByOrder,
    hardsubSettings.thumbnailTextsSecondaryByOrder,
    hardsubSettings.thumbnailTextSecondary,
    processing.status,
    resolveThumbnailLayoutOverrides,
    settings.renderResolution,
    settings.thumbnailFontName,
    settings.thumbnailFontSize,
    settings.thumbnailFrameTimeSec,
    settings.thumbnailLineHeightRatio,
    settings.thumbnailTextPrimaryColor,
    settings.thumbnailTextPrimaryFontName,
    settings.thumbnailTextPrimaryFontSize,
    settings.thumbnailTextPrimaryPosition,
    settings.thumbnailTextSecondaryColor,
    settings.thumbnailTextSecondaryFontName,
    settings.thumbnailTextSecondaryFontSize,
    settings.thumbnailTextSecondaryPosition,
  ]);

  const handleStep4VoiceTest = useCallback(async () => {
    if (processing.status === 'running' || step4VoiceTestState === 'testing') {
      return;
    }
    const sampleText = (step4VoiceTestText || '').trim();
    if (!sampleText) {
      setStep4VoiceTestState('error');
      setStep4VoiceTestMessage('Text test giọng không được để trống.');
      return;
    }

    setStep4VoiceTestState('testing');
    setStep4VoiceTestMessage('Đang test giọng...');
    stopStep4VoiceTestPlayback();

    try {
      const response = await window.electronAPI.tts.testVoice({
        text: sampleText,
        voice: settings.voice,
        rate: settings.rate,
        volume: settings.volume,
        outputFormat: 'mp3',
      });
      if (!response?.success || !response.data?.audioDataUri) {
        throw new Error(response?.error || 'Không nhận được audio sample.');
      }

      await playStep4VoiceTestAudio(response.data.audioDataUri);
      const durationText = response.data.durationMs && response.data.durationMs > 0
        ? ` (${(response.data.durationMs / 1000).toFixed(2)}s)`
        : '';
      setStep4VoiceTestState('success');
      setStep4VoiceTestMessage(`Test thành công: ${response.data.voice}${durationText}`);
    } catch (error) {
      setStep4VoiceTestState('error');
      setStep4VoiceTestMessage(error instanceof Error ? error.message : 'Test giọng thất bại.');
    }
  }, [
    playStep4VoiceTestAudio,
    processing.status,
    settings.rate,
    settings.voice,
    settings.volume,
    step4VoiceTestState,
    step4VoiceTestText,
    stopStep4VoiceTestPlayback,
  ]);

  useEffect(() => {
    if (processing.status !== 'running') {
      return;
    }
    stopStep4VoiceTestPlayback();
    if (step4VoiceTestState === 'testing') {
      setStep4VoiceTestState('idle');
      setStep4VoiceTestMessage('');
    }
  }, [processing.status, step4VoiceTestState, stopStep4VoiceTestPlayback]);

  const audioFiles = processing.audioFiles;
  const step7AudioElementRef = useRef<HTMLAudioElement | null>(null);
  const step7AudioAutoPlayAfterMixRef = useRef(false);
  const step7AudioLastMixedSignatureRef = useRef<string>('');
  const step7AudioLastDataUriRef = useRef<string>('');
  const [isStep7AudioPlaying, setIsStep7AudioPlaying] = useState(false);
  const [step7AudioButtonError, setStep7AudioButtonError] = useState<string>('');

  const stopStep7AudioPlayback = useCallback(() => {
    const audio = step7AudioElementRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsStep7AudioPlaying(false);
  }, []);

  const playStep7AudioPreview = useCallback(async (audioDataUri: string) => {
    if (!audioDataUri) return;
    const audio = step7AudioElementRef.current;
    if (!audio) {
      setIsStep7AudioPlaying(false);
      setStep7AudioButtonError('Không thể phát audio preview.');
      return;
    }
    try {
      if (audio.src !== audioDataUri) {
        audio.src = audioDataUri;
      }
      audio.currentTime = 0;
      await audio.play();
      setIsStep7AudioPlaying(true);
      setStep7AudioButtonError('');
    } catch {
      setIsStep7AudioPlaying(false);
      setStep7AudioButtonError('Không thể phát audio preview.');
    }
  }, []);

  useEffect(() => {
    const audio = new Audio();
    const handlePlay = () => setIsStep7AudioPlaying(true);
    const handlePause = () => setIsStep7AudioPlaying(false);
    const handleEnded = () => setIsStep7AudioPlaying(false);
    const handleError = () => {
      setIsStep7AudioPlaying(false);
      setStep7AudioButtonError('Không thể phát audio preview.');
    };
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    step7AudioElementRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      step7AudioElementRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (processing.audioPreviewStatus === 'mixing') {
      setStep7AudioButtonError('');
      return;
    }

    if (processing.audioPreviewStatus === 'error') {
      step7AudioAutoPlayAfterMixRef.current = false;
      stopStep7AudioPlayback();
      setStep7AudioButtonError(processing.audioPreviewProgressText || 'Test mix audio thất bại.');
      return;
    }

    if (processing.audioPreviewStatus === 'idle') {
      step7AudioAutoPlayAfterMixRef.current = false;
      stopStep7AudioPlayback();
      return;
    }

    if (
      processing.audioPreviewStatus === 'ready'
      && processing.audioPreviewDataUri
      && step7AudioAutoPlayAfterMixRef.current
    ) {
      step7AudioAutoPlayAfterMixRef.current = false;
      void playStep7AudioPreview(processing.audioPreviewDataUri);
    }
  }, [
    processing.audioPreviewStatus,
    processing.audioPreviewDataUri,
    processing.audioPreviewProgressText,
    playStep7AudioPreview,
    stopStep7AudioPlayback,
  ]);

  useEffect(() => {
    if (processing.status === 'running') {
      step7AudioAutoPlayAfterMixRef.current = false;
      stopStep7AudioPlayback();
    }
  }, [processing.status, stopStep7AudioPlayback]);

  // --- Download prompt preview ---
  const handleDownloadPromptPreview = async () => {
    const entries = fileManager.entries;
    const linesPerBatch = 50;
    const batchTexts = entries.slice(0, linesPerBatch).map(e => e.text);
    const count = batchTexts.length;

    // Lấy custom prompt từ DB nếu có
    let customTemplate: string | undefined;
    let promptName = 'default';
    try {
      const settingsRes = await window.electronAPI.appSettings.getAll();
      const captionPromptId = settingsRes?.data?.captionPromptId;
      if (captionPromptId) {
        const promptRes: any = await window.electronAPI.invoke('prompt:getById', captionPromptId);
        if (promptRes?.content) {
          customTemplate = promptRes.content;
          promptName = promptRes.name || captionPromptId;
        }
      }
    } catch (e) {
      console.warn('[PromptPreview] Không tải được settings/prompt:', e);
    }

    let prompt: string;
    let responseFormat: 'json';

    if (customTemplate) {
      const arrayText = JSON.stringify(batchTexts);
      const rawText = batchTexts.join('\n');
      prompt = customTemplate
        .replace(/"\{\{TEXT\}\}"/g, arrayText)   // "{{TEXT}}" → JSON array
        .replace(/\{\{TEXT\}\}/g, rawText)          // {{TEXT}} → plain fallback
        .replace(/\{\{COUNT\}\}/g, String(count))
        .replace(/\{\{FILE_NAME\}\}/g, 'subtitle');
      responseFormat = 'json';
    } else {
      // Default JSON-only format
      const sourcePayload = batchTexts.map((text, i) => ({ index: i + 1, text }));
      prompt = `Dịch ${count} dòng subtitle sau sang tiếng Vietnamese.\nYÊU CẦU BẮT BUỘC:\n1. CHỈ trả về JSON thuần túy, không markdown, không text thừa.\n2. JSON success schema:\n{\n  "status": "success",\n  "data": {\n    "translations": [\n      { "index": 1, "translated": "..." }\n    ],\n    "summary": {\n      "total_sentences": ${count},\n      "input_count": ${count},\n      "output_count": ${count},\n      "match": true,\n      "language_style": "casual"\n    }\n  }\n}\n3. translations phải có CHÍNH XÁC ${count} object, index từ 1..${count}, không thiếu, không trùng.\n4. Mỗi câu input tương ứng đúng 1 câu translated, không gộp/không tách câu.\n5. Nếu không thể xử lý, trả JSON error:\n{\n  "status": "error",\n  "error": {\n    "code": "ERROR_PROCESSING_FAILED",\n    "message": "..."\n  }\n}\n\nNguồn:\n${JSON.stringify(sourcePayload)}`;
      responseFormat = 'json';
    }

    const header = [
      `; === CAPTION PROMPT PREVIEW ===`,
      `; Prompt: ${customTemplate ? promptName : '(default built-in)'}`,
      `; Response format: ${responseFormat}`,
      `; Batch size: ${count} / ${entries.length} dòng (chỉ batch đầu tiên)`,
      `; ================================`,
      '',
    ].join('\n');

    const content = header + prompt;

    const saveRes = await (window.electronAPI as any).invoke('dialog:showSaveDialog', {
      title: 'Lưu preview prompt',
      defaultPath: 'caption_prompt_preview.txt',
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (!saveRes?.filePath) return;

    // Ghi file qua IPC
    await (window.electronAPI as any).invoke('fs:writeFile', { filePath: saveRes.filePath, content });
  };

  // 5. Available Fonts State
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);

  const [diskAudioDuration, setDiskAudioDuration] = useState<number | null>(null);
  const [diskSubtitleDuration, setDiskSubtitleDuration] = useState<number | null>(null);
  const [diskSubtitleAlreadyScaled, setDiskSubtitleAlreadyScaled] = useState(false);
  const [sessionTimingSnapshot, setSessionTimingSnapshot] = useState<SessionTimingSnapshot | null>(null);
  const [thumbnailPreviewFolderPath, setThumbnailPreviewFolderPath] = useState('');

  // Section 6 (Cấu hình) ưu tiên folder người dùng đang focus khi idle.
  // Khi pipeline chạy, luôn ưu tiên folder đang xử lý.
  const firstFolderPath = hardsubSettings.firstFolderPath;
  const isMultiFolder = hardsubSettings.isMultiFolder;
  const idleFocusedFolderPath = useMemo(() => {
    if (!thumbnailPreviewFolderPath) {
      return processingInputPaths[0] || firstFolderPath;
    }
    if (processingInputPaths.includes(thumbnailPreviewFolderPath)) {
      return thumbnailPreviewFolderPath;
    }
    return processingInputPaths[0] || firstFolderPath;
  }, [firstFolderPath, processingInputPaths, thumbnailPreviewFolderPath]);

  // Khi đang xử lý multi-folder, dùng path của folder đang xử lý để hiển thị thông số video chính xác.
  // Khi idle, dùng folder người dùng đang focus (fallback folder đầu tiên trong danh sách đang xử lý).
  const displayPath = processing.currentFolder?.path ?? idleFocusedFolderPath;
  const videoInfo = displayPath ? fileManager.folderVideos[displayPath] : null;
  const originalVideoDuration = videoInfo?.duration || 0;
  const livePreviewVideoPath = videoInfo?.fullPath || fileManager.firstVideoPath || null;
  const buildStep7AudioPreviewSignature = useCallback(() => {
    const targetPath = (displayPath || '').trim().toLowerCase();
    const renderAudioSpeed = Number(settings.renderAudioSpeed ?? 1).toFixed(3);
    const srtSpeed = Number(settings.srtSpeed ?? 1).toFixed(3);
    const videoVolume = Number(settings.videoVolume ?? 100).toFixed(3);
    const audioVolume = Number(settings.audioVolume ?? 100).toFixed(3);
    const ttsRate = (settings.rate || '').trim().toLowerCase();
    return [
      targetPath,
      `renderAudioSpeed:${renderAudioSpeed}`,
      `srtSpeed:${srtSpeed}`,
      `videoVolume:${videoVolume}`,
      `audioVolume:${audioVolume}`,
      `rate:${ttsRate}`,
    ].join('|');
  }, [
    displayPath,
    settings.renderAudioSpeed,
    settings.srtSpeed,
    settings.videoVolume,
    settings.audioVolume,
    settings.rate,
  ]);

  const [sessionStepStatus, setSessionStepStatus] = useState<Partial<Record<Step, string>>>({});
  const [sessionStepSkipped, setSessionStepSkipped] = useState<Partial<Record<Step, boolean>>>({});
  const [sessionStepTimingMeta, setSessionStepTimingMeta] = useState<Partial<Record<Step, SessionStepTimingMeta>>>({});
  const [sessionStep3BatchState, setSessionStep3BatchState] = useState<Step3BatchState | null>(null);
  const [sessionStep2BatchPlanCount, setSessionStep2BatchPlanCount] = useState<number | null>(null);
  const [sessionStep2BatchPlan, setSessionStep2BatchPlan] = useState<Array<{
    batchIndex: number;
    startIndex: number;
    endIndex: number;
    lineCount: number;
  }>>([]);
  const [sessionEntryCounts, setSessionEntryCounts] = useState<{ translated: number; extracted: number }>({
    translated: 0,
    extracted: 0,
  });
  const [uiNowMs, setUiNowMs] = useState<number>(() => Date.now());
  const [stepLiveStartMs, setStepLiveStartMs] = useState<Partial<Record<Step, number>>>({});
  const [step3BatchRuntimeMap, setStep3BatchRuntimeMap] = useState<Record<number, Step3BatchRuntimeEntry>>({});
  const [step3LiveTotalBatches, setStep3LiveTotalBatches] = useState<number | null>(null);
  const [step3ManualModal, setStep3ManualModal] = useState<{ mode: 'single' | 'bulk'; batchIndex?: number } | null>(null);
  const [step3ManualInput, setStep3ManualInput] = useState('');
  const [step3ManualError, setStep3ManualError] = useState('');
  const [step3ManualBusy, setStep3ManualBusy] = useState(false);
  const [step3BulkMultiModalOpen, setStep3BulkMultiModalOpen] = useState(false);
  const [step3BulkMultiFiles, setStep3BulkMultiFiles] = useState<Step3BulkFileItem[]>([]);
  const [step3BulkMultiError, setStep3BulkMultiError] = useState('');
  const [step3BulkMultiMessage, setStep3BulkMultiMessage] = useState('');
  const [step3BulkMultiBusy, setStep3BulkMultiBusy] = useState(false);
  const [step3RuntimeTimer, setStep3RuntimeTimer] = useState<Step3RuntimeTimer>({
    apiLabel: '',
    tokenLabel: '',
    apiStartedAtMs: null,
    apiEndedAtMs: null,
    tokenStartedAtMs: null,
    tokenEndedAtMs: null,
  });
  const [sessionPreviewEntries, setSessionPreviewEntries] = useState<SubtitleEntry[]>([]);
  const [renderedPreviewVideoPath, setRenderedPreviewVideoPath] = useState<string | null>(null);
  const [previewSourceLabel, setPreviewSourceLabel] = useState<string>('live_video');
  const [previewMode, setPreviewMode] = useState<'render' | 'live'>('live');
  const lastHydratedInputPathRef = useRef<string>('');

  // Output dir cho folder đang display (theo dõi real-time trong multi-folder)
  const displayOutputDir = settings.inputType === 'srt'
    ? (displayPath ? displayPath.replace(/[^/\\]+$/, 'caption_output') : captionFolder)
    : (displayPath ? `${displayPath}/caption_output` : '');

  const refreshActiveSession = useCallback(async (cancelRef?: { current: boolean }) => {
    const isCancelled = () => !!cancelRef?.current;
    if (!fileManager.filePath) {
      setSessionStepStatus({});
      setSessionStepSkipped({});
      setSessionStepTimingMeta({});
      setSessionStep3BatchState(null);
      setSessionStep2BatchPlanCount(null);
      setSessionStep2BatchPlan([]);
      setSessionEntryCounts({ translated: 0, extracted: 0 });
      setStep3BatchRuntimeMap({});
      setStep3LiveTotalBatches(null);
      setSessionPreviewEntries(fileManager.entries);
      setRenderedPreviewVideoPath(null);
      setPreviewSourceLabel('live_video');
      setSessionTimingSnapshot(null);
      return;
    }

    const inputPaths = processingInputPaths;
    const fallbackInputPath = inputPaths.length === 0
      ? getInputPaths(settings.inputType, fileManager.filePath)[0]
      : null;
    const activeInputPath = processing.currentFolder?.path ?? idleFocusedFolderPath ?? inputPaths[0] ?? fallbackInputPath;
    if (!activeInputPath) {
      if (import.meta?.env?.DEV) {
        console.log('[CaptionTranslator][SessionHydrate] No active input path', {
          inputType: settings.inputType,
          filePath: fileManager.filePath,
          processingInputPaths: inputPaths,
          idleFocusedFolderPath,
        });
      }
      setSessionTimingSnapshot(null);
      setSessionStep3BatchState(null);
      setSessionStep2BatchPlanCount(null);
      setSessionStep2BatchPlan([]);
      setSessionEntryCounts({ translated: 0, extracted: 0 });
      setStep3BatchRuntimeMap({});
      setStep3LiveTotalBatches(null);
      return;
    }

    try {
      const sessionPath = getSessionPathForInputPath(settings.inputType, activeInputPath);
      if (import.meta?.env?.DEV) {
        console.log('[CaptionTranslator][SessionHydrate] Start', {
          inputType: settings.inputType,
          filePath: fileManager.filePath,
          processingInputPaths: inputPaths,
          activeInputPath,
          sessionPath,
        });
      }
      const session = await readCaptionSession(sessionPath, {
        projectId,
        inputType: settings.inputType,
        sourcePath: activeInputPath,
        folderPath: settings.inputType === 'draft'
          ? activeInputPath
          : activeInputPath.replace(/[^/\\]+$/, ''),
      });
      if (isCancelled()) return;
      console.log('[CaptionTranslator][SessionHydrate]', {
        sessionPath,
        activeInputPath,
        steps: {
          step1: session.steps.step1?.status,
          step2: session.steps.step2?.status,
          step3: session.steps.step3?.status,
          step4: session.steps.step4?.status,
          step6: session.steps.step6?.status,
          step7: session.steps.step7?.status,
        },
      });

      const nextStepStatus: Partial<Record<Step, string>> = {
        1: session.steps.step1?.status,
        2: session.steps.step2?.status,
        3: session.steps.step3?.status,
        4: session.steps.step4?.status,
        6: session.steps.step6?.status,
        7: session.steps.step7?.status,
      };
      const isSkipped = (stepState: unknown): boolean => {
        const record = (stepState && typeof stepState === 'object')
          ? (stepState as Record<string, unknown>)
          : {};
        const metrics = (record.metrics && typeof record.metrics === 'object')
          ? (record.metrics as Record<string, unknown>)
          : {};
        return record.status === 'success'
          && (metrics.skipped === true || metrics.skipBy === 'session_contract');
      };
      const nextStepSkipped: Partial<Record<Step, boolean>> = {
        1: isSkipped(session.steps.step1),
        2: isSkipped(session.steps.step2),
        3: isSkipped(session.steps.step3),
        4: isSkipped(session.steps.step4),
        6: isSkipped(session.steps.step6),
        7: isSkipped(session.steps.step7),
      };
      const nextStepTimingMeta: Partial<Record<Step, SessionStepTimingMeta>> = {
        1: {
          status: session.steps.step1?.status,
          startedAt: session.steps.step1?.startedAt,
          endedAt: session.steps.step1?.endedAt,
        },
        2: {
          status: session.steps.step2?.status,
          startedAt: session.steps.step2?.startedAt,
          endedAt: session.steps.step2?.endedAt,
        },
        3: {
          status: session.steps.step3?.status,
          startedAt: session.steps.step3?.startedAt,
          endedAt: session.steps.step3?.endedAt,
        },
        4: {
          status: session.steps.step4?.status,
          startedAt: session.steps.step4?.startedAt,
          endedAt: session.steps.step4?.endedAt,
        },
        6: {
          status: session.steps.step6?.status,
          startedAt: session.steps.step6?.startedAt,
          endedAt: session.steps.step6?.endedAt,
        },
        7: {
          status: session.steps.step7?.status,
          startedAt: session.steps.step7?.startedAt,
          endedAt: session.steps.step7?.endedAt,
        },
      };
      setSessionStepStatus(nextStepStatus);
      setSessionStepSkipped(nextStepSkipped);
      setSessionStepTimingMeta(nextStepTimingMeta);
      setSessionStep3BatchState(session.data.step3BatchState ?? null);
      setSessionStep2BatchPlanCount(
        Array.isArray(session.data.step2BatchPlan) ? session.data.step2BatchPlan.length : null
      );
      setSessionStep2BatchPlan(
        Array.isArray(session.data.step2BatchPlan) ? (session.data.step2BatchPlan as Array<{
          batchIndex: number;
          startIndex: number;
          endIndex: number;
          lineCount: number;
        }>) : []
      );
      setSessionTimingSnapshot(readTimingSnapshotFromSession(session));
      lastHydratedInputPathRef.current = activeInputPath;

      const translated = (session.data.translatedEntries || []) as SubtitleEntry[];
      const extracted = (session.data.extractedEntries || []) as SubtitleEntry[];
      setSessionEntryCounts({ translated: translated.length, extracted: extracted.length });
      const selectedEntries =
        (session.steps.step3?.status === 'success' && translated.length > 0)
          ? translated
          : (translated.length > 0 ? translated : extracted);
      setSessionPreviewEntries(selectedEntries.length > 0 ? selectedEntries : fileManager.entries);
      setPreviewSourceLabel(
        session.steps.step3?.status === 'success' && translated.length > 0
          ? 'session_translated_entries'
          : 'session_extracted_entries'
      );

      const finalVideoPathRaw =
        typeof session.artifacts.finalVideoPath === 'string' && session.artifacts.finalVideoPath.trim().length > 0
          ? session.artifacts.finalVideoPath
          : (typeof (session.data.renderResult as Record<string, unknown> | undefined)?.outputPath === 'string'
            ? ((session.data.renderResult as Record<string, unknown>).outputPath as string)
            : null);

      if (finalVideoPathRaw) {
        const verifyRes = await (window.electronAPI as any).captionVideo.getVideoMetadata(finalVideoPathRaw);
        if (!isCancelled() && verifyRes?.success) {
          setRenderedPreviewVideoPath(finalVideoPathRaw);
        } else if (!isCancelled()) {
          setRenderedPreviewVideoPath(null);
        }
      } else {
        setRenderedPreviewVideoPath(null);
      }
    } catch (error) {
      if (!isCancelled()) {
        console.warn('[CaptionTranslator] Không thể hydrate preview từ caption_session.json', error);
        if (activeInputPath !== lastHydratedInputPathRef.current) {
          setSessionStepStatus({});
          setSessionStepSkipped({});
          setSessionStepTimingMeta({});
          setSessionPreviewEntries(fileManager.entries);
          setRenderedPreviewVideoPath(null);
          setSessionTimingSnapshot(null);
        } else {
          setSessionTimingSnapshot(null);
        }
      }
    }
  }, [
    fileManager.filePath,
    fileManager.entries,
    idleFocusedFolderPath,
    processing.currentFolder?.path,
    processingInputPaths,
    projectId,
    settings.inputType,
  ]);

  useEffect(() => {
    const cancelRef = { current: false };
    void refreshActiveSession(cancelRef);
    return () => {
      cancelRef.current = true;
    };
  }, [refreshActiveSession, processing.currentStep, processing.status]);

  const resolveActiveInputPath = useCallback(() => {
    const inputPaths = processingInputPaths;
    const fallbackInputPath = inputPaths.length === 0
      ? getInputPaths(settings.inputType, fileManager.filePath)[0]
      : null;
    return processing.currentFolder?.path ?? idleFocusedFolderPath ?? inputPaths[0] ?? fallbackInputPath ?? '';
  }, [
    processing.currentFolder?.path,
    idleFocusedFolderPath,
    processingInputPaths,
    settings.inputType,
    fileManager.filePath,
  ]);

  const openStep3ManualSingle = useCallback((batchIndex: number) => {
    setStep3ManualModal({ mode: 'single', batchIndex });
    setStep3ManualInput('');
    setStep3ManualError('');
  }, []);

  const openStep3ManualBulk = useCallback(() => {
    if (isStep3MultiFolderMode) {
      setStep3BulkMultiModalOpen(true);
      setStep3BulkMultiError('');
      setStep3BulkMultiMessage('');
      return;
    }
    setStep3ManualModal({ mode: 'bulk' });
    setStep3ManualInput('');
    setStep3ManualError('');
  }, [isStep3MultiFolderMode]);

  const closeStep3ManualModal = useCallback(() => {
    if (step3ManualBusy) return;
    setStep3ManualModal(null);
    setStep3ManualInput('');
    setStep3ManualError('');
  }, [step3ManualBusy]);

  const handleSubmitStep3Manual = useCallback(async () => {
    if (!step3ManualModal || step3ManualBusy || processing.status === 'running') {
      return;
    }
    const activeInputPath = resolveActiveInputPath();
    if (!activeInputPath) {
      setStep3ManualError('Không tìm thấy input path để cập nhật.');
      return;
    }
    const raw = step3ManualInput.trim();
    if (!raw) {
      setStep3ManualError('Input rỗng.');
      return;
    }
    setStep3ManualBusy(true);
    setStep3ManualError('');
    try {
      const result = step3ManualModal.mode === 'single'
        ? await processing.applyManualBatchResponse({
            inputPath: activeInputPath,
            batchIndex: step3ManualModal.batchIndex || 1,
            responseJson: raw,
          })
        : await processing.applyManualBulkResponses({
            inputPath: activeInputPath,
            raw,
          });
      if (!result.success) {
        setStep3ManualError(result.error || 'Không thể áp dụng manual response.');
        return;
      }
      await refreshActiveSession();
      setStep3ManualModal(null);
      setStep3ManualInput('');
    } catch (error) {
      setStep3ManualError(error instanceof Error ? error.message : String(error));
    } finally {
      setStep3ManualBusy(false);
    }
  }, [
    step3ManualModal,
    step3ManualBusy,
    step3ManualInput,
    processing,
    resolveActiveInputPath,
    refreshActiveSession,
  ]);

  const closeStep3BulkMultiModal = useCallback(() => {
    if (step3BulkMultiBusy) return;
    setStep3BulkMultiModalOpen(false);
    setStep3BulkMultiError('');
    setStep3BulkMultiMessage('');
  }, [step3BulkMultiBusy]);

  const handleStep3BulkMultiPickFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted = Array.from(files).filter((file) => {
      const name = file.name.toLowerCase();
      return name.endsWith('.txt') || name.endsWith('.json');
    });
    if (accepted.length === 0) {
      setStep3BulkMultiError('Không có file TXT/JSON hợp lệ.');
      return;
    }
    const items: Step3BulkFileItem[] = accepted.map((file) => ({
      id: `${file.name}::${file.size}::${file.lastModified}`,
      file,
    }));
    setStep3BulkMultiFiles(items);
    setStep3BulkMultiError('');
    setStep3BulkMultiMessage('');
  }, []);

  const handleStep3BulkMultiClearFiles = useCallback(() => {
    setStep3BulkMultiFiles([]);
    setStep3BulkMultiError('');
    setStep3BulkMultiMessage('');
  }, []);

  const handleStep3BulkMultiMoveFile = useCallback((fromIndex: number, toIndex: number) => {
    setStep3BulkMultiFiles((prev) => {
      if (
        fromIndex < 0
        || toIndex < 0
        || fromIndex >= prev.length
        || toIndex >= prev.length
        || fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const handleApplyStep3BulkMultiFolder = useCallback(async () => {
    if (step3BulkMultiBusy || processing.status === 'running') {
      return;
    }
    const folderPaths = processingInputPaths;
    if (!folderPaths.length) {
      setStep3BulkMultiError('Không có folder đang chọn để áp dụng.');
      return;
    }
    if (step3BulkMultiFiles.length !== folderPaths.length) {
      setStep3BulkMultiError('Số file không khớp số folder đang chọn.');
      return;
    }
    setStep3BulkMultiBusy(true);
    setStep3BulkMultiError('');
    setStep3BulkMultiMessage('');
    try {
      for (let i = 0; i < folderPaths.length; i += 1) {
        const folderPath = folderPaths[i];
        const item = step3BulkMultiFiles[i];
        if (!item) {
          setStep3BulkMultiError(`Thiếu file cho folder #${i + 1}.`);
          return;
        }
        setStep3BulkMultiMessage(`Đang áp dụng ${i + 1}/${folderPaths.length}: ${item.file.name}`);
        const raw = await item.file.text();
        const result = await processing.applyManualBulkResponses({ inputPath: folderPath, raw });
        if (!result.success) {
          setStep3BulkMultiError(`Folder #${i + 1}: ${result.error || 'Không thể áp dụng.'}`);
          setStep3BulkMultiMessage('');
          return;
        }
      }
      await refreshActiveSession();
      setStep3BulkMultiModalOpen(false);
      setStep3BulkMultiFiles([]);
      setStep3BulkMultiMessage('');
    } catch (error) {
      setStep3BulkMultiError(error instanceof Error ? error.message : String(error));
    } finally {
      setStep3BulkMultiBusy(false);
    }
  }, [
    step3BulkMultiBusy,
    step3BulkMultiFiles,
    processing.status,
    processing,
    processingInputPaths,
    refreshActiveSession,
  ]);

  useEffect(() => {
    if (previewMode === 'render' && !renderedPreviewVideoPath) {
      setPreviewMode('live');
    }
  }, [previewMode, renderedPreviewVideoPath]);

  useEffect(() => {
    if (settings.inputType !== 'draft') {
      if (thumbnailPreviewFolderPath) {
        setThumbnailPreviewFolderPath('');
      }
      return;
    }
    const selectedPaths = processingInputPaths;
    if (!selectedPaths.length) {
      if (thumbnailPreviewFolderPath) {
        setThumbnailPreviewFolderPath('');
      }
      return;
    }
    if (thumbnailPreviewFolderPath && selectedPaths.includes(thumbnailPreviewFolderPath)) {
      return;
    }
    const fallbackPath = (
      (processing.currentFolder?.path && selectedPaths.includes(processing.currentFolder.path))
        ? processing.currentFolder.path
        : selectedPaths[0]
    ) || '';
    if (fallbackPath !== thumbnailPreviewFolderPath) {
      setThumbnailPreviewFolderPath(fallbackPath);
    }
  }, [
    processingInputPaths,
    processing.currentFolder?.path,
    settings.inputType,
    thumbnailPreviewFolderPath,
  ]);

  const effectivePreviewMode: 'render' | 'live' =
    previewMode === 'render' && renderedPreviewVideoPath ? 'render' : 'live';
  const previewVideoPath = effectivePreviewMode === 'render'
    ? renderedPreviewVideoPath
    : livePreviewVideoPath;
  const previewEntries = effectivePreviewMode === 'render'
    ? []
    : (sessionPreviewEntries.length > 0 ? sessionPreviewEntries : fileManager.entries);
  const firstFolderVideoInfo = firstFolderPath ? fileManager.folderVideos[firstFolderPath] : null;
  const thumbnailPreviewFolderPathResolved = settings.inputType === 'draft'
    ? (
        (isMultiFolder
          ? (thumbnailPreviewFolderPath || processing.currentFolder?.path || firstFolderPath)
          : (processing.currentFolder?.path || firstFolderPath)
        ) || ''
      )
    : '';
  const thumbnailPreviewFolderIndex = settings.inputType === 'draft'
    ? hardsubSettings.selectedDraftPaths.findIndex((path) => path === thumbnailPreviewFolderPathResolved)
    : -1;
  const thumbnailPreviewVideoInfo = thumbnailPreviewFolderPathResolved
    ? fileManager.folderVideos[thumbnailPreviewFolderPathResolved]
    : null;
  const thumbnailPreviewVideoPath = thumbnailPreviewVideoInfo?.fullPath || firstFolderVideoInfo?.fullPath || fileManager.firstVideoPath || null;
  const thumbnailPreviewInputPath = settings.inputType === 'draft'
    ? (thumbnailPreviewFolderPathResolved || firstFolderPath || '')
    : fileManager.filePath;
  const thumbnailPreviewContextKey: ThumbnailPreviewContextKey | null = (projectId && thumbnailPreviewInputPath)
    ? {
        projectId,
        folderPath: thumbnailPreviewInputPath,
        layoutKey: settings.renderMode === 'hardsub_portrait_9_16' ? 'portrait' : 'landscape',
      }
    : null;
  const thumbnailPreviewText = isMultiFolder
    ? (thumbnailPreviewFolderIndex >= 0 ? (hardsubSettings.thumbnailTextsByOrder[thumbnailPreviewFolderIndex] || '') : '')
    : hardsubSettings.thumbnailText;
  const thumbnailPreviewSecondaryText = isMultiFolder
    ? (
        thumbnailPreviewFolderIndex >= 0
          ? (hardsubSettings.thumbnailTextsSecondaryByOrder[thumbnailPreviewFolderIndex] || '')
          : ''
      )
    : (hardsubSettings.thumbnailTextSecondary || '');
  const videoPreviewText = isMultiFolder
    ? (thumbnailPreviewFolderIndex >= 0 ? (hardsubSettings.videoTextsByOrder[thumbnailPreviewFolderIndex] || '') : '')
    : hardsubSettings.videoText;
  const videoPreviewSecondaryText = isMultiFolder
    ? (
        thumbnailPreviewFolderIndex >= 0
          ? (hardsubSettings.videoTextsSecondaryByOrder[thumbnailPreviewFolderIndex] || '')
          : ''
      )
    : (hardsubSettings.videoTextSecondary || '');
  const videoNameByFolderPath = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    Object.entries(fileManager.folderVideos || {}).forEach(([folderPath, info]) => {
      map[folderPath] = info?.name || '';
    });
    return map;
  }, [fileManager.folderVideos]);
  const thumbnailPreviewSourceLabel = settings.inputType === 'draft'
    ? (thumbnailPreviewFolderPathResolved
      ? `Nguồn: ${getPathBaseName(thumbnailPreviewFolderPathResolved)}`
      : 'Nguồn: folder hiện tại')
    : 'Nguồn: file hiện tại';
  const handleThumbnailPreviewTextChange = useCallback((value: string) => {
    if (isMultiFolder) {
      if (thumbnailPreviewFolderIndex < 0) {
        return;
      }
      hardsubSettings.updateThumbnailTextByOrder(thumbnailPreviewFolderIndex, value);
      return;
    }
    hardsubSettings.setThumbnailText(value);
  }, [hardsubSettings, isMultiFolder, thumbnailPreviewFolderIndex]);

  const handleThumbnailPreviewSecondaryTextChange = useCallback((value: string) => {
    if (isMultiFolder) {
      if (thumbnailPreviewFolderIndex < 0) {
        return;
      }
      hardsubSettings.setThumbnailTextSecondaryByOrder(thumbnailPreviewFolderIndex, value);
      return;
    }
    hardsubSettings.setThumbnailTextSecondary(value);
  }, [hardsubSettings, isMultiFolder, thumbnailPreviewFolderIndex]);

  const handleVideoPreviewTextChange = useCallback((value: string) => {
    if (isMultiFolder) {
      if (thumbnailPreviewFolderIndex < 0) {
        return;
      }
      hardsubSettings.updateVideoTextByOrder(thumbnailPreviewFolderIndex, value);
      return;
    }
    hardsubSettings.setVideoText(value);
  }, [hardsubSettings, isMultiFolder, thumbnailPreviewFolderIndex]);

  const handleVideoPreviewSecondaryTextChange = useCallback((value: string) => {
    if (isMultiFolder) {
      if (thumbnailPreviewFolderIndex < 0) {
        return;
      }
      hardsubSettings.setVideoTextSecondaryByOrder(thumbnailPreviewFolderIndex, value);
      return;
    }
    hardsubSettings.setVideoTextSecondary(value);
  }, [hardsubSettings, isMultiFolder, thumbnailPreviewFolderIndex]);

  const [thumbnailPreviewVideoMeta, setThumbnailPreviewVideoMeta] = useState<{ duration: number; fps: number }>({
    duration: 5,
    fps: 30,
  });

  useEffect(() => {
    if (!thumbnailPreviewVideoPath) {
      setThumbnailPreviewVideoMeta({ duration: 5, fps: 30 });
      return;
    }
    let cancelled = false;
    const loadVideoMeta = async () => {
      try {
        const api = (window.electronAPI as any).captionVideo;
        const res = await api.getVideoMetadata(thumbnailPreviewVideoPath);
        if (cancelled || !res?.success || !res?.data) {
          return;
        }
        const duration = Number.isFinite(res.data.duration) && res.data.duration > 0 ? res.data.duration : 5;
        const fps = Number.isFinite(res.data.fps) && res.data.fps > 0 ? res.data.fps : 30;
        setThumbnailPreviewVideoMeta({ duration, fps });
      } catch {
        if (!cancelled) {
          setThumbnailPreviewVideoMeta({ duration: 5, fps: 30 });
        }
      }
    };
    void loadVideoMeta();
    return () => {
      cancelled = true;
    };
  }, [thumbnailPreviewVideoPath]);

  const thumbnailFrameFps = Number.isFinite(thumbnailPreviewVideoMeta.fps) && thumbnailPreviewVideoMeta.fps > 0
    ? thumbnailPreviewVideoMeta.fps
    : 30;
  const thumbnailFrameStepSec = 1 / thumbnailFrameFps;
  const thumbnailFrameMaxSec = Math.max(
    thumbnailFrameStepSec,
    Number.isFinite(thumbnailPreviewVideoMeta.duration) && thumbnailPreviewVideoMeta.duration > 0
      ? thumbnailPreviewVideoMeta.duration
      : 5
  );
  const thumbnailFrameValueSec = Math.max(
    0,
    Math.min(thumbnailFrameMaxSec, settings.thumbnailFrameTimeSec ?? 0)
  );
  const thumbnailFrameValueIndex = Math.max(0, Math.round(thumbnailFrameValueSec * thumbnailFrameFps));

  const setThumbnailFrameSecClamped = useCallback((value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    const next = Math.max(0, Math.min(thumbnailFrameMaxSec, value));
    settings.setThumbnailFrameTimeSec(next);
  }, [settings.setThumbnailFrameTimeSec, thumbnailFrameMaxSec]);

  const stepThumbnailFrame = useCallback((delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const maxFrame = Math.max(0, Math.round(thumbnailFrameMaxSec * thumbnailFrameFps));
    const nextFrame = Math.max(0, Math.min(maxFrame, thumbnailFrameValueIndex + Math.round(delta)));
    settings.setThumbnailFrameTimeSec(nextFrame / thumbnailFrameFps);
  }, [
    settings.setThumbnailFrameTimeSec,
    thumbnailFrameFps,
    thumbnailFrameMaxSec,
    thumbnailFrameValueIndex,
  ]);

  const setThumbnailPrimaryPositionAxis = useCallback((axis: 'x' | 'y', value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    settings.setThumbnailTextPrimaryPosition({
      x: axis === 'x' ? value : settings.thumbnailTextPrimaryPosition.x,
      y: axis === 'y' ? value : settings.thumbnailTextPrimaryPosition.y,
    });
  }, [
    settings.setThumbnailTextPrimaryPosition,
    settings.thumbnailTextPrimaryPosition.x,
    settings.thumbnailTextPrimaryPosition.y,
  ]);

  const setThumbnailSecondaryPositionAxis = useCallback((axis: 'x' | 'y', value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    settings.setThumbnailTextSecondaryPosition({
      x: axis === 'x' ? value : settings.thumbnailTextSecondaryPosition.x,
      y: axis === 'y' ? value : settings.thumbnailTextSecondaryPosition.y,
    });
  }, [
    settings.setThumbnailTextSecondaryPosition,
    settings.thumbnailTextSecondaryPosition.x,
    settings.thumbnailTextSecondaryPosition.y,
  ]);

  const handleBulkApplyJsonLines = useCallback((raw: string): BulkApplyResult => {
    const folderCount = step7VisibleFolderCount;
    if (!folderCount) {
      return {
        status: 'warning',
        summary: 'Chưa có folder để áp dụng.',
      };
    }

    const parsed = parseThumbnailBulkInput(raw || '', step7ThumbnailPanelData.items);
    if (!parsed.ok) {
      return {
        status: 'error',
        summary: `Lỗi dòng ${parsed.errorLine}.`,
        detail: parsed.errorMessage,
      };
    }

    if (parsed.rows.length === 0) {
      return {
        status: 'warning',
        summary: 'Không có dòng JSON hợp lệ để áp dụng.',
        detail: 'Dùng JSON Lines hoặc JSON plan có blocks.',
      };
    }

    const rowsForApply = parsed.rows
      .filter((row) => row.indexZeroBased >= 0 && row.indexZeroBased < folderCount)
      .map((row) => {
        const sourceIdx = mapStep7VisibleIndexToSourceIndex(row.indexZeroBased);
        if (sourceIdx < 0) {
          return null;
        }
        return {
          indexZeroBased: sourceIdx,
          text1: row.text1,
          ...(row.hasText2 ? { text2: row.text2 || '' } : {}),
        };
      })
      .filter((row): row is { indexZeroBased: number; text1: string; text2?: string } => Boolean(row));

    if (!rowsForApply.length) {
      return {
        status: 'warning',
        summary: 'Không có mapping hợp lệ với danh sách folder hiện tại.',
      };
    }

    const applyResult = hardsubSettings.applyBulkThumbnailByOrder(rowsForApply);
    const sourceFolderCount = hardsubSettings.thumbnailFolderItems.length;
    const normalizedRows = rowsForApply
      .map((row) => ({
        indexZeroBased: row.indexZeroBased,
        text1: (row.text1 || '').trim(),
        hasText2: Object.prototype.hasOwnProperty.call(row, 'text2'),
        text2: typeof row.text2 === 'string' ? row.text2.trim() : '',
      }))
      .filter((row) => row.text1.length > 0);
    const text2Rows = normalizedRows.filter((row) => row.hasText2);
    const nextTextsByOrder = hardsubSettings.thumbnailTextsByOrder.length === sourceFolderCount
      ? [...hardsubSettings.thumbnailTextsByOrder]
      : new Array(sourceFolderCount).fill('');
    const nextSecondaryByOrder = hardsubSettings.thumbnailTextsSecondaryByOrder.length === sourceFolderCount
      ? [...hardsubSettings.thumbnailTextsSecondaryByOrder]
      : new Array(sourceFolderCount).fill('');
    normalizedRows.forEach((row) => {
      nextTextsByOrder[row.indexZeroBased] = row.text1;
    });
    text2Rows.forEach((row) => {
      nextSecondaryByOrder[row.indexZeroBased] = row.text2 || '';
    });
    void persistThumbnailTextToSessions({
      thumbnailTextsByOrder: nextTextsByOrder,
      thumbnailTextsSecondaryByOrder: nextSecondaryByOrder,
    }).catch((error) => {
      console.warn('[CaptionTranslator] Không thể lưu thumbnail text ngay sau bulk apply', error);
    });

    const notes: string[] = [...parsed.notes];
    if (parsed.mode === 'json_lines') {
      const missing = Math.max(0, folderCount - parsed.sourceCount);
      const overflow = Math.max(0, parsed.sourceCount - folderCount);
      if (missing > 0) {
        notes.push(`Thiếu ${missing} dòng so với số folder.`);
      }
      if (overflow > 0) {
        notes.push(`Dư ${overflow} dòng đã bỏ qua.`);
      }
    } else {
      const covered = new Set(parsed.rows
        .filter((row) => row.indexZeroBased >= 0 && row.indexZeroBased < folderCount)
        .map((row) => row.indexZeroBased)
      ).size;
      if (covered < folderCount) {
        notes.push(`Đã map ${covered}/${folderCount} folder.`);
      }
    }

    const status: BulkApplyResult['status'] = notes.length > 0 ? 'warning' : 'success';
    const modeLabel = parsed.mode === 'json_plan' ? 'JSON plan' : 'JSON lines';

    return {
      status,
      summary: `[${modeLabel}] Đã áp dụng ${applyResult.appliedText1}/${folderCount} dòng (Text2: ${applyResult.appliedText2}).`,
      detail: notes.join(' '),
    };
  }, [hardsubSettings, mapStep7VisibleIndexToSourceIndex, persistThumbnailTextToSessions, step7ThumbnailPanelData.items, step7VisibleFolderCount]);

  // 6. Tính toán thời lượng Audio & Video cho Step 7
  // Reset khi chuyển folder cấu hình (firstFolderPath thay đổi)
  useEffect(() => {
    setDiskAudioDuration(null);
    setDiskSubtitleDuration(null);
    setDiskSubtitleAlreadyScaled(false);
  }, [firstFolderPath]);

  useEffect(() => {
    let mounted = true;
    const fetchDiskDuration = async () => {
      if (!displayOutputDir) {
        if (mounted) setDiskAudioDuration(null);
        return;
      }
      try {
        const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
        const activeInputPath = processing.currentFolder?.path ?? inputPaths[0];
        const safeScale = settings.srtSpeed > 0 ? settings.srtSpeed : 1.0;
        const speedLabel = safeScale.toFixed(2).replace(/\.?0+$/, '');
        const candidateAudioPaths: string[] = [];

        if (activeInputPath) {
          const sessionPath = getSessionPathForInputPath(settings.inputType, activeInputPath);
          const session = await readCaptionSession(sessionPath, {
            projectId,
            inputType: settings.inputType,
            sourcePath: activeInputPath,
            folderPath: settings.inputType === 'draft'
              ? activeInputPath
              : activeInputPath.replace(/[^/\\]+$/, ''),
          });
          const artifactMergedPath = typeof session.artifacts.mergedAudioPath === 'string'
            ? session.artifacts.mergedAudioPath.trim()
            : '';
          const mergeResult = (session.data.mergeResult && typeof session.data.mergeResult === 'object')
            ? (session.data.mergeResult as Record<string, unknown>)
            : {};
          const mergeResultPath = typeof mergeResult.outputPath === 'string'
            ? mergeResult.outputPath.trim()
            : '';

          if (artifactMergedPath) {
            candidateAudioPaths.push(artifactMergedPath);
          }
          if (mergeResultPath) {
            candidateAudioPaths.push(mergeResultPath);
          }
        }

        candidateAudioPaths.push(`${displayOutputDir}/merged_audio_${speedLabel}x.wav`);
        candidateAudioPaths.push(`${displayOutputDir}/merged_audio.wav`);

        const uniqueAudioPaths = Array.from(new Set(candidateAudioPaths.filter((p) => !!p)));
        let resolvedDuration: number | null = null;

        for (const audioPath of uniqueAudioPaths) {
          console.log('Fetching metadata for audio path:', audioPath);
          const res = await (window.electronAPI as any).captionVideo.getVideoMetadata(audioPath);
          console.log('Metadata response:', res);
          if (!res?.success || !res.data?.duration) {
            continue;
          }

          const audioDuration: number = res.data.duration;
          // Sanity check: nếu audio > 2× video duration → stale file từ run cũ, thử candidate khác
          if (originalVideoDuration > 0 && audioDuration > originalVideoDuration * 2) {
            console.warn(`diskAudioDuration ${audioDuration}s > 2× video ${originalVideoDuration}s — stale candidate, continue`);
            continue;
          }

          resolvedDuration = audioDuration;
          break;
        }

        if (mounted) {
          setDiskAudioDuration(resolvedDuration);
        }
      } catch (err) {
        console.error("Error fetching disk duration:", err);
        if (mounted) setDiskAudioDuration(null);
      }
    };

    fetchDiskDuration();
    if (processing.status === 'success') {
      fetchDiskDuration();
    }
    return () => { mounted = false; };
  }, [
    displayOutputDir,
    fileManager.filePath,
    originalVideoDuration,
    processing.currentFolder?.path,
    processing.status,
    projectId,
    settings.inputType,
    settings.srtSpeed,
  ]);

  const srtDurationMs = fileManager.entries.length > 0 
    ? Math.max(...fileManager.entries.map(e => e.endMs || 0)) 
    : 0;
  const srtTimeScale = settings.srtSpeed > 0 ? settings.srtSpeed : 1.0;

  const normalizeSpeedLabel = (speed: number) => {
    const fixed = speed.toFixed(2);
    return fixed.replace(/\.?0+$/, '');
  };

  useEffect(() => {
    let mounted = true;
    const fetchDiskSubtitleDuration = async () => {
      if (!displayOutputDir) {
        if (mounted) {
          setDiskSubtitleDuration(null);
          setDiskSubtitleAlreadyScaled(false);
        }
        return;
      }

      const getDurationFromSrt = async (srtPath: string, scale: number) => {
        try {
          const res = await (window.electronAPI as any).caption.parseSrt(srtPath);
          if (!res?.success || !res?.data?.entries?.length) return null;
          const endMs = Math.max(...res.data.entries.map((e: any) => e.endMs || 0));
          if (!endMs || endMs <= 0) return null;
          return (endMs / 1000) * scale;
        } catch {
          return null;
        }
      };

      const scaleLabel = normalizeSpeedLabel(srtTimeScale);
      const scaledSrtPath = `${displayOutputDir}/srt/subtitle_${scaleLabel}x.srt`;
      const translatedSrtPath = `${displayOutputDir}/srt/translated.srt`;

      let durationSec = await getDurationFromSrt(scaledSrtPath, 1.0);
      let alreadyScaled = durationSec != null;
      if (durationSec == null) {
        durationSec = await getDurationFromSrt(translatedSrtPath, srtTimeScale);
        alreadyScaled = false;
      }

      if (mounted) {
        setDiskSubtitleDuration(durationSec);
        setDiskSubtitleAlreadyScaled(alreadyScaled);
      }
    };

    fetchDiskSubtitleDuration();
    if (processing.status === 'success') {
      fetchDiskSubtitleDuration();
    }
    return () => { mounted = false; };
  }, [displayOutputDir, srtTimeScale, processing.status]);

  const scaledSrtDurationSec = srtDurationMs > 0 ? (srtDurationMs / 1000) * srtTimeScale : 0;
  const subtitleSyncDurationSec = (diskSubtitleDuration && diskSubtitleDuration > 0)
    ? diskSubtitleDuration
    : scaledSrtDurationSec;

  // Multi-folder: entries không được load (guarded by !isMulti) nên srtDurationMs = 0.
  // Fallback: dùng videoInfo.duration của folder hiện tại làm ước tính duration audio
  // (TTS fill theo SRT timing ≈ video duration). Cập nhật real-time khi currentFolder đổi.
  let fallbackBaseAudioDurationMs = srtDurationMs;
  if (isMultiFolder && fallbackBaseAudioDurationMs === 0 && originalVideoDuration > 0) {
    fallbackBaseAudioDurationMs = originalVideoDuration * 1000;
  }

  // Single-folder: có thể dùng audioFiles nếu đã chạy TTS
  if (!isMultiFolder && !settings.autoFitAudio && audioFiles && audioFiles.length > 0) {
    let maxEndTime = 0;
    for (const f of audioFiles) {
      // @ts-ignore
      const ttsEndMs = f.startMs + (typeof f.durationMs === 'number' ? f.durationMs : 0);
      if (ttsEndMs > maxEndTime) maxEndTime = ttsEndMs;
    }
    fallbackBaseAudioDurationMs = Math.max(srtDurationMs, maxEndTime);
  }

  // Dùng diskAudioDuration (file thực trên đĩa) nếu có, cả single và multi-folder
  const baseAudioDuration = (diskAudioDuration !== null && diskAudioDuration > 0)
    ? diskAudioDuration
    : (subtitleSyncDurationSec > 0 ? subtitleSyncDurationSec : (fallbackBaseAudioDurationMs / 1000));

  // isEstimated: true khi không có audio file thực và dùng video duration fallback
  const isEstimated = diskAudioDuration === null && subtitleSyncDurationSec === 0 && srtDurationMs === 0 && originalVideoDuration > 0;

  const audioExpectedDuration = settings.renderAudioSpeed > 0 
    ? baseAudioDuration / settings.renderAudioSpeed 
    : baseAudioDuration;

  const step4Scale = srtTimeScale > 0 ? srtTimeScale : 1.0;
  const step7Speed = settings.renderAudioSpeed > 0 ? settings.renderAudioSpeed : 1.0;
  const subRenderDuration = subtitleSyncDurationSec;
  const timingCalc = calculateHardsubTiming({
    step4Scale,
    step7Speed,
    subRenderDuration,
    audioScaledDuration: audioExpectedDuration,
    configuredSrtTimeScale: srtTimeScale,
    srtAlreadyScaled: diskSubtitleAlreadyScaled,
  });
  const hasBackendTimingForCurrentSettings = Boolean(
    sessionTimingSnapshot
      && nearlyEqual(sessionTimingSnapshot.step4SrtScale, step4Scale)
      && nearlyEqual(sessionTimingSnapshot.step7AudioSpeed, step7Speed)
  );
  const audioEffectiveSpeed = hasBackendTimingForCurrentSettings && typeof sessionTimingSnapshot?.audioEffectiveSpeed === 'number'
    ? sessionTimingSnapshot.audioEffectiveSpeed
    : timingCalc.audioEffectiveSpeed;
  const videoSubBaseDuration = hasBackendTimingForCurrentSettings && typeof sessionTimingSnapshot?.videoSubBaseDuration === 'number'
    ? sessionTimingSnapshot.videoSubBaseDuration
    : timingCalc.videoSubBaseDuration;
  const autoVideoSpeed = hasBackendTimingForCurrentSettings && typeof sessionTimingSnapshot?.videoSpeedMultiplier === 'number'
    ? sessionTimingSnapshot.videoSpeedMultiplier
    : timingCalc.videoSpeedMultiplier;
  const videoMarkerSec = hasBackendTimingForCurrentSettings && typeof sessionTimingSnapshot?.videoMarkerSec === 'number'
    ? sessionTimingSnapshot.videoMarkerSec
    : timingCalc.videoMarkerSec;
  const timingDisplaySource = hasBackendTimingForCurrentSettings ? 'backend' : 'ui_fallback';

  const formatDuration = (seconds: number) => {
    if (seconds <= 0) return '--';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1);
    return m > 0 ? `${m}p${s}s` : `${s}s`;
  };

  useEffect(() => {
    console.log(`[CaptionTranslator] 🕒 THỜI GIAN GỐC & TÍNH TOÁN (AUTO-FIT):
- File audio trên đĩa (diskAudioDuration): ${diskAudioDuration ? diskAudioDuration.toFixed(2) + 's' : 'null'}
- Thời gian gốc dự phòng (fallbackBaseAudioDurationMs): ${(fallbackBaseAudioDurationMs / 1000).toFixed(2)}s
- Mốc subtitle cuối (scaled theo srtSpeed): ${scaledSrtDurationSec.toFixed(2)}s
- Mốc subtitle từ file SRT trên đĩa: ${diskSubtitleDuration ? diskSubtitleDuration.toFixed(2) + 's' : 'null'}
- SRT đã scale sẵn (backend-style): ${diskSubtitleAlreadyScaled ? 'yes' : 'no'}
- Step4 scale: ${step4Scale.toFixed(3)}x
- Step7 speed: ${step7Speed.toFixed(3)}x
- Audio hiệu dụng (step4 - delta step7): ${audioEffectiveSpeed.toFixed(3)}x
- Sub render duration: ${subRenderDuration.toFixed(2)}s
- Video sub base duration: ${videoSubBaseDuration.toFixed(2)}s
- Duration Audio gốc (baseAudioDuration): ${baseAudioDuration.toFixed(2)}s
- Tốc độ Audio thiết lập (settings.renderAudioSpeed): ${settings.renderAudioSpeed}x
- 👉 Duration Audio mới (Render video length): ${audioExpectedDuration.toFixed(2)}s
- Duration Video dùng để sync (videoSubBaseDuration): ${videoSubBaseDuration.toFixed(2)}s
- 👉 Tốc độ Video tự động chỉnh (autoVideoSpeed): ${autoVideoSpeed.toFixed(3)}x
- 🎯 Mốc video chuẩn (gốc): ${videoMarkerSec.toFixed(2)}s
- Timing source: ${timingDisplaySource}
    `);
  }, [diskAudioDuration, diskSubtitleDuration, diskSubtitleAlreadyScaled, fallbackBaseAudioDurationMs, scaledSrtDurationSec, baseAudioDuration, settings.renderAudioSpeed, audioExpectedDuration, step4Scale, step7Speed, audioEffectiveSpeed, subRenderDuration, videoSubBaseDuration, autoVideoSpeed, videoMarkerSec, timingDisplaySource]);

  useEffect(() => {
    // Lấy danh sách font thực tế từ resources/fonts
    const fetchFonts = async () => {
      try {
        const res = await (window.electronAPI as any).captionVideo.getAvailableFonts();
        if (res?.success && res.data?.length > 0) {
          setAvailableFonts(res.data);
        }
      } catch (err) {
        console.error("Lỗi lấy font", err);
      }
    };
    fetchFonts();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const preloadFontsForUi = async () => {
      for (const fontName of availableFonts) {
        if (cancelled) {
          return;
        }
        try {
          await ensureCaptionFontLoaded(fontName);
        } catch (error) {
          console.warn(`[CaptionTranslator] Không preload được font: ${fontName}`, error);
        }
      }
    };

    preloadFontsForUi();
    return () => {
      cancelled = true;
    };
  }, [availableFonts]);
  
  const getProgressColor = () => {
    if (processing.status === 'error') return 'var(--color-error)';
    if (processing.status === 'success') return 'var(--color-success)';
    return 'var(--color-primary)';
  };

  const step7DependencyWarning = (() => {
    const issue = processing.stepDependencyIssues.find((item) => item.step === 7);
    if (!issue) return undefined;
    return `Step 7 đang bị chặn: ${issue.reason}`;
  })();
  const step7RenderUiLog = useMemo(() => {
    if (processing.status !== 'running' || processing.currentStep !== 7) {
      return '';
    }
    const timeSec = settings.thumbnailFrameTimeSec ?? 0;
    const durationSec = settings.thumbnailDurationSec ?? 0.5;
    const timeLabel = (settings.thumbnailFrameTimeSec === null || settings.thumbnailFrameTimeSec === undefined)
      ? 'auto(0s)'
      : `${timeSec}s`;
    const renderMode = settings.renderMode || 'black_bg';
    const accel = settings.hardwareAcceleration || 'none';
    const res = settings.renderResolution || 'original';
    return `Step7 render: mode=${renderMode} | thumbnail=ON @${timeLabel}/${durationSec}s | accel=${accel} | res=${res}`;
  }, [
    processing.status,
    processing.currentStep,
    settings.thumbnailFrameTimeSec,
    settings.thumbnailDurationSec,
    settings.renderMode,
    settings.hardwareAcceleration,
    settings.renderResolution,
  ]);
  const isStep7AudioMixing = processing.audioPreviewStatus === 'mixing';
  const hasStep7AudioPreview = Boolean(processing.audioPreviewDataUri);
  const isStep7AudioError = processing.audioPreviewStatus === 'error' || Boolean(step7AudioButtonError);
  const isStep7AudioActionActive = isStep7AudioMixing || isStep7AudioPlaying;
  const isBulkExportRunning = thumbnailBulkExportState.status === 'running';
  const canBulkExportThumbnails = (
    settings.inputType === 'draft'
    && isMultiFolder
    && (settings.renderMode === 'hardsub' || settings.renderMode === 'hardsub_portrait_9_16')
    && selectedDraftRunPaths.length > 0
  );
  const canQuickStep7Audio = isStep7AudioActionActive || hasStep7AudioPreview || (
    processing.enabledSteps.has(7) &&
    processing.status !== 'running' &&
    Boolean(displayPath || fileManager.filePath)
  );
  const step7QuickAudioLabel = isStep7AudioMixing
    ? 'Đang mix...'
    : isStep7AudioPlaying
      ? 'Đang phát'
      : 'Test mix 20s';
  const step7QuickAudioTitle = isStep7AudioMixing
    ? 'Bấm để dừng mix audio preview'
    : isStep7AudioPlaying
      ? 'Bấm để dừng phát audio preview'
      : 'Test mix 20s cho Step 7';
  const bulkExportLabel = isBulkExportRunning ? 'Đang xuất thumbnail...' : 'Xuất thumbnail';
  const bulkExportTitle = thumbnailBulkExportState.message
    ? thumbnailBulkExportState.message
    : 'Xuất thumbnail hàng loạt (16:9 + 9:16)';

  const handleQuickStep7AudioToggle = useCallback(() => {
    if (isStep7AudioPlaying) {
      step7AudioAutoPlayAfterMixRef.current = false;
      stopStep7AudioPlayback();
      return;
    }
    if (isStep7AudioMixing) {
      step7AudioAutoPlayAfterMixRef.current = false;
      void processing.stopStep7AudioPreview();
      stopStep7AudioPlayback();
      return;
    }

    setStep7AudioButtonError('');
    const currentSignature = buildStep7AudioPreviewSignature();
    const canReuseCurrentPreview = (
      processing.audioPreviewStatus === 'ready'
      && Boolean(processing.audioPreviewDataUri)
      && step7AudioLastMixedSignatureRef.current === currentSignature
    );
    if (canReuseCurrentPreview && processing.audioPreviewDataUri) {
      step7AudioAutoPlayAfterMixRef.current = false;
      void playStep7AudioPreview(processing.audioPreviewDataUri);
      return;
    }

    step7AudioAutoPlayAfterMixRef.current = true;
    void processing.handleStep7AudioPreview(displayPath || undefined);
  }, [
    isStep7AudioPlaying,
    isStep7AudioMixing,
    stopStep7AudioPlayback,
    processing,
    playStep7AudioPreview,
    displayPath,
    buildStep7AudioPreviewSignature,
  ]);

  useEffect(() => {
    if (processing.audioPreviewStatus === 'ready' && processing.audioPreviewDataUri) {
      if (step7AudioLastDataUriRef.current !== processing.audioPreviewDataUri) {
        step7AudioLastDataUriRef.current = processing.audioPreviewDataUri;
        step7AudioLastMixedSignatureRef.current = buildStep7AudioPreviewSignature();
      }
      return;
    }
    if (!processing.audioPreviewDataUri) {
      step7AudioLastDataUriRef.current = '';
      step7AudioLastMixedSignatureRef.current = '';
    }
  }, [
    processing.audioPreviewStatus,
    processing.audioPreviewDataUri,
    buildStep7AudioPreviewSignature,
  ]);

  const isStep3Running = processing.status === 'running' && processing.currentStep === 3;

  useEffect(() => {
    if (processing.status !== 'running' || !processing.currentStep) {
      return;
    }
    const step = processing.currentStep as Step;
    setStepLiveStartMs((prev) => {
      if (prev[step]) {
        return prev;
      }
      const sessionStartMs = parseIsoToMs(sessionStepTimingMeta[step]?.startedAt);
      return {
        ...prev,
        [step]: sessionStartMs ?? Date.now(),
      };
    });
  }, [processing.status, processing.currentStep, sessionStepTimingMeta]);

  useEffect(() => {
    if (processing.status === 'running') {
      return;
    }
    setStepLiveStartMs({});
  }, [processing.status]);

  useEffect(() => {
    setStepLiveStartMs({});
    setStep3BatchRuntimeMap({});
    setStep3LiveTotalBatches(null);
    setStep3RuntimeTimer({
      apiLabel: '',
      tokenLabel: '',
      apiStartedAtMs: null,
      apiEndedAtMs: null,
      tokenStartedAtMs: null,
      tokenEndedAtMs: null,
    });
  }, [processing.currentFolder?.path]);

  useEffect(() => {
    if (!isStep3Running) {
      setStep3RuntimeTimer((prev) => {
        if (!prev.apiStartedAtMs && !prev.tokenStartedAtMs) {
          return prev;
        }
        const now = Date.now();
        return {
          ...prev,
          apiEndedAtMs: prev.apiEndedAtMs ?? now,
          tokenEndedAtMs: prev.tokenEndedAtMs ?? now,
        };
      });
      return;
    }

    const now = Date.now();
    const hints = parseStep3RuntimeHints(processing.progress.message || '');
    const fallbackApi = settings.translateMethod === 'impit'
      ? 'impit'
      : settings.translateMethod === 'gemini_webapi_queue'
        ? 'gemini_webapi_queue'
        : settings.translateMethod === 'grok_ui'
          ? 'grok_ui'
          : 'api';
    const nextApiLabel = (hints.apiLabel || fallbackApi).toLowerCase();
    const fallbackToken = nextApiLabel === 'impit'
      ? 'impit_cookie'
      : nextApiLabel === 'gemini_webapi_queue'
        ? 'queue_rr'
        : nextApiLabel === 'grok_ui'
          ? 'grok_ui'
          : 'rotation';
    const nextTokenLabel = (hints.tokenLabel || fallbackToken).trim();

    setStep3RuntimeTimer((prev) => {
      let apiStartedAtMs = prev.apiStartedAtMs;
      let apiEndedAtMs = prev.apiEndedAtMs;
      if (prev.apiLabel !== nextApiLabel || !apiStartedAtMs || apiEndedAtMs) {
        apiStartedAtMs = now;
        apiEndedAtMs = null;
      }

      let tokenStartedAtMs = prev.tokenStartedAtMs;
      let tokenEndedAtMs = prev.tokenEndedAtMs;
      if (prev.tokenLabel !== nextTokenLabel || !tokenStartedAtMs || tokenEndedAtMs) {
        tokenStartedAtMs = now;
        tokenEndedAtMs = null;
      }

      return {
        apiLabel: nextApiLabel,
        tokenLabel: nextTokenLabel,
        apiStartedAtMs,
        apiEndedAtMs,
        tokenStartedAtMs,
        tokenEndedAtMs,
      };
    });
  }, [isStep3Running, processing.progress.message, settings.translateMethod]);

  useEffect(() => {
    const totalBatches = typeof processing.progress.totalBatches === 'number' && Number.isFinite(processing.progress.totalBatches)
      ? Math.max(1, Math.floor(processing.progress.totalBatches))
      : null;
    if (totalBatches !== null) {
      setStep3LiveTotalBatches((prev) => (prev === totalBatches ? prev : totalBatches));
    }

    if (!isStep3Running) {
      return;
    }

    const eventType = processing.progress.eventType;
    if (eventType !== 'batch_started' && eventType !== 'batch_retry' && eventType !== 'batch_completed' && eventType !== 'batch_failed') {
      return;
    }

    const fromReport = typeof processing.progress.batchReport?.batchIndex === 'number'
      ? Math.floor(processing.progress.batchReport.batchIndex)
      : null;
    const fromProgress = typeof processing.progress.batchIndex === 'number'
      ? Math.floor(processing.progress.batchIndex) + 1
      : null;
    const batchIndex = fromReport ?? fromProgress;
    if (!batchIndex || batchIndex <= 0) {
      return;
    }

    const nowMs = Date.now();
    const progressStartMs = toEpochMs(processing.progress.startedAt);
    const progressEndMs = toEpochMs(processing.progress.endedAt);
    const progressNextAllowedMs = toEpochMs(processing.progress.nextAllowedAt);

    setStep3BatchRuntimeMap((prev) => {
      const current = prev[batchIndex];
      const next: Step3BatchRuntimeEntry = current
        ? { ...current }
        : {
            phase: 'waiting',
            queuedAtMs: nowMs,
            dispatchAtMs: null,
            completedAtMs: null,
            nextAllowedAtMs: null,
          };

      if (eventType === 'batch_started' || eventType === 'batch_retry') {
        if (progressStartMs !== null) {
          next.phase = 'running';
          next.dispatchAtMs = progressStartMs;
          next.queuedAtMs = next.queuedAtMs ?? nowMs;
        } else if (next.phase !== 'running') {
          next.phase = 'waiting';
          next.queuedAtMs = next.queuedAtMs ?? nowMs;
        }
        next.nextAllowedAtMs = progressNextAllowedMs ?? next.nextAllowedAtMs;
      } else if (eventType === 'batch_completed' || eventType === 'batch_failed') {
        next.phase = eventType === 'batch_completed' ? 'success' : 'failed';
        next.dispatchAtMs = toEpochMs(processing.progress.batchReport?.startedAt) ?? progressStartMs ?? next.dispatchAtMs;
        next.completedAtMs = toEpochMs(processing.progress.batchReport?.endedAt) ?? progressEndMs ?? nowMs;
        next.error = processing.progress.batchReport?.error;
      }

      if (
        current
        && current.phase === next.phase
        && current.queuedAtMs === next.queuedAtMs
        && current.dispatchAtMs === next.dispatchAtMs
        && current.completedAtMs === next.completedAtMs
        && current.nextAllowedAtMs === next.nextAllowedAtMs
        && current.error === next.error
      ) {
        return prev;
      }

      return {
        ...prev,
        [batchIndex]: next,
      };
    });
  }, [
    isStep3Running,
    processing.progress.eventType,
    processing.progress.batchIndex,
    processing.progress.totalBatches,
    processing.progress.batchReport?.batchIndex,
    processing.progress.batchReport?.startedAt,
    processing.progress.batchReport?.endedAt,
    processing.progress.batchReport?.error,
    processing.progress.startedAt,
    processing.progress.endedAt,
    processing.progress.nextAllowedAt,
  ]);

  useEffect(() => {
    if (isStep3Running) {
      return;
    }
    setStep3BatchRuntimeMap({});
    setStep3LiveTotalBatches(null);
  }, [isStep3Running]);

  useEffect(() => {
    const shouldTick = processing.status === 'running'
      || isStep3Running
      || Object.values(sessionStepTimingMeta).some((meta) => meta?.status === 'running');
    if (!shouldTick) {
      return;
    }
    const timer = window.setInterval(() => {
      setUiNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [processing.status, isStep3Running, sessionStepTimingMeta]);

  const getStepElapsedLabel = useCallback((step: Step): string => {
    const meta = sessionStepTimingMeta[step];
    const sessionStartMs = parseIsoToMs(meta?.startedAt);
    const sessionEndMs = parseIsoToMs(meta?.endedAt);
    const isCurrentRunningStep = processing.status === 'running' && processing.currentStep === step;

    let elapsedMs: number | null = null;
    if (isCurrentRunningStep) {
      const liveStartMs = stepLiveStartMs[step];
      const effectiveStartMs = sessionStartMs ?? liveStartMs ?? Date.now();
      elapsedMs = Math.max(0, uiNowMs - effectiveStartMs);
    } else if (sessionStartMs !== null && sessionEndMs !== null && sessionEndMs >= sessionStartMs) {
      elapsedMs = sessionEndMs - sessionStartMs;
    } else if (sessionStartMs !== null && meta?.status === 'running') {
      elapsedMs = Math.max(0, uiNowMs - sessionStartMs);
    }

    if (elapsedMs === null) {
      return '--';
    }
    return formatElapsedMs(elapsedMs);
  }, [processing.status, processing.currentStep, sessionStepTimingMeta, stepLiveStartMs, uiNowMs]);

  const step3ApiRuntimeLabel = useMemo(() => {
    if (!step3RuntimeTimer.apiStartedAtMs) {
      return '--';
    }
    const endMs = step3RuntimeTimer.apiEndedAtMs ?? uiNowMs;
    return formatElapsedMs(Math.max(0, endMs - step3RuntimeTimer.apiStartedAtMs));
  }, [step3RuntimeTimer.apiStartedAtMs, step3RuntimeTimer.apiEndedAtMs, uiNowMs]);

  const step3TokenRuntimeLabel = useMemo(() => {
    if (!step3RuntimeTimer.tokenStartedAtMs) {
      return '--';
    }
    const endMs = step3RuntimeTimer.tokenEndedAtMs ?? uiNowMs;
    return formatElapsedMs(Math.max(0, endMs - step3RuntimeTimer.tokenStartedAtMs));
  }, [step3RuntimeTimer.tokenStartedAtMs, step3RuntimeTimer.tokenEndedAtMs, uiNowMs]);

  const step3BatchViewModel = useMemo<Step3BatchViewModel | null>(() => {
    const safeState = sessionStep3BatchState;
    const step3Stopped = sessionStepStatus[3] === 'stopped';
    const stateReports = Array.isArray(safeState?.batches) ? safeState.batches : [];
    const reportMap = new Map<number, SharedTranslationBatchReport>();
    for (const report of stateReports) {
      if (!report || typeof report.batchIndex !== 'number') {
        continue;
      }
      if (step3Stopped && report.status === 'failed' && report.error === 'NO_BATCH_REPORT') {
        continue;
      }
      const batchIndex = Math.max(1, Math.floor(report.batchIndex));
      reportMap.set(batchIndex, report);
    }

    const planMap = new Map<number, { startIndex: number; endIndex: number; lineCount: number }>();
    for (const plan of sessionStep2BatchPlan) {
      if (!plan || typeof plan.batchIndex !== 'number') {
        continue;
      }
      const idx = Math.max(1, Math.floor(plan.batchIndex));
      const startIndex = typeof plan.startIndex === 'number' ? Math.max(0, Math.floor(plan.startIndex)) : 0;
      const endIndex = typeof plan.endIndex === 'number' ? Math.max(startIndex, Math.floor(plan.endIndex)) : startIndex;
      const lineCount = typeof plan.lineCount === 'number' ? Math.max(0, Math.floor(plan.lineCount)) : (endIndex - startIndex + 1);
      planMap.set(idx, { startIndex, endIndex, lineCount });
    }

    const runtimeIndexes = Object.keys(step3BatchRuntimeMap)
      .map((key) => Number(key))
      .filter((value) => Number.isFinite(value) && value > 0);
    const maxRuntimeIndex = runtimeIndexes.reduce((max, current) => Math.max(max, current), 0);
    const maxReportIndex = Array.from(reportMap.keys()).reduce((max, current) => Math.max(max, current), 0);
    const liveTotal = step3LiveTotalBatches && step3LiveTotalBatches > 0
      ? step3LiveTotalBatches
      : 0;
    const stateTotal = typeof safeState?.totalBatches === 'number' && Number.isFinite(safeState.totalBatches)
      ? Math.max(1, Math.floor(safeState.totalBatches))
      : 0;
    const planTotal = sessionStep2BatchPlan.length > 0
      ? sessionStep2BatchPlan.length
      : (typeof sessionStep2BatchPlanCount === 'number'
        ? Math.max(0, Math.floor(sessionStep2BatchPlanCount))
        : 0);
    const totalBatches = Math.max(stateTotal, liveTotal, maxReportIndex, maxRuntimeIndex, planTotal);
    const totalSourceLines = Math.max(
      0,
      fileManager.entries.length,
      sessionPreviewEntries.length,
      sessionEntryCounts.translated,
      sessionEntryCounts.extracted
    );
    const maxExpectedFromReports = stateReports
      .map((report) => (typeof report?.expectedLines === 'number' && Number.isFinite(report.expectedLines) ? Math.floor(report.expectedLines) : 0))
      .reduce((max, current) => Math.max(max, current), 0);
    const step3BatchSize = Math.max(1, maxExpectedFromReports || STEP3_DEFAULT_LINES_PER_BATCH);

    const missingBatchIndexes = Array.isArray(safeState?.missingBatchIndexes)
      ? safeState.missingBatchIndexes
        .filter((value): value is number => Number.isFinite(value))
        .map((value) => Math.max(1, Math.floor(value)))
        .sort((a, b) => a - b)
      : [];
    const filteredMissingBatchIndexes = step3Stopped
      ? missingBatchIndexes.filter((value) => reportMap.has(value))
      : missingBatchIndexes;

    const rows: Step3BatchViewRow[] = [];
    for (let batchIndex = 1; batchIndex <= totalBatches; batchIndex++) {
      const report = reportMap.get(batchIndex);
      const runtimeEntry = step3BatchRuntimeMap[batchIndex];
      const planEntry = planMap.get(batchIndex);
      const fallbackStartIndex = Math.max(0, (batchIndex - 1) * step3BatchSize);
      const fallbackExpectedLines = totalSourceLines > fallbackStartIndex
        ? Math.min(step3BatchSize, totalSourceLines - fallbackStartIndex)
        : 0;
      const fallbackEndIndex = fallbackExpectedLines > 0
        ? fallbackStartIndex + fallbackExpectedLines - 1
        : fallbackStartIndex;
      const reportStatus = report?.status === 'success' || report?.status === 'failed'
        ? report.status
        : null;
      const runtimeStatus = runtimeEntry?.phase;
      const status: Step3BatchStatus =
        runtimeStatus === 'waiting' || runtimeStatus === 'running'
          ? runtimeStatus
          : runtimeStatus === 'success' || runtimeStatus === 'failed'
            ? runtimeStatus
            : (reportStatus || 'waiting');

      const reportStartedAtMs = toEpochMs((report as { startedAt?: number } | undefined)?.startedAt);
      const reportEndedAtMs = toEpochMs((report as { endedAt?: number } | undefined)?.endedAt);
      const startedAtMs = reportStartedAtMs ?? runtimeEntry?.dispatchAtMs ?? null;
      const endedAtMs = reportEndedAtMs ?? runtimeEntry?.completedAtMs ?? null;
      const queuedAtMs = runtimeEntry?.queuedAtMs ?? null;
      const nextAllowedAtMs = runtimeEntry?.nextAllowedAtMs ?? null;
      const planExpectedLines = typeof planEntry?.lineCount === 'number' ? planEntry.lineCount : null;
      const baseExpectedLines = typeof planExpectedLines === 'number' ? planExpectedLines : fallbackExpectedLines;
      const expectedLines = typeof report?.expectedLines === 'number' && Number.isFinite(report.expectedLines)
        ? Math.max(0, Math.floor(report.expectedLines))
        : baseExpectedLines;
      const translatedLines = typeof report?.translatedLines === 'number' && Number.isFinite(report.translatedLines)
        ? Math.max(0, Math.floor(report.translatedLines))
        : 0;
      const baseStartLine = typeof planEntry?.startIndex === 'number' ? planEntry.startIndex : fallbackStartIndex;
      const baseEndLine = typeof planEntry?.endIndex === 'number' ? planEntry.endIndex : fallbackEndIndex;
      const startLine = (typeof report?.startIndex === 'number' && Number.isFinite(report.startIndex))
        ? Math.max(0, Math.floor(report.startIndex))
        : baseStartLine;
      const endLine = (typeof report?.endIndex === 'number' && Number.isFinite(report.endIndex))
        ? Math.max(startLine, Math.floor(report.endIndex))
        : baseEndLine;
      const lineRangeLabel = expectedLines > 0 ? `${startLine + 1}–${endLine + 1}` : '--';
      const lineSummaryLabel = (() => {
        if (status === 'success') {
          return `${translatedLines}/${expectedLines} (${lineRangeLabel})`;
        }
        if (status === 'failed') {
          return `${translatedLines}/${expectedLines} (${lineRangeLabel})`;
        }
        return `${expectedLines} dòng (${lineRangeLabel})`;
      })();

      const timeLabel = (() => {
        if (status === 'waiting') {
          return typeof queuedAtMs === 'number'
            ? `Chờ ${formatElapsedMs(Math.max(0, uiNowMs - queuedAtMs))}`
            : 'Chờ --';
        }
        if (status === 'running') {
          return typeof startedAtMs === 'number'
            ? `Xử lý ${formatElapsedMs(Math.max(0, uiNowMs - startedAtMs))}`
            : 'Xử lý --';
        }
        if (typeof startedAtMs === 'number' && typeof endedAtMs === 'number' && endedAtMs >= startedAtMs) {
          return formatElapsedMs(endedAtMs - startedAtMs);
        }
        return '--';
      })();
      const transportLabel = report?.resourceLabel || report?.resourceId || report?.transport || '--';
      const durationLabel = typeof report?.durationMs === 'number'
        ? formatElapsedMs(report.durationMs)
        : timeLabel;
      const timeMetaLabel = (() => {
        if (status === 'waiting') {
          return formatEtaDisplay(nextAllowedAtMs, uiNowMs);
        }
        if (status === 'running') {
          return `Bắt đầu ${formatEpochDisplay(startedAtMs)}`;
        }
        return `${formatEpochDisplay(startedAtMs)} → ${formatEpochDisplay(endedAtMs)}`;
      })();
      const missingLines = Array.isArray(report?.missingGlobalLineIndexes)
        ? report.missingGlobalLineIndexes.length
        : 0;

      rows.push({
        batchIndex,
        status,
        attempts: typeof report?.attempts === 'number' ? Math.max(0, Math.floor(report.attempts)) : 0,
        expectedLines,
        translatedLines,
        lineSummaryLabel,
        missingLines,
        startedAtMs,
        endedAtMs,
        timeLabel: durationLabel,
        timeMetaLabel,
        missingLabel: missingLines > 0 ? formatNumberList(report?.missingGlobalLineIndexes || [], 16) : '--',
        error: report?.error || runtimeEntry?.error,
        transportLabel,
      });
    }

    const waitingBatches = rows.filter((row) => row.status === 'waiting').length;
    const completedBatches = rows.filter((row) => row.status === 'success').length;
    const failedBatches = rows.filter((row) => row.status === 'failed').length;
    const runningBatchIndex = rows.find((row) => row.status === 'running')?.batchIndex ?? null;
    const updatedAtLabel = formatIsoDisplay(safeState?.updatedAt);

    return {
      totalBatches,
      waitingBatches,
      completedBatches,
      failedBatches,
      runningBatchIndex,
      missingBatchIndexes: filteredMissingBatchIndexes,
      updatedAtLabel,
      rows,
    };
  }, [
    fileManager.entries.length,
    sessionPreviewEntries.length,
    sessionEntryCounts,
    sessionStep3BatchState,
    sessionStepStatus,
    sessionStep2BatchPlan,
    sessionStep2BatchPlanCount,
    step3BatchRuntimeMap,
    step3LiveTotalBatches,
    uiNowMs,
  ]);

  const getStepBadge = (step: Step): { label: string; className: string } => {
    const hasIssue = processing.stepDependencyIssues.some((item) => item.step === step);
    if (processing.status === 'running' && processing.currentStep === step) {
      return { label: 'Running', className: `${styles.statusBadge} ${styles.statusRunning}` };
    }
    if (processing.status === 'error' && processing.currentStep === step) {
      return { label: 'Error', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    if (hasIssue) {
      return { label: 'Blocked', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    const persistedStatus = sessionStepStatus[step];
    if (persistedStatus === 'success' && sessionStepSkipped[step]) {
      return { label: 'Skipped', className: `${styles.statusBadge} ${styles.statusSkipped}` };
    }
    if (persistedStatus === 'success') {
      return { label: 'Done', className: `${styles.statusBadge} ${styles.statusDone}` };
    }
    if (persistedStatus === 'running') {
      return { label: 'Running', className: `${styles.statusBadge} ${styles.statusRunning}` };
    }
    if (persistedStatus === 'error') {
      return { label: 'Error', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    if (persistedStatus === 'stopped') {
      return { label: 'Stopped', className: `${styles.statusBadge} ${styles.statusStopped}` };
    }
    if (persistedStatus === 'stale') {
      return { label: 'Stale', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    if (processing.status === 'success' && processing.enabledSteps.has(step)) {
      return { label: 'Done', className: `${styles.statusBadge} ${styles.statusDone}` };
    }
    return { label: processing.enabledSteps.has(step) ? 'Idle' : 'Off', className: `${styles.statusBadge} ${styles.statusIdle}` };
  };

  const getStepToneClass = (label: string): string => {
    if (label === 'Running') return styles.stepToneRunning;
    if (label === 'Done') return styles.stepToneDone;
    if (label === 'Skipped') return styles.stepToneWarning;
    if (label === 'Error' || label === 'Blocked' || label === 'Stale') return styles.stepToneError;
    if (label === 'Stopped') return styles.stepToneWarning;
    if (label === 'Off') return styles.stepToneMuted;
    return styles.stepToneIdle;
  };

  const getStepStatusCompactLabel = (label: string): string => {
    if (label === 'Running') return 'RUN';
    if (label === 'Done') return 'DONE';
    if (label === 'Skipped') return 'SKIP';
    if (label === 'Error') return 'ERR';
    if (label === 'Blocked') return 'LOCK';
    if (label === 'Stale') return 'OLD';
    if (label === 'Stopped') return 'STOP';
    if (label === 'Off') return 'OFF';
    return 'IDLE';
  };

  const STEP_SHORT_LABELS: Record<Step, string> = {
    1: 'Input',
    2: 'Tách',
    3: 'Dịch',
    4: 'TTS',
    5: 'Trim',
    6: 'Ghép',
    7: 'Render',
  };
  const STEP_INSPECTOR_LIST: Step[] = [1, 2, 3, 4, 6, 7];

  const configSummaryRows = useMemo(() => {
    const subtitlePos = settings.subtitlePosition
      ? `${settings.subtitlePosition.x.toFixed(3)}, ${settings.subtitlePosition.y.toFixed(3)}`
      : 'Auto';
    const logoPos = settings.logoPosition
      ? `${settings.logoPosition.x.toFixed(3)}, ${settings.logoPosition.y.toFixed(3)}`
      : 'Off';
    return [
      { key: 'Input', value: settings.inputType === 'draft' ? 'Draft' : 'SRT' },
      { key: 'Dịch', value: settings.translateMethod === 'api'
        ? `${settings.translateMethod?.toUpperCase() || 'API'} / ${settings.geminiModel}`
        : `${(settings.translateMethod || 'api').toUpperCase()}` },
      {
        key: 'TTS',
        value: isCapCutVoiceSelected
          ? `${selectedVoiceLabel} | Rate/Volume: fixed (CapCut)`
          : `${selectedVoiceLabel} | rate ${settings.rate} | vol ${settings.volume}`,
      },
      { key: 'Mode', value: `${settings.renderMode} / ${settings.renderResolution} / ${settings.renderContainer?.toUpperCase() || 'MP4'}` },
      { key: 'Speed', value: `audio ${settings.renderAudioSpeed}x | video ${autoVideoSpeed.toFixed(2)}x (${timingDisplaySource})` },
      {
        key: 'Âm lượng',
        value: `video ${formatPercentDisplay(settings.videoVolume)}% | TTS ${formatPercentDisplay(settings.audioVolume)}%`,
      },
      { key: 'Sub pos', value: subtitlePos },
      { key: 'Logo', value: `${logoPos} | scale ${Math.round((settings.logoScale || 1) * 100)}%` },
      {
        key: 'Thumbnail',
        value:
          `${settings.thumbnailDurationSec ?? 0.5}s @ ${settings.thumbnailFrameTimeSec ?? 0}s | ` +
          `T1 ${
            settings.renderMode === 'hardsub_portrait_9_16'
              ? (settings.portraitTextPrimaryFontName || settings.thumbnailTextPrimaryFontName || settings.thumbnailFontName)
              : (settings.thumbnailTextPrimaryFontName || settings.thumbnailFontName)
          } ${
            settings.renderMode === 'hardsub_portrait_9_16'
              ? (settings.portraitTextPrimaryFontSizeRel ?? settings.thumbnailTextPrimaryFontSizeRel ?? settings.thumbnailFontSizeRel ?? 48)
              : (settings.thumbnailTextPrimaryFontSizeRel ?? settings.thumbnailFontSizeRel ?? 48)
          }r | ` +
          `T2 ${
            settings.renderMode === 'hardsub_portrait_9_16'
              ? (settings.portraitTextSecondaryFontName || settings.thumbnailTextSecondaryFontName || settings.thumbnailFontName)
              : (settings.thumbnailTextSecondaryFontName || settings.thumbnailFontName)
          } ${
            settings.renderMode === 'hardsub_portrait_9_16'
              ? (settings.portraitTextSecondaryFontSizeRel ?? settings.thumbnailTextSecondaryFontSizeRel ?? settings.thumbnailFontSizeRel ?? 48)
              : (settings.thumbnailTextSecondaryFontSizeRel ?? settings.thumbnailFontSizeRel ?? 48)
          }r | ` +
          `C1 ${
            (settings.renderMode === 'hardsub_portrait_9_16'
              ? (settings.portraitTextPrimaryColor || settings.thumbnailTextPrimaryColor || '#FFFF00')
              : (settings.thumbnailTextPrimaryColor || '#FFFF00')).toUpperCase()
          } | C2 ${
            (settings.renderMode === 'hardsub_portrait_9_16'
              ? (settings.portraitTextSecondaryColor || settings.thumbnailTextSecondaryColor || '#FFFF00')
              : (settings.thumbnailTextSecondaryColor || '#FFFF00')).toUpperCase()
          } | ` +
          `line ${Number(settings.thumbnailLineHeightRatio ?? 1.16).toFixed(2)}x`,
      },
      {
        key: 'Preview',
        value: previewSourceLabel === 'session_translated_entries'
          ? 'Session translated'
          : 'Session data',
      },
    ];
  }, [
    settings.inputType,
    settings.translateMethod,
    settings.geminiModel,
    isCapCutVoiceSelected,
    selectedVoiceLabel,
    settings.rate,
    settings.volume,
    settings.renderMode,
    settings.renderResolution,
    settings.renderContainer,
    settings.renderAudioSpeed,
    settings.videoVolume,
    settings.audioVolume,
    settings.subtitlePosition,
    settings.logoPosition,
    settings.logoScale,
    settings.thumbnailDurationSec,
    settings.thumbnailFrameTimeSec,
    settings.thumbnailFontName,
    settings.thumbnailFontSize,
    settings.thumbnailTextPrimaryFontName,
    settings.thumbnailTextPrimaryFontSize,
    settings.thumbnailTextPrimaryColor,
    settings.thumbnailTextSecondaryFontName,
    settings.thumbnailTextSecondaryFontSize,
    settings.thumbnailTextSecondaryColor,
    settings.thumbnailLineHeightRatio,
    autoVideoSpeed,
    timingDisplaySource,
    previewSourceLabel,
  ]);

  const handleSelectLogo = async () => {
    const result = await (window.electronAPI as any).invoke('dialog:openFile', {
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (!result?.canceled && result?.filePaths?.[0]) {
      settings.setLogoPath(result.filePaths[0]);
      settings.setLogoPosition(undefined);
    }
  };

  const handleRemoveLogo = () => {
    settings.setLogoPath(undefined);
    settings.setLogoPosition(undefined);
  };

  const [activeStep, setActiveStep] = useState<Step>(1);
  const [activePreviewTab, setActivePreviewTab] = useState<'subtitle' | 'thumbnail'>('subtitle');
  const [commonConfigTab, setCommonConfigTab] = useState<CommonConfigTab>('render');
  const [inspectorPane, setInspectorPane] = useState<InspectorPane>('step');
  const [isStepInspectorOpen, setIsStepInspectorOpen] = useState(false);
  const [inspectorSelectedStep, setInspectorSelectedStep] = useState<Step>(1);
  const [inspectorViewMode, setInspectorViewMode] = useState<StepInspectionViewMode>('summary');
  const [inspectorSessionData, setInspectorSessionData] = useState<CaptionSessionV1 | null>(null);
  const [inspectorSessionPath, setInspectorSessionPath] = useState('');
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] = useState('');
  const [inspectorCopyNotice, setInspectorCopyNotice] = useState('');
  const [defaultSaveState, setDefaultSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [defaultSaveMessage, setDefaultSaveMessage] = useState('');
  const inspectorCacheRef = useRef<StepInspectionCache | null>(null);
  const inspectorRequestSeqRef = useRef(0);
  const [preferredLandscapeRenderMode, setPreferredLandscapeRenderMode] = useState<'hardsub' | 'black_bg'>(
    settings.renderMode === 'black_bg' ? 'black_bg' : 'hardsub'
  );

  const handleSaveCaptionDefaults = useCallback(async () => {
    if (!projectSettingsSnapshot) {
      setDefaultSaveState('error');
      setDefaultSaveMessage('Không thể lấy snapshot settings.');
      return;
    }
    setDefaultSaveState('saving');
    setDefaultSaveMessage('Đang lưu mặc định...');
    try {
      const sanitizedSnapshot = sanitizeCaptionDefaults(projectSettingsSnapshot);
      const res = await window.electronAPI.captionDefaults.save(sanitizedSnapshot as any);
      if (!res?.success) {
        throw new Error(res?.error || 'Lưu thất bại');
      }
      setDefaultSaveState('success');
      setDefaultSaveMessage('Đã lưu mặc định.');
    } catch (error) {
      setDefaultSaveState('error');
      setDefaultSaveMessage(
        `Lưu thất bại: ${error instanceof Error ? error.message : String(error || 'Unknown error')}`
      );
    }
  }, [projectSettingsSnapshot]);

  useEffect(() => {
    if (settings.renderMode === 'hardsub' || settings.renderMode === 'black_bg') {
      setPreferredLandscapeRenderMode(settings.renderMode);
    }
  }, [settings.renderMode]);

  useEffect(() => {
    setInspectorPane('step');
  }, [activeStep]);

  const activeLayoutSwitch: LayoutSwitchValue = settings.renderMode === 'hardsub_portrait_9_16'
    ? 'portrait'
    : 'landscape';

  const applyLayoutSwitch = useCallback((layout: LayoutSwitchValue) => {
    if (layout === 'portrait') {
      settings.setRenderMode('hardsub_portrait_9_16');
      return;
    }
    settings.setRenderMode(preferredLandscapeRenderMode || 'hardsub');
  }, [preferredLandscapeRenderMode, settings.setRenderMode]);

  const applyLandscapeRenderMode = useCallback((mode: 'hardsub' | 'black_bg') => {
    setPreferredLandscapeRenderMode(mode);
    if (activeLayoutSwitch === 'landscape') {
      settings.setRenderMode(mode);
    }
  }, [activeLayoutSwitch, settings.setRenderMode]);

  const handlePreviewLayoutChange = useCallback((value: LayoutSwitchValue) => {
    applyLayoutSwitch(value);
  }, [applyLayoutSwitch]);

  const STEP_DESCRIPTION: Record<Step, string> = {
    1: 'Chọn nguồn SRT/Draft và nạp dữ liệu caption.',
    2: 'Tách subtitle theo dòng hoặc theo số phần.',
    3: 'Thiết lập phương thức dịch và model.',
    4: 'Thiết lập voice TTS (tham số render/audio ở Common).',
    5: 'Step 5 đã được gộp vào Step 6 (Trim + Merge).',
    6: 'Step 6: Trim audio (tùy chọn) + ghép audio.',
    7: 'Tiện ích Step 7 + thumbnail theo folder.',
  };

  const stepInspectorInputPaths = useMemo(
    () => processingInputPaths,
    [processingInputPaths]
  );
  const stepInspectorActiveInputPath = processing.currentFolder?.path ?? idleFocusedFolderPath ?? stepInspectorInputPaths[0] ?? '';
  const stepInspectorFolderLabel = useMemo(() => {
    const currentFolderName = (processing.currentFolder?.name || '').trim();
    if (currentFolderName) {
      return currentFolderName;
    }
    if (!stepInspectorActiveInputPath) {
      return '--';
    }
    return getPathBaseName(stepInspectorActiveInputPath);
  }, [processing.currentFolder?.name, stepInspectorActiveInputPath]);

  const stepInspectorSessionResolvedPath = useMemo(() => {
    if (!stepInspectorActiveInputPath) {
      return '';
    }
    return getSessionPathForInputPath(settings.inputType, stepInspectorActiveInputPath);
  }, [settings.inputType, stepInspectorActiveInputPath]);

  const readStepInspectorSession = useCallback(async (force = false) => {
    if (!stepInspectorActiveInputPath || !stepInspectorSessionResolvedPath) {
      setInspectorSessionData(null);
      setInspectorSessionPath('');
      setInspectorError('Chưa có nguồn input để đọc caption_session.json.');
      setInspectorLoading(false);
      return;
    }

    const requestId = inspectorRequestSeqRef.current + 1;
    inspectorRequestSeqRef.current = requestId;
    setInspectorLoading(true);
    setInspectorError('');
    setInspectorSessionPath(stepInspectorSessionResolvedPath);

    try {
      const session = await readCaptionSession(stepInspectorSessionResolvedPath, {
        projectId,
        inputType: settings.inputType,
        sourcePath: stepInspectorActiveInputPath,
        folderPath: settings.inputType === 'draft'
          ? stepInspectorActiveInputPath
          : stepInspectorActiveInputPath.replace(/[^/\\]+$/, ''),
      });
      if (requestId !== inspectorRequestSeqRef.current) {
        return;
      }

      const updatedAt = typeof session.updatedAt === 'string' ? session.updatedAt : '';
      const cached = inspectorCacheRef.current;
      const canReuseCached = !force
        && !!cached
        && cached.sessionPath === stepInspectorSessionResolvedPath
        && cached.updatedAt === updatedAt;
      if (canReuseCached && cached) {
        setInspectorSessionData(cached.session);
      } else {
        inspectorCacheRef.current = {
          sessionPath: stepInspectorSessionResolvedPath,
          updatedAt,
          session,
        };
        setInspectorSessionData(session);
      }
    } catch (error) {
      if (requestId !== inspectorRequestSeqRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error || 'Unknown error');
      setInspectorSessionData(null);
      setInspectorError(`Không đọc được session: ${message}`);
    } finally {
      if (requestId === inspectorRequestSeqRef.current) {
        setInspectorLoading(false);
      }
    }
  }, [
    projectId,
    settings.inputType,
    stepInspectorActiveInputPath,
    stepInspectorSessionResolvedPath,
  ]);

  useEffect(() => {
    if (!isStepInspectorOpen) {
      return;
    }
    void readStepInspectorSession(false);
  }, [
    isStepInspectorOpen,
    readStepInspectorSession,
    processing.currentFolder?.path,
    processing.currentStep,
    processing.status,
  ]);

  useEffect(() => {
    if (!isStepInspectorOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsStepInspectorOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isStepInspectorOpen]);

  useEffect(() => {
    if (!inspectorCopyNotice) {
      return;
    }
    const timer = window.setTimeout(() => {
      setInspectorCopyNotice('');
    }, 1800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [inspectorCopyNotice]);

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fallthrough
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }, []);

  const stepInspectionViewModel = useMemo<StepInspectionViewModel | null>(() => {
    if (!inspectorSessionData) {
      return null;
    }
    const step = inspectorSelectedStep;
    const stepKey = `step${step}` as `step${Step}`;
    const stepState = inspectorSessionData.steps[stepKey];
    const stepData = inspectorSessionData.data;
    const runtime = inspectorSessionData.runtime;
    const status = typeof stepState?.status === 'string' ? stepState.status : 'idle';
    const dependsOn = Array.isArray(stepState?.dependsOn) ? (stepState.dependsOn as number[]) : [];
    const metrics = (stepState?.metrics && typeof stepState.metrics === 'object')
      ? stepState.metrics as Record<string, unknown>
      : {};
    const artifactsRaw = (stepData.stepArtifacts && typeof stepData.stepArtifacts === 'object')
      ? (stepData.stepArtifacts as Record<string, unknown>)[stepKey]
      : undefined;
    const stepArtifacts = Array.isArray(artifactsRaw)
      ? (artifactsRaw as Array<Record<string, unknown>>).map((item) => ({
          role: typeof item.role === 'string' ? item.role : 'unknown',
          path: typeof item.path === 'string' ? item.path : '',
          kind: typeof item.kind === 'string' ? item.kind : 'file',
          note: typeof item.note === 'string' ? item.note : undefined,
        }))
      : [];

    const summaryItems: StepInspectionSummaryItem[] = [
      { label: 'Status', value: status, tone: status === 'error' ? 'error' : status === 'stopped' ? 'warning' : 'default' },
      { label: 'Started At', value: formatIsoDisplay(stepState?.startedAt), mono: true },
      { label: 'Ended At', value: formatIsoDisplay(stepState?.endedAt), mono: true },
      { label: 'Duration', value: formatStepDuration(stepState?.startedAt, stepState?.endedAt, stepState?.status, uiNowMs), mono: true },
      { label: 'Error', value: stepState?.error || '--', tone: stepState?.error ? 'error' : 'muted' },
      { label: 'Blocked Reason', value: stepState?.blockedReason || '--', tone: stepState?.blockedReason ? 'warning' : 'muted' },
      { label: 'Depends On', value: dependsOn.length > 0 ? dependsOn.map((item) => `B${item}`).join(', ') : '--' },
      { label: 'Input FP', value: shortenMiddle(stepState?.inputFingerprint || '--'), mono: true },
      { label: 'Output FP', value: shortenMiddle(stepState?.outputFingerprint || '--'), mono: true },
    ];

    const stepItems: StepInspectionSummaryItem[] = [];
    switch (step) {
      case 1: {
        const extracted = Array.isArray(stepData.extractedEntries) ? stepData.extractedEntries : [];
        stepItems.push({ label: 'Extracted Entries', value: `${extracted.length}` });
        break;
      }
      case 2: {
        const plan = Array.isArray(stepData.step2BatchPlan) ? stepData.step2BatchPlan as Array<Record<string, unknown>> : [];
        const first = plan[0];
        const last = plan[plan.length - 1];
        const startIndex = typeof first?.startIndex === 'number' ? first.startIndex : null;
        const endIndex = typeof last?.endIndex === 'number' ? last.endIndex : null;
        stepItems.push({ label: 'Total Batches', value: `${plan.length}` });
        stepItems.push({
          label: 'Range',
          value: startIndex !== null && endIndex !== null ? `${startIndex}-${endIndex}` : '--',
          mono: true,
        });
        break;
      }
      case 3: {
        const batchState = (stepData.step3BatchState && typeof stepData.step3BatchState === 'object')
          ? stepData.step3BatchState as Record<string, unknown>
          : {};
        const missingBatches = Array.isArray(batchState.missingBatchIndexes)
          ? batchState.missingBatchIndexes as number[]
          : [];
        const missingLines = Array.isArray(batchState.missingGlobalLineIndexes)
          ? batchState.missingGlobalLineIndexes as number[]
          : [];
        const failedBatches = typeof batchState.failedBatches === 'number' ? batchState.failedBatches : 0;
        stepItems.push({ label: 'Failed Batches', value: `${failedBatches}`, tone: failedBatches > 0 ? 'error' : 'default' });
        stepItems.push({ label: 'Missing Batches', value: formatNumberList(missingBatches), tone: missingBatches.length > 0 ? 'warning' : 'muted', mono: true });
        stepItems.push({ label: 'Missing Global Lines', value: formatNumberList(missingLines), tone: missingLines.length > 0 ? 'warning' : 'muted', mono: true });
        break;
      }
      case 4: {
        const audioFiles = stepData.ttsAudioFiles || [];
        const failedCount = audioFiles.filter((item: { success?: boolean }) => item?.success === false).length;
        stepItems.push({ label: 'Audio Files', value: `${audioFiles.length}` });
        stepItems.push({ label: 'Failed Files', value: `${failedCount}`, tone: failedCount > 0 ? 'warning' : 'default' });
        break;
      }
      case 6: {
        const mergeResult = (stepData.mergeResult && typeof stepData.mergeResult === 'object')
          ? stepData.mergeResult as Record<string, unknown>
          : {};
        const mergedAudioPath = typeof inspectorSessionData.artifacts.mergedAudioPath === 'string'
          ? inspectorSessionData.artifacts.mergedAudioPath
          : '';
        const mergeOutputPath = typeof mergeResult.outputPath === 'string' ? mergeResult.outputPath : '';
        const trimResults = (stepData.trimResults && typeof stepData.trimResults === 'object')
          ? stepData.trimResults as Record<string, unknown>
          : null;
        const trimAudioEnabled = metrics.trimAudioEnabled === true || !!trimResults;
        stepItems.push({ label: 'Trim Enabled', value: trimAudioEnabled ? 'true' : 'false' });
        if (trimAudioEnabled) {
          const trimOutputDir = typeof trimResults?.trimOutputDir === 'string'
            ? (trimResults.trimOutputDir as string)
            : '';
          const trimFiles = Array.isArray(trimResults?.trimFiles)
            ? trimResults?.trimFiles as string[]
            : [];
          const trimmedEnd = (trimResults?.trimmedEnd && typeof trimResults.trimmedEnd === 'object')
            ? trimResults.trimmedEnd as Record<string, unknown>
            : null;
          const trimmedCount = typeof trimmedEnd?.trimmedCount === 'number'
            ? trimmedEnd.trimmedCount
            : (typeof trimResults?.trimmedCount === 'number' ? trimResults.trimmedCount as number : 0);
          const failedCount = typeof trimmedEnd?.failedCount === 'number'
            ? trimmedEnd.failedCount
            : (Array.isArray(trimResults?.errors) ? trimResults.errors.length : 0);
          stepItems.push({ label: 'Trim Output Dir', value: trimOutputDir || '--', mono: true });
          stepItems.push({ label: 'Trimmed Count', value: `${trimmedCount}` });
          stepItems.push({ label: 'Trim Failed', value: `${failedCount}`, tone: failedCount > 0 ? 'warning' : 'default' });
          stepItems.push({ label: 'Trimmed Files', value: `${trimFiles.length}` });
        }
        stepItems.push({ label: 'Merge Success', value: mergeResult.success === true ? 'true' : mergeResult.success === false ? 'false' : '--' });
        stepItems.push({ label: 'Merged Audio Path', value: mergedAudioPath || mergeOutputPath || '--', mono: true });
        break;
      }
      case 7: {
        const renderResult = (stepData.renderResult && typeof stepData.renderResult === 'object')
          ? stepData.renderResult as Record<string, unknown>
          : {};
        const timingPayload = (stepData.renderTimingPayload && typeof stepData.renderTimingPayload === 'object')
          ? stepData.renderTimingPayload as Record<string, unknown>
          : {};
        const finalVideoPath = typeof inspectorSessionData.artifacts.finalVideoPath === 'string'
          ? inspectorSessionData.artifacts.finalVideoPath
          : '';
        const markerSec = typeof timingPayload.videoMarkerSec === 'number'
          ? timingPayload.videoMarkerSec
          : undefined;
        stepItems.push({ label: 'Render Success', value: renderResult.success === true ? 'true' : renderResult.success === false ? 'false' : '--' });
        stepItems.push({ label: 'Final Video Path', value: finalVideoPath || (typeof renderResult.outputPath === 'string' ? renderResult.outputPath : '--'), mono: true });
        stepItems.push({ label: 'Marker Sec', value: typeof markerSec === 'number' ? markerSec.toFixed(3) : '--', mono: true });
        break;
      }
      default:
        break;
    }

    const stepRelatedData = (() => {
      switch (step) {
        case 1:
          return {
            extractedEntries: stepData.extractedEntries || [],
          };
        case 2:
          return {
            step2BatchPlan: stepData.step2BatchPlan || [],
          };
        case 3:
          return {
            step3BatchState: stepData.step3BatchState || null,
            translatedEntries: stepData.translatedEntries || [],
            translatedSrtContent: stepData.translatedSrtContent || '',
          };
        case 4:
          return {
            ttsAudioFiles: stepData.ttsAudioFiles || [],
          };
        case 6:
          return {
            mergeResult: stepData.mergeResult || null,
            mergedAudioPath: inspectorSessionData.artifacts.mergedAudioPath || null,
            trimResults: stepData.trimResults || null,
          };
        case 7:
          return {
            renderResult: stepData.renderResult || null,
            renderTimingPayload: stepData.renderTimingPayload || null,
            finalVideoPath: inspectorSessionData.artifacts.finalVideoPath || null,
            step7SubtitleSource: stepData.step7SubtitleSource || null,
            step7AudioSource: stepData.step7AudioSource || null,
          };
        default:
          return {};
      }
    })();

    const runtimeReduced = {
      runState: runtime.runState,
      currentStep: runtime.currentStep,
      lastMessage: runtime.lastMessage,
      progress: runtime.progress,
      lastGuardError: runtime.lastGuardError,
      stopRequestAt: runtime.stopRequestAt,
      lastStopCheckpoint: runtime.lastStopCheckpoint,
    };

    const payload = {
      step,
      stepKey,
      folderPath: inspectorSessionData.projectContext?.folderPath || stepInspectorActiveInputPath || '',
      stepState,
      stepData: stepRelatedData,
      stepArtifacts,
      sessionArtifacts: inspectorSessionData.artifacts || {},
      runtime: runtimeReduced,
      updatedAt: inspectorSessionData.updatedAt,
      metrics,
    };

    return {
      step,
      stepKey,
      summaryItems,
      stepItems,
      artifacts: stepArtifacts,
      maskedJsonPayload: maskSensitive(payload) as Record<string, unknown>,
    };
  }, [inspectorSessionData, inspectorSelectedStep, stepInspectorActiveInputPath, uiNowMs]);

  const stepInspectorJsonText = useMemo(() => {
    if (!stepInspectionViewModel) {
      return '';
    }
    return JSON.stringify(stepInspectionViewModel.maskedJsonPayload, null, 2);
  }, [stepInspectionViewModel]);

  const handleCopyStepInspectorJson = useCallback(async () => {
    if (!stepInspectorJsonText) {
      return;
    }
    const copied = await copyToClipboard(stepInspectorJsonText);
    setInspectorCopyNotice(copied ? 'Đã copy JSON step.' : 'Không thể copy JSON step.');
  }, [copyToClipboard, stepInspectorJsonText]);

  const handleCopyStepInspectorPath = useCallback(async () => {
    if (!inspectorSessionPath) {
      return;
    }
    const copied = await copyToClipboard(inspectorSessionPath);
    setInspectorCopyNotice(copied ? 'Đã copy session path.' : 'Không thể copy session path.');
  }, [copyToClipboard, inspectorSessionPath]);

  const openStepInspector = useCallback(() => {
    setInspectorSelectedStep(activeStep);
    setInspectorViewMode('summary');
    setInspectorCopyNotice('');
    setIsStepInspectorOpen(true);
  }, [activeStep]);

  const getStepInspectorToneClass = useCallback((tone?: StepInspectionTone): string => {
    if (tone === 'error') {
      return styles.stepDataValueError;
    }
    if (tone === 'warning') {
      return styles.stepDataValueWarning;
    }
    if (tone === 'muted') {
      return styles.stepDataValueMuted;
    }
    return '';
  }, []);

  const videoVolumeMultiplier = percentToMultiplierDisplayValue(settings.videoVolume, 100);
  const audioVolumeMultiplier = percentToMultiplierDisplayValue(settings.audioVolume, 100);

  const handleVideoVolumeMultiplierChange = useCallback((multiplier: number) => {
    settings.setVideoVolume(
      multiplierToPercentValue(
        multiplier,
        VIDEO_VOLUME_PERCENT_MIN,
        VIDEO_VOLUME_PERCENT_MAX,
        100
      )
    );
  }, [settings.setVideoVolume]);

  const handleAudioVolumeMultiplierChange = useCallback((multiplier: number) => {
    settings.setAudioVolume(
      multiplierToPercentValue(
        multiplier,
        AUDIO_VOLUME_PERCENT_MIN,
        AUDIO_VOLUME_PERCENT_MAX,
        100
      )
    );
  }, [settings.setAudioVolume]);

  const commonConfigBar = (
    <div className={styles.commonConfigBar}>
      <div className={styles.commonConfigTop}>
        <div className={styles.commonConfigTitle}>Common Config</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className={styles.resetBtnLike}
            onClick={handleSaveCaptionDefaults}
            disabled={defaultSaveState === 'saving'}
            title="Lưu cấu hình hiện tại làm mặc định"
          >
            {defaultSaveState === 'saving' ? 'Đang lưu...' : 'Save as default'}
          </button>
          {defaultSaveMessage && (
            <span className={styles.textMuted} style={{ fontSize: '12px' }}>
              {defaultSaveMessage}
            </span>
          )}
        </div>
      </div>

      <div className={styles.commonConfigTabs}>
        <button
          type="button"
          className={`${styles.commonConfigTabBtn} ${commonConfigTab === 'render' ? styles.commonConfigTabBtnActive : ''}`}
          onClick={() => setCommonConfigTab('render')}
        >
          Render
        </button>
        <button
          type="button"
          className={`${styles.commonConfigTabBtn} ${commonConfigTab === 'typography' ? styles.commonConfigTabBtnActive : ''}`}
          onClick={() => setCommonConfigTab('typography')}
        >
          Typography
        </button>
        <button
          type="button"
          className={`${styles.commonConfigTabBtn} ${commonConfigTab === 'audio' ? styles.commonConfigTabBtnActive : ''}`}
          onClick={() => setCommonConfigTab('audio')}
        >
          Audio
        </button>
      </div>

      <div className={styles.commonConfigBody}>
        {commonConfigTab === 'render' && (
          <div className={styles.commonConfigSection}>
            <div className={styles.commonInlineSection}>
              <span className={styles.label}>Landscape mode</span>
              <div className={styles.commonPillRow}>
                <button
                  type="button"
                  className={`${styles.commonPillBtn} ${preferredLandscapeRenderMode === 'hardsub' ? styles.commonPillBtnActive : ''}`}
                  onClick={() => applyLandscapeRenderMode('hardsub')}
                >
                  Hardsub
                </button>
                <button
                  type="button"
                  className={`${styles.commonPillBtn} ${preferredLandscapeRenderMode === 'black_bg' ? styles.commonPillBtnActive : ''}`}
                  onClick={() => applyLandscapeRenderMode('black_bg')}
                >
                  Nền đen
                </button>
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Render resolution</label>
                <select
                  value={settings.renderResolution}
                  onChange={(e) => settings.setRenderResolution(e.target.value as any)}
                  className={styles.select}
                >
                  {settings.renderMode === 'hardsub_portrait_9_16' ? (
                    <>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="540p">540p</option>
                      <option value="360p">360p</option>
                    </>
                  ) : (
                    <>
                      <option value="original">Gốc</option>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="540p">540p</option>
                      <option value="360p">360p</option>
                    </>
                  )}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Container</label>
                <select
                  value={settings.renderContainer || 'mp4'}
                  onChange={(e) => settings.setRenderContainer(e.target.value as 'mp4' | 'mov')}
                  className={styles.select}
                >
                  <option value="mp4">MP4</option>
                  <option value="mov">MOV</option>
                </select>
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Hardware</label>
                <select
                  className={styles.select}
                  value={settings.hardwareAcceleration}
                  onChange={(e) => settings.setHardwareAcceleration(e.target.value as 'none' | 'qsv' | 'nvenc')}
                >
                  <option value="none">CPU</option>
                  <option value="qsv">QSV</option>
                  <option value="nvenc">NVENC</option>
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Mask mode</label>
                <select
                  className={styles.select}
                  value={settings.coverMode || 'blackout_bottom'}
                  onChange={(e) => settings.setCoverMode(e.target.value as 'blackout_bottom' | 'copy_from_above')}
                  disabled={settings.renderMode === 'black_bg'}
                >
                  <option value="blackout_bottom">Che đen đáy</option>
                  <option value="copy_from_above">Copy vùng trên</option>
                </select>
              </div>
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Mức che đáy</span>
                <span className={styles.commonInlineValue}>
                  {Math.round((1 - (settings.blackoutTop ?? 0.9)) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.99}
                step={0.01}
                value={settings.blackoutTop ?? 0.9}
                onChange={(e) => settings.setBlackoutTop(Number(e.target.value))}
                disabled={settings.renderMode === 'black_bg'}
              />
              <div className={styles.commonInlineActions}>
                <button type="button" className={styles.resetBtnLike} onClick={() => settings.setBlackoutTop(null)}>
                  Auto
                </button>
                <button type="button" className={styles.resetBtnLike} onClick={() => settings.setCoverQuad(DEFAULT_COVER_QUAD)}>
                  Reset cover quad
                </button>
              </div>
            </div>

            {settings.coverMode === 'copy_from_above' && (
              <div className={styles.commonInlineSection}>
                <div className={styles.commonInlineHeader}>
                  <span className={styles.label}>Feather viền copy</span>
                  <span className={styles.commonInlineValue}>
                    LR {Math.round(settings.coverFeatherHorizontalPercent ?? 20)}% | TB {Math.round(settings.coverFeatherVerticalPercent ?? 20)}%
                  </span>
                </div>
                <div className={styles.commonInlineActions}>
                  <label className={styles.label}>Trái / Phải</label>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={1}
                    value={settings.coverFeatherHorizontalPercent ?? 20}
                    onChange={(e) => settings.setCoverFeatherHorizontalPercent(Number(e.target.value))}
                    disabled={settings.renderMode === 'black_bg'}
                  />
                  <button type="button" className={styles.resetBtnLike} onClick={() => settings.setCoverFeatherHorizontalPercent(20)}>
                    LR mặc định 20%
                  </button>
                </div>
                <div className={styles.commonInlineActions}>
                  <label className={styles.label}>Trên / Dưới</label>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={1}
                    value={settings.coverFeatherVerticalPercent ?? 20}
                    onChange={(e) => settings.setCoverFeatherVerticalPercent(Number(e.target.value))}
                    disabled={settings.renderMode === 'black_bg'}
                  />
                  <button type="button" className={styles.resetBtnLike} onClick={() => settings.setCoverFeatherVerticalPercent(20)}>
                    TB mặc định 20%
                  </button>
                  <button type="button" className={styles.resetBtnLike} onClick={() => settings.setCoverFeatherPx(20)}>
                    Đồng bộ 20%
                  </button>
                </div>
              </div>
            )}

            {settings.renderMode === 'hardsub_portrait_9_16' && (
              <div className={styles.commonInlineSection}>
                <div className={styles.commonInlineHeader}>
                  <span className={styles.label}>Crop ngang foreground</span>
                  <span className={styles.commonInlineValue}>{Math.round(settings.portraitForegroundCropPercent ?? 0)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={settings.portraitForegroundCropPercent ?? 0}
                  onChange={(e) => settings.setPortraitForegroundCropPercent(Number(e.target.value))}
                />
              </div>
            )}

            <div className={styles.inputGroup}>
              <label className={styles.label}>Thumb duration (s)</label>
              <Input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={settings.thumbnailDurationSec ?? 0.5}
                onChange={(e) => settings.setThumbnailDurationSec(Number(e.target.value))}
              />
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Logo</span>
                <span className={styles.commonInlineValue}>
                  {settings.logoPath ? `${Math.round((settings.logoScale || 1) * 100)}%` : 'Off'}
                </span>
              </div>
              <div className={styles.commonInlineActions}>
                <button type="button" className={styles.resetBtnLike} onClick={handleSelectLogo}>
                  Chọn logo
                </button>
                <button
                  type="button"
                  className={styles.resetBtnLike}
                  onClick={handleRemoveLogo}
                  disabled={!settings.logoPath}
                >
                  Xóa logo
                </button>
                <button
                  type="button"
                  className={styles.resetBtnLike}
                  onClick={() => settings.setLogoPosition(undefined)}
                  disabled={!settings.logoPath}
                >
                  Reset vị trí
                </button>
              </div>
              <div className={styles.commonHint}>
                {settings.logoPath
                  ? `Logo: ${(settings.logoPath.split(/[/\\]/).pop() || settings.logoPath)}`
                  : 'Chưa chọn logo'}
              </div>
            </div>
          </div>
        )}

        {commonConfigTab === 'typography' && (
          <div className={styles.commonConfigSection}>
            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Font subtitle</label>
                <select
                  className={styles.select}
                  value={settings.style?.fontName || 'ZYVNA Fairy'}
                  onChange={(e) => settings.setStyle((s: any) => ({ ...s, fontName: e.target.value }))}
                >
                  {availableFonts.map((font) => (
                    <option key={`sub-${font}`} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Size subtitle (relative)</label>
                <Input
                  type="number"
                  min={SUBTITLE_FONT_SIZE_MIN}
                  max={SUBTITLE_FONT_SIZE_MAX}
                  step={1}
                  value={subtitleFontSizeInput}
                  onChange={(e) => setSubtitleFontSizeInput(e.target.value)}
                  onBlur={commitSubtitleFontSizeInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Màu subtitle</label>
                <input
                  className={styles.colorInput}
                  type="color"
                  value={settings.style?.fontColor || '#FFFF00'}
                  onInput={(e) => applySubtitleFontColor((e.target as HTMLInputElement).value)}
                  onChange={(e) => applySubtitleFontColor(e.target.value)}
                  onBlur={(e) => commitSubtitleFontColor(e.target.value)}
                />
                {renderColorHistory(settings.style?.fontColor || '#FFFF00', commitSubtitleFontColor)}
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Shadow subtitle</label>
                <Input
                  type="number"
                  min={0}
                  max={20}
                  step={1}
                  value={settings.style?.shadow ?? 4}
                  onChange={(e) => settings.setStyle((s: any) => ({ ...s, shadow: Number(e.target.value) }))}
                />
              </div>
            </div>

            {settings.renderMode === 'hardsub_portrait_9_16' ? (
              <>
                <div className={styles.grid2}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Font Text1 Video (Hardsub 9:16)</label>
                    <select
                      className={styles.select}
                      value={settings.portraitTextPrimaryFontName || settings.thumbnailTextPrimaryFontName || settings.thumbnailFontName || 'BrightwallPersonal'}
                      onChange={(e) => settings.setPortraitTextPrimaryFontName(e.target.value)}
                    >
                      {availableFonts.map((font) => (
                        <option key={`t1-video-${font}`} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Size Text1 Video (relative)</label>
                    <Input
                      type="number"
                      min={THUMBNAIL_FONT_SIZE_MIN}
                      max={THUMBNAIL_FONT_SIZE_MAX}
                      step={1}
                      value={portraitTextPrimaryFontSizeInput}
                      onChange={(e) => setPortraitTextPrimaryFontSizeInput(e.target.value)}
                      onBlur={commitPortraitTextPrimaryFontSizeInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                </div>

                <div className={styles.grid2}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Màu Text1 Video</label>
                    <input
                      className={styles.colorInput}
                      type="color"
                      value={settings.portraitTextPrimaryColor || '#FFFF00'}
                      onInput={(e) => applyPortraitTextPrimaryColor((e.target as HTMLInputElement).value)}
                      onChange={(e) => applyPortraitTextPrimaryColor(e.target.value)}
                      onBlur={(e) => commitPortraitTextPrimaryColor(e.target.value)}
                    />
                    {renderColorHistory(settings.portraitTextPrimaryColor || '#FFFF00', commitPortraitTextPrimaryColor)}
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Line height</label>
                    <Input
                      type="number"
                      min={0}
                      max={4}
                      step={0.02}
                      value={Number(settings.thumbnailLineHeightRatio ?? 1.16).toFixed(2)}
                      onChange={(e) => settings.setThumbnailLineHeightRatio(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className={styles.grid2}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Font Text2 Video (Hardsub 9:16)</label>
                    <select
                      className={styles.select}
                      value={settings.portraitTextSecondaryFontName || settings.thumbnailTextSecondaryFontName || settings.thumbnailFontName || 'BrightwallPersonal'}
                      onChange={(e) => settings.setPortraitTextSecondaryFontName(e.target.value)}
                    >
                      {availableFonts.map((font) => (
                        <option key={`t2-video-${font}`} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Size Text2 Video (relative)</label>
                    <Input
                      type="number"
                      min={THUMBNAIL_FONT_SIZE_MIN}
                      max={THUMBNAIL_FONT_SIZE_MAX}
                      step={1}
                      value={portraitTextSecondaryFontSizeInput}
                      onChange={(e) => setPortraitTextSecondaryFontSizeInput(e.target.value)}
                      onBlur={commitPortraitTextSecondaryFontSizeInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                </div>

                <div className={styles.grid2}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Màu Text2 Video</label>
                    <input
                      className={styles.colorInput}
                      type="color"
                      value={settings.portraitTextSecondaryColor || '#FFFF00'}
                      onInput={(e) => applyPortraitTextSecondaryColor((e.target as HTMLInputElement).value)}
                      onChange={(e) => applyPortraitTextSecondaryColor(e.target.value)}
                      onBlur={(e) => commitPortraitTextSecondaryColor(e.target.value)}
                    />
                    {renderColorHistory(settings.portraitTextSecondaryColor || '#FFFF00', commitPortraitTextSecondaryColor)}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={styles.grid2}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Font Text1 Thumbnail</label>
                    <select
                      className={styles.select}
                      value={settings.thumbnailTextPrimaryFontName || settings.thumbnailFontName || 'BrightwallPersonal'}
                      onChange={(e) => settings.setThumbnailTextPrimaryFontName(e.target.value)}
                    >
                      {availableFonts.map((font) => (
                        <option key={`t1-thumb-${font}`} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Size Text1 Thumbnail (relative)</label>
                    <Input
                      type="number"
                      min={THUMBNAIL_FONT_SIZE_MIN}
                      max={THUMBNAIL_FONT_SIZE_MAX}
                      step={1}
                      value={thumbnailTextPrimaryFontSizeInput}
                      onChange={(e) => setThumbnailTextPrimaryFontSizeInput(e.target.value)}
                      onBlur={commitThumbnailTextPrimaryFontSizeInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                </div>

                <div className={styles.grid2}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Màu Text1 Thumbnail</label>
                    <input
                      className={styles.colorInput}
                      type="color"
                      value={settings.thumbnailTextPrimaryColor || '#FFFF00'}
                      onInput={(e) => applyThumbnailTextPrimaryColor((e.target as HTMLInputElement).value)}
                      onChange={(e) => applyThumbnailTextPrimaryColor(e.target.value)}
                      onBlur={(e) => commitThumbnailTextPrimaryColor(e.target.value)}
                    />
                    {renderColorHistory(settings.thumbnailTextPrimaryColor || '#FFFF00', commitThumbnailTextPrimaryColor)}
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Line height</label>
                    <Input
                      type="number"
                      min={0}
                      max={4}
                      step={0.02}
                      value={Number(settings.thumbnailLineHeightRatio ?? 1.16).toFixed(2)}
                      onChange={(e) => settings.setThumbnailLineHeightRatio(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className={styles.grid2}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Font Text2 Thumbnail</label>
                    <select
                      className={styles.select}
                      value={settings.thumbnailTextSecondaryFontName || settings.thumbnailFontName || 'BrightwallPersonal'}
                      onChange={(e) => settings.setThumbnailTextSecondaryFontName(e.target.value)}
                    >
                      {availableFonts.map((font) => (
                        <option key={`t2-thumb-${font}`} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Size Text2 Thumbnail (relative)</label>
                    <Input
                      type="number"
                      min={THUMBNAIL_FONT_SIZE_MIN}
                      max={THUMBNAIL_FONT_SIZE_MAX}
                      step={1}
                      value={thumbnailTextSecondaryFontSizeInput}
                      onChange={(e) => setThumbnailTextSecondaryFontSizeInput(e.target.value)}
                      onBlur={commitThumbnailTextSecondaryFontSizeInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                </div>

                <div className={styles.grid2}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Màu Text2 Thumbnail</label>
                    <input
                      className={styles.colorInput}
                      type="color"
                      value={settings.thumbnailTextSecondaryColor || '#FFFF00'}
                      onInput={(e) => applyThumbnailTextSecondaryColor((e.target as HTMLInputElement).value)}
                      onChange={(e) => applyThumbnailTextSecondaryColor(e.target.value)}
                      onBlur={(e) => commitThumbnailTextSecondaryColor(e.target.value)}
                    />
                    {renderColorHistory(settings.thumbnailTextSecondaryColor || '#FFFF00', commitThumbnailTextSecondaryColor)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {commonConfigTab === 'audio' && (
          <div className={styles.commonConfigSection}>
            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Scale SRT (step4/6/7)</label>
                <Input
                  type="number"
                  value={settings.srtSpeed}
                  onChange={(e) => settings.setSrtSpeed(Number(e.target.value))}
                  min={1}
                  max={2}
                  step={0.1}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Render audio speed</label>
                <Input
                  type="number"
                  value={settings.renderAudioSpeed}
                  onChange={(e) => settings.setRenderAudioSpeed(Number(e.target.value))}
                  min={0.1}
                  max={5}
                  step={0.05}
                />
              </div>
            </div>

            <div style={{ marginTop: '8px' }}>
              <Checkbox
                label="Auto fit audio"
                checked={settings.autoFitAudio}
                onChange={() => settings.setAutoFitAudio(!settings.autoFitAudio)}
              />
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Âm lượng video (x)</span>
                <span className={styles.commonInlineValue}>{formatMultiplierDisplay(videoVolumeMultiplier, 1)}x</span>
              </div>
              <input
                type="range"
                value={videoVolumeMultiplier}
                onChange={(e) => handleVideoVolumeMultiplierChange(Number(e.target.value))}
                min={VIDEO_VOLUME_PERCENT_MIN / 100}
                max={VIDEO_VOLUME_PERCENT_MAX / 100}
                step={VOLUME_MULTIPLIER_STEP}
              />
              <Input
                type="number"
                value={videoVolumeMultiplier}
                onChange={(e) => handleVideoVolumeMultiplierChange(Number(e.target.value))}
                min={VIDEO_VOLUME_PERCENT_MIN / 100}
                max={VIDEO_VOLUME_PERCENT_MAX / 100}
                step={VOLUME_MULTIPLIER_STEP}
              />
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Âm lượng TTS render (x)</span>
                <span className={styles.commonInlineValue}>{formatMultiplierDisplay(audioVolumeMultiplier, 1)}x</span>
              </div>
              <input
                type="range"
                value={audioVolumeMultiplier}
                onChange={(e) => handleAudioVolumeMultiplierChange(Number(e.target.value))}
                min={AUDIO_VOLUME_PERCENT_MIN / 100}
                max={AUDIO_VOLUME_PERCENT_MAX / 100}
                step={VOLUME_MULTIPLIER_STEP}
              />
              <Input
                type="number"
                value={audioVolumeMultiplier}
                onChange={(e) => handleAudioVolumeMultiplierChange(Number(e.target.value))}
                min={AUDIO_VOLUME_PERCENT_MIN / 100}
                max={AUDIO_VOLUME_PERCENT_MAX / 100}
                step={VOLUME_MULTIPLIER_STEP}
              />
            </div>

            <div className={styles.commonHint}>
              Video {formatDuration(originalVideoDuration)} | Sync {formatDuration(videoSubBaseDuration)} | Audio {formatDuration(audioExpectedDuration)} | Marker {formatDuration(videoMarkerSec)}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const step3BatchInspectorPane = (() => {
    if (activeStep !== 3) {
      return (
        <div className={styles.panelSection}>
          <div className={styles.configSummaryTitle}>Step 3 Batch</div>
          <div className={styles.commonHint}>Tab này chỉ áp dụng khi đang chọn Step 3.</div>
        </div>
      );
    }

    if (!step3BatchViewModel) {
      return (
        <div className={styles.panelSection}>
          <div className={styles.configSummaryTitle}>Step 3 Batch</div>
          <div className={styles.commonHint}>Chưa có dữ liệu batch trong session.</div>
        </div>
      );
    }

    if (step3BatchViewModel.totalBatches === 0) {
      return (
        <div className={styles.panelSection}>
          <div className={styles.configSummaryTitle}>Step 3 Batch Monitor</div>
          <div className={styles.commonHint}>Chưa chạy Step 3 hoặc chưa nhận được batch progress.</div>
        </div>
      );
    }

    const progressPercent = step3BatchViewModel.totalBatches > 0
      ? Math.min(100, Math.max(0, (step3BatchViewModel.completedBatches / step3BatchViewModel.totalBatches) * 100))
      : 0;

    return (
      <div className={styles.step3BatchPane}>
        <div className={styles.panelSection}>
          <div className={styles.step3BatchHeaderRow}>
            <div className={styles.configSummaryTitle}>Step 3 Batch Monitor</div>
            <button
              type="button"
              className={styles.step3BatchActionBtn}
              onClick={openStep3ManualBulk}
              disabled={processing.status === 'running'}
              title="Nhập JSON cho nhiều batch"
            >
              Bulk JSON
            </button>
          </div>
          <div className={styles.step3BatchSummaryGrid}>
            <div className={styles.step3BatchStatCard}>
              <span className={styles.step3BatchStatLabel}>Đang chờ</span>
              <span className={styles.step3BatchStatValue}>{step3BatchViewModel.waitingBatches}</span>
            </div>
            <div className={styles.step3BatchStatCard}>
              <span className={styles.step3BatchStatLabel}>Đang xử lý</span>
              <span className={styles.step3BatchStatValue}>{step3BatchViewModel.runningBatchIndex ? `#${step3BatchViewModel.runningBatchIndex}` : '--'}</span>
            </div>
            <div className={styles.step3BatchStatCard}>
              <span className={styles.step3BatchStatLabel}>Thành công</span>
              <span className={styles.step3BatchStatValue}>{step3BatchViewModel.completedBatches}/{step3BatchViewModel.totalBatches}</span>
            </div>
            <div className={styles.step3BatchStatCard}>
              <span className={styles.step3BatchStatLabel}>Lỗi</span>
              <span className={styles.step3BatchStatValue}>{step3BatchViewModel.failedBatches}</span>
            </div>
          </div>
          <div className={styles.step3BatchProgressBar}>
            <div className={styles.step3BatchProgressFill} style={{ width: `${progressPercent.toFixed(1)}%` }} />
          </div>
          <div className={styles.step3BatchMetaRow}>
            <span>Missing batch: {formatNumberList(step3BatchViewModel.missingBatchIndexes, 16)}</span>
            <span className={styles.step3BatchMetaMono}>Updated: {step3BatchViewModel.updatedAtLabel}</span>
          </div>
        </div>

        <div className={styles.panelSection}>
          <div className={styles.step3BatchTableHeader}>
            <span>Batch</span>
            <span>Stat</span>
            <span>Time</span>
            <span>Action</span>
          </div>
          <div className={styles.step3BatchList}>
            {step3BatchViewModel.rows.map((row) => (
              <div key={`s3-batch-${row.batchIndex}`} className={styles.step3BatchRow}>
                <div className={styles.step3BatchColMain}>
                  <span className={styles.step3BatchTitle}>#{row.batchIndex} · {row.lineSummaryLabel}</span>
                </div>
                <div className={styles.step3BatchColStatus}>
                  <span
                    className={`${styles.step3BatchStatusPill} ${
                      row.status === 'success'
                        ? styles.step3BatchStatusSuccess
                        : row.status === 'failed'
                          ? styles.step3BatchStatusFailed
                          : row.status === 'running'
                            ? styles.step3BatchStatusRunning
                            : styles.step3BatchStatusWaiting
                    }`}
                  >
                    {row.status === 'success'
                      ? 'OK'
                      : row.status === 'failed'
                        ? 'ERR'
                        : row.status === 'running'
                          ? 'RUN'
                          : 'WAIT'}
                  </span>
                </div>
                <div className={styles.step3BatchColTime}>
                  <span className={styles.step3BatchTime}>{row.timeLabel}</span>
                  <span className={styles.step3BatchSub}>try {row.attempts || '--'} · {row.transportLabel}</span>
                </div>
                <div className={styles.step3BatchColAction}>
                  <button
                    type="button"
                    className={styles.step3BatchActionBtn}
                    onClick={() => openStep3ManualSingle(row.batchIndex)}
                    disabled={processing.status === 'running'}
                    title={`Nhập JSON cho batch #${row.batchIndex}`}
                  >
                    Nhập tay
                  </button>
                </div>
                {(row.status === 'failed' && (row.missingLines > 0 || row.error)) && (
                  <div className={styles.step3BatchErrorRow}>
                    {row.missingLines > 0 && (
                      <span>Missing: {row.missingLines} ({row.missingLabel})</span>
                    )}
                    {row.error && (
                      <span className={styles.step3BatchMetaMono}>Err: {row.error}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  })();

  const thumbnailConfigBar = (
    <div className={styles.panelSection}>
      <div className={styles.configSummaryTitle}>Thumbnail Config</div>
      <div className={styles.commonHint}>
        Quản lý text/style/frame/vị trí thumbnail tại panel phải. Kéo-thả vẫn thực hiện trên canvas preview bên trái.
      </div>
      <div className={styles.commonConfigSection}>
        <div className={styles.grid2}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Text1</label>
            <textarea
              className={styles.input}
              rows={2}
              value={thumbnailPreviewText}
              onChange={(e) => handleThumbnailPreviewTextChange(e.target.value)}
              placeholder="Tiêu đề video..."
            />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Text2</label>
            <textarea
              className={styles.input}
              rows={2}
              value={thumbnailPreviewSecondaryText}
              onChange={(e) => handleThumbnailPreviewSecondaryTextChange(e.target.value)}
              placeholder="Tên phim..."
            />
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Video Text1</label>
            <textarea
              className={styles.input}
              rows={2}
              value={videoPreviewText}
              onChange={(e) => handleVideoPreviewTextChange(e.target.value)}
              placeholder="Text1 hiển thị trong video..."
            />
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Video Text2</label>
            <textarea
              className={styles.input}
              rows={2}
              value={videoPreviewSecondaryText}
              onChange={(e) => handleVideoPreviewSecondaryTextChange(e.target.value)}
              placeholder="Text2 hiển thị trong video..."
            />
          </div>
        </div>

        <div className={styles.thumbnailAutoFillRow}>
          <button
            type="button"
            className={styles.thumbnailAutoFillBtn}
            onClick={handleSyncVideoText1}
          >
            Đồng bộ Text1 → Video
          </button>
          <button
            type="button"
            className={styles.thumbnailAutoFillBtn}
            onClick={handleSyncVideoText2}
          >
            Đồng bộ Text2 → Video
          </button>
        </div>

        <div className={styles.grid2}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Font Text1</label>
            <select
              className={styles.select}
              value={settings.thumbnailTextPrimaryFontName || settings.thumbnailFontName || 'BrightwallPersonal'}
              onChange={(e) => settings.setThumbnailTextPrimaryFontName(e.target.value)}
            >
              {availableFonts.map((font) => (
                <option key={`thumb-panel-t1-${font}`} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Size Text1 (relative)</label>
            <Input
              type="number"
              min={THUMBNAIL_FONT_SIZE_MIN}
              max={THUMBNAIL_FONT_SIZE_MAX}
              step={1}
              value={settings.thumbnailTextPrimaryFontSizeRel ?? THUMBNAIL_FONT_SIZE_DEFAULT}
              onChange={(e) => settings.setThumbnailTextPrimaryFontSize(Number(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Màu Text1</label>
            <input
              className={styles.colorInput}
              type="color"
              value={settings.thumbnailTextPrimaryColor || '#FFFF00'}
              onInput={(e) => applyThumbnailTextPrimaryColor((e.target as HTMLInputElement).value)}
              onChange={(e) => applyThumbnailTextPrimaryColor(e.target.value)}
              onBlur={(e) => commitThumbnailTextPrimaryColor(e.target.value)}
            />
            {renderColorHistory(settings.thumbnailTextPrimaryColor || '#FFFF00', commitThumbnailTextPrimaryColor)}
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Line height</label>
            <Input
              type="number"
              min={0}
              max={4}
              step={0.02}
              value={Number(settings.thumbnailLineHeightRatio ?? 1.16).toFixed(2)}
              onChange={(e) => settings.setThumbnailLineHeightRatio(Number(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Font Text2</label>
            <select
              className={styles.select}
              value={settings.thumbnailTextSecondaryFontName || settings.thumbnailFontName || 'BrightwallPersonal'}
              onChange={(e) => settings.setThumbnailTextSecondaryFontName(e.target.value)}
            >
              {availableFonts.map((font) => (
                <option key={`thumb-panel-t2-${font}`} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Size Text2 (relative)</label>
            <Input
              type="number"
              min={THUMBNAIL_FONT_SIZE_MIN}
              max={THUMBNAIL_FONT_SIZE_MAX}
              step={1}
              value={settings.thumbnailTextSecondaryFontSizeRel ?? THUMBNAIL_FONT_SIZE_DEFAULT}
              onChange={(e) => settings.setThumbnailTextSecondaryFontSize(Number(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Màu Text2</label>
            <input
              className={styles.colorInput}
              type="color"
              value={settings.thumbnailTextSecondaryColor || '#FFFF00'}
              onInput={(e) => applyThumbnailTextSecondaryColor((e.target as HTMLInputElement).value)}
              onChange={(e) => applyThumbnailTextSecondaryColor(e.target.value)}
              onBlur={(e) => commitThumbnailTextSecondaryColor(e.target.value)}
            />
            {renderColorHistory(settings.thumbnailTextSecondaryColor || '#FFFF00', commitThumbnailTextSecondaryColor)}
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Frame time (s)</label>
            <Input
              type="number"
              min={0}
              max={thumbnailFrameMaxSec}
              step={thumbnailFrameStepSec}
              value={thumbnailFrameValueSec}
              onChange={(e) => setThumbnailFrameSecClamped(Number(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.commonInlineSection}>
          <div className={styles.commonInlineHeader}>
            <span className={styles.label}>Frame thumbnail</span>
            <span className={styles.commonInlineValue}>
              #{thumbnailFrameValueIndex} @ {thumbnailFrameValueSec.toFixed(2)}s ({thumbnailFrameFps.toFixed(2)} fps)
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={thumbnailFrameMaxSec}
            step={thumbnailFrameStepSec}
            value={thumbnailFrameValueSec}
            onChange={(e) => setThumbnailFrameSecClamped(Number(e.target.value))}
            disabled={!thumbnailPreviewVideoPath}
          />
          <div className={styles.commonInlineActions}>
            <button
              type="button"
              className={styles.resetBtnLike}
              onClick={() => stepThumbnailFrame(-1)}
              disabled={!thumbnailPreviewVideoPath}
            >
              -1f
            </button>
            <button
              type="button"
              className={styles.resetBtnLike}
              onClick={() => stepThumbnailFrame(1)}
              disabled={!thumbnailPreviewVideoPath}
            >
              +1f
            </button>
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Text1 Position</label>
            <div className={styles.grid2}>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={settings.thumbnailTextPrimaryPosition.x.toFixed(3)}
                onChange={(e) => setThumbnailPrimaryPositionAxis('x', Number(e.target.value))}
              />
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={settings.thumbnailTextPrimaryPosition.y.toFixed(3)}
                onChange={(e) => setThumbnailPrimaryPositionAxis('y', Number(e.target.value))}
              />
            </div>
            <div className={styles.commonInlineActions}>
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={() => settings.setThumbnailTextPrimaryPosition({ x: 0.5, y: 0.5 })}
              >
                Reset Text1
              </button>
            </div>
          </div>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Text2 Position</label>
            <div className={styles.grid2}>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={settings.thumbnailTextSecondaryPosition.x.toFixed(3)}
                onChange={(e) => setThumbnailSecondaryPositionAxis('x', Number(e.target.value))}
              />
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={settings.thumbnailTextSecondaryPosition.y.toFixed(3)}
                onChange={(e) => setThumbnailSecondaryPositionAxis('y', Number(e.target.value))}
              />
            </div>
            <div className={styles.commonInlineActions}>
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={() => settings.setThumbnailTextSecondaryPosition({ x: 0.5, y: 0.64 })}
              >
                Reset Text2
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const activeStepContent = (() => {
    if (activeStep === 1) {
      return (
        <div className={styles.stepInspectorStack}>
          <div className={styles.stepCard}>
            <div className={styles.stepCardHeader}>
              <div className={styles.stepCardTitle}>Nguồn caption</div>
            </div>
            <div className={styles.fileTypeSelection}>
              <RadioButton
                label="SRT"
                checked={settings.inputType === 'srt'}
                onChange={() => settings.setInputType('srt')}
                name="inputType"
              />
              <RadioButton
                label="Draft"
                description="CapCut"
                checked={settings.inputType === 'draft'}
                onChange={() => settings.setInputType('draft')}
                name="inputType"
              />
            </div>
            <div className={styles.stepCardHint}>
              {settings.inputType === 'draft'
                ? 'Draft cho phép chọn nhiều folder trong cùng một lần duyệt.'
                : 'SRT dùng một file phụ đề làm nguồn.'}
            </div>
          </div>

          <div className={styles.stepCard}>
            <div className={styles.stepCardHeader}>
              <div className={styles.stepCardTitle}>Đường dẫn đầu vào</div>
            </div>
            <div className={styles.stepBrowseRow}>
              {settings.inputType === 'srt' ? (
                <Input
                  value={fileManager.filePath}
                  onChange={(e) => fileManager.setFilePath(e.target.value)}
                  placeholder="Đường dẫn .srt"
                />
              ) : (
                <div
                  className={`${styles.folderBoxContainer} ${!fileManager.filePath ? styles.emptyFolderBox : ''}`}
                  onClick={!fileManager.filePath
                    ? () => {
                        void fileManager.handleBrowseFile();
                      }
                    : undefined}
                >
                  {!fileManager.filePath ? (
                    <span className={styles.placeholderText}>Chưa chọn folder...</span>
                  ) : (
                    filteredDraftInputPaths.length === 0 ? (
                      <span className={styles.placeholderText}>Không có folder nào thỏa điều kiện lọc.</span>
                    ) : (
                      <div className={styles.folderGrid}>
                        {filteredDraftInputPaths.map((path, idx) => {
                          const folderName = path.split(/[/\\]/).pop() || path;
                          const vInfo = fileManager.folderVideos[path];
                          const isActiveFolder = displayPath === path;
                          return (
                            <div
                              key={`${path}-${idx}`}
                              className={`${styles.folderBox} ${isActiveFolder ? styles.folderBoxActive : ''} ${!selectedDraftRunSet.has(path) ? styles.folderBoxDisabled : ''}` }
                              title={path}
                              onClick={() => {
                                if (processing.status === 'running') return;
                                setThumbnailPreviewFolderPath(path);
                              }}
                            >
                              <div className={styles.folderBoxHeader}>
                                <input
                                  type="checkbox"
                                  className={styles.folderSelectCheckbox}
                                  checked={selectedDraftRunSet.has(path)}
                                  disabled={processing.status === 'running'}
                                  onChange={() => {
                                    if (processing.status === 'running') return;
                                    toggleDraftRunPath(path);
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                  title="Chọn folder để chạy pipeline"
                                />
                                <img src={folderIconUrl} alt="folder" className={`${styles.folderIcon} ${styles.folderIconCompact}`} />
                                <span className={styles.folderName}>{folderName}</span>
                              </div>
                              {vInfo && (
                                <div className={styles.folderBoxSubText}>
                                  <img src={videoIconUrl} alt="video" className={styles.folderVideoIcon} />
                                  {vInfo.name}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </div>
              )}
              <Button onClick={fileManager.handleBrowseFile}>Chọn</Button>
              {settings.inputType === 'draft' && fileManager.filePath && (
                <Button
                  variant="secondary"
                  disabled={processing.status === 'running'}
                  onClick={() => fileManager.setFilePath('')}
                  title="Bỏ chọn tất cả folder"
                >
                  Bỏ chọn tất cả
                </Button>
              )}
            </div>
            {settings.inputType === 'draft' && (
              <div className={styles.durationFilterControls}>
                <select
                  value={draftDurationFilterMode}
                  onChange={(e) => setDraftDurationFilterMode(e.target.value as DraftDurationFilterMode)}
                  className={`${styles.select} ${styles.durationFilterModeSelect}`}
                  title="Lọc folder theo thời lượng video"
                  disabled={processing.status === 'running'}
                >
                  <option value="all">Không lọc thời lượng</option>
                  <option value="above">{'Lọc trên (>=)'}</option>
                  <option value="below">{'Lọc dưới (<=)'}</option>
                </select>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={draftDurationFilterMinutes}
                  onChange={(e) => {
                    const nextValue = Number(e.target.value);
                    setDraftDurationFilterMinutes(Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0);
                  }}
                  disabled={draftDurationFilterMode === 'all' || processing.status === 'running'}
                  className={styles.durationFilterMinutesInput}
                  placeholder="Số phút"
                  title="Nhập ngưỡng phút để lọc folder"
                />
                <span className={styles.durationFilterUnit}>phút</span>
              </div>
            )}
            {settings.inputType === 'draft' && (
              <div className={styles.folderSelectActions}>
                <Button
                  variant="secondary"
                  disabled={processing.status === 'running' || filteredDraftInputPaths.length === 0}
                  onClick={handleSelectAllDraftRuns}
                  title="Chọn tất cả folder đang hiển thị"
                >
                  Chọn tất cả
                </Button>
                <Button
                  variant="secondary"
                  disabled={processing.status === 'running' || selectedDraftRunPaths.length === 0}
                  onClick={handleClearDraftRuns}
                  title="Bỏ chọn tất cả folder"
                >
                  Bỏ chọn
                </Button>
              </div>
            )}
            {settings.inputType === 'draft' && (
              <div className={styles.stepCardHint}>
                Có thể chọn nhiều folder cùng lúc bằng Ctrl/Shift trong hộp thoại.
                {draftDurationFilterMode !== 'all'
                  ? ` Đang lọc theo mốc ${draftDurationFilterThresholdMinutes} phút (bao gồm ngưỡng).`
                  : ''}
              </div>
            )}
            <div className={styles.stepMetaPills}>
              {settings.inputType === 'draft' && (
                <span className={styles.stepMetaPill}>Folders tổng: {selectedInputPaths.length}</span>
              )}
              {settings.inputType === 'draft' && (
                <span className={styles.stepMetaPill}>Sau lọc: {filteredDraftInputPaths.length}</span>
              )}
              {settings.inputType === 'draft' && (
                <span className={styles.stepMetaPill}>Đã chọn: {selectedDraftRunPaths.length}</span>
              )}
              {settings.inputType === 'draft' && draftDurationFilterMode !== 'all' && (
                <span className={styles.stepMetaPill}>Thiếu duration: {draftDurationFilterStats.missingDurationCount}</span>
              )}
              {settings.inputType === 'draft' && draftDurationFilterMode !== 'all' && (
                <span className={styles.stepMetaPill}>Không đạt ngưỡng: {draftDurationFilterStats.excludedByThresholdCount}</span>
              )}
              <span className={styles.stepMetaPill}>Dòng đã load: {fileManager.entries.length}</span>
            </div>
          </div>
        </div>
      );
    }

    if (activeStep === 2) {
      return (
        <div className={styles.stepInspectorStack}>
          <div className={styles.stepCard}>
            <div className={styles.stepCardHeader}>
              <div className={styles.stepCardTitle}>Chiến lược tách</div>
              <span className={styles.stepMetaPill}>
                {settings.splitByLines ? `${settings.linesPerFile} dòng / file` : `${settings.numberOfParts} phần`}
              </span>
            </div>
            <div className={styles.splitConfig}>
              <RadioButton
                label="Dòng/file"
                checked={settings.splitByLines}
                onChange={() => settings.setSplitByLines(true)}
                name="splitConfig"
              >
                <select
                  value={settings.linesPerFile}
                  onChange={(e) => settings.setLinesPerFile(Number(e.target.value))}
                  className={`${styles.select} ${styles.selectSmall} ${!settings.splitByLines ? styles.disabled : ''}`}
                  disabled={!settings.splitByLines}
                  onClick={(e) => e.stopPropagation()}
                >
                  {LINES_PER_FILE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </RadioButton>

              <RadioButton
                label="Số phần"
                checked={!settings.splitByLines}
                onChange={() => settings.setSplitByLines(false)}
                name="splitConfig"
              >
                <Input
                  type="number"
                  value={settings.numberOfParts}
                  onChange={(e) => settings.setNumberOfParts(Number(e.target.value))}
                  min={2}
                  max={20}
                  variant="small"
                  disabled={settings.splitByLines}
                  onClick={(e) => e.stopPropagation()}
                  containerClassName={settings.splitByLines ? styles.disabled : ''}
                />
              </RadioButton>
            </div>
            <div className={styles.stepCardHint}>
              Chọn một cách tách để tối ưu batch dịch và xử lý audio.
            </div>
          </div>
        </div>
      );
    }

    if (activeStep === 3) {
      return (
        <div className={styles.stepInspectorStack}>
          <div className={styles.stepCard}>
            <div className={styles.stepCardHeader}>
              <div className={styles.stepCardTitle}>Model dịch</div>
              <Button
                variant="secondary"
                onClick={handleDownloadPromptPreview}
                disabled={fileManager.entries.length === 0}
                title={fileManager.entries.length === 0 ? 'Load SRT trước để xem prompt' : 'Tải prompt preview (batch 1)'}
                className={styles.stepCompactBtn}
              >
                <Download size={13} />
                Prompt
              </Button>
            </div>
            <div className={styles.stepOptionRow}>
              <RadioButton
                label="API"
                checked={settings.translateMethod === 'api'}
                onChange={() => settings.setTranslateMethod('api')}
                name="translateMethod"
              />
              <RadioButton
                label="Impit"
                checked={settings.translateMethod === 'impit'}
                onChange={() => settings.setTranslateMethod('impit')}
                name="translateMethod"
              />
              <RadioButton
                label="GeminiWebApi Queue"
                checked={settings.translateMethod === 'gemini_webapi_queue'}
                onChange={() => settings.setTranslateMethod('gemini_webapi_queue')}
                name="translateMethod"
              />
              <RadioButton
                label="Grok UI"
                checked={settings.translateMethod === 'grok_ui'}
                onChange={() => settings.setTranslateMethod('grok_ui')}
                name="translateMethod"
              />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Gemini model</label>
              <select
                value={settings.geminiModel}
                onChange={(e) => settings.setGeminiModel(e.target.value)}
                className={styles.select}
                disabled={settings.translateMethod !== 'api'}
                style={settings.translateMethod !== 'api' ? { opacity: 0.4 } : undefined}
              >
                {GEMINI_MODELS.map((m: { value: string; label: string }) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.stepCardHint}>
              {settings.translateMethod === 'impit'
                ? 'Impit bỏ qua model API.'
                : settings.translateMethod === 'gemini_webapi_queue'
                  ? 'GeminiWebApi Queue dùng account từ gemini_chat_config và xoay vòng qua queue.'
                  : settings.translateMethod === 'grok_ui'
                    ? 'Grok UI dùng Grok3API qua trình duyệt, không phụ thuộc Gemini model.'
                    : 'API sẽ dùng model đã chọn để dịch batch.'}
            </div>
          </div>
          <div className={styles.stepCard}>
            <div className={styles.stepCardHeader}>
              <div className={styles.stepCardTitle}>Runtime theo kênh dịch</div>
              <span className={styles.stepMetaPill}>
                {isStep3Running ? 'Live' : 'Idle'}
              </span>
            </div>
            <div className={styles.stepRuntimeGrid}>
              <div className={styles.stepRuntimeItem}>
                <span className={styles.stepRuntimeLabel}>API</span>
                <span className={styles.stepRuntimeValue}>
                  {(step3RuntimeTimer.apiLabel || (
                    settings.translateMethod === 'impit'
                      ? 'impit'
                      : settings.translateMethod === 'gemini_webapi_queue'
                        ? 'gemini_webapi_queue'
                        : settings.translateMethod === 'grok_ui'
                          ? 'grok_ui'
                        : 'api'
                  )).toUpperCase()}
                </span>
                <span className={styles.stepRuntimeTimer}>{step3ApiRuntimeLabel}</span>
              </div>
              <div className={styles.stepRuntimeItem}>
                <span className={styles.stepRuntimeLabel}>Token</span>
                <span className={styles.stepRuntimeValue}>
                  {step3RuntimeTimer.tokenLabel || (
                    settings.translateMethod === 'impit'
                      ? 'impit_cookie'
                      : settings.translateMethod === 'gemini_webapi_queue'
                        ? 'queue_rr'
                        : settings.translateMethod === 'grok_ui'
                          ? 'grok_ui'
                        : 'rotation'
                  )}
                </span>
                <span className={styles.stepRuntimeTimer}>{step3TokenRuntimeLabel}</span>
              </div>
            </div>
            <div className={styles.stepCardHint}>
              Runtime lấy từ progress Step 3 hiện tại. Nếu backend chưa gửi token cụ thể, UI dùng giá trị dự phòng.
            </div>
          </div>
        </div>
      );
    }

    if (activeStep === 4) {
      const isStep4PipelineRunning = processing.status === 'running';
      const isStep4VoiceTesting = step4VoiceTestState === 'testing';
      const canRunStep4VoiceTest = !isStep4PipelineRunning && !isStep4VoiceTesting;
      const step4VoiceTestStatusLabel = step4VoiceTestState === 'testing'
        ? 'đang test'
        : step4VoiceTestState === 'success'
          ? 'thành công'
          : step4VoiceTestState === 'error'
            ? 'lỗi'
            : 'idle';
      return (
        <div className={styles.stepInspectorStack}>
          <div className={styles.stepCard}>
            <div className={styles.stepCardHeader}>
              <div className={styles.stepCardTitle}>Giọng đọc</div>
              <span className={styles.stepMetaPill}>{selectedVoiceLabel}</span>
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Voice</label>
              <select value={settings.voice} onChange={(e) => settings.setVoice(e.target.value)} className={styles.select}>
                {edgeVoiceOptions.length > 0 && (
                  <optgroup label="Edge">
                    {edgeVoiceOptions.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {capCutVoiceOptions.length > 0 && (
                  <optgroup label="CapCut">
                    {capCutVoiceOptions.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className={styles.step4VoiceTestBlock}>
              <label className={styles.label}>Text test giọng</label>
              <textarea
                rows={2}
                className={styles.input}
                value={step4VoiceTestText}
                onChange={(e) => setStep4VoiceTestText(e.target.value)}
                placeholder={STEP4_VOICE_TEST_DEFAULT_TEXT}
                disabled={isStep4PipelineRunning}
              />
              <div className={styles.step4VoiceTestActions}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void handleStep4VoiceTest();
                  }}
                  disabled={!canRunStep4VoiceTest}
                  className={styles.stepCompactBtn}
                  title={isStep4PipelineRunning ? 'Đang chạy pipeline, tạm khóa test giọng.' : 'Test giọng hiện tại'}
                >
                  {isStep4VoiceTesting ? 'Đang test...' : 'Test giọng'}
                </Button>
                {isStep4VoiceTestPlaying && (
                  <Button
                    variant="secondary"
                    onClick={stopStep4VoiceTestPlayback}
                    className={styles.stepCompactBtn}
                  >
                    Dừng
                  </Button>
                )}
                <span
                  className={`${styles.step4VoiceTestStatus} ${step4VoiceTestState === 'error' ? styles.step4VoiceTestStatusError : ''}`}
                >
                  {step4VoiceTestMessage
                    ? `${step4VoiceTestStatusLabel}: ${step4VoiceTestMessage}`
                    : `Trạng thái: ${step4VoiceTestStatusLabel}`}
                </span>
              </div>
            </div>
          </div>
          {!isCapCutVoiceSelected && (
            <div className={styles.stepCard}>
              <div className={styles.stepCardHeader}>
                <div className={styles.stepCardTitle}>Edge TTS tuning</div>
              </div>
              <div className={styles.grid2Compact}>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Rate</label>
                  <select value={settings.rate} onChange={(e) => settings.setRate(e.target.value)} className={styles.select}>
                    {RATE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Volume</label>
                  <select value={settings.volume} onChange={(e) => settings.setVolume(e.target.value)} className={styles.select}>
                    {VOLUME_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Batch size (Edge)</label>
                  <Input
                    type="number"
                    min={EDGE_TTS_BATCH_SIZE_MIN}
                    max={EDGE_TTS_BATCH_SIZE_MAX}
                    step={1}
                    value={settings.edgeTtsBatchSize}
                    onChange={(e) => settings.setEdgeTtsBatchSize(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className={styles.stepCardHint}>
                Số caption xử lý mỗi lượt cho Edge TTS. Mặc định 50.
              </div>
            </div>
          )}
          {isCapCutVoiceSelected && (
            <div className={styles.stepInfoCard}>
              Giọng CapCut dùng thông số mặc định từ provider, không áp dụng Rate/Volume của Edge.
            </div>
          )}
          <div className={styles.stepInfoNote}>
            Các tham số đồng bộ render/audio đã chuyển sang Common Config &gt; Audio.
          </div>
        </div>
      );
    }

    if (activeStep === 6) {
      return (
        <div className={styles.stepInspectorStack}>
          <div className={styles.stepCard}>
            <div className={styles.stepCardHeader}>
              <div className={styles.stepCardTitle}>Trim audio (tuỳ chọn)</div>
              <span className={styles.stepMetaPill}>{settings.trimAudioEnabled ? 'ON' : 'OFF'}</span>
            </div>
            <div className={styles.stepOptionRow}>
              <Checkbox
                label="Trim silence trước khi ghép"
                checked={!!settings.trimAudioEnabled}
                onChange={(checked) => settings.setTrimAudioEnabled(checked)}
                disabled={processing.status === 'running'}
              />
            </div>
            <div className={styles.stepCardHint}>
              Khi bật, audio sẽ được trim vào thư mục <span className={styles.stepDataMono}>audio_trimmed/</span> rồi mới ghép.
            </div>
          </div>
          <div className={styles.stepInfoCard}>
            Step 6 dùng cấu hình audio ở các bước trước.
          </div>
          <div className={styles.stepInfoNote}>
            Tốc độ/volume render đang lấy từ Common Config &gt; Audio.
          </div>
        </div>
      );
    }

    return (
      <div className={styles.stepInspectorStack}>
        <HardsubSettingsPanel
          visible={processing.enabledSteps.has(7)}
          renderSummary={{
            renderMode: settings.renderMode,
            renderResolution: settings.renderResolution,
            renderContainer: settings.renderContainer || 'mp4',
            thumbnailDurationSec: settings.thumbnailDurationSec ?? 0.5,
            thumbnailFrameTimeSec: settings.thumbnailFrameTimeSec ?? null,
          }}
          metrics={{
            isMultiFolder,
            isEstimated,
            displayPath,
            videoName: videoInfo?.name,
            baseAudioDuration,
            audioExpectedDuration,
            videoSubBaseDuration,
            videoMarkerSec,
            autoVideoSpeed,
            formatDuration,
          } as HardsubTimingMetrics}
          audioPreview={{
            status: processing.audioPreviewStatus,
            progressText: processing.audioPreviewProgressText,
            dataUri: processing.audioPreviewDataUri,
            meta: processing.audioPreviewMeta
              ? {
                  folderName: processing.audioPreviewMeta.folderName,
                  startSec: processing.audioPreviewMeta.startSec,
                  endSec: processing.audioPreviewMeta.endSec,
                  markerSec: processing.audioPreviewMeta.markerSec,
                  outputPath: processing.audioPreviewMeta.outputPath,
                }
              : null,
            disabled: processing.status === 'running',
            onTest: () => processing.handleStep7AudioPreview(displayPath || undefined),
            onStop: () => {
              void processing.stopStep7AudioPreview();
            },
          }}
          thumbnailListPanel={(
            <ThumbnailListPanel
              visible={
                (settings.renderMode === 'hardsub' || settings.renderMode === 'hardsub_portrait_9_16') &&
                settings.inputType === 'draft' &&
                isMultiFolder
              }
              items={step7ThumbnailPanelData.items}
              videoNameByFolderPath={videoNameByFolderPath}
              autoStartValue={hardsubSettings.thumbnailAutoStartValue}
              onAutoStartValueChange={hardsubSettings.setThumbnailAutoStartValue}
              secondaryGlobalText={hardsubSettings.thumbnailTextSecondary}
              onSecondaryGlobalTextChange={(value) => {
                hardsubSettings.setThumbnailTextSecondaryGlobal(value);
              }}
              onApplySecondaryGlobalText={handleApplySecondaryGlobalText}
              onItemTextChange={handleStep7ItemTextChange}
              onItemSecondaryTextChange={handleStep7ItemSecondaryTextChange}
              onItemVideoTextChange={handleStep7ItemVideoTextChange}
              onItemVideoSecondaryTextChange={handleStep7ItemVideoSecondaryTextChange}
              onSyncVideoText1={handleSyncVideoText1}
              onSyncVideoText2={handleSyncVideoText2}
              onBulkApplyJsonLines={handleBulkApplyJsonLines}
              onManualSaveTexts={handleManualSaveThumbnailTexts}
              onBulkExportThumbnails={handleBulkExportThumbnails}
              manualSaveState={thumbnailManualSaveState}
              manualSaveMessage={thumbnailManualSaveMessage}
              manualSaveDisabled={false}
              bulkExportState={thumbnailBulkExportState}
              bulkExportDisabled={processing.status === 'running'}
              showMissingWarning={hardsubSettings.isThumbnailEnabled && step7VisibleMissingThumbnailText}
              dependencyWarning={step7DependencyWarning}
            />
          )}
        />
        {!processing.enabledSteps.has(7) && (
          <div className={styles.stepInfoCard}>
            Bật Step 7 ở phần Điều khiển để chỉnh render.
          </div>
        )}
      </div>
    );
  })();

  return (
    <>
      <div className={styles.container}>
      <div className={styles.workspace}>
        <aside className={styles.stepRail}>
          <div className={styles.stepRailHeader}>
            <div className={styles.stepRailTitle}>Steps</div>
            <div className={styles.stepRailCurrent}>B{activeStep}</div>
          </div>
          <div className={styles.stepStatusList}>
            {([1, 2, 3, 4, 6, 7] as Step[]).map((step) => {
              const badge = getStepBadge(step);
              const toneClass = getStepToneClass(badge.label);
              const compactStatus = getStepStatusCompactLabel(badge.label);
              const elapsedLabel = getStepElapsedLabel(step);
              const isActive = activeStep === step;
              const isCurrent = processing.currentStep === step && processing.status === 'running';
              return (
                <button
                  key={step}
                  type="button"
                  className={`${styles.stepStatusBtn} ${isActive ? styles.stepStatusBtnActive : ''} ${isCurrent ? styles.stepStatusBtnCurrent : ''}`}
                  onClick={() => {
                    setActiveStep(step);
                    setInspectorPane('step');
                  }}
                  title={`B${step} ${STEP_SHORT_LABELS[step]} - ${badge.label}`}
                >
                  <span className={`${styles.stepStatusDot} ${toneClass}`} />
                  <span className={styles.stepStatusMain}>
                    <span className={styles.stepStatusCode}>B{step}</span>
                    <span className={styles.stepStatusName}>{STEP_SHORT_LABELS[step]}</span>
                    <span className={styles.stepStatusElapsed}>{elapsedLabel}</span>
                  </span>
                  <span className={`${styles.stepStatusState} ${toneClass}`}>{compactStatus}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.stepRailQuick}>
            {canBulkExportThumbnails && (
              <button
                type="button"
                className={`${styles.resetBtnLike} ${styles.stepRailQuickBtn}`}
                onClick={handleBulkExportThumbnails}
                disabled={processing.status === 'running' || isBulkExportRunning}
                title={bulkExportTitle}
              >
                <span className={styles.stepRailQuickBtnLabel}>{bulkExportLabel}</span>
              </button>
            )}
            <button
              type="button"
              className={`${styles.resetBtnLike} ${styles.stepRailQuickBtn} ${isStep7AudioActionActive ? styles.stepRailQuickBtnActive : ''} ${isStep7AudioError ? styles.stepRailQuickBtnError : ''}`}
              onClick={handleQuickStep7AudioToggle}
              disabled={!canQuickStep7Audio}
              title={isStep7AudioError ? (step7AudioButtonError || step7QuickAudioTitle) : step7QuickAudioTitle}
            >
              <span className={styles.stepRailQuickBtnLabel}>{step7QuickAudioLabel}</span>
              {isStep7AudioError && !isStep7AudioMixing && <AlertCircle size={13} className={`${styles.stepRailQuickBtnIcon} ${styles.stepRailQuickBtnIconError}`} />}
            </button>
            <button
              type="button"
              className={`${styles.resetBtnLike} ${styles.stepRailQuickBtn}`}
              onClick={() => {
                setActiveStep(1);
                setInspectorPane('step');
                void fileManager.handleBrowseFile();
              }}
              title={settings.inputType === 'draft' ? 'Chọn lại/ thêm nhiều folder' : 'Chọn file SRT'}
            >
              Nguồn vào
            </button>
          </div>
        </aside>

        <section className={styles.workspaceStage}>
          <div className={styles.stageHeader}>
            <div className={styles.stageTitle}>
              <Eye size={14} />
              Preview
            </div>
            <div className={styles.previewTabGroup}>
              <button
                type="button"
                className={`${styles.resetBtnLike} ${activePreviewTab === 'subtitle' ? styles.previewModeBtnActive : ''}`}
                onClick={() => setActivePreviewTab('subtitle')}
              >
                Subtitle
              </button>
              <button
                type="button"
                className={`${styles.resetBtnLike} ${activePreviewTab === 'thumbnail' ? styles.previewModeBtnActive : ''}`}
                onClick={() => setActivePreviewTab('thumbnail')}
              >
                Thumbnail
              </button>
            </div>
            {activePreviewTab === 'thumbnail' && settings.inputType === 'draft' && isMultiFolder && (
              <div className={styles.thumbnailFolderPicker}>
                <select
                  className={styles.thumbnailFolderSelect}
                  value={thumbnailPreviewFolderPathResolved}
                  onChange={(e) => setThumbnailPreviewFolderPath(e.target.value)}
                  title="Chọn folder để chỉnh text thumbnail trực tiếp trên preview"
                >
                  {processingInputPaths.map((path, index) => (
                    <option key={path} value={path}>
                      {index + 1}. {getPathBaseName(path)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className={styles.stageBody}>
            {activePreviewTab === 'subtitle' ? (
              <div className={styles.previewSurface}>
                <SubtitlePreview
                  videoPath={previewVideoPath}
                  style={settings.style}
                  entries={previewEntries}
                  subtitlePosition={settings.subtitlePosition}
                  blackoutTop={settings.blackoutTop}
                  coverMode={settings.coverMode}
                  coverQuad={settings.coverQuad}
                  coverFeatherPx={settings.coverFeatherPx}
                  coverFeatherHorizontalPx={settings.coverFeatherHorizontalPx}
                  coverFeatherVerticalPx={settings.coverFeatherVerticalPx}
                  coverFeatherHorizontalPercent={settings.coverFeatherHorizontalPercent}
                  coverFeatherVerticalPercent={settings.coverFeatherVerticalPercent}
                  renderMode={settings.renderMode}
                  renderResolution={settings.renderResolution}
                  hardwareAcceleration={settings.hardwareAcceleration}
                  previewLayoutValue={activeLayoutSwitch}
                  onPreviewLayoutChange={handlePreviewLayoutChange}
                  logoPath={settings.logoPath}
                  logoPosition={settings.logoPosition}
                  logoScale={settings.logoScale}
                  portraitForegroundCropPercent={settings.portraitForegroundCropPercent ?? settings.foregroundCropPercent ?? 0}
                  thumbnailText={thumbnailPreviewText}
                  thumbnailTextSecondary={thumbnailPreviewSecondaryText}
                  hardsubPortraitTextPrimary={videoPreviewText}
                  hardsubPortraitTextSecondary={videoPreviewSecondaryText}
                  thumbnailFontName={settings.thumbnailFontName}
                  thumbnailFontSize={settings.thumbnailFontSize}
                  hardsubPortraitTextPrimaryFontName={settings.hardsubPortraitTextPrimaryFontName || settings.portraitTextPrimaryFontName}
                  hardsubPortraitTextPrimaryFontSize={settings.hardsubPortraitTextPrimaryFontSize ?? settings.portraitTextPrimaryFontSize}
                  hardsubPortraitTextPrimaryColor={settings.hardsubPortraitTextPrimaryColor || settings.portraitTextPrimaryColor}
                  hardsubPortraitTextSecondaryFontName={settings.hardsubPortraitTextSecondaryFontName || settings.portraitTextSecondaryFontName}
                  hardsubPortraitTextSecondaryFontSize={settings.hardsubPortraitTextSecondaryFontSize ?? settings.portraitTextSecondaryFontSize}
                  hardsubPortraitTextSecondaryColor={settings.hardsubPortraitTextSecondaryColor || settings.portraitTextSecondaryColor}
                  portraitTextPrimaryFontName={settings.portraitTextPrimaryFontName}
                  portraitTextPrimaryFontSize={settings.portraitTextPrimaryFontSize}
                  portraitTextPrimaryColor={settings.portraitTextPrimaryColor}
                  portraitTextSecondaryFontName={settings.portraitTextSecondaryFontName}
                  portraitTextSecondaryFontSize={settings.portraitTextSecondaryFontSize}
                  portraitTextSecondaryColor={settings.portraitTextSecondaryColor}
                  thumbnailLineHeightRatio={settings.thumbnailLineHeightRatio}
                  hardsubPortraitTextPrimaryPosition={settings.hardsubPortraitTextPrimaryPosition || settings.portraitTextPrimaryPosition}
                  hardsubPortraitTextSecondaryPosition={settings.hardsubPortraitTextSecondaryPosition || settings.portraitTextSecondaryPosition}
                  portraitTextPrimaryPosition={settings.portraitTextPrimaryPosition}
                  portraitTextSecondaryPosition={settings.portraitTextSecondaryPosition}
                  onPositionChange={settings.setSubtitlePosition}
                  onBlackoutChange={settings.setBlackoutTop}
                  onCoverModeChange={settings.setCoverMode}
                  onCoverQuadChange={settings.setCoverQuad}
                  onRenderResolutionChange={settings.setRenderResolution}
                  onLogoPositionChange={(pos) => settings.setLogoPosition(pos || undefined)}
                  onLogoScaleChange={(scale) => settings.setLogoScale(scale)}
                  onPortraitTextPrimaryPositionChange={settings.setPortraitTextPrimaryPosition}
                  onPortraitTextSecondaryPositionChange={settings.setPortraitTextSecondaryPosition}
                  renderSnapshotMode={effectivePreviewMode === 'render'}
                  onSelectLogo={handleSelectLogo}
                  onRemoveLogo={handleRemoveLogo}
                  hydrationSeq={settings.hydrationSeq}
                  interactiveDisabledReason={
                    effectivePreviewMode === 'render'
                      ? 'Đang xem snapshot render 100% từ caption_session.json. Chuyển Live để chỉnh layer.'
                      : undefined
                  }
                  realPreviewDisabledReason={
                    processing.status === 'running'
                      ? 'Pipeline đang chạy. Tạm khóa preview thật để tránh tranh chấp FFmpeg.'
                      : undefined
                  }
                />
              </div>
            ) : (
              <div className={styles.previewSurface}>
                <ThumbnailPreviewPanel
                  videoPath={thumbnailPreviewVideoPath}
                  sourceLabel={thumbnailPreviewSourceLabel}
                  renderMode={settings.renderMode}
                  renderResolution={settings.renderResolution}
                  thumbnailText={thumbnailPreviewText}
                  thumbnailTextSecondary={thumbnailPreviewSecondaryText}
                  thumbnailTextHelper={undefined}
                  thumbnailFrameTimeSec={settings.thumbnailFrameTimeSec}
                  onThumbnailFrameTimeSecChange={settings.setThumbnailFrameTimeSec}
                  thumbnailFontName={settings.thumbnailFontName}
                  thumbnailFontSize={settings.thumbnailFontSize}
                  thumbnailTextPrimaryFontName={settings.thumbnailTextPrimaryFontName}
                  thumbnailTextPrimaryFontSize={settings.thumbnailTextPrimaryFontSize}
                  thumbnailTextPrimaryColor={settings.thumbnailTextPrimaryColor}
                  thumbnailTextSecondaryFontName={settings.thumbnailTextSecondaryFontName}
                  thumbnailTextSecondaryFontSize={settings.thumbnailTextSecondaryFontSize}
                  thumbnailTextSecondaryColor={settings.thumbnailTextSecondaryColor}
                  thumbnailLineHeightRatio={settings.thumbnailLineHeightRatio}
                  thumbnailTextPrimaryPosition={settings.thumbnailTextPrimaryPosition}
                  thumbnailTextSecondaryPosition={settings.thumbnailTextSecondaryPosition}
                  onThumbnailTextPrimaryPositionChange={settings.setThumbnailTextPrimaryPosition}
                  onThumbnailTextSecondaryPositionChange={settings.setThumbnailTextSecondaryPosition}
                  contextKey={thumbnailPreviewContextKey}
                  inputType={settings.inputType}
                />
              </div>
            )}
          </div>
        </section>
        <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            <div className={styles.inspectorHeaderTop}>
              <div>
                <div className={styles.inspectorTitle}>B{activeStep} {STEP_SHORT_LABELS[activeStep]}</div>
                <div className={styles.inspectorHint}>{STEP_DESCRIPTION[activeStep]}</div>
              </div>
              <button
                type="button"
                className={`${styles.resetBtnLike} ${styles.inspectorStepDataBtn}`}
                onClick={openStepInspector}
                disabled={!fileManager.filePath}
                title="Mở drawer kiểm tra dữ liệu step từ caption_session.json"
              >
                Kiểm tra Step Data
              </button>
            </div>
          </div>
          <div className={styles.inspectorTabs}>
            <button
              type="button"
              className={`${styles.inspectorTabBtn} ${inspectorPane === 'step' ? styles.inspectorTabBtnActive : ''}`}
              onClick={() => setInspectorPane('step')}
            >
              Step
            </button>
            <button
              type="button"
              className={`${styles.inspectorTabBtn} ${inspectorPane === 'common' ? styles.inspectorTabBtnActive : ''}`}
              onClick={() => setInspectorPane('common')}
            >
              Common
            </button>
            <button
              type="button"
              className={`${styles.inspectorTabBtn} ${inspectorPane === 'snapshot' ? styles.inspectorTabBtnActive : ''}`}
              onClick={() => setInspectorPane('snapshot')}
            >
              Snapshot
            </button>
            {activeStep === 3 && (
              <button
                type="button"
                className={`${styles.inspectorTabBtn} ${inspectorPane === 'batch3' ? styles.inspectorTabBtnActive : ''}`}
                onClick={() => setInspectorPane('batch3')}
              >
                Batch
              </button>
            )}
            <button
              type="button"
              className={`${styles.inspectorTabBtn} ${inspectorPane === 'thumbnail' ? styles.inspectorTabBtnActive : ''}`}
              onClick={() => setInspectorPane('thumbnail')}
            >
              Thumbnail
            </button>
          </div>
          <div className={styles.inspectorBody}>
            {inspectorPane === 'step' && activeStepContent}
            {inspectorPane === 'common' && commonConfigBar}
            {inspectorPane === 'snapshot' && (
              <div className={styles.panelSection}>
                <div className={styles.configSummaryTitle}>Session Snapshot</div>
                <div className={styles.configSummaryGrid}>
                  {configSummaryRows.map((row) => (
                    <div key={row.key} className={styles.configSummaryRow}>
                      <span className={styles.configSummaryKey}>{row.key}</span>
                      <span className={styles.configSummaryValue}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {inspectorPane === 'batch3' && step3BatchInspectorPane}
            {inspectorPane === 'thumbnail' && thumbnailConfigBar}
            <div className={styles.commonHint} style={{ marginTop: 8 }} title={fileManager.filePath || undefined}>
              {inspectorPane === 'step'
                ? (settings.inputType === 'draft'
                  ? `Input: Draft ${processingInputPaths.length} folder | ${fileManager.entries.length} dòng`
                  : `Input: SRT | ${fileManager.entries.length} dòng`)
                : inspectorPane === 'common'
                  ? 'Common: Render / Typography / Audio dùng lại nhiều step. Voice giữ ở B4.'
                  : inspectorPane === 'batch3'
                    ? (activeStep === 3
                      ? 'Theo dõi realtime batch đang dịch ở Step 3 (Live + Session).'
                      : 'Tab Batch chỉ dùng cho Step 3.')
                  : inspectorPane === 'thumbnail'
                    ? (thumbnailPreviewSourceLabel || 'Thumbnail config')
                    : `Snapshot: trạng thái ${processing.status}, rà nhanh trước khi chạy.`}
            </div>
          </div>
        </aside>
      </div>

      {isStepInspectorOpen && (
        <>
          <button
            type="button"
            className={styles.stepDataDrawerBackdrop}
            onClick={() => setIsStepInspectorOpen(false)}
            aria-label="Đóng Step Data Inspector"
          />
          <aside className={styles.stepDataDrawer}>
            <div className={styles.stepDataDrawerHeader}>
              <div className={styles.stepDataDrawerTitle}>Step Data Inspector</div>
              <div className={styles.stepDataDrawerHint} title={stepInspectorActiveInputPath || undefined}>
                Folder hiện tại: <span className={styles.stepDataMono}>{stepInspectorFolderLabel}</span>
              </div>
              <div className={styles.stepDataDrawerHint} title={inspectorSessionPath || undefined}>
                Session: <span className={styles.stepDataMono}>{shortenMiddle(inspectorSessionPath || '--', 96)}</span>
              </div>
            </div>

            <div className={styles.stepDataDrawerActions}>
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={() => {
                  void readStepInspectorSession(true);
                }}
              >
                Làm mới
              </button>
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={() => setIsStepInspectorOpen(false)}
              >
                Đóng
              </button>
            </div>

            <div className={styles.stepDataStepSwitcher}>
              {STEP_INSPECTOR_LIST.map((step) => (
                <button
                  key={`inspect-step-${step}`}
                  type="button"
                  className={`${styles.stepDataStepChip} ${inspectorSelectedStep === step ? styles.stepDataStepChipActive : ''}`}
                  onClick={() => setInspectorSelectedStep(step)}
                >
                  B{step}
                </button>
              ))}
            </div>

            <div className={styles.stepDataModeSwitch}>
              <button
                type="button"
                className={`${styles.stepDataModeBtn} ${inspectorViewMode === 'summary' ? styles.stepDataModeBtnActive : ''}`}
                onClick={() => setInspectorViewMode('summary')}
              >
                Summary
              </button>
              <button
                type="button"
                className={`${styles.stepDataModeBtn} ${inspectorViewMode === 'json' ? styles.stepDataModeBtnActive : ''}`}
                onClick={() => setInspectorViewMode('json')}
              >
                Xem JSON
              </button>
            </div>

            <div className={styles.stepDataDrawerBody}>
              {inspectorLoading && !stepInspectionViewModel && (
                <div className={styles.stepDataState}>Đang đọc caption_session.json...</div>
              )}
              {!inspectorLoading && inspectorError && (
                <div className={`${styles.stepDataState} ${styles.stepDataStateError}`}>{inspectorError}</div>
              )}
              {!inspectorLoading && !inspectorError && !stepInspectionViewModel && (
                <div className={styles.stepDataState}>Chưa có dữ liệu step để hiển thị.</div>
              )}

              {!inspectorError && stepInspectionViewModel && inspectorViewMode === 'summary' && (
                <div className={styles.stepDataSummaryGrid}>
                  <section className={styles.stepDataSection}>
                    <div className={styles.stepDataSectionTitle}>Summary</div>
                    {stepInspectionViewModel.summaryItems.map((item) => (
                      <div key={`summary-${item.label}`} className={styles.stepDataSummaryRow}>
                        <span className={styles.stepDataSummaryLabel}>{item.label}</span>
                        <span
                          className={[
                            styles.stepDataSummaryValue,
                            item.mono ? styles.stepDataMono : '',
                            getStepInspectorToneClass(item.tone),
                          ].join(' ').trim()}
                          title={item.value}
                        >
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </section>

                  <section className={styles.stepDataSection}>
                    <div className={styles.stepDataSectionTitle}>
                      B{stepInspectionViewModel.step} {STEP_SHORT_LABELS[stepInspectionViewModel.step]}
                    </div>
                    {stepInspectionViewModel.stepItems.length === 0 ? (
                      <div className={styles.stepDataEmptyText}>Chưa có dữ liệu output cho step này.</div>
                    ) : (
                      stepInspectionViewModel.stepItems.map((item) => (
                        <div key={`step-item-${item.label}`} className={styles.stepDataSummaryRow}>
                          <span className={styles.stepDataSummaryLabel}>{item.label}</span>
                          <span
                            className={[
                              styles.stepDataSummaryValue,
                              item.mono ? styles.stepDataMono : '',
                              getStepInspectorToneClass(item.tone),
                            ].join(' ').trim()}
                            title={item.value}
                          >
                            {item.value}
                          </span>
                        </div>
                      ))
                    )}
                  </section>

                  <section className={styles.stepDataSection}>
                    <div className={styles.stepDataSectionTitle}>Artifacts</div>
                    {stepInspectionViewModel.artifacts.length === 0 ? (
                      <div className={styles.stepDataEmptyText}>Không có artifact cho step này.</div>
                    ) : (
                      <div className={styles.stepDataArtifactList}>
                        {stepInspectionViewModel.artifacts.map((artifact, index) => (
                          <div key={`artifact-${artifact.role}-${index}`} className={styles.stepDataArtifactItem}>
                            <div className={styles.stepDataArtifactMeta}>
                              <span>{artifact.role}</span>
                              <span className={styles.stepDataMono}>{artifact.kind}</span>
                            </div>
                            <div className={`${styles.stepDataArtifactPath} ${styles.stepDataMono}`} title={artifact.path}>
                              {artifact.path || '--'}
                            </div>
                            {artifact.note && (
                              <div className={styles.stepDataArtifactNote}>{artifact.note}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}

              {!inspectorError && stepInspectionViewModel && inspectorViewMode === 'json' && (
                <div className={styles.stepDataJsonWrap}>
                  <pre className={styles.stepDataJsonBlock}>{stepInspectorJsonText}</pre>
                </div>
              )}
            </div>

            <div className={styles.stepDataDrawerFooter}>
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={() => {
                  void handleCopyStepInspectorJson();
                }}
                disabled={!stepInspectionViewModel}
              >
                Copy JSON step
              </button>
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={() => {
                  void handleCopyStepInspectorPath();
                }}
                disabled={!inspectorSessionPath}
              >
                Copy session path
              </button>
              <span className={styles.stepDataCopyNotice}>{inspectorCopyNotice || ' '}</span>
            </div>
          </aside>
        </>
      )}

      <div className={styles.runBar}>
        <div className={styles.runBarHeader}>
          <div className={styles.runBarTitle}>Chạy & Tiến độ</div>
          <span className={`${styles.statusBadge} ${styles.statusIdle}`}>{processing.status}</span>
        </div>

        <div className={styles.runBarControls}>
          <div className={styles.stepCheckboxes}>
            {([1, 2, 3, 4, 6, 7] as Step[]).map((step) => (
              <Checkbox
                key={step}
                label={`B${step} ${STEP_SHORT_LABELS[step]}`}
                checked={processing.enabledSteps.has(step)}
                onChange={() => processing.toggleStep(step)}
                highlight={processing.currentStep === step}
              />
            ))}
          </div>

          {isMultiFolder && (
            <div className={styles.runBarModeSwitch}>
              <button
                className={styles.resetBtnLike}
                style={{
                  flex: 1,
                  background: settings.processingMode !== 'step-first' ? 'var(--color-accent, #4a9eff)' : 'transparent',
                  color: settings.processingMode !== 'step-first' ? '#fff' : 'var(--color-text-muted)',
                  borderColor: settings.processingMode !== 'step-first' ? 'var(--color-accent, #4a9eff)' : 'var(--color-border)',
                  cursor: processing.status === 'running' ? 'not-allowed' : 'pointer',
                  opacity: processing.status === 'running' ? 0.5 : 1,
                }}
                disabled={processing.status === 'running'}
                onClick={() => settings.setProcessingMode('folder-first')}
                title="Xong từng folder"
              >
                Folder-first
              </button>
              <button
                className={styles.resetBtnLike}
                style={{
                  flex: 1,
                  background: settings.processingMode === 'step-first' ? 'var(--color-accent, #4a9eff)' : 'transparent',
                  color: settings.processingMode === 'step-first' ? '#fff' : 'var(--color-text-muted)',
                  borderColor: settings.processingMode === 'step-first' ? 'var(--color-accent, #4a9eff)' : 'var(--color-border)',
                  cursor: processing.status === 'running' ? 'not-allowed' : 'pointer',
                  opacity: processing.status === 'running' ? 0.5 : 1,
                }}
                disabled={processing.status === 'running'}
                onClick={() => settings.setProcessingMode('step-first')}
                title="Xong từng step"
              >
                Step-first
              </button>
            </div>
          )}

          <div className={styles.buttonsRow}>
            <Button
              onClick={processing.handleStart}
              disabled={processing.status === 'running'}
              variant="success"
              fullWidth
            >
              ▶ Chạy
            </Button>
            <Button
              onClick={processing.handleStop}
              disabled={processing.status !== 'running'}
              variant="danger"
              fullWidth
            >
              ⏹ Dừng
            </Button>
          </div>
        </div>

        {processing.stepDependencyIssues.length > 0 && (
          <div className={styles.stepGuardBox}>
            <div className={styles.stepGuardTitle}>Step bị chặn:</div>
            {processing.stepDependencyIssues.slice(0, 2).map((issue, idx) => (
              <div
                key={`${issue.folderPath}-${issue.step}-${idx}`}
                className={styles.stepGuardItem}
                title={`[${issue.folderName}] Step ${issue.step}: ${issue.reason}`}
              >
                [{issue.folderName}] Step {issue.step}: {issue.reason}
              </div>
            ))}
          </div>
        )}

        <div className={styles.progressSection}>
          {processing.currentFolder && processing.currentFolder.total > 1 && (
            <div className={styles.progressHeader} style={{ marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-accent, #4a9eff)' }}>
                Project {processing.currentFolder.index}/{processing.currentFolder.total}: {processing.currentFolder.name}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                {processing.currentFolder.index}/{processing.currentFolder.total}
              </span>
            </div>
          )}
          {processing.enabledSteps.has(7) && originalVideoDuration > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <span>{videoInfo?.name ?? 'Video'}</span>
              <span>{formatDuration(originalVideoDuration)}</span>
              <span>Sync: {formatDuration(videoSubBaseDuration)}</span>
              <span>Audio: {formatDuration(audioExpectedDuration)}</span>
              <span>Marker: {formatDuration(videoMarkerSec)}</span>
              <span style={{ color: autoVideoSpeed < 0.8 || autoVideoSpeed > 1.2 ? 'var(--color-warning, #f59e0b)' : 'inherit' }}>
                Speed: {autoVideoSpeed.toFixed(2)}x
              </span>
            </div>
          )}
          {step7RenderUiLog && (
            <div className={styles.textMuted} style={{ fontSize: '11px', marginBottom: '4px' }}>
              {step7RenderUiLog}
            </div>
          )}
          <div className={styles.progressHeader}>
            <span className={styles.textMuted}>{processing.progress.message}</span>
            {processing.progress.total > 0 && (
              <span className={styles.textMuted}>
                {processing.progress.current}/{processing.progress.total}
              </span>
            )}
          </div>
          {processing.currentFolder && processing.currentFolder.total > 1 && (
            <div className={styles.progressBar} style={{ marginBottom: '4px' }}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${((processing.currentFolder.index - 1) / processing.currentFolder.total) * 100}%`,
                  backgroundColor: 'var(--color-accent, #4a9eff)',
                  opacity: 0.5,
                }}
              />
            </div>
          )}
          {processing.progress.total > 0 && (
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${(processing.progress.current / processing.progress.total) * 100}%`,
                  backgroundColor: getProgressColor(),
                }}
              />
            </div>
          )}
        </div>
      </div>
      </div>

      {step3BulkMultiModalOpen && (
        <Step3BulkMultiFolderModal
          visible={step3BulkMultiModalOpen}
          folders={processingInputPaths}
          files={step3BulkMultiFiles}
          busy={step3BulkMultiBusy}
          error={step3BulkMultiError}
          message={step3BulkMultiMessage}
          autoPickOnOpen={step3BulkMultiFiles.length === 0}
          onClose={closeStep3BulkMultiModal}
          onPickFiles={handleStep3BulkMultiPickFiles}
          onClearFiles={handleStep3BulkMultiClearFiles}
          onMoveFile={handleStep3BulkMultiMoveFile}
          onApply={handleApplyStep3BulkMultiFolder}
        />
      )}

      {step3ManualModal && (
      <div
        className={styles.modalBackdrop}
        onClick={() => {
          closeStep3ManualModal();
        }}
      >
        <div
          className={styles.modalCard}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <div className={styles.modalHeader}>
            <div className={styles.modalTitle}>
              {step3ManualModal.mode === 'single'
                ? `Nhập JSON batch #${step3ManualModal.batchIndex ?? ''}`
                : 'Bulk JSON cho nhiều batch'}
            </div>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={closeStep3ManualModal}
              disabled={step3ManualBusy}
            >
              ✕
            </button>
          </div>
          <div className={styles.modalBody}>
            <textarea
              className={styles.input}
              rows={10}
              placeholder={step3ManualModal.mode === 'single'
                ? 'Dán JSON response (JSON-only) giống như AI trả về (không cần original)...'
                : 'Dán JSON array hoặc NDJSON: {\"batchIndex\":2,\"response\":{...}}'}
              value={step3ManualInput}
              onChange={(e) => setStep3ManualInput(e.target.value)}
              disabled={step3ManualBusy}
            />
            {step3ManualError && (
              <div className={styles.modalError}>{step3ManualError}</div>
            )}
            <div className={styles.modalHint}>
              {step3ManualModal.mode === 'single'
                ? 'Input phải là JSON response đúng schema Step 3. original là tùy chọn.'
                : 'Mỗi item: {batchIndex, response}. response có thể là JSON object hoặc string.'}
            </div>
          </div>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.modalSecondaryBtn}
              onClick={closeStep3ManualModal}
              disabled={step3ManualBusy}
            >
              Hủy
            </button>
            <button
              type="button"
              className={styles.modalPrimaryBtn}
              onClick={handleSubmitStep3Manual}
              disabled={step3ManualBusy}
            >
              {step3ManualBusy ? 'Đang áp dụng...' : 'Áp dụng'}
            </button>
          </div>
        </div>
      </div>
      )}
    </>
  );
}
