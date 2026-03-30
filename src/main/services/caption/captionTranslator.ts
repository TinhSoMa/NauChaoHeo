/**
 * Caption Translator - Dịch caption sử dụng Gemini API
 * Xử lý dịch batch theo pacing queue và progress callback
 */

import {
  SubtitleEntry,
  TranslationOptions,
  TranslationResult,
  TranslationProgress,
  TranslationBatchReport,
  TranslationQueuePacingMetadata,
  CAPTION_PROCESS_STOP_SIGNAL,
} from '../../../shared/types/caption';
import { callGeminiWithRotation, callGeminiWithAssignedKey, GEMINI_MODELS, type GeminiModel } from '../gemini';
import { AppSettingsService } from '../appSettings';
import { type KeyInfo } from '../../../shared/types/gemini';
import { getApiManager } from '../gemini/apiManager';
import { callGeminiImpitAutoSelect } from '../shared';
import { getGrokUiRuntime } from '../grokUi';
import { getGeminiWebApiRuntime } from '../geminiWebApi';
import { RotationJobExecutionError } from '../shared/universalRotationQueue';
import {
  CAPTION_GEMINI_WEB_QUEUE_FEATURE,
  CAPTION_GEMINI_WEB_QUEUE_POOL_ID,
  CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
  CAPTION_GEMINI_WEB_QUEUE_SERVICE_ID,
  type CaptionGeminiWebQueueRuntimeContext,
  getCaptionStep3QueueGapMs,
  ensureCaptionGeminiWebQueueRuntime,
} from './captionGeminiWebQueueRuntime';
import {
  buildConversationKey as buildCaptionConversationKey,
  clearConversation as clearCaptionGeminiConversation,
  getConversation as getCaptionGeminiConversation,
  upsertConversation as upsertCaptionGeminiConversation,
} from './captionGeminiConversationStore';
import {
  splitForTranslation,
  mergeTranslatedTexts,
  createTranslationPrompt,
  parseJsonTranslationResponse,
  TextBatch,
} from './textSplitter';

type TranslationTransport = 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui';

const STOP_TRANSLATION_MESSAGE = 'Đã gửi tín hiệu dừng dịch.';
const GROK_UI_RATE_LIMIT_MESSAGE = 'Grok UI: tất cả profile bị rate limit, dừng dịch.';
const GROK_UI_HARD_STOP_MESSAGE = 'Grok UI batch failed, stopped.';
const GEMINI_WEB_ACCOUNTS_EXHAUSTED_CODE = 'ALL_GEMINI_WEB_ACCOUNTS_FAILED';
let activeTranslateRunId: string | undefined;
let translateStopRequested = false;
let translateStopRunId: string | undefined;
const translateStopListeners = new Set<(runId?: string) => void>();

const normalizeRunId = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const shouldStopTranslation = (runId?: string | null): boolean => {
  if (!translateStopRequested) return false;
  if (!translateStopRunId) return true;
  const normalized = normalizeRunId(runId);
  return !!normalized && normalized === translateStopRunId;
};

const throwIfTranslationStopped = (runId?: string | null): void => {
  if (shouldStopTranslation(runId)) {
    throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
  }
};

const notifyTranslationStopped = (runId?: string): void => {
  for (const listener of Array.from(translateStopListeners)) {
    try {
      listener(runId);
    } catch {
      // ignore listener errors
    }
  }
};

