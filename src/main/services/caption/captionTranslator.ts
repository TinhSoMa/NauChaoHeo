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
  SingleBatchOptions,
  SingleBatchResult,
  CAPTION_PROCESS_STOP_SIGNAL,
} from '../../../shared/types/caption';
import { callGeminiWithRotation, GEMINI_MODELS, type GeminiModel } from '../gemini';
import { type AIProvider } from './aiProvider';
import { createGeminiProvider } from './providers/geminiProvider';
import { createOpenRouterProvider } from './providers/openrouterProvider';
import { createDeepSeekProvider } from './providers/deepseekProvider';
import { getSystemPrompt } from '../deepseek/deepseekService.js';
import { AppSettingsService } from '../appSettings';
import { PromptService } from '../promptService';
import { type KeyInfo } from '../../../shared/types/gemini';
import { getApiManager } from '../gemini/apiManager';
import { GeminiChatService } from '../chatGemini/geminiChatService';
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
  mergeTranslatedTexts,
  createTranslationPrompt,
  createDeepSeekPrompt,
  parseJsonTranslationResponse,
  TextBatch,
} from './textSplitter';
import * as path from 'path';
import * as fs from 'fs';
import { getCaptionOutputDirFromInput } from '../../../shared/utils/captionSession';

import type { TranslationTransport } from './aiProvider';

function createProviderForMethod(
  method: string,
  assignedKey?: { apiKey: string; keyInfo: KeyInfo },
): AIProvider | null {
  if (method === 'api') return createGeminiProvider(assignedKey)
  if (method === 'openrouter') return createOpenRouterProvider()
  if (method === 'deepseek') return createDeepSeekProvider()
  return null
}

const STOP_TRANSLATION_MESSAGE = 'Đã gửi tín hiệu dừng dịch.';
const GROK_UI_RATE_LIMIT_MESSAGE = 'Grok UI: tất cả profile bị rate limit, dừng dịch.';
const GROK_UI_HARD_STOP_MESSAGE = 'Grok UI batch failed, stopped.';
const GEMINI_WEB_ACCOUNTS_EXHAUSTED_CODE = 'ALL_GEMINI_WEB_ACCOUNTS_FAILED';
const CAPTION_GEMINI_WEB_QUEUE_MAX_ATTEMPTS = 2; // 1 lan dau + 1 lan retry
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
  translateStopRequested = false;
  translateStopRunId = undefined;
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
  keySwitchCount?: number;
  accountLabel?: string;
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
  provider: AIProvider,
  model: string,
  targetLanguage: string,
  promptTemplate?: string,
  shouldStop?: () => boolean,
  stopSignal?: AbortSignal,
  memoryContext?: string,
  debugSaveDir?: string,
  deepseekSystemPrompt?: string,
): Promise<BatchTranslationResult> {
  console.log(`[CaptionTranslator] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng) [transport: ${provider.transport}]`);
  const promptResult = provider.transport === 'deepseek'
    ? createDeepSeekPrompt(batch.texts, targetLanguage, promptTemplate, memoryContext, debugSaveDir, batch.batchIndex, deepseekSystemPrompt)
    : createTranslationPrompt(batch.texts, targetLanguage, promptTemplate, memoryContext, debugSaveDir, batch.batchIndex);
  const { prompt, systemPrompt } = promptResult;

  try {
    const response = await provider.call({ prompt, systemPrompt, model, signal: stopSignal, debugSaveDir, batchIndex: batch.batchIndex });

    if (!response.success && response.error === 'STOP_REQUESTED') {
      throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
    }

    const accountLabel = response.accountLabel;

    if (!response.success || typeof response.data !== 'string') {
      return {
        success: false,
        translatedTexts: [],
        error: response.error || 'Không có response',
        transport: provider.transport,
        keySwitchCount: response.keySwitchCount,
        accountLabel,
      };
    }

    const parsed = parseJsonTranslationResponse(response.data, batch.texts.length);
    const translatedTexts = parsed.translatedTexts;
    if (!parsed.ok) {
      return {
        success: false,
        translatedTexts,
        error: `${parsed.errorCode || 'ERROR_PROCESSING_FAILED'}: ${parsed.errorMessage || 'JSON response không hợp lệ'}`,
        transport: provider.transport,
        keySwitchCount: response.keySwitchCount,
        accountLabel,
      };
    }

    const validCount = translatedTexts.filter((t) => t.trim()).length;
    if (validCount < batch.texts.length) {
      console.warn(
        `[CaptionTranslator] Batch ${batch.batchIndex + 1}: Thiếu dòng ${validCount}/${batch.texts.length} — sẽ retry`
      );
      return { success: false, translatedTexts, error: `Thiếu ${batch.texts.length - validCount} dòng`, transport: provider.transport, keySwitchCount: response.keySwitchCount, accountLabel };
    }

    return { success: true, translatedTexts, transport: provider.transport, keySwitchCount: response.keySwitchCount, accountLabel };
  } catch (error) {
    if (error instanceof Error && error.message === CAPTION_PROCESS_STOP_SIGNAL) {
      throw error;
    }

    console.error(`[CaptionTranslator] Lỗi dịch batch ${batch.batchIndex + 1}:`, error);
    return {
      success: false,
      translatedTexts: [],
      error: String(error),
      transport: provider.transport,
    };
  }
}


