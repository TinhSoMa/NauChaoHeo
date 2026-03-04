/**
 * Caption Translator - Dịch caption sử dụng Gemini API
 * Xử lý dịch batch với retry và progress callback
 */

import {
  SubtitleEntry,
  TranslationOptions,
  TranslationResult,
  TranslationProgress,
  TranslationBatchReport,
} from '../../../shared/types/caption';
import { callGeminiWithRotation, callGeminiWithAssignedKey, GEMINI_MODELS, type GeminiModel } from '../gemini';
import { type KeyInfo } from '../../../shared/types/gemini';
import { getApiManager } from '../gemini/apiManager';
import { callGeminiImpitAutoSelect } from '../shared';
import {
  splitForTranslation,
  mergeTranslatedTexts,
  createTranslationPrompt,
  parseTranslationResponse,
  parsePipeResponse,
  TextBatch,
} from './textSplitter';

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

/**
 * Dịch một batch text
 */
async function translateBatch(
  batch: TextBatch,
  model: GeminiModel,
  targetLanguage: string,
  promptTemplate?: string,
  assignedKey?: { apiKey: string; keyInfo: KeyInfo }
): Promise<{ success: boolean; translatedTexts: string[]; error?: string }> {
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
      return { success: false, translatedTexts, error: `Thiếu ${batch.texts.length - validCount} dòng` };
    }

    return { success: true, translatedTexts };
  } catch (error) {
    console.error(`[CaptionTranslator] Lỗi dịch batch ${batch.batchIndex + 1}:`, error);
    return {
      success: false,
      translatedTexts: [],
      error: String(error),
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
): Promise<{ success: boolean; translatedTexts: string[]; error?: string }> {
  console.log(`[CaptionTranslator] [Impit] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);

  const { prompt, responseFormat } = createTranslationPrompt(batch.texts, targetLanguage, promptTemplate);

  try {
    const result = await callGeminiImpitAutoSelect(prompt);

    if (!result.success || !result.text) {
      return {
        success: false,
        translatedTexts: [],
        error: result.error || 'Không có response từ impit',
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
      return { success: false, translatedTexts, error: `Thiếu ${batch.texts.length - validCount} dòng` };
    }

    return { success: true, translatedTexts };
  } catch (error) {
    console.error(`[CaptionTranslator] [Impit] Lỗi dịch batch ${batch.batchIndex + 1}:`, error);
    return {
      success: false,
      translatedTexts: [],
      error: String(error),
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
  const MAX_CONCURRENT = useImpit ? 3 : 5;

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
    const methodLabel = useImpit ? 'impit' : 'api';
    let progressTokenLabel = useImpit ? 'impit_cookie' : (assignedKey?.keyInfo.name || 'rotation');
    // Report progress khi bắt đầu batch
    if (progressCallback) {
      progressCallback({
        current: batch.startIndex,
        total: entries.length,
        batchIndex: i,
        totalBatches: batches.length,
        status: 'translating',
        message: `Đang dịch batch ${i + 1}/${batches.length} [${methodLabel}] [token:${progressTokenLabel}] (${MAX_CONCURRENT} song song)...`,
        eventType: 'batch_started',
      });
    }

    // Dịch batch với retry — yêu cầu 100%, không chấp nhận thiếu dòng
    const maxAttempts = 3; // 1 lần đầu + 2 retry
    let attemptCount = 0;
    let batchResult = useImpit
      ? await translateBatchImpit(batch, targetLanguage, promptTemplate)
      : await translateBatch(batch, model as GeminiModel, targetLanguage, promptTemplate, assignedKey);
    attemptCount++;

    while (!batchResult.success && attemptCount < maxAttempts) {
      attemptCount++;
      const missingCount = batch.texts.length - (batchResult.translatedTexts?.filter(t => t.trim()).length ?? 0);
      console.log(`[CaptionTranslator] Retry ${attemptCount - 1}/${maxAttempts - 1} cho batch ${i + 1} (thiếu ${missingCount} dòng)`);
      progressTokenLabel = useImpit ? 'impit_cookie' : 'rotation';
      if (progressCallback) {
        progressCallback({
          current: batch.startIndex,
          total: entries.length,
          batchIndex: i,
          totalBatches: batches.length,
          status: 'translating',
          message: `Batch ${i + 1}: Thiếu ${missingCount} dòng — đang thử lại lần ${attemptCount - 1}/${maxAttempts - 1} [${methodLabel}] [token:${progressTokenLabel}]...`,
          eventType: 'batch_retry',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // Retry không cần key cố định — để rotation tự chọn key khác
      batchResult = useImpit
        ? await translateBatchImpit(batch, targetLanguage, promptTemplate)
        : await translateBatch(batch, model as GeminiModel, targetLanguage, promptTemplate);
    }

    const normalizedTexts = Array.from({ length: batch.texts.length }, (_, idx) => batchResult.translatedTexts?.[idx] ?? '');
    const isFullSuccess = !!batchResult.success;
    const report = buildBatchReport(
      batch,
      normalizedTexts,
      attemptCount,
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
      const errorMsg = `Batch #${report.batchIndex} (dòng ${report.startIndex + 1}-${report.endIndex + 1}) thiếu ${report.missingGlobalLineIndexes.length}/${report.expectedLines} dòng sau ${maxAttempts} lần thử (global: ${globalMissing})`;
      console.error(`[CaptionTranslator] ${errorMsg}`);
      errors.push(errorMsg);
    }

    completedBatches++;
    processedLines += batch.texts.length;
    if (progressCallback) {
      progressCallback({
        current: Math.min(processedLines, entries.length),
        total: entries.length,
        batchIndex: completedBatches,
        totalBatches: batches.length,
        status: report.status === 'success' ? 'translating' : 'error',
        message: `Hoàn thành ${completedBatches}/${batches.length} batch [${methodLabel}] [token:${progressTokenLabel}]...`,
        eventType: report.status === 'success' ? 'batch_completed' : 'batch_failed',
        batchReport: report,
        translatedChunk: {
          startIndex: batch.startIndex,
          texts: normalizedTexts,
        },
      });
    }
  };

  // Chạy theo từng nhóm MAX_CONCURRENT batch
  const manager = getApiManager();
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

  // Merge kết quả vào entries
  const resultEntries = mergeTranslatedTexts(entries, allTranslatedTexts);

  // Report completion
  if (progressCallback) {
    progressCallback({
      current: entries.length,
      total: entries.length,
      batchIndex: batches.length,
      totalBatches: batches.length,
      status: 'completed',
      message: `Hoàn thành: ${translatedCount}/${entries.length} dòng`,
      eventType: 'summary',
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
