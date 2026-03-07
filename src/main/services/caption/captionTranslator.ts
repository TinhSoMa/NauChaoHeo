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
  CAPTION_STEP3_QUEUE_GAP_MS,
  type CaptionGeminiWebQueueRuntimeContext,
  ensureCaptionGeminiWebQueueRuntime,
} from './captionGeminiWebQueueRuntime';
import {
  getConversation as getCaptionGeminiConversation,
  upsertConversation as upsertCaptionGeminiConversation,
} from './captionGeminiConversationStore';
import {
  splitForTranslation,
  mergeTranslatedTexts,
  createTranslationPrompt,
  parseTranslationResponse,
  parsePipeResponse,
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

  const { prompt, responseFormat } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate);

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

    const translatedTexts = responseFormat === 'pipe'
      ? parsePipeResponse(response.data, batch.texts.length)
      : parseTranslationResponse(response.data, batch.texts.length);

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

  const { prompt, responseFormat } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate);

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

    const translatedTexts = responseFormat === 'pipe'
      ? parsePipeResponse(result.text, batch.texts.length)
      : parseTranslationResponse(result.text, batch.texts.length);

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
  const { prompt, responseFormat } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate);
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
        console.log(
          `[CaptionTranslator] [GeminiWebQueue] Batch ${batch.batchIndex + 1} cookie-sync accountConfigId=${accountConfigId} (${resourceLabel})`
        );
        const conversationMetadata = getCaptionGeminiConversation({
          projectId,
          sourcePath,
          accountConfigId,
        });
        const response = await getGeminiWebApiRuntime().generateContent({
          prompt: ctx.payload.prompt,
          timeoutMs: 120_000,
          accountConfigId,
          useChatSession: true,
          conversationMetadata,
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

        upsertCaptionGeminiConversation(
          {
            projectId,
            sourcePath,
            accountConfigId,
          },
          response.conversationMetadata || null
        );

        return {
          text: response.text || '',
          accountConfigId,
          resourceLabel,
        };
      },
    });
    const queueTiming = buildQueueTimingFromResult(queued, CAPTION_STEP3_QUEUE_GAP_MS);

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
    const translatedTexts = responseFormat === 'pipe'
      ? parsePipeResponse(responseText, batch.texts.length)
      : parseTranslationResponse(responseText, batch.texts.length);

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
  const batches = splitForTranslation(entries, linesPerBatch);
  const allTranslatedTexts: string[] = new Array(entries.length).fill('');
  const errors: string[] = [];
  const batchReports: TranslationBatchReport[] = [];

  let translatedCount = 0;
  let failedCount = 0;
  let completedBatches = 0;
  let processedLines = 0;

  const useImpit = options.translateMethod === 'impit';
  const useGeminiWebQueue = options.translateMethod === 'gemini_webapi_queue';
  const projectId = (options.projectId || '').trim() || '__default_project__';
  const sourcePath = (options.sourcePath || '').trim() || '__unknown_source__';
  const MAX_CONCURRENT = useImpit ? 3 : 5;
  const queueGapMs = CAPTION_STEP3_QUEUE_GAP_MS;
  let lastDispatchTiming: TranslationQueuePacingMetadata | undefined;
  let nextDispatchAtMs = Date.now();
  let dispatchGateQueue: Promise<void> = Promise.resolve();
  let geminiWebQueueContext: CaptionGeminiWebQueueRuntimeContext | null = null;

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

  if (useGeminiWebQueue) {
    geminiWebQueueContext = ensureCaptionGeminiWebQueueRuntime();
    const { queue } = geminiWebQueueContext;
    const snapshot = queue.getSnapshot();
    const enabledResources = snapshot.resources.filter(
      (resource) => resource.poolId === CAPTION_GEMINI_WEB_QUEUE_POOL_ID && resource.enabled
    );
    if (enabledResources.length === 0) {
      const errorMessage = 'Không có account Gemini Web hợp lệ (is_active + __Secure-1PSID + __Secure-1PSIDTS).';
      return {
        success: false,
        entries,
        totalLines: entries.length,
        translatedLines: 0,
        failedLines: entries.length,
        errors: [errorMessage],
        batchReports: [],
        missingBatchIndexes: batches.map((batch) => batch.batchIndex + 1),
        missingGlobalLineIndexes: Array.from({ length: entries.length }, (_, index) => index + 1),
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

  // Dịch song song tối đa MAX_CONCURRENT batch cùng lúc
  const processBatch = async (batch: TextBatch, i: number, assignedKey?: { apiKey: string; keyInfo: KeyInfo }): Promise<void> => {
    const methodLabel: TranslationTransport = useGeminiWebQueue ? 'gemini_webapi_queue' : (useImpit ? 'impit' : 'api');
    const defaultTokenLabel = useGeminiWebQueue ? 'queue_rr' : (useImpit ? 'impit_cookie' : (assignedKey?.keyInfo.name || 'rotation'));
    const dispatchModeLabel = useGeminiWebQueue
      ? 'dispatch mỗi 10s, không chờ batch trước'
      : `${MAX_CONCURRENT} song song, pacing 10s`;
    let progressTokenLabel = defaultTokenLabel;

    // Report progress khi batch đã vào hàng đợi pacing
    if (progressCallback) {
      progressCallback({
        current: batch.startIndex,
        total: entries.length,
        batchIndex: i,
        totalBatches: batches.length,
        status: 'translating',
        message: `Batch ${i + 1}/${batches.length} đang chờ dispatch 10s [${methodLabel}] [token:${progressTokenLabel}]...`,
        eventType: 'batch_started',
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
        message: `Đang dịch batch ${i + 1}/${batches.length} [${methodLabel}] [token:${progressTokenLabel}] (${dispatchModeLabel})...`,
        eventType: 'batch_started',
        transport: methodLabel,
        ...dispatchTiming,
      });
    }

    console.log(
      `[CaptionTranslator] Dispatch batch #${i + 1}/${batches.length} at ${new Date(dispatchTiming.startedAt).toISOString()} (next=${new Date(dispatchTiming.nextAllowedAt).toISOString()})`
    );

    // Dịch batch 1 lần; retry do queue/transport tự quản lý
    let batchResult: BatchTranslationResult = useGeminiWebQueue
      ? await translateBatchGeminiWebQueue(batch, targetLanguage, promptTemplate, projectId, sourcePath, geminiWebQueueContext!)
      : useImpit
        ? await translateBatchImpit(batch, targetLanguage, promptTemplate)
        : await translateBatch(batch, model as GeminiModel, targetLanguage, promptTemplate, assignedKey);
    const pacingMetadata = mergePacingMetadata(batchResult, dispatchTiming);

    const normalizedTexts = Array.from({ length: batch.texts.length }, (_, idx) => batchResult.translatedTexts?.[idx] ?? '');
    const isFullSuccess = !!batchResult.success;
    if (batchResult.resourceLabel || batchResult.resourceId) {
      progressTokenLabel = batchResult.resourceLabel || batchResult.resourceId || progressTokenLabel;
    }
    const report = buildBatchReport(
      batch,
      normalizedTexts,
      1,
      isFullSuccess ? 'success' : 'failed',
      isFullSuccess ? undefined : (batchResult.error || 'BATCH_TRANSLATION_FAILED')
    );

    batchReports.push(report);

    // Luôn giữ partial đã dịch được để renderer có thể lưu dần vào session
    for (let j = 0; j < normalizedTexts.length; j++) {
      allTranslatedTexts[batch.startIndex + j] = normalizedTexts[j];
    }

    translatedCount += report.translatedLines;
    failedCount += report.missingGlobalLineIndexes.length;

    if (!isFullSuccess) {
      const globalMissing = formatIndexRanges(report.missingGlobalLineIndexes);
      const errorMsg = `Batch #${report.batchIndex} (dòng ${report.startIndex + 1}-${report.endIndex + 1}) thiếu ${report.missingGlobalLineIndexes.length}/${report.expectedLines} dòng sau 1 lần gửi (global: ${globalMissing})`;
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
          texts: normalizedTexts,
        },
        transport: batchResult.transport || methodLabel,
        resourceId: batchResult.resourceId,
        resourceLabel: batchResult.resourceLabel,
        queueRuntimeKey: batchResult.queueRuntimeKey,
        ...pacingMetadata,
      });
    }
  };

  // Chạy theo từng nhóm MAX_CONCURRENT batch
  const manager = getApiManager();
  if (useGeminiWebQueue) {
    const dispatchPromises = batches.map((batch, index) =>
      processBatch(batch, index).catch((error) => {
        console.error('[CaptionTranslator] Lỗi processBatch không mong muốn:', error);
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
                  console.error('[CaptionTranslator] Lỗi processBatch không mong muốn:', error);
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
      batchIndex: batches.length,
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