/**
 * Dịch một batch text qua Impit (Gemini Web / cookie)
 */
async function translateBatchImpit(
  batch: TextBatch,
  targetLanguage: string,
  promptTemplate?: string,
  memoryContext?: string,
  debugSaveDir?: string,
): Promise<BatchTranslationResult> {
  console.log(`[CaptionTranslator] [Impit] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);

  const { prompt } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate, memoryContext, debugSaveDir, batch.batchIndex);

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
  timeoutMs: number,
  memoryContext?: string,
  debugSaveDir?: string,
): Promise<BatchTranslationResult> {
  console.log(`[CaptionTranslator] [GrokUI] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);

  const { prompt } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate, memoryContext, debugSaveDir, batch.batchIndex);

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
  memoryContext?: string,
  debugSaveDir?: string,
): Promise<BatchTranslationResult> {
  console.log(`[CaptionTranslator] [GeminiWebQueue] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);
  const { prompt } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate, memoryContext, debugSaveDir, batch.batchIndex);
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
        const markCookieErrorIfNeeded = (errorCode?: string, errorMessage?: string) => {
          if (errorCode === 'COOKIE_INVALID' || errorCode === 'COOKIE_NOT_FOUND' || errorCode === 'GEMINI_TIMEOUT') {
            GeminiChatService.markConfigError(accountConfigId, errorMessage || errorCode);
          }
        };
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
            markCookieErrorIfNeeded(response.errorCode, errorMessage);
            throw new RotationJobExecutionError('TIMEOUT', errorMessage);
          }
          if (response.errorCode === 'COOKIE_INVALID' || response.errorCode === 'COOKIE_NOT_FOUND') {
            markCookieErrorIfNeeded(response.errorCode, errorMessage);
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
              markCookieErrorIfNeeded(response.errorCode, errorMessage);
              throw new RotationJobExecutionError('TIMEOUT', errorMessage);
            }
            if (response.errorCode === 'COOKIE_INVALID' || response.errorCode === 'COOKIE_NOT_FOUND') {
              markCookieErrorIfNeeded(response.errorCode, errorMessage);
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
  const stopAbortController = new AbortController();
  void stopSignal.promise.then(() => {
    if (!stopAbortController.signal.aborted) {
      stopAbortController.abort();
    }
  });
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

    // Chia thành batches (lazy: chỉ compute batch khi cần)
    const totalBatches = Math.ceil(entries.length / linesPerBatch);
    const maxBatchIndex = totalBatches;
    const getBatchAtIndex = (index: number): TextBatch => {
      const startIndex = index * linesPerBatch;
      const endIndex = Math.min(startIndex + linesPerBatch, entries.length);
      const batchEntries = entries.slice(startIndex, endIndex);
      return {
        batchIndex: index,
        startIndex,
        endIndex,
        entries: batchEntries,
        texts: batchEntries.map((e) => e.text),
      };
    };
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
    if (retryIndexesProvided && (requestedRetryBatchIndexes.length === 0 || invalidRetryBatchIndexes.length > 0 || !retryBatchIndexSet)) {
      const missingGlobalLineIndexes = Array.from(retryBatchIndexSet ?? [])
        .sort((a, b) => a - b)
        .flatMap((batchNumber) => {
          const start = (batchNumber - 1) * linesPerBatch;
          const end = Math.min(start + linesPerBatch, entries.length);
          return Array.from({ length: end - start }, (_, i) => start + i + 1);
        });
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
    let preservedTranslatedCount = 0;
    if (retryBatchIndexSet) {
      for (let entryIdx = 0; entryIdx < entries.length; entryIdx++) {
        const batchIdx = Math.floor(entryIdx / linesPerBatch);
        if (retryBatchIndexSet.has(batchIdx + 1)) continue;
        if ((allTranslatedTexts[entryIdx] || '').trim().length > 0) preservedTranslatedCount++;
      }
    }
    const errors: string[] = [];
    const batchReports: TranslationBatchReport[] = [];

    let translatedCount = preservedTranslatedCount;
    let failedCount = 0;
    let completedBatches = 0;
    let processedLines = 0;

    const useImpit = options.translateMethod === 'impit';
    const useGeminiWebQueue = options.translateMethod === 'gemini_webapi_queue';
    const useGrokUi = options.translateMethod === 'grok_ui';
    const useProvider = !useImpit && !useGeminiWebQueue && !useGrokUi;
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
    let geminiStickyResourceId: string | null = null;
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
    // Retry on rate limit (429) — the key rotation in callChatCompletionWithRotation may free up capacity
    if (errorText.includes('429') || errorText.includes('rate limit') || errorText.includes('too many requests')) {
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
    if (enabledResources.length === 0) {
      const errorMessage = 'Không có account Gemini Web hợp lệ (is_active + __Secure-1PSID + __Secure-1PSIDTS).';
      const missingGlobalLineIndexes = Array.from({ length: entries.length }, (_, i) => i + 1);
      return {
        success: false,
        entries,
        totalLines: entries.length,
        translatedLines: preservedTranslatedCount,
        failedLines: missingGlobalLineIndexes.length,
        errors: [errorMessage],
        batchReports: [],
        missingBatchIndexes: Array.from({ length: totalBatches }, (_, i) => i + 1),
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

  const isGeminiAccountFailoverError = (batchResult: BatchTranslationResult): boolean => {
    const normalizedCode = (batchResult.errorCode || '').trim().toUpperCase();
    const normalizedError = (batchResult.error || '').trim().toLowerCase();

    if (
      normalizedCode === 'RESOURCE_UNAVAILABLE'
      || normalizedCode === 'COOKIE_INVALID'
      || normalizedCode === 'COOKIE_NOT_FOUND'
      || normalizedCode === 'GEMINI_TIMEOUT'
    ) {
      return true;
    }

    if (normalizedCode === 'TIMEOUT' && normalizedError.includes('gemini timeout')) {
      return true;
    }

    if (
      normalizedError.includes('cookie_invalid')
      || normalizedError.includes('cookie_not_found')
      || normalizedError.includes('__secure-1psid')
      || normalizedError.includes('gemini timeout')
    ) {
      return true;
    }

    return false;
  };

  const resolveGeminiStickyResourceId = (): string | null => {
    const resourceIds = getGeminiEnabledResourceIds();
    if (resourceIds.length === 0) {
      geminiStickyResourceId = null;
      return null;
    }

    if (geminiStickyResourceId && resourceIds.includes(geminiStickyResourceId)) {
      return geminiStickyResourceId;
    }

    geminiStickyResourceId = resourceIds[0];
    return geminiStickyResourceId;
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
      : (useImpit ? 'impit' : (useGrokUi ? 'grok_ui' : (options.translateMethod as TranslationTransport || 'api')));
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
        totalBatches,
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

  const deepseekSystemPromptSnapshot = getSystemPrompt();

  // Dịch tuần tự từng batch (batch trước xong mới đến batch sau)
  const processBatch = async (batch: TextBatch, i: number, assignedKey?: { apiKey: string; keyInfo: KeyInfo }): Promise<void> => {
    assertNotStopped();
    const provider = useProvider
      ? createProviderForMethod(options.translateMethod || 'api', assignedKey)
      : null;
    const methodLabel: TranslationTransport = useGeminiWebQueue
      ? 'gemini_webapi_queue'
      : (useImpit ? 'impit' : (useGrokUi ? 'grok_ui' : (provider?.transport || 'api')));
    const batchNumber = batch.batchIndex + 1;
    const totalBatchCount = maxBatchIndex;
    const defaultTokenLabel = useGeminiWebQueue
      ? 'queue_rr'
      : (useImpit ? 'impit_cookie' : (useGrokUi ? 'grok_ui' : (assignedKey?.keyInfo.name || 'rotation')));
    const queueGapSecLabel = Number((queueGapMs / 1000).toFixed(1)).toString().replace(/\.0$/, '');
    const dispatchModeLabel = useGeminiWebQueue
      ? `tuần tự 1 job, chờ sau hoàn thành theo setting (${queueGapSecLabel}s+)`
      : `tuần tự 1 job, pacing ${queueGapSecLabel}s`;
    let progressTokenLabel = defaultTokenLabel;
  const totalAttempts = useGeminiWebQueue
      ? CAPTION_GEMINI_WEB_QUEUE_MAX_ATTEMPTS
      : Math.max(1, MAX_BATCH_RETRY + 1);
    let attempt = 0;
    let bestTexts: string[] = Array.from({ length: batch.texts.length }, () => '');
    let bestTranslatedCount = -1;
    let lastResult: BatchTranslationResult | null = null;
    let lastDispatchTiming: DispatchTimingMetadata | null = null;

    let localMemoryContext: string | undefined;

    while (attempt < totalAttempts) {
      assertNotStopped();
      attempt += 1;
      const isRetryAttempt = attempt > 1;
      const preferredGeminiResourceId = useGeminiWebQueue ? resolveGeminiStickyResourceId() : null;
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
          },
          localMemoryContext,
        )
        : useImpit
          ? await translateBatchImpit(batch, targetLanguage, promptTemplate, localMemoryContext)
          : useGrokUi
            ? await translateBatchGrokUi(batch, targetLanguage, promptTemplate, grokUiTimeoutMs, localMemoryContext)
            : await translateBatch(
                batch,
                provider!,
                model,
                targetLanguage,
                promptTemplate,
                () => shouldStopTranslation(runId),
                stopAbortController.signal,
                localMemoryContext,
                deepseekSystemPromptSnapshot,
              );

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
      if (useGeminiWebQueue) {
        const resolvedResourceId = (batchResult.resourceId || '').trim();
        if (resolvedResourceId) {
          geminiStickyResourceId = resolvedResourceId;
        }
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
        const shouldFailover = isGeminiAccountFailoverError(batchResult);
        if (shouldFailover && failedResourceId) {
          disableGeminiResourceForCurrentRun(failedResourceId, batchResult.error || batchResult.errorCode || 'ACCOUNT_FAILED');
          if (geminiStickyResourceId === failedResourceId) {
            geminiStickyResourceId = null;
          }
        }
        const remainingResourceIds = shouldFailover ? getGeminiEnabledResourceIds() : [];
        if (shouldFailover && remainingResourceIds.length === 0) {
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
      // Rate limit cooldown: wait before retrying to let the rate limit window pass
      const errorText = (lastResult?.error || '').toLowerCase();
      if (errorText.includes('429') || errorText.includes('rate limit')) {
        const cooldownMs = Math.min(10_000 + attempt * 5_000, 60_000); // 15s → 20s → 25s ... max 60s
        console.log(`[CaptionTranslator] ⏳ Rate limit hit, cooldown ${cooldownMs}ms trước retry...`);
        await sleepWithStop(cooldownMs);
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
        ? `Batch #${report.batchIndex} hoàn tất ${report.translatedLines}/${report.expectedLines} dòng, đã lưu partial. (${completedBatches}/${totalBatches}) [${methodLabel}] [token:${progressTokenLabel}]`
        : `Batch #${report.batchIndex} còn thiếu ${report.missingGlobalLineIndexes.length}/${report.expectedLines} dòng (global: ${reportMissingGlobalRanges}), đã lưu partial. (${completedBatches}/${totalBatches}) [${methodLabel}] [token:${progressTokenLabel}]`;
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

  // Chạy tuần tự từng batch (tránh rate limit, memory context cần batch trước hoàn thành)
  const manager = getApiManager();
  if (useGeminiWebQueue) {
    assertNotStopped();
    for (let i = 0; i < totalBatches; i += 1) {
      if (retryBatchIndexSet && !retryBatchIndexSet.has(i + 1)) continue;
      const batch = getBatchAtIndex(i);
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
    for (let i = 0; i < totalBatches; i += 1) {
      if (retryBatchIndexSet && !retryBatchIndexSet.has(i + 1)) continue;
      assertNotStopped();
      const batch = getBatchAtIndex(i);

      // Gán key riêng cho batch này (chỉ áp dụng cho API, không phải impit/grok_ui/openrouter/deepseek)
      let assignedKey: { apiKey: string; keyInfo: KeyInfo } | undefined;
      if (options.translateMethod === 'api') {
        const { apiKey, keyInfo } = manager.getNextApiKey();
        assignedKey = apiKey && keyInfo ? { apiKey, keyInfo } : undefined;
        console.log(`[CaptionTranslator] Batch ${i + 1}/${totalBatches}: gán key [${assignedKey?.keyInfo.name ?? 'rotation'}]`);
      }

      await processBatch(batch, i, assignedKey).catch(async (error) => {
        if (isStopSignal(error)) {
          throw error;
        }
        await registerUnexpectedBatchFailure(batch, error);
      });

      // Nếu batch thất bại sau tất cả retry → dừng toàn bộ, không dịch batch sau
      const lastReport = batchReports[batchReports.length - 1];
      if (lastReport && lastReport.status === 'failed') {
        console.log(`[CaptionTranslator] Batch ${i + 1} thất bại sau tất cả retry — dừng dịch các batch còn lại.`);
        break;
      }
    }
  }

  if (useGeminiWebQueue && geminiExhaustedError) {
    const reportedBatchIndexes = new Set(batchReports.map((report) => report.batchIndex));
    for (let i = 0; i < totalBatches; i += 1) {
      if (retryBatchIndexSet && !retryBatchIndexSet.has(i + 1)) continue;
      const batchNumber = i + 1;
      if (reportedBatchIndexes.has(batchNumber)) {
        continue;
      }
      const batch = getBatchAtIndex(i);
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

  // Fallback cho API/Impit/Grok UI: nếu có batch bị skip do break
  if (!useGeminiWebQueue && completedBatches < totalBatches) {
    const reportedBatchIndexes = new Set(batchReports.map((r) => r.batchIndex));
    const methodLabel: TranslationTransport = useImpit ? 'impit' : (useGrokUi ? 'grok_ui' : (options.translateMethod as TranslationTransport || 'api'));
    for (let i = 0; i < totalBatches; i += 1) {
      if (retryBatchIndexSet && !retryBatchIndexSet.has(i + 1)) continue;
      const batchNumber = i + 1;
      if (reportedBatchIndexes.has(batchNumber)) continue;
      const batch = getBatchAtIndex(i);
      const fallbackTexts = Array.from(
        { length: batch.texts.length },
        (_, offset) => allTranslatedTexts[batch.startIndex + offset] ?? ''
      );
      const report = buildBatchReport(
        batch,
        fallbackTexts,
        0,
        'failed',
        `BATCH_SKIPPED: batch #${batchNumber} bị bỏ qua do batch trước thất bại hoàn toàn`,
        undefined,
        methodLabel,
        undefined,
        undefined,
        undefined,
      );
      batchReports.push(report);
      translatedCount += report.translatedLines;
      failedCount += report.missingGlobalLineIndexes.length;
      completedBatches += 1;
      processedLines += batch.texts.length;
    }
    const skipMessage = `Dừng sớm: batch hiện tại thất bại sau tất cả retry — ${totalBatches - batchReports.length} batch còn lại đã bị bỏ qua`;
    console.warn(`[CaptionTranslator] ${skipMessage}`);
    errors.push(skipMessage);
  }

  // Merge kết quả vào entries
  const resultEntries = mergeTranslatedTexts(entries, allTranslatedTexts);

    // Report completion
    if (progressCallback && !shouldStopTranslation(runId)) {
      const summaryTransport: TranslationTransport = useGeminiWebQueue
        ? 'gemini_webapi_queue'
        : (useImpit ? 'impit' : (useGrokUi ? 'grok_ui' : (options.translateMethod as TranslationTransport || 'api')));
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
        const config = GeminiChatService.getById(resourceId);
        const shouldRemainDisabled = !!config && (!config.isActive || config.isError);
        try {
          geminiWebQueueRuntimeForRestore.queue.setResourceEnabled(
            CAPTION_GEMINI_WEB_QUEUE_POOL_ID,
            resourceId,
            shouldRemainDisabled ? false : restoreEnabled,
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
 * Dịch 1 batch đơn lẻ (dùng cho kiến trúc 1 batch/lần)
 */
export async function translateSingleBatch(
  options: SingleBatchOptions
): Promise<SingleBatchResult> {
  const {
    entries,
    batchIndex,
    totalBatches,
    targetLanguage,
    model,
    promptTemplate,
    translateMethod,
    projectId,
    sourcePath,
    runId,
    isThumbnailPrompt,
  } = options;

  throwIfTranslationStopped(runId);

  // Resolve custom prompt từ settings nếu chưa được cung cấp
  let resolvedPromptTemplate = promptTemplate;
  if (!resolvedPromptTemplate) {
    try {
      const appSettings = AppSettingsService.getAll();
      let matchingPrompt: any = null;
      if (appSettings.captionPromptFamilyId) {
        matchingPrompt = PromptService.resolveLatestByFamily(appSettings.captionPromptFamilyId);
      }
      if (!matchingPrompt && appSettings.captionPromptId) {
        matchingPrompt = PromptService.getById(appSettings.captionPromptId);
      }
      if (matchingPrompt?.content) {
        resolvedPromptTemplate = matchingPrompt.content;
        console.log(`[CaptionTranslator] Sử dụng custom prompt: "${matchingPrompt.name}" (${matchingPrompt.id})`);
      }
    } catch (error) {
      console.warn('[CaptionTranslator] Lỗi resolve custom prompt:', error);
    }
  }

  // Build TextBatch từ entries
  let batch: TextBatch = {
    batchIndex,
    startIndex: 0,
    endIndex: Math.max(0, entries.length - 1),
    entries,
    texts: entries.map((e) => e.text),
  };

  if (isThumbnailPrompt) {
    if (entries.length === 0) {
      throw new Error('[CaptionTranslator] isThumbnailPrompt requires at least one entry');
    }
    const allText = entries.map(e => e.text).join('\n');
    const firstEntry = entries[0];
    batch = {
      batchIndex,
      startIndex: 0,
      endIndex: 0,
      entries: [{ ...firstEntry, text: allText }],
      texts: [allText],
    };
    resolvedPromptTemplate = `You are an expert YouTube thumbnail prompt engineer for AI image generation.

Based on the following video subtitle content, generate a COMPLETE, PRODUCTION-READY prompt for creating a YouTube thumbnail. The prompt must be self-contained and ready to use directly in an AI image generator.

Your output MUST include all of the following elements:
1. Main subject: Describe the key visual based on the video content
2. Style requirements: Include visual style, mood/atmosphere, color palette, composition, lighting, and art direction
3. Text overlay suggestions: If relevant, propose short overlay text and its style (bold, minimal, etc.)
4. Technical constraints: MUST specify STRICT 16:9 aspect ratio (1920x1080), widescreen, horizontal layout, YouTube thumbnail proportions
5. Quality descriptors: High quality, professional, eye-catching, clean composition, optimized for YouTube thumbnail viewing

Return ONLY the final prompt text — no explanations, no prefixes, no labels.`;
  }

  const useGeminiWebQueue = translateMethod === 'gemini_webapi_queue';
  const useImpit = translateMethod === 'impit';
  const useGrokUi = translateMethod === 'grok_ui';
  const useProvider = !useImpit && !useGeminiWebQueue && !useGrokUi;

  // Build memory context from previous batches
  let localMemoryContext: string | undefined;
  if (options.previousBatches && options.previousBatches.length > 0) {
    const ctxParts: string[] = [];
    for (const pb of options.previousBatches) {
      const pairs = pb.entries.map((e, i) => ({
        source: e.text,
        translated: pb.translatedTexts[i] || '',
      }));
      const batchLines = pairs.map(
        (p) => `${p.source} → ${p.translated}`
      ).join('\n');
      ctxParts.push(batchLines);
    }
    localMemoryContext = ctxParts.join('\n\n');
    console.log(`[CaptionTranslator] [Memory] batch #${batchIndex + 1}: using ${options.previousBatches.length} previous batch(es) as context`);
  }

  // Lấy API key nếu cần (chỉ 'api' transport dùng Gemini key rotation)
  let assignedKey: { apiKey: string; keyInfo: KeyInfo } | undefined;
  if (translateMethod === 'api') {
    const manager = getApiManager();
    const keyResult = manager.getNextApiKey();
    assignedKey = keyResult.apiKey && keyResult.keyInfo ? { apiKey: keyResult.apiKey, keyInfo: keyResult.keyInfo } : undefined;
    console.log(`[CaptionTranslator] Batch #${batchIndex + 1}: gán key [${assignedKey?.keyInfo.name ?? 'rotation'}]`);
  }

  const provider = useProvider ? createProviderForMethod(translateMethod || '', assignedKey) : null;

  // Gemini Web Queue setup
  let geminiWebQueueContext: CaptionGeminiWebQueueRuntimeContext | null = null;
  let geminiStickyResourceId: string | null = null;
  if (useGeminiWebQueue) {
    geminiWebQueueContext = ensureCaptionGeminiWebQueueRuntime();
    if (geminiWebQueueContext) {
      const snapshot = geminiWebQueueContext.queue.getSnapshot();
      const enabledResources = snapshot.resources.filter(
        (r) => r.poolId === CAPTION_GEMINI_WEB_QUEUE_POOL_ID && r.enabled
      );
      if (enabledResources.length > 0) {
        geminiStickyResourceId = enabledResources[0].resourceId;
      }
    }
  }

  // Tạo thư mục debug lưu prompt
  const debugSaveDir = (() => {
    try {
      const rawSourcePath = (sourcePath || '').trim();
      if (!rawSourcePath) return undefined;
      const isSrt = rawSourcePath.toLowerCase().endsWith('.srt');
      const inputDir = isSrt ? path.dirname(rawSourcePath) : rawSourcePath;
      const outputDir = getCaptionOutputDirFromInput(isSrt ? 'srt' : 'draft', inputDir);
      if (!outputDir) return undefined;
      const debugDir = path.join(outputDir, 'debug_prompts');
      fs.mkdirSync(debugDir, { recursive: true });
      return debugDir;
    } catch {
      return undefined;
    }
  })();

  const totalAttempts = useGeminiWebQueue
    ? CAPTION_GEMINI_WEB_QUEUE_MAX_ATTEMPTS
    : Math.max(1, 2 + 1); // 1 lần đầu + 2 lần retry
  const queueGapMs = useGrokUi
    ? Number(AppSettingsService.getAll().grokUiRequestDelayMs || 3000)
    : Number(AppSettingsService.getAll().apiRequestDelayMs || 2000);

  let attempt = 0;
  let lastResult: BatchTranslationResult | null = null;
  let bestTexts: string[] = Array.from({ length: batch.texts.length }, () => '');
  let bestTranslatedCount = -1;

  while (attempt < totalAttempts) {
    throwIfTranslationStopped(runId);
    attempt++;
    const isRetryAttempt = attempt > 1;

    if (useGeminiWebQueue && !geminiStickyResourceId) {
      lastResult = {
        success: false,
        translatedTexts: bestTexts,
        error: `${GEMINI_WEB_ACCOUNTS_EXHAUSTED_CODE}: Không còn account Gemini Web khả dụng.`,
        transport: 'gemini_webapi_queue' as TranslationTransport,
      };
      break;
    }

    // Pacing giữa các lần retry
    if (isRetryAttempt) {
      const cooldown = queueGapMs;
      console.log(`[CaptionTranslator] Retry cooldown ${cooldown}ms`);
      await new Promise((resolve) => setTimeout(resolve, cooldown));
      throwIfTranslationStopped(runId);
    }

    const batchResult: BatchTranslationResult = useGeminiWebQueue
      ? await translateBatchGeminiWebQueue(
          batch,
          targetLanguage,
          resolvedPromptTemplate,
          (projectId || '').trim() || '__default_project__',
          (sourcePath || '').trim() || '__unknown_source__',
          geminiWebQueueContext!,
          { preferredResourceId: geminiStickyResourceId || undefined, maxAttempts: 1 },
          localMemoryContext,
          debugSaveDir,
        )
      : useImpit
        ? await translateBatchImpit(batch, targetLanguage, resolvedPromptTemplate, localMemoryContext, debugSaveDir)
        : useGrokUi
          ? await translateBatchGrokUi(batch, targetLanguage, resolvedPromptTemplate, queueGapMs, localMemoryContext, debugSaveDir)
          : await translateBatch(
              batch,
              provider!,
              model,
              targetLanguage,
              resolvedPromptTemplate,
              () => shouldStopTranslation(runId),
              undefined,
              localMemoryContext,
              debugSaveDir,
            );

    lastResult = batchResult;

    const normalizedTexts = Array.from(
      { length: batch.texts.length },
      (_, idx) => batchResult.translatedTexts?.[idx] ?? '',
    );
    const translatedLineCount = normalizedTexts.filter((t) => t.trim()).length;
    if (translatedLineCount > bestTranslatedCount) {
      bestTranslatedCount = translatedLineCount;
      bestTexts = normalizedTexts;
    }

    if (batchResult.success) {
      bestTexts = normalizedTexts;
      throwIfTranslationStopped(runId);
      return {
        success: true,
        translatedTexts: bestTexts,
        batchIndex,
        transport: batchResult.transport,
        resourceId: batchResult.resourceId,
        resourceLabel: batchResult.resourceLabel,
        queueRuntimeKey: batchResult.queueRuntimeKey,
        keySwitchCount: batchResult.keySwitchCount,
        assignedAccountLabel: batchResult.accountLabel,
      };
    }

    // Gemini Web Queue: failover
    if (useGeminiWebQueue) {
      const failedResourceId = (batchResult.resourceId || '').trim();
      if (failedResourceId && geminiWebQueueContext) {
        geminiWebQueueContext.queue.setResourceEnabled(
          CAPTION_GEMINI_WEB_QUEUE_POOL_ID,
          failedResourceId,
          false,
        );
      }
      if (geminiStickyResourceId === failedResourceId) {
        geminiStickyResourceId = null;
      }
      if (attempt >= totalAttempts) {
        break;
      }
      continue;
    }

    // API/Impit/Grok UI: kiểm tra retryable
    let retryable = !batchResult.success;
    if (retryable && batchResult.error) {
      const errorText = batchResult.error.toLowerCase();
      if (!errorText.includes('error_count_mismatch') && !(errorText.includes('thiếu') && errorText.includes('dòng'))) {
        const translatedCount = normalizedTexts.filter((t) => t.trim()).length;
        retryable = translatedCount < batch.texts.length;
      }
    }
    if (!retryable || attempt >= totalAttempts) {
      break;
    }
  }

  throwIfTranslationStopped(runId);
  return {
    success: lastResult?.success ?? false,
    translatedTexts: bestTexts,
    batchIndex,
    error: lastResult?.error || 'Batch translation failed',
    transport: lastResult?.transport,
    resourceId: lastResult?.resourceId,
    resourceLabel: lastResult?.resourceLabel,
    queueRuntimeKey: lastResult?.queueRuntimeKey,
    keySwitchCount: lastResult?.keySwitchCount,
    assignedAccountLabel: lastResult?.accountLabel,
  };
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

const THUMBNAIL_CONTEXT_MAX_ENTRIES = 100; // 2 batches x 50 lines

const THUMBNAIL_EXTRACT_TEMPLATE = `You are a structured data extractor for YouTube thumbnail creation.

Analyze the following translated subtitle content (first 2 batches) and extract these fields as a JSON object:

{
  "mainSubject": "Describe the key visual scene in 5-10 words",
  "category": "Content category: Công Nghệ / Game / Vlog / Hướng Dẫn / Giải Trí / Tin Tức",
  "mood": "Mood: Phấn Khích / Nghiêm Túc / Vui Vẻ / Chuyên Nghiệp / Bí Ẩn / Năng Động",
  "theme": "Visual theme: Sáng Sủa / Tối / Nhiều Màu / Tối Giản / Chuyển Màu / Neon",
  "primaryColor": "Dominant color: Đỏ / Xanh Dương / Xanh Lá / Tím / Cam / Vàng / Hồng / Xanh Cyan",
  "thumbnailStyle": "Art style: Siêu Thực / Hoạt Hình / Tối Giản / Nghệ Thuật / Hiện Đại / Cổ Điển",
  "textOverlay": "The name of this movie/series in Vietnamese (max 3 words)",
  "textStyle": "Text overlay style: Đậm / Tối Giản / Cầu Kỳ / Viền / Đổ Bóng / Chuyển Màu"
}

Return ONLY valid JSON, no other text.`;

const THUMBNAIL_TEXT_OVERLAY_TEMPLATE = 'Create a YouTube thumbnail in STRICT 16:9 aspect ratio (1920x1080 dimensions). \nMain subject: {{mainSubject}}. \nStyle requirements: {{category}} style, {{thumbnailStyle}} thumbnail, with {{theme}} theme, {{mood}} mood, dominant {{primaryColor}} color palette, featuring {{textStyle}} text overlay "{{textOverlay}}".\nCRITICAL: Must be exactly 16:9 aspect ratio, widescreen format, horizontal layout, YouTube thumbnail proportions (1920x1080). High quality, professional, eye-catching, clean composition optimized for YouTube thumbnail viewing.';

function fillThumbnailTemplate(vars: Record<string, string>): string {
  let result = THUMBNAIL_TEXT_OVERLAY_TEMPLATE;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(`{{${key}}}`, value);
  }
  return result;
}

export interface GenerateThumbnailPromptOptions {
  entries: SubtitleEntry[];
  model: string;
  translateMethod: 'api' | 'deepseek' | 'openrouter';
  projectName?: string;
}

export async function generateThumbnailPrompt(
  options: GenerateThumbnailPromptOptions,
): Promise<{ success: boolean; prompt?: string; error?: string }> {
  const { entries, model, translateMethod, projectName } = options;
  if (entries.length === 0) {
    return { success: false, error: 'Không có subtitle entries.' };
  }

  const contextEntries = entries.slice(0, THUMBNAIL_CONTEXT_MAX_ENTRIES);
  const allText = contextEntries.map(e => e.translatedText ?? e.text).join('\n');
  const extractPrompt = `${THUMBNAIL_EXTRACT_TEMPLATE}\n\n## Translated subtitles (first 2 batches)\n${allText}`;
  const provider = createProviderForMethod(translateMethod);
  if (!provider) {
    return { success: false, error: `Unsupported translate method: ${translateMethod}` };
  }

  try {
    const response = await provider.call({ prompt: extractPrompt, model });
    if (!response.success || typeof response.data !== 'string') {
      return { success: false, error: response.error || 'AI không trả về kết quả' };
    }

    let fields: Record<string, string>;
    try {
      fields = JSON.parse(response.data.trim());
    } catch {
      return { success: false, error: 'AI không trả về JSON hợp lệ' };
    }

    const textOverlay = projectName
      ? projectName
      : (fields.textOverlay || fields.mainSubject || '');
    const textStyle = fields.textStyle || 'Đậm';

    const finalPrompt = fillThumbnailTemplate({
      mainSubject: fields.mainSubject || 'Main scene from content',
      category: fields.category || 'Giải Trí',
      thumbnailStyle: fields.thumbnailStyle || 'Hiện Đại',
      theme: fields.theme || 'Sáng Sủa',
      mood: fields.mood || 'Vui Vẻ',
      primaryColor: fields.primaryColor || 'Đỏ',
      textStyle,
      textOverlay,
    });

    return { success: true, prompt: finalPrompt };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
