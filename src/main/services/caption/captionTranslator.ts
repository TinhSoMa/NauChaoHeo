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
} from '../../../shared/types/caption';
import { callGeminiWithRotation, callGeminiWithAssignedKey, GEMINI_MODELS, type GeminiModel } from '../gemini';
import { AppSettingsService } from '../appSettings';
import { type KeyInfo } from '../../../shared/types/gemini';
import { getApiManager } from '../gemini/apiManager';
import { callGeminiImpitAutoSelect } from '../shared';
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

type TranslationTransport = 'api' | 'impit' | 'gemini_webapi_queue';

interface BatchTranslationResult {
  success: boolean;
  translatedTexts: string[];
  error?: string;
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

async function translateBatchGeminiWebQueue(
  batch: TextBatch,
  targetLanguage: string,
  promptTemplate: string | undefined,
  projectId: string,
  sourcePath: string,
  queueContext: CaptionGeminiWebQueueRuntimeContext,
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
      maxAttempts: 3,
      timeoutMs: 120_000,
      requiredCapabilities: ['caption_translate', 'gemini_webapi'],
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
  progressCallback?: (progress: TranslationProgress) => void
): Promise<TranslationResult> {
  const {
    entries,
    targetLanguage = 'Vietnamese',
    model = GEMINI_MODELS.FLASH_3_0,
    linesPerBatch = 50,
    promptTemplate,
  } = options;

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
  const MAX_CONCURRENT = useImpit ? 3 : (useGeminiWebQueue ? 5 : apiWorkerCountSetting);
  let queueGapMs = getCaptionStep3QueueGapMs();
  if (!useGeminiWebQueue && !useImpit) {
    queueGapMs = apiRequestDelayMs;
  }
  let lastDispatchTiming: TranslationQueuePacingMetadata | undefined;
  let nextDispatchAtMs = Date.now();
  let dispatchGateQueue: Promise<void> = Promise.resolve();
  let geminiWebQueueContext: CaptionGeminiWebQueueRuntimeContext | null = null;
  const MAX_BATCH_RETRY = 2;

  const reserveDispatchSlot = (): Promise<DispatchTimingMetadata> => {
    const reservation = dispatchGateQueue
      .catch(() => undefined)
      .then(async () => {
        const now = Date.now();
        const dispatchAt = Math.max(now, nextDispatchAtMs);
        const waitMs = dispatchAt - now;
        if (waitMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        }
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

  if (useGeminiWebQueue) {
    geminiWebQueueContext = ensureCaptionGeminiWebQueueRuntime();
    queueGapMs = geminiWebQueueContext.queueGapMs;
    const { queue } = geminiWebQueueContext;
    const snapshot = queue.getSnapshot();
    const enabledResources = snapshot.resources.filter(
      (resource) => resource.poolId === CAPTION_GEMINI_WEB_QUEUE_POOL_ID && resource.enabled
    );
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

  const buildBatchReport = (
    batch: TextBatch,
    translatedTexts: string[],
    attempts: number,
    status: 'success' | 'failed',
    error?: string
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
    };
  };

  const registerUnexpectedBatchFailure = (batch: TextBatch, rawError: unknown): void => {
    const batchNumber = batch.batchIndex + 1;
    if (batchReports.some((report) => report.batchIndex === batchNumber)) {
      return;
    }

    const fallbackTexts = Array.from(
      { length: batch.texts.length },
      (_, offset) => allTranslatedTexts[batch.startIndex + offset] ?? ''
    );
    const fallbackError = `UNEXPECTED_BATCH_EXCEPTION: ${String(rawError)}`;
    const report = buildBatchReport(batch, fallbackTexts, 1, 'failed', fallbackError);
    batchReports.push(report);
    translatedCount += report.translatedLines;
    failedCount += report.missingGlobalLineIndexes.length;
    completedBatches++;
    processedLines += batch.texts.length;

    const missingRanges = formatIndexRanges(report.missingGlobalLineIndexes);
    const errorMessage = `Batch #${report.batchIndex} crash ngoài dự kiến (global: ${missingRanges}): ${String(rawError)}`;
    console.error(`[CaptionTranslator] ${errorMessage}`);
    errors.push(errorMessage);

    if (progressCallback) {
      const methodLabel: TranslationTransport = useGeminiWebQueue ? 'gemini_webapi_queue' : (useImpit ? 'impit' : 'api');
      progressCallback({
        current: Math.min(processedLines, entries.length),
        total: entries.length,
        batchIndex: Math.max(0, report.batchIndex - 1),
        totalBatches: batches.length,
        status: 'error',
        message: `Batch #${report.batchIndex} bị lỗi ngoài dự kiến, đã đánh dấu failed.`,
        eventType: 'batch_failed',
        batchReport: report,
        translatedChunk: {
          startIndex: batch.startIndex,
          texts: fallbackTexts,
        },
        transport: methodLabel,
      });
    }
  };

  // Dịch song song tối đa MAX_CONCURRENT batch cùng lúc
  const processBatch = async (batch: TextBatch, i: number, assignedKey?: { apiKey: string; keyInfo: KeyInfo }): Promise<void> => {
    const methodLabel: TranslationTransport = useGeminiWebQueue ? 'gemini_webapi_queue' : (useImpit ? 'impit' : 'api');
    const defaultTokenLabel = useGeminiWebQueue ? 'queue_rr' : (useImpit ? 'impit_cookie' : (assignedKey?.keyInfo.name || 'rotation'));
    const queueGapSecLabel = Number((queueGapMs / 1000).toFixed(1)).toString().replace(/\.0$/, '');
    const dispatchModeLabel = useGeminiWebQueue
      ? `dispatch mỗi ${queueGapSecLabel}s, không chờ batch trước`
      : `${MAX_CONCURRENT} song song, pacing ${queueGapSecLabel}s`;
    let progressTokenLabel = defaultTokenLabel;
    const totalAttempts = Math.max(1, MAX_BATCH_RETRY + 1);
    let attempt = 0;
    let bestTexts: string[] = Array.from({ length: batch.texts.length }, () => '');
    let bestTranslatedCount = -1;
    let lastResult: BatchTranslationResult | null = null;
    let lastDispatchTiming: DispatchTimingMetadata | null = null;

    while (attempt < totalAttempts) {
      attempt += 1;
      const isRetryAttempt = attempt > 1;
      if (progressCallback) {
        progressCallback({
          current: batch.startIndex,
          total: entries.length,
          batchIndex: i,
          totalBatches: batches.length,
          status: 'translating',
          message: isRetryAttempt
            ? `Batch ${i + 1}/${batches.length} retry lần ${attempt}/${totalAttempts} đang chờ dispatch ${queueGapSecLabel}s [${methodLabel}] [token:${progressTokenLabel}]...`
            : `Batch ${i + 1}/${batches.length} đang chờ dispatch ${queueGapSecLabel}s [${methodLabel}] [token:${progressTokenLabel}]...`,
          eventType: isRetryAttempt ? 'batch_retry' : 'batch_started',
          transport: methodLabel,
          queuePacingMode: 'dispatch_spacing_global',
          queueGapMs,
          nextAllowedAt: nextDispatchAtMs,
        });
      }

      const dispatchTiming = await reserveDispatchSlot();
      lastDispatchTiming = dispatchTiming;

      if (progressCallback) {
        progressCallback({
          current: batch.startIndex,
          total: entries.length,
          batchIndex: i,
          totalBatches: batches.length,
          status: 'translating',
          message: isRetryAttempt
            ? `Đang retry batch ${i + 1}/${batches.length} lần ${attempt}/${totalAttempts} [${methodLabel}] [token:${progressTokenLabel}] (${dispatchModeLabel})...`
            : `Đang dịch batch ${i + 1}/${batches.length} [${methodLabel}] [token:${progressTokenLabel}] (${dispatchModeLabel})...`,
          eventType: isRetryAttempt ? 'batch_retry' : 'batch_started',
          transport: methodLabel,
          ...dispatchTiming,
        });
      }

      console.log(
        `[CaptionTranslator] Dispatch batch #${i + 1}/${batches.length} attempt ${attempt}/${totalAttempts} at ${new Date(dispatchTiming.startedAt).toISOString()} (next=${new Date(dispatchTiming.nextAllowedAt).toISOString()})`
      );

      const batchResult: BatchTranslationResult = useGeminiWebQueue
        ? await translateBatchGeminiWebQueue(batch, targetLanguage, promptTemplate, projectId, sourcePath, geminiWebQueueContext!)
        : useImpit
          ? await translateBatchImpit(batch, targetLanguage, promptTemplate)
          : await translateBatch(batch, model as GeminiModel, targetLanguage, promptTemplate, assignedKey);

      lastResult = batchResult;
      lastDispatchTiming = dispatchTiming;
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

      const retryable = shouldRetryBatch(batchResult, normalizedTexts, batch.texts.length);
      if (!retryable || attempt >= totalAttempts) {
        break;
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
      isFullSuccess ? undefined : (lastResult?.error || 'BATCH_TRANSLATION_FAILED')
    );

    batchReports.push(report);

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
    if (progressCallback) {
      const reportMissingGlobalRanges = formatIndexRanges(report.missingGlobalLineIndexes);
      const completionMessage = report.status === 'success'
        ? `Batch #${report.batchIndex} hoàn tất ${report.translatedLines}/${report.expectedLines} dòng, đã lưu partial. (${completedBatches}/${batches.length}) [${methodLabel}] [token:${progressTokenLabel}]`
        : `Batch #${report.batchIndex} còn thiếu ${report.missingGlobalLineIndexes.length}/${report.expectedLines} dòng (global: ${reportMissingGlobalRanges}), đã lưu partial. (${completedBatches}/${batches.length}) [${methodLabel}] [token:${progressTokenLabel}]`;
      progressCallback({
        current: Math.min(processedLines, entries.length),
        total: entries.length,
        batchIndex: report.batchIndex - 1,
        totalBatches: batches.length,
        status: report.status === 'success' ? 'translating' : 'error',
        message: completionMessage,
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
  };

  // Chạy theo từng nhóm MAX_CONCURRENT batch
  const manager = getApiManager();
  if (useGeminiWebQueue) {
    const dispatchPromises = batches.map((batch, index) =>
      processBatch(batch, index).catch((error) => {
        registerUnexpectedBatchFailure(batch, error);
      })
    );
    await Promise.all(dispatchPromises);
  } else {
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
      const chunk = batches.slice(i, i + MAX_CONCURRENT);

      // Pre-assign 1 key riêng biệt cho mỗi batch trong chunk (chỉ áp dụng cho API, không phải impit)
      const assignedKeys: Array<{ apiKey: string; keyInfo: KeyInfo } | undefined> = [];
      if (!useImpit) {
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
          new Promise<void>((resolve) =>
            setTimeout(() => {
              processBatch(batch, i + offset, assignedKeys[offset])
                .catch((error) => {
                  registerUnexpectedBatchFailure(batch, error);
                })
                .finally(resolve);
            }, offset * 300)
          )
        )
      );
    }
  }

  // Merge kết quả vào entries
  const resultEntries = mergeTranslatedTexts(entries, allTranslatedTexts);

  // Report completion
  if (progressCallback) {
    const summaryTransport: TranslationTransport = useGeminiWebQueue ? 'gemini_webapi_queue' : (useImpit ? 'impit' : 'api');
    const summaryPacingMetadata = mergePacingMetadata(lastDispatchTiming);
    progressCallback({
      current: entries.length,
      total: entries.length,
      batchIndex: Math.max(0, batches.length - 1),
      totalBatches: batches.length,
      status: 'completed',
      message: `Hoàn thành: ${translatedCount}/${entries.length} dòng`,
      eventType: 'summary',
      transport: summaryTransport,
      queueRuntimeKey: useGeminiWebQueue ? CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY : undefined,
      ...summaryPacingMetadata,
    });
  }

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