const createTranslationStopSignal = (runId?: string | null): { promise: Promise<void>; dispose: () => void } => {
  const normalized = normalizeRunId(runId);
  let disposed = false;
  let resolveRef: (() => void) | null = null;
  const listener = (stoppedRunId?: string) => {
    if (disposed) return;
    if (!stoppedRunId || !normalized || stoppedRunId === normalized) {
      disposed = true;
      translateStopListeners.delete(listener);
      resolveRef?.();
    }
  };
  const promise = new Promise<void>((resolve) => {
    resolveRef = resolve;
    translateStopListeners.add(listener);
    if (shouldStopTranslation(normalized)) {
      listener(normalized);
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    translateStopListeners.delete(listener);
  };
  return { promise, dispose };
};

export function beginTranslationRun(runId?: string | null): void {
  activeTranslateRunId = normalizeRunId(runId);
}

export function endTranslationRun(runId?: string | null): void {
  const normalized = normalizeRunId(runId);
  if (!normalized || activeTranslateRunId === normalized) {
    activeTranslateRunId = undefined;
  }
  if (translateStopRunId && normalized && translateStopRunId === normalized) {
    translateStopRequested = false;
    translateStopRunId = undefined;
  }
}

export function isTranslationActive(runId?: string | null): boolean {
  if (!activeTranslateRunId) return false;
  const normalized = normalizeRunId(runId);
  if (!normalized) return true;
  return activeTranslateRunId === normalized;
}

export function stopActiveTranslation(runId?: string | null): { stopped: boolean; message: string } {
  const normalized = normalizeRunId(runId);
  const targetRunId = normalized || activeTranslateRunId;
  if (!targetRunId) {
    translateStopRequested = false;
    translateStopRunId = undefined;
    return { stopped: false, message: 'Không có tiến trình dịch đang chạy.' };
  }
  translateStopRequested = true;
  translateStopRunId = targetRunId;
  notifyTranslationStopped(targetRunId);
  void getGrokUiRuntime().shutdown({ hard: true }).catch(() => undefined);
  return { stopped: true, message: STOP_TRANSLATION_MESSAGE };
}

interface BatchTranslationResult {
  success: boolean;
  translatedTexts: string[];
  error?: string;
  errorCode?: string;
  transport: TranslationTransport;
  resourceId?: string;
  resourceLabel?: string;
  queueRuntimeKey?: string;
  queuePacingMode?: TranslationQueuePacingMetadata['queuePacingMode'];
  queueGapMs?: number;
  startedAt?: number;
  endedAt?: number;
  nextAllowedAt?: number;
}

interface DispatchTimingMetadata {
  queuePacingMode: 'dispatch_spacing_global';
  queueGapMs: number;
  startedAt: number;
  endedAt: number;
  nextAllowedAt: number;
}

interface GeminiWebQueueDispatchOptions {
  preferredResourceId?: string;
  maxAttempts?: number;
}

function formatIndexRanges(indexes: number[]): string {
  const normalized = Array.from(
    new Set(
      indexes
        .map((value) => Math.floor(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ).sort((a, b) => a - b);

  if (normalized.length === 0) {
    return 'không rõ';
  }

  const ranges: string[] = [];
  let start = normalized[0];
  let prev = normalized[0];

  for (let i = 1; i < normalized.length; i++) {
    const current = normalized[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current;
    prev = current;
  }

  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(',');
}

function createDispatchTimingMetadata(
  startedAt: number,
  queueGapMs: number
): DispatchTimingMetadata {
  const safeStartedAt = Number.isFinite(startedAt) ? Math.floor(startedAt) : Date.now();
  return {
    queuePacingMode: 'dispatch_spacing_global',
    queueGapMs,
    startedAt: safeStartedAt,
    endedAt: safeStartedAt,
    nextAllowedAt: safeStartedAt + queueGapMs,
  };
}

function buildQueueTimingFromResult(
  queued: { startedAt?: number; endedAt?: number },
  queueGapMs: number
): TranslationQueuePacingMetadata {
  const startedAt = Number.isFinite(queued.startedAt) ? Math.floor(queued.startedAt as number) : undefined;
  const endedAt = Number.isFinite(queued.endedAt) ? Math.floor(queued.endedAt as number) : Date.now();
  return {
    queuePacingMode: 'dispatch_spacing_global',
    queueGapMs,
    startedAt,
    endedAt,
    nextAllowedAt: startedAt !== undefined ? startedAt + queueGapMs : undefined,
  };
}

function mergePacingMetadata(
  primary?: TranslationQueuePacingMetadata,
  fallback?: TranslationQueuePacingMetadata
): TranslationQueuePacingMetadata | undefined {
  const merged: TranslationQueuePacingMetadata = {
    queuePacingMode: primary?.queuePacingMode ?? fallback?.queuePacingMode,
    queueGapMs: primary?.queueGapMs ?? fallback?.queueGapMs,
    startedAt: primary?.startedAt ?? fallback?.startedAt,
    endedAt: primary?.endedAt ?? fallback?.endedAt,
    nextAllowedAt: primary?.nextAllowedAt ?? fallback?.nextAllowedAt,
  };
  if (
    !merged.queuePacingMode &&
    typeof merged.queueGapMs !== 'number' &&
    typeof merged.startedAt !== 'number' &&
    typeof merged.endedAt !== 'number' &&
    typeof merged.nextAllowedAt !== 'number'
  ) {
    return undefined;
  }
  return merged;
}

function isConversationMetadata(value: unknown): value is Record<string, unknown> | unknown[] {
  return !!value && typeof value === 'object';
}

function extractConversationTraceId(metadata: unknown): string {
  if (!isConversationMetadata(metadata) || Array.isArray(metadata)) {
    return 'unknown';
  }
  const candidates = [
    metadata.conversationId,
    metadata.conversation_id,
    metadata.chatId,
    metadata.chat_id,
    metadata.id,
  ];
  const raw = candidates.find((item) => typeof item === 'string' && item.trim().length > 0);
  if (!raw || typeof raw !== 'string') {
    return 'unknown';
  }
  const trimmed = raw.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

/**
 * Dịch một batch text
 */
async function translateBatch(
  batch: TextBatch,
  model: GeminiModel,
  targetLanguage: string,
  promptTemplate?: string,
  assignedKey?: { apiKey: string; keyInfo: KeyInfo }
): Promise<BatchTranslationResult> {
  const keyLabel = assignedKey ? assignedKey.keyInfo.name : 'rotation';
  console.log(`[CaptionTranslator] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng) [key: ${keyLabel}]`);

  const { prompt } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate);

  try {
    const response = assignedKey
      ? await callGeminiWithAssignedKey(prompt, assignedKey, model)
      : await callGeminiWithRotation(prompt, model);

    if (!response.success || !response.data) {
      return {
        success: false,
        translatedTexts: [],
        error: response.error || 'Không có response',
        transport: 'api',
      };
    }

    const parsed = parseJsonTranslationResponse(response.data, batch.texts.length);
    const translatedTexts = parsed.translatedTexts;
    if (!parsed.ok) {
      return {
        success: false,
        translatedTexts,
        error: `${parsed.errorCode || 'ERROR_PROCESSING_FAILED'}: ${parsed.errorMessage || 'JSON response không hợp lệ'}`,
        transport: 'api',
      };
    }

    const validCount = translatedTexts.filter((t) => t.trim()).length;
    if (validCount < batch.texts.length) {
      console.warn(
        `[CaptionTranslator] Batch ${batch.batchIndex + 1}: Thiếu dòng ${validCount}/${batch.texts.length} — sẽ retry`
      );
      return { success: false, translatedTexts, error: `Thiếu ${batch.texts.length - validCount} dòng`, transport: 'api' };
    }

    return { success: true, translatedTexts, transport: 'api' };
  } catch (error) {
    console.error(`[CaptionTranslator] Lỗi dịch batch ${batch.batchIndex + 1}:`, error);
    return {
      success: false,
      translatedTexts: [],
      error: String(error),
      transport: 'api',
    };
  }
}

/**
 * Dịch một batch text qua Impit (Gemini Web / cookie)
 */
async function translateBatchImpit(
  batch: TextBatch,
  targetLanguage: string,
  promptTemplate?: string
): Promise<BatchTranslationResult> {
  console.log(`[CaptionTranslator] [Impit] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);

  const { prompt } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate);

  try {
    const result = await callGeminiImpitAutoSelect(prompt);

    if (!result.success || !result.text) {
      return {
        success: false,
        translatedTexts: [],
        error: result.error || 'Không có response từ impit',
        transport: 'impit',
      };
    }

    const parsed = parseJsonTranslationResponse(result.text, batch.texts.length);
    const translatedTexts = parsed.translatedTexts;
    if (!parsed.ok) {
      return {
        success: false,
        translatedTexts,
        error: `${parsed.errorCode || 'ERROR_PROCESSING_FAILED'}: ${parsed.errorMessage || 'JSON response không hợp lệ'}`,
        transport: 'impit',
      };
    }

    const validCount = translatedTexts.filter((t) => t.trim()).length;
    if (validCount < batch.texts.length) {
      console.warn(
        `[CaptionTranslator] [Impit] Batch ${batch.batchIndex + 1}: Thiếu dòng ${validCount}/${batch.texts.length} — sẽ retry`
      );
      return { success: false, translatedTexts, error: `Thiếu ${batch.texts.length - validCount} dòng`, transport: 'impit' };
    }

    return { success: true, translatedTexts, transport: 'impit' };
  } catch (error) {
    console.error(`[CaptionTranslator] [Impit] Lỗi dịch batch ${batch.batchIndex + 1}:`, error);
    return {
      success: false,
      translatedTexts: [],
      error: String(error),
      transport: 'impit',
    };
  }
}

/**
 * Dịch một batch text qua Grok UI (Grok3API UI mode)
 */
async function translateBatchGrokUi(
  batch: TextBatch,
  targetLanguage: string,
  promptTemplate: string | undefined,
  timeoutMs: number
): Promise<BatchTranslationResult> {
  console.log(`[CaptionTranslator] [GrokUI] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);

  const { prompt } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate);

  try {
    const result = await getGrokUiRuntime().ask({ prompt, timeoutMs });

    if (!result.success || !result.text) {
      if (result.errorCode === 'rate_limited' && result.error === 'RATE_LIMIT_ALL_PROFILES') {
        console.warn('[CaptionTranslator][GrokUI] All profiles rate limited → stopping translation.');
        throw new Error(GROK_UI_RATE_LIMIT_MESSAGE);
      }
      return {
        success: false,
        translatedTexts: [],
        error: result.error || 'Không có response từ Grok UI',
        transport: 'grok_ui',
      };
    }

    console.log(`[CaptionTranslator][GrokUI] Response received (full):\n${result.text}`);

    const parsed = parseJsonTranslationResponse(result.text, batch.texts.length);
    const translatedTexts = parsed.translatedTexts;
    if (!parsed.ok) {
      console.warn(
        `[CaptionTranslator][GrokUI] Parse failed: code=${parsed.errorCode || 'unknown'} msg=${parsed.errorMessage || 'unknown'}`
      );
      return {
        success: false,
        translatedTexts,
        error: `${parsed.errorCode || 'ERROR_PROCESSING_FAILED'}: ${parsed.errorMessage || 'JSON response không hợp lệ'}`,
        transport: 'grok_ui',
      };
    }

    const validCount = translatedTexts.filter((t) => t.trim()).length;
    if (validCount < batch.texts.length) {
      console.warn(
        `[CaptionTranslator] [GrokUI] Batch ${batch.batchIndex + 1}: Thiếu dòng ${validCount}/${batch.texts.length} — sẽ retry`
      );
      return { success: false, translatedTexts, error: `Thiếu ${batch.texts.length - validCount} dòng`, transport: 'grok_ui' };
    }

    return { success: true, translatedTexts, transport: 'grok_ui' };
  } catch (error) {
    if (error instanceof Error && error.message === GROK_UI_RATE_LIMIT_MESSAGE) {
      throw error;
    }
    console.error(`[CaptionTranslator] [GrokUI] Lỗi dịch batch ${batch.batchIndex + 1}:`, error);
    return {
      success: false,
      translatedTexts: [],
      error: String(error),
      transport: 'grok_ui',
    };
  }
}

async function translateBatchGeminiWebQueue(
  batch: TextBatch,
  targetLanguage: string,
  promptTemplate: string | undefined,
  projectId: string,
  sourcePath: string,
  queueContext: CaptionGeminiWebQueueRuntimeContext,
  dispatchOptions?: GeminiWebQueueDispatchOptions,
): Promise<BatchTranslationResult> {
  console.log(`[CaptionTranslator] [GeminiWebQueue] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);
  const { prompt } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate);
  const { queue, resourceLabelById } = queueContext;

  try {
    const queued = await queue.enqueue<{ prompt: string }, { text: string; accountConfigId: string; resourceLabel: string }>({
      poolId: CAPTION_GEMINI_WEB_QUEUE_POOL_ID,
      feature: CAPTION_GEMINI_WEB_QUEUE_FEATURE,
      serviceId: CAPTION_GEMINI_WEB_QUEUE_SERVICE_ID,
      jobType: 'translate-caption-batch',
      priority: 'normal',
      maxAttempts: Math.max(1, Math.floor(dispatchOptions?.maxAttempts ?? 3)),
      timeoutMs: 120_000,
      requiredCapabilities: ['caption_translate', 'gemini_webapi'],
      preferredResourceId: dispatchOptions?.preferredResourceId,
      payload: { prompt },
      execute: async (ctx) => {
        const accountConfigId = ctx.resource.resourceId;
        const resourceLabel = (ctx.resource.label || resourceLabelById.get(accountConfigId) || accountConfigId).trim();
        const conversationKey = buildCaptionConversationKey({ projectId, sourcePath });
        const conversationScope = {
          projectId,
          sourcePath,
          accountConfigId,
        };
        const storedConversationMetadata = getCaptionGeminiConversation(conversationScope);
        const hasStoredConversation = isConversationMetadata(storedConversationMetadata);
        console.log(
          `[CaptionTranslator] [GeminiWebQueue] Batch ${batch.batchIndex + 1} cookie-sync accountConfigId=${accountConfigId} (${resourceLabel})`
        );
        let response = await getGeminiWebApiRuntime().generateContent({
          prompt: ctx.payload.prompt,
          timeoutMs: 120_000,
          accountConfigId,
          conversationKey,
          useChatSession: true,
          conversationMetadata: hasStoredConversation ? storedConversationMetadata : null,
          proxyScope: 'caption',
        });

        if (!response.success) {
          const errorMessage = response.error || 'GeminiWebApi execution failed';
          if (response.errorCode === 'GEMINI_TIMEOUT') {
            throw new RotationJobExecutionError('TIMEOUT', errorMessage);
          }
          if (response.errorCode === 'COOKIE_INVALID' || response.errorCode === 'COOKIE_NOT_FOUND') {
            throw new RotationJobExecutionError('RESOURCE_UNAVAILABLE', errorMessage);
          }
          throw new RotationJobExecutionError('EXECUTION_ERROR', errorMessage);
        }

        let outputConversationMetadata = isConversationMetadata(response.conversationMetadata)
          ? response.conversationMetadata
          : null;
        let outputConversationMetadataReason = response.conversationMetadataReason || 'unknown';
        let outputConversationMetadataDebug = response.conversationMetadataDebug || null;
        let conversationMode: 'reused' | 'created_new' = hasStoredConversation
          ? 'reused'
          : (response.conversationContinued ? 'reused' : 'created_new');

        if (!outputConversationMetadata) {
          if (hasStoredConversation) {
            clearCaptionGeminiConversation(projectId, sourcePath, accountConfigId);
            console.warn(
              `[CaptionTranslator] [GeminiWebQueue] Batch ${batch.batchIndex + 1} metadata missing -> reset stored conversation accountConfigId=${accountConfigId} reason=${outputConversationMetadataReason} textLen=${(response.text || '').length} debug=${JSON.stringify(outputConversationMetadataDebug || {})}`
            );
          } else {
            console.warn(
              `[CaptionTranslator] [GeminiWebQueue] Batch ${batch.batchIndex + 1} metadata missing on new conversation accountConfigId=${accountConfigId} reason=${outputConversationMetadataReason} textLen=${(response.text || '').length} debug=${JSON.stringify(outputConversationMetadataDebug || {})}`
            );
          }

          response = await getGeminiWebApiRuntime().generateContent({
            prompt: ctx.payload.prompt,
            timeoutMs: 120_000,
            accountConfigId,
            conversationKey,
            useChatSession: true,
            resetConversation: true,
            conversationMetadata: null,
            proxyScope: 'caption',
          });

          if (!response.success) {
            const errorMessage = response.error || 'GeminiWebApi execution failed after conversation reset';
            if (response.errorCode === 'GEMINI_TIMEOUT') {
              throw new RotationJobExecutionError('TIMEOUT', errorMessage);
            }
            if (response.errorCode === 'COOKIE_INVALID' || response.errorCode === 'COOKIE_NOT_FOUND') {
              throw new RotationJobExecutionError('RESOURCE_UNAVAILABLE', errorMessage);
            }
            throw new RotationJobExecutionError('EXECUTION_ERROR', errorMessage);
          }

          outputConversationMetadata = isConversationMetadata(response.conversationMetadata)
            ? response.conversationMetadata
            : null;
          outputConversationMetadataReason = response.conversationMetadataReason || 'unknown';
          outputConversationMetadataDebug = response.conversationMetadataDebug || null;
          conversationMode = 'created_new';

          if (!outputConversationMetadata) {
            throw new RotationJobExecutionError(
              'EXECUTION_ERROR',
              `GeminiWebApi did not return conversation metadata after resetConversation (reason=${outputConversationMetadataReason}, textLen=${(response.text || '').length}, debug=${JSON.stringify(outputConversationMetadataDebug || {})})`
            );
          }
        }

        upsertCaptionGeminiConversation(conversationScope, outputConversationMetadata);
        const traceConversationId = extractConversationTraceId(outputConversationMetadata);
        console.log(
          `[CaptionTranslator] [GeminiWebQueue] Batch ${batch.batchIndex + 1} conversation=${conversationMode} accountConfigId=${accountConfigId} conversationId=${traceConversationId} key=${conversationKey}`
        );

        return {
          text: response.text || '',
          accountConfigId,
          resourceLabel,
        };
      },
    });
    const queueTiming = buildQueueTimingFromResult(queued, queueContext.queueGapMs);

    if (!queued.success) {
      return {
        success: false,
        translatedTexts: [],
        error: queued.error || 'GeminiWeb queue job failed',
        errorCode: queued.errorCode,
        transport: 'gemini_webapi_queue',
        resourceId: queued.resourceId,
        resourceLabel: queued.resourceId ? resourceLabelById.get(queued.resourceId) : undefined,
        queueRuntimeKey: CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
        ...queueTiming,
      };
    }

    const responseText = queued.result?.text || '';
    const parsed = parseJsonTranslationResponse(responseText, batch.texts.length);
    const translatedTexts = parsed.translatedTexts;
    if (!parsed.ok) {
      return {
        success: false,
        translatedTexts,
        error: `${parsed.errorCode || 'ERROR_PROCESSING_FAILED'}: ${parsed.errorMessage || 'JSON response không hợp lệ'}`,
        errorCode: parsed.errorCode || 'ERROR_PROCESSING_FAILED',
        transport: 'gemini_webapi_queue',
        resourceId: queued.resourceId,
        resourceLabel: queued.result?.resourceLabel || (queued.resourceId ? resourceLabelById.get(queued.resourceId) : undefined),
        queueRuntimeKey: CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
        ...queueTiming,
      };
    }

    const validCount = translatedTexts.filter((text) => text.trim()).length;
    if (validCount < batch.texts.length) {
      return {
        success: false,
        translatedTexts,
        error: `Thiếu ${batch.texts.length - validCount} dòng`,
        errorCode: 'ERROR_MISSING_LINES',
        transport: 'gemini_webapi_queue',
        resourceId: queued.resourceId,
        resourceLabel: queued.result?.resourceLabel || (queued.resourceId ? resourceLabelById.get(queued.resourceId) : undefined),
        queueRuntimeKey: CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
        ...queueTiming,
      };
    }

    return {
      success: true,
      translatedTexts,
      transport: 'gemini_webapi_queue',
      resourceId: queued.resourceId,
      resourceLabel: queued.result?.resourceLabel || (queued.resourceId ? resourceLabelById.get(queued.resourceId) : undefined),
      queueRuntimeKey: CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
      ...queueTiming,
    };
  } catch (error) {
    return {
      success: false,
      translatedTexts: [],
      error: String(error),
      errorCode: 'EXECUTION_ERROR',
      transport: 'gemini_webapi_queue',
      queueRuntimeKey: CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
    };
  }
}

/**
 * Dịch tất cả entries với progress callback
 */
export async function translateAll(
  options: TranslationOptions,
  progressCallback?: (progress: TranslationProgress) => void,
  progressAck?: (payload: { runId?: string; batchIndex: number; eventType: 'batch_completed' | 'batch_failed' }) => Promise<void>
): Promise<TranslationResult> {
  const {
    entries,
    targetLanguage = 'Vietnamese',
    model = GEMINI_MODELS.FLASH_3_0,
    linesPerBatch = 50,
    promptTemplate,
  } = options;
  const runId = normalizeRunId(options.runId);
  const assertNotStopped = () => throwIfTranslationStopped(runId);
  const isStopSignal = (error: unknown) =>
    error instanceof Error
    && (
      error.message === CAPTION_PROCESS_STOP_SIGNAL
      || error.message === GROK_UI_RATE_LIMIT_MESSAGE
      || error.message === GROK_UI_HARD_STOP_MESSAGE
    );
  const stopSignal = createTranslationStopSignal(runId);
  const raceWithStop = async <T>(promise: Promise<T>): Promise<T> => (
    Promise.race([
      promise,
      stopSignal.promise.then(() => {
        throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
      }),
    ])
  );
  const sleepWithStop = async (ms: number): Promise<void> => {
    if (ms <= 0) return;
    await raceWithStop(new Promise<void>((resolve) => setTimeout(resolve, ms)));
  };

  let geminiWebQueueRuntimeForRestore: CaptionGeminiWebQueueRuntimeContext | null = null;
  const geminiResourceEnabledRestoreMap = new Map<string, boolean>();
  const geminiTemporarilyDisabledResourceIds = new Set<string>();

  try {
    assertNotStopped();

    console.log(`[CaptionTranslator] Bắt đầu dịch ${entries.length} entries`);
    console.log(`[CaptionTranslator] Model: ${model}, Target: ${targetLanguage}`);

    // Chia thành batches
    const allBatches = splitForTranslation(entries, linesPerBatch);
    const maxBatchIndex = allBatches.length;
    const retryIndexesProvided = Array.isArray(options.retryBatchIndexes);
    const retryBatchIndexesInput: number[] = retryIndexesProvided ? (options.retryBatchIndexes as number[]) : [];
    const normalizedRetryBatchIndexes = retryIndexesProvided
      ? retryBatchIndexesInput
          .map((value) => Math.floor(Number(value)))
          .filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const requestedRetryBatchIndexes = Array.from(new Set(normalizedRetryBatchIndexes)).sort((a, b) => a - b);
    const invalidRetryBatchIndexes = requestedRetryBatchIndexes.filter((value) => value > maxBatchIndex);
    const validRetryBatchIndexes = requestedRetryBatchIndexes.filter((value) => value <= maxBatchIndex);
    const retryBatchIndexSet = validRetryBatchIndexes.length > 0
      ? new Set<number>(validRetryBatchIndexes)
      : null;
    const batches = retryBatchIndexSet
      ? allBatches.filter((batch) => retryBatchIndexSet.has(batch.batchIndex + 1))
      : allBatches;
    const collectMissingGlobalLineIndexes = (targetBatches: TextBatch[]): number[] => Array.from(
      new Set(
        targetBatches.flatMap((batch) =>
          Array.from({ length: batch.texts.length }, (_, offset) => batch.startIndex + offset + 1)
        )
      )
    ).sort((a, b) => a - b);
    if (retryIndexesProvided && (requestedRetryBatchIndexes.length === 0 || invalidRetryBatchIndexes.length > 0 || batches.length === 0)) {
      const mappedRetryBatches = allBatches.filter((batch) => retryBatchIndexSet?.has(batch.batchIndex + 1));
      const missingGlobalLineIndexes = collectMissingGlobalLineIndexes(mappedRetryBatches);
      const errorMessage = invalidRetryBatchIndexes.length > 0
        ? `ERROR_INVALID_RETRY_BATCH_INDEXES: out_of_range=${JSON.stringify(invalidRetryBatchIndexes)}, maxBatchIndex=${maxBatchIndex}`
        : `ERROR_INVALID_RETRY_BATCH_INDEXES: ${JSON.stringify(options.retryBatchIndexes)}`;
      return {
        success: false,
        entries,
        totalLines: entries.length,
        translatedLines: 0,
        failedLines: missingGlobalLineIndexes.length,
        errors: [errorMessage],
        batchReports: [],
        missingBatchIndexes: requestedRetryBatchIndexes,
        missingGlobalLineIndexes,
      };
    }
    if (retryBatchIndexSet) {
      console.log(
        `[CaptionTranslator] Step3 resume mode: chỉ dịch lại batch ${Array.from(retryBatchIndexSet).sort((a, b) => a - b).map((v) => `#${v}`).join(', ')}`
      );
    }

    const allTranslatedTexts: string[] = entries.map((entry) => (
      typeof entry.translatedText === 'string' ? entry.translatedText : ''
    ));
    const preservedTranslatedCount = retryBatchIndexSet
      ? allBatches.reduce((sum, batch) => {
        const batchNumber = batch.batchIndex + 1;
        if (retryBatchIndexSet.has(batchNumber)) {
          return sum;
        }
        let batchTranslated = 0;
        for (let i = batch.startIndex; i < batch.endIndex; i++) {
          if ((allTranslatedTexts[i] || '').trim().length > 0) {
            batchTranslated++;
          }
        }
        return sum + batchTranslated;
      }, 0)
      : 0;
    const errors: string[] = [];
    const batchReports: TranslationBatchReport[] = [];

    let translatedCount = preservedTranslatedCount;
    let failedCount = 0;
    let completedBatches = 0;
    let processedLines = 0;

    const useImpit = options.translateMethod === 'impit';
    const useGeminiWebQueue = options.translateMethod === 'gemini_webapi_queue';
    const useGrokUi = options.translateMethod === 'grok_ui';
    const projectId = (options.projectId || '').trim() || '__default_project__';
    const sourcePath = (options.sourcePath || '').trim() || '__unknown_source__';
    const apiWorkerCountSetting = (() => {
      try {
        const raw = Number(AppSettingsService.getAll().apiWorkerCount);
        return Number.isFinite(raw) ? Math.min(10, Math.max(1, Math.floor(raw))) : 1;
      } catch (error) {
        return 1;
      }
    })();
    const apiRequestDelayMs = (() => {
      try {
        const raw = Number(AppSettingsService.getAll().apiRequestDelayMs);
        return Number.isFinite(raw) ? Math.min(30000, Math.max(0, Math.floor(raw))) : 500;
      } catch (error) {
        return 500;
      }
    })();
    const grokUiRequestDelayMs = (() => {
      try {
        const raw = Number(AppSettingsService.getAll().grokUiRequestDelayMs);
        return Number.isFinite(raw) ? Math.min(30000, Math.max(0, Math.floor(raw))) : 5000;
      } catch (error) {
        return 5000;
      }
    })();
    const grokUiTimeoutMs = (() => {
      try {
        const raw = Number(AppSettingsService.getAll().grokUiTimeoutMs);
        return Number.isFinite(raw) ? Math.min(300000, Math.max(10000, Math.floor(raw))) : 120000;
      } catch (error) {
        return 120000;
      }
    })();
    const MAX_CONCURRENT = useGrokUi ? 1 : (useImpit ? 3 : (useGeminiWebQueue ? 5 : apiWorkerCountSetting));
    let queueGapMs = getCaptionStep3QueueGapMs();
    if (useGrokUi) {
      queueGapMs = grokUiRequestDelayMs;
    } else if (!useGeminiWebQueue && !useImpit) {
      queueGapMs = apiRequestDelayMs;
    }
    let lastDispatchTiming: TranslationQueuePacingMetadata | undefined;
    let nextDispatchAtMs = Date.now();
    let dispatchGateQueue: Promise<void> = Promise.resolve();
    let geminiWebQueueContext: CaptionGeminiWebQueueRuntimeContext | null = null;
    let geminiSequentialNextDispatchAtMs: number | null = null;
    let geminiExhaustedError: string | null = null;
    let geminiRoundRobinCursor = 0;
    let geminiInitialEnabledCount = 0;
    const MAX_BATCH_RETRY_DEFAULT = 2;
    const MAX_BATCH_RETRY = useGrokUi ? 2 : MAX_BATCH_RETRY_DEFAULT;

    const reserveDispatchSlot = (): Promise<DispatchTimingMetadata> => {
      const reservation = dispatchGateQueue
        .catch(() => undefined)
        .then(async () => {
        assertNotStopped();
        const now = Date.now();
        const dispatchAt = Math.max(now, nextDispatchAtMs);
        const waitMs = dispatchAt - now;
        if (waitMs > 0) {
          await sleepWithStop(waitMs);
        }
        assertNotStopped();
        const timing = createDispatchTimingMetadata(Date.now(), queueGapMs);
        nextDispatchAtMs = timing.nextAllowedAt;
        return timing;
      });
    dispatchGateQueue = reservation.then(() => undefined, () => undefined);
    return reservation;
  };

  const countTranslatedLines = (texts: string[]): number => (
    texts.reduce((sum, text) => sum + (text && text.trim().length > 0 ? 1 : 0), 0)
  );

  const shouldRetryBatch = (
    batchResult: BatchTranslationResult,
    normalizedTexts: string[],
    expectedCount: number
  ): boolean => {
    if (batchResult.success) {
      return false;
    }
    const errorText = (batchResult.error || '').toLowerCase();
    if (errorText.includes('error_count_mismatch')) {
      return true;
    }
    if (errorText.includes('thiếu') && errorText.includes('dòng')) {
      return true;
    }
    const translatedCount = countTranslatedLines(normalizedTexts);
    return translatedCount < expectedCount;
  };

  const awaitProgressAckIfNeeded = async (
    eventType: 'batch_completed' | 'batch_failed',
    batchIndex: number
  ): Promise<void> => {
    if (!useGrokUi || !progressAck) {
      return;
    }
    try {
      await raceWithStop(progressAck({ runId, batchIndex, eventType }));
    } catch (error) {
      if (error instanceof Error && error.message === CAPTION_PROCESS_STOP_SIGNAL) {
        throw error;
      }
      console.warn(`[CaptionTranslator] Grok UI ACK error: ${String(error)}`);
    }
  };

  if (useGeminiWebQueue) {
    geminiWebQueueContext = ensureCaptionGeminiWebQueueRuntime();
    geminiWebQueueRuntimeForRestore = geminiWebQueueContext;
    queueGapMs = geminiWebQueueContext.queueGapMs;
    const { queue } = geminiWebQueueContext;
    const snapshot = queue.getSnapshot();
    for (const resource of snapshot.resources) {
      if (resource.poolId !== CAPTION_GEMINI_WEB_QUEUE_POOL_ID) {
        continue;
      }
      geminiResourceEnabledRestoreMap.set(resource.resourceId, resource.enabled);
    }
    const enabledResources = snapshot.resources.filter(
      (resource) => resource.poolId === CAPTION_GEMINI_WEB_QUEUE_POOL_ID && resource.enabled
    );
    geminiInitialEnabledCount = enabledResources.length;
    if (enabledResources.length === 0) {
      const errorMessage = 'Không có account Gemini Web hợp lệ (is_active + __Secure-1PSID + __Secure-1PSIDTS).';
      const missingGlobalLineIndexes = collectMissingGlobalLineIndexes(batches);
      return {
        success: false,
        entries,
        totalLines: entries.length,
        translatedLines: preservedTranslatedCount,
        failedLines: missingGlobalLineIndexes.length,
        errors: [errorMessage],
        batchReports: [],
        missingBatchIndexes: batches.map((batch) => batch.batchIndex + 1),
        missingGlobalLineIndexes,
        queuePacingMode: 'dispatch_spacing_global',
        queueGapMs,
      };
    }
  }

  const sampleGeminiQueueDelayMs = (): number => {
    if (!geminiWebQueueContext) {
      return queueGapMs;
    }
    const minMs = Math.max(0, Math.floor(geminiWebQueueContext.minIntervalMs || queueGapMs));
    const maxMs = Math.max(minMs, Math.floor(geminiWebQueueContext.maxIntervalMs || minMs));
    if (geminiWebQueueContext.intervalMode !== 'random' || maxMs <= minMs) {
      return minMs;
    }
    return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  };

  const getGeminiEnabledResourceIds = (): string[] => {
    if (!geminiWebQueueContext) {
      return [];
    }
    return geminiWebQueueContext.queue.getSnapshot().resources
      .filter(
        (resource) => resource.poolId === CAPTION_GEMINI_WEB_QUEUE_POOL_ID && resource.enabled
      )
      .map((resource) => resource.resourceId);
  };

  const pickNextGeminiResourceId = (): string | null => {
    const resourceIds = getGeminiEnabledResourceIds();
    if (resourceIds.length === 0) {
      return null;
    }
    const index = geminiRoundRobinCursor % resourceIds.length;
    const picked = resourceIds[index];
    geminiRoundRobinCursor = (index + 1) % resourceIds.length;
    return picked;
  };

  const disableGeminiResourceForCurrentRun = (resourceId: string, reason: string): void => {
    if (!geminiWebQueueContext || !resourceId) {
      return;
    }
    if (geminiTemporarilyDisabledResourceIds.has(resourceId)) {
      return;
    }
    geminiTemporarilyDisabledResourceIds.add(resourceId);
    try {
      geminiWebQueueContext.queue.setResourceEnabled(CAPTION_GEMINI_WEB_QUEUE_POOL_ID, resourceId, false);
      console.warn(
        `[CaptionTranslator] [GeminiWebQueue] Tạm loại account ${resourceId} trong run hiện tại. Reason: ${reason}`
      );
    } catch (error) {
      console.warn(
        `[CaptionTranslator] [GeminiWebQueue] Không thể tạm loại account ${resourceId}: ${String(error)}`
      );
    }
  };

  const buildBatchReport = (
    batch: TextBatch,
    translatedTexts: string[],
    attempts: number,
    status: 'success' | 'failed',
    error?: string,
    timing?: TranslationQueuePacingMetadata,
    transport?: TranslationTransport,
    resourceId?: string,
    resourceLabel?: string,
    queueRuntimeKey?: string
  ): TranslationBatchReport => {
    const expectedLines = batch.texts.length;
    const normalized = Array.from({ length: expectedLines }, (_, index) => translatedTexts[index] ?? '');
    const missingLinesInBatch: number[] = [];
    const missingGlobalLineIndexes: number[] = [];
    let translatedLines = 0;

    for (let i = 0; i < expectedLines; i++) {
      if (normalized[i] && normalized[i].trim().length > 0) {
        translatedLines++;
      } else {
        missingLinesInBatch.push(i + 1);
        missingGlobalLineIndexes.push(batch.startIndex + i + 1);
      }
    }

    const startedAt = typeof timing?.startedAt === 'number' ? timing.startedAt : undefined;
    const endedAt = typeof timing?.endedAt === 'number' ? timing.endedAt : undefined;
    const durationMs = (typeof startedAt === 'number' && typeof endedAt === 'number' && endedAt >= startedAt)
      ? (endedAt - startedAt)
      : undefined;

    return {
      batchIndex: batch.batchIndex + 1,
      startIndex: batch.startIndex,
      endIndex: Math.max(batch.startIndex, batch.startIndex + expectedLines - 1),
      expectedLines,
      translatedLines,
      missingLinesInBatch,
      missingGlobalLineIndexes,
      attempts,
      status,
      error,
      startedAt,
      endedAt,
      durationMs,
      transport,
      resourceId,
      resourceLabel,
      queueRuntimeKey,
      queuePacingMode: timing?.queuePacingMode,
      queueGapMs: timing?.queueGapMs,
      nextAllowedAt: timing?.nextAllowedAt,
    };
  };

  const registerUnexpectedBatchFailure = async (batch: TextBatch, rawError: unknown): Promise<void> => {
    const methodLabel: TranslationTransport = useGeminiWebQueue
      ? 'gemini_webapi_queue'
      : (useImpit ? 'impit' : (useGrokUi ? 'grok_ui' : 'api'));
    const batchNumber = batch.batchIndex + 1;
    if (batchReports.some((report) => report.batchIndex === batchNumber)) {
      return;
    }

    const fallbackTexts = Array.from(
      { length: batch.texts.length },
      (_, offset) => allTranslatedTexts[batch.startIndex + offset] ?? ''
    );
    const fallbackError = `UNEXPECTED_BATCH_EXCEPTION: ${String(rawError)}`;
    const report = buildBatchReport(
      batch,
      fallbackTexts,
      1,
      'failed',
      fallbackError,
      undefined,
      methodLabel,
      undefined,
      undefined,
      undefined
    );
    batchReports.push(report);
    translatedCount += report.translatedLines;
    failedCount += report.missingGlobalLineIndexes.length;
    completedBatches++;
    processedLines += batch.texts.length;

    const missingRanges = formatIndexRanges(report.missingGlobalLineIndexes);
    const errorMessage = `Batch #${report.batchIndex} crash ngoài dự kiến (global: ${missingRanges}): ${String(rawError)}`;
    console.error(`[CaptionTranslator] ${errorMessage}`);
    errors.push(errorMessage);

    if (progressCallback && !shouldStopTranslation(runId)) {
      progressCallback({
        current: Math.min(processedLines, entries.length),
        total: entries.length,
        batchIndex: Math.max(0, report.batchIndex - 1),
        totalBatches: batches.length,
        status: 'error',
        message: `Batch #${report.batchIndex} bị lỗi ngoài dự kiến, đã đánh dấu failed.`,
        runId,
        eventType: 'batch_failed',
        batchReport: report,
        translatedChunk: {
          startIndex: batch.startIndex,
          texts: fallbackTexts,
        },
        transport: methodLabel,
      });
    }
    await awaitProgressAckIfNeeded('batch_failed', report.batchIndex);
  };

  // Dịch song song tối đa MAX_CONCURRENT batch cùng lúc
  const processBatch = async (batch: TextBatch, i: number, assignedKey?: { apiKey: string; keyInfo: KeyInfo }): Promise<void> => {
    assertNotStopped();
    const methodLabel: TranslationTransport = useGeminiWebQueue
      ? 'gemini_webapi_queue'
      : (useImpit ? 'impit' : (useGrokUi ? 'grok_ui' : 'api'));
    const batchNumber = batch.batchIndex + 1;
    const totalBatchCount = maxBatchIndex;
    const defaultTokenLabel = useGeminiWebQueue
      ? 'queue_rr'
      : (useImpit ? 'impit_cookie' : (useGrokUi ? 'grok_ui' : (assignedKey?.keyInfo.name || 'rotation')));
    const queueGapSecLabel = Number((queueGapMs / 1000).toFixed(1)).toString().replace(/\.0$/, '');
    const dispatchModeLabel = useGeminiWebQueue
      ? `tuần tự 1 job, chờ sau hoàn thành theo setting (${queueGapSecLabel}s+)`
      : `${MAX_CONCURRENT} song song, pacing ${queueGapSecLabel}s`;
    let progressTokenLabel = defaultTokenLabel;
    const totalAttempts = useGeminiWebQueue
      ? Math.max(1, geminiInitialEnabledCount)
      : Math.max(1, MAX_BATCH_RETRY + 1);
    let attempt = 0;
    let bestTexts: string[] = Array.from({ length: batch.texts.length }, () => '');
    let bestTranslatedCount = -1;
    let lastResult: BatchTranslationResult | null = null;
    let lastDispatchTiming: DispatchTimingMetadata | null = null;

    while (attempt < totalAttempts) {
      assertNotStopped();
      attempt += 1;
      const isRetryAttempt = attempt > 1;
      const preferredGeminiResourceId = useGeminiWebQueue ? pickNextGeminiResourceId() : null;
      if (useGeminiWebQueue && !preferredGeminiResourceId) {
        geminiExhaustedError = `${GEMINI_WEB_ACCOUNTS_EXHAUSTED_CODE}: Không còn account Gemini Web khả dụng để dịch Step 3.`;
        lastResult = {
          success: false,
          translatedTexts: bestTexts,
          error: geminiExhaustedError,
          errorCode: GEMINI_WEB_ACCOUNTS_EXHAUSTED_CODE,
          transport: 'gemini_webapi_queue',
          queueRuntimeKey: CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
        };
        break;
      }

      const nextAllowedAt = useGeminiWebQueue
        ? (geminiSequentialNextDispatchAtMs ?? Date.now())
        : nextDispatchAtMs;
      if (progressCallback && !shouldStopTranslation(runId)) {
        progressCallback({
          current: batch.startIndex,
          total: entries.length,
          batchIndex: batch.batchIndex,
          totalBatches: totalBatchCount,
          status: 'translating',
          message: isRetryAttempt
            ? `Batch ${batchNumber}/${totalBatchCount} retry lần ${attempt}/${totalAttempts} đang chờ dispatch ${queueGapSecLabel}s [${methodLabel}] [token:${progressTokenLabel}]...`
            : `Batch ${batchNumber}/${totalBatchCount} đang chờ dispatch ${queueGapSecLabel}s [${methodLabel}] [token:${progressTokenLabel}]...`,
          runId,
          eventType: isRetryAttempt ? 'batch_retry' : 'batch_started',
          transport: methodLabel,
          queuePacingMode: 'dispatch_spacing_global',
          queueGapMs,
          nextAllowedAt,
        });
      }

      let dispatchTiming: DispatchTimingMetadata;
      if (useGeminiWebQueue) {
        const waitUntil = geminiSequentialNextDispatchAtMs ?? Date.now();
        const now = Date.now();
        const waitMs = Math.max(0, waitUntil - now);
        if (waitMs > 0) {
          await sleepWithStop(waitMs);
        }
        const dispatchAt = Date.now();
        dispatchTiming = {
          queuePacingMode: 'dispatch_spacing_global',
          queueGapMs,
          startedAt: dispatchAt,
          endedAt: dispatchAt,
          nextAllowedAt: dispatchAt,
        };
      } else {
        dispatchTiming = await reserveDispatchSlot();
      }
      lastDispatchTiming = dispatchTiming;

      assertNotStopped();
      if (progressCallback && !shouldStopTranslation(runId)) {
        progressCallback({
          current: batch.startIndex,
          total: entries.length,
          batchIndex: batch.batchIndex,
          totalBatches: totalBatchCount,
          status: 'translating',
          message: isRetryAttempt
            ? `Đang retry batch ${batchNumber}/${totalBatchCount} lần ${attempt}/${totalAttempts} [${methodLabel}] [token:${progressTokenLabel}] (${dispatchModeLabel})...`
            : `Đang dịch batch ${batchNumber}/${totalBatchCount} [${methodLabel}] [token:${progressTokenLabel}] (${dispatchModeLabel})...`,
          runId,
          eventType: isRetryAttempt ? 'batch_retry' : 'batch_started',
          transport: methodLabel,
          ...dispatchTiming,
        });
      }

      console.log(
        `[CaptionTranslator] Dispatch batch #${batchNumber}/${totalBatchCount} attempt ${attempt}/${totalAttempts} at ${new Date(dispatchTiming.startedAt).toISOString()} (next=${new Date(dispatchTiming.nextAllowedAt).toISOString()})`
      );

      const batchResult: BatchTranslationResult = useGeminiWebQueue
        ? await translateBatchGeminiWebQueue(
          batch,
          targetLanguage,
          promptTemplate,
          projectId,
          sourcePath,
          geminiWebQueueContext!,
          {
            preferredResourceId: preferredGeminiResourceId || undefined,
            maxAttempts: 1,
          }
        )
        : useImpit
          ? await translateBatchImpit(batch, targetLanguage, promptTemplate)
          : useGrokUi
            ? await translateBatchGrokUi(batch, targetLanguage, promptTemplate, grokUiTimeoutMs)
            : await translateBatch(batch, model as GeminiModel, targetLanguage, promptTemplate, assignedKey);

      assertNotStopped();
      lastResult = batchResult;
      if (useGeminiWebQueue) {
        const finishedAt = Date.now();
        const nextGapMs = sampleGeminiQueueDelayMs();
        geminiSequentialNextDispatchAtMs = finishedAt + nextGapMs;
        batchResult.queuePacingMode = 'dispatch_spacing_global';
        batchResult.queueGapMs = nextGapMs;
        batchResult.startedAt = batchResult.startedAt ?? dispatchTiming.startedAt;
        batchResult.endedAt = finishedAt;
        batchResult.nextAllowedAt = geminiSequentialNextDispatchAtMs;
      }
      lastDispatchTiming = {
        ...dispatchTiming,
        queueGapMs: batchResult.queueGapMs ?? dispatchTiming.queueGapMs,
        endedAt: batchResult.endedAt ?? dispatchTiming.endedAt,
        nextAllowedAt: batchResult.nextAllowedAt ?? dispatchTiming.nextAllowedAt,
      };
      if (batchResult.resourceLabel || batchResult.resourceId) {
        progressTokenLabel = batchResult.resourceLabel || batchResult.resourceId || progressTokenLabel;
      }

      const normalizedTexts = Array.from({ length: batch.texts.length }, (_, idx) => batchResult.translatedTexts?.[idx] ?? '');
      const translatedLineCount = countTranslatedLines(normalizedTexts);
      if (translatedLineCount > bestTranslatedCount) {
        bestTranslatedCount = translatedLineCount;
        bestTexts = normalizedTexts;
      }

      if (batchResult.success) {
        bestTexts = normalizedTexts;
        break;
      }

      if (useGeminiWebQueue) {
        const failedResourceId = (batchResult.resourceId || '').trim();
        if (failedResourceId) {
          disableGeminiResourceForCurrentRun(failedResourceId, batchResult.error || batchResult.errorCode || 'ACCOUNT_FAILED');
        }
        const remainingResourceIds = getGeminiEnabledResourceIds();
        if (remainingResourceIds.length === 0) {
          geminiExhaustedError = `${GEMINI_WEB_ACCOUNTS_EXHAUSTED_CODE}: Tất cả account Gemini Web đều lỗi trong run hiện tại.`;
          lastResult = {
            ...batchResult,
            error: geminiExhaustedError,
            errorCode: GEMINI_WEB_ACCOUNTS_EXHAUSTED_CODE,
          };
          break;
        }
        if (attempt >= totalAttempts) {
          break;
        }
        continue;
      }

      const retryable = shouldRetryBatch(batchResult, normalizedTexts, batch.texts.length);
      if (!retryable || attempt >= totalAttempts) {
        break;
      }
      if (useGrokUi) {
        const retryCooldownUntil = Date.now() + queueGapMs;
        nextDispatchAtMs = Math.max(nextDispatchAtMs, retryCooldownUntil);
        console.log(
          `[CaptionTranslator] [GrokUI] Cooldown trước retry ${queueGapMs}ms (next=${new Date(nextDispatchAtMs).toISOString()})`
        );
      }
    }

    const finalTexts = bestTexts;
    const isFullSuccess = !!lastResult?.success;
    const attemptsUsed = attempt;
    const pacingMetadata = mergePacingMetadata(lastResult || undefined, lastDispatchTiming || undefined);
    const report = buildBatchReport(
      batch,
      finalTexts,
      attemptsUsed,
      isFullSuccess ? 'success' : 'failed',
      isFullSuccess ? undefined : (lastResult?.error || 'BATCH_TRANSLATION_FAILED'),
      pacingMetadata,
      lastResult?.transport || methodLabel,
      lastResult?.resourceId,
      lastResult?.resourceLabel,
      lastResult?.queueRuntimeKey
    );

    batchReports.push(report);

    if (useGrokUi) {
      console.log(
        `[CaptionTranslator][GrokUI] Batch #${report.batchIndex} mapping start=${report.startIndex} end=${report.endIndex} chunkStart=${batch.startIndex} lines=${report.expectedLines}`
      );
    }

    // Luôn giữ partial đã dịch được để renderer có thể lưu dần vào session
    for (let j = 0; j < finalTexts.length; j++) {
      allTranslatedTexts[batch.startIndex + j] = finalTexts[j];
    }

    translatedCount += report.translatedLines;
    failedCount += report.missingGlobalLineIndexes.length;

    if (!isFullSuccess) {
      const globalMissing = formatIndexRanges(report.missingGlobalLineIndexes);
      const errorMsg = `Batch #${report.batchIndex} (dòng ${report.startIndex + 1}-${report.endIndex + 1}) thiếu ${report.missingGlobalLineIndexes.length}/${report.expectedLines} dòng sau ${attemptsUsed} lần gửi (global: ${globalMissing})`;
      console.error(`[CaptionTranslator] ${errorMsg}`);
      errors.push(errorMsg);
    }

    completedBatches++;
    processedLines += batch.texts.length;
    if (progressCallback && !shouldStopTranslation(runId)) {
      const reportMissingGlobalRanges = formatIndexRanges(report.missingGlobalLineIndexes);
      const completionMessage = report.status === 'success'
        ? `Batch #${report.batchIndex} hoàn tất ${report.translatedLines}/${report.expectedLines} dòng, đã lưu partial. (${completedBatches}/${batches.length}) [${methodLabel}] [token:${progressTokenLabel}]`
        : `Batch #${report.batchIndex} còn thiếu ${report.missingGlobalLineIndexes.length}/${report.expectedLines} dòng (global: ${reportMissingGlobalRanges}), đã lưu partial. (${completedBatches}/${batches.length}) [${methodLabel}] [token:${progressTokenLabel}]`;
      progressCallback({
        current: Math.min(processedLines, entries.length),
        total: entries.length,
        batchIndex: report.batchIndex - 1,
        totalBatches: totalBatchCount,
        status: report.status === 'success' ? 'translating' : 'error',
        message: completionMessage,
        runId,
        eventType: report.status === 'success' ? 'batch_completed' : 'batch_failed',
        batchReport: report,
        translatedChunk: {
          startIndex: batch.startIndex,
          texts: finalTexts,
        },
        transport: lastResult?.transport || methodLabel,
        resourceId: lastResult?.resourceId,
        resourceLabel: lastResult?.resourceLabel,
        queueRuntimeKey: lastResult?.queueRuntimeKey,
        ...pacingMetadata,
      });
    }
    await awaitProgressAckIfNeeded(
      report.status === 'success' ? 'batch_completed' : 'batch_failed',
      report.batchIndex
    );
    if (useGrokUi && !isFullSuccess) {
      console.warn(
        `[CaptionTranslator] [GrokUI] Batch #${report.batchIndex} failed after ${attemptsUsed} attempts → hard stop (missing=${report.missingGlobalLineIndexes.length})`
      );
      throw new Error(GROK_UI_HARD_STOP_MESSAGE);
    }
    assertNotStopped();
    if (useGrokUi) {
      const now = Date.now();
      const cooldownUntil = now + queueGapMs;
      nextDispatchAtMs = Math.max(nextDispatchAtMs, cooldownUntil);
      lastDispatchTiming = {
        queuePacingMode: 'dispatch_spacing_global',
        queueGapMs,
        startedAt: lastDispatchTiming?.startedAt ?? now,
        endedAt: now,
        nextAllowedAt: cooldownUntil,
      };
      console.log(
        `[CaptionTranslator] [GrokUI] Cooldown sau ACK ${queueGapMs}ms (next=${new Date(nextDispatchAtMs).toISOString()})`
      );
    }
  };

  // Chạy theo từng nhóm MAX_CONCURRENT batch
  const manager = getApiManager();
  if (useGeminiWebQueue) {
    assertNotStopped();
    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      await processBatch(batch, i).catch(async (error) => {
        if (isStopSignal(error)) {
          throw error;
        }
        await registerUnexpectedBatchFailure(batch, error);
      });
      if (geminiExhaustedError) {
        break;
      }
    }
  } else {
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
      assertNotStopped();
      const chunk = batches.slice(i, i + MAX_CONCURRENT);

      // Pre-assign 1 key riêng biệt cho mỗi batch trong chunk (chỉ áp dụng cho API, không phải impit)
      const assignedKeys: Array<{ apiKey: string; keyInfo: KeyInfo } | undefined> = [];
      if (!useImpit && !useGrokUi) {
        for (let k = 0; k < chunk.length; k++) {
          const { apiKey, keyInfo } = manager.getNextApiKey();
          assignedKeys.push(apiKey && keyInfo ? { apiKey, keyInfo } : undefined);
        }
        const keyNames = assignedKeys.map(k => k?.keyInfo.name ?? 'rotation').join(', ');
        console.log(`[CaptionTranslator] Chunk ${Math.floor(i / MAX_CONCURRENT) + 1}: gán key [${keyNames}]`);
      }

      // Stagger start: mỗi batch trong chunk delay 300ms để tránh burst cùng lúc
      await Promise.all(
        chunk.map((batch, offset) =>
          new Promise<void>((resolve, reject) =>
            setTimeout(() => {
              processBatch(batch, i + offset, assignedKeys[offset])
                .catch(async (error) => {
                  if (isStopSignal(error)) {
                    reject(error);
                    return;
                  }
                  await registerUnexpectedBatchFailure(batch, error);
                })
                .finally(resolve);
            }, offset * 300)
          )
        )
      );
    }
  }

  if (useGeminiWebQueue && geminiExhaustedError) {
    const reportedBatchIndexes = new Set(batchReports.map((report) => report.batchIndex));
    for (const batch of batches) {
      const batchNumber = batch.batchIndex + 1;
      if (reportedBatchIndexes.has(batchNumber)) {
        continue;
      }
      const fallbackTexts = Array.from(
        { length: batch.texts.length },
        (_, offset) => allTranslatedTexts[batch.startIndex + offset] ?? ''
      );
      const report = buildBatchReport(
        batch,
        fallbackTexts,
        0,
        'failed',
        geminiExhaustedError,
        undefined,
        'gemini_webapi_queue',
        undefined,
        undefined,
        CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
      );
      batchReports.push(report);
      translatedCount += report.translatedLines;
      failedCount += report.missingGlobalLineIndexes.length;
      completedBatches += 1;
      processedLines += batch.texts.length;
    }
    if (!errors.includes(geminiExhaustedError)) {
      errors.push(geminiExhaustedError);
    }
  }

  // Merge kết quả vào entries
  const resultEntries = mergeTranslatedTexts(entries, allTranslatedTexts);

    // Report completion
    if (progressCallback && !shouldStopTranslation(runId)) {
      const summaryTransport: TranslationTransport = useGeminiWebQueue
        ? 'gemini_webapi_queue'
        : (useImpit ? 'impit' : (useGrokUi ? 'grok_ui' : 'api'));
      const summaryPacingMetadata = mergePacingMetadata(lastDispatchTiming);
      const hasFailures = failedCount > 0;
      progressCallback({
        current: entries.length,
        total: entries.length,
        batchIndex: Math.max(0, maxBatchIndex - 1),
        totalBatches: maxBatchIndex,
        status: hasFailures ? 'error' : 'completed',
        message: hasFailures
          ? `Kết thúc có lỗi: ${translatedCount}/${entries.length} dòng, thiếu ${failedCount} dòng`
          : `Hoàn thành: ${translatedCount}/${entries.length} dòng`,
        runId,
        eventType: 'summary',
        transport: summaryTransport,
        queueRuntimeKey: useGeminiWebQueue ? CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY : undefined,
        ...summaryPacingMetadata,
      });
    }

  assertNotStopped();

  console.log(
    `[CaptionTranslator] Hoàn thành: ${translatedCount} dịch, ${failedCount} lỗi`
  );

  const missingBatchIndexes = batchReports
    .filter((report) => report.status === 'failed')
    .map((report) => report.batchIndex);
  const missingGlobalLineIndexes = Array.from(
    new Set(
      batchReports
        .filter((report) => report.status === 'failed')
        .flatMap((report) => report.missingGlobalLineIndexes)
    )
  ).sort((a, b) => a - b);

    return {
      success: failedCount === 0,
      entries: resultEntries,
      totalLines: entries.length,
      translatedLines: translatedCount,
      failedLines: failedCount,
      errors: errors.length > 0 ? errors : undefined,
      batchReports,
      missingBatchIndexes,
      missingGlobalLineIndexes,
      ...mergePacingMetadata(lastDispatchTiming),
    };
  } finally {
    if (geminiWebQueueRuntimeForRestore && geminiTemporarilyDisabledResourceIds.size > 0) {
      for (const resourceId of geminiTemporarilyDisabledResourceIds) {
        const restoreEnabled = geminiResourceEnabledRestoreMap.get(resourceId);
        if (typeof restoreEnabled !== 'boolean') {
          continue;
        }
        try {
          geminiWebQueueRuntimeForRestore.queue.setResourceEnabled(
            CAPTION_GEMINI_WEB_QUEUE_POOL_ID,
            resourceId,
            restoreEnabled,
          );
        } catch (error) {
          console.warn(
            `[CaptionTranslator] [GeminiWebQueue] Không thể khôi phục trạng thái account ${resourceId}: ${String(error)}`
          );
        }
      }
    }
    stopSignal.dispose();
  }
}

/**
 * Dịch nhanh một đoạn text đơn lẻ (không batch)
 */
export async function translateSingleText(
  text: string,
  targetLanguage: string = 'Vietnamese',
  model: GeminiModel = GEMINI_MODELS.FLASH_3_0
): Promise<{ success: boolean; translatedText: string; error?: string }> {
  const prompt = `Dịch đoạn text sau sang tiếng ${targetLanguage}. Chỉ trả về bản dịch, không giải thích:

${text}`;

  try {
    const response = await callGeminiWithRotation(prompt, model);

    if (response.success && response.data) {
      return { success: true, translatedText: response.data.trim() };
    }

    return {
      success: false,
      translatedText: '',
      error: response.error || 'Không có response',
    };
  } catch (error) {
    return { success: false, translatedText: '', error: String(error) };
  }
}
