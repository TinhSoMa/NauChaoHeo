/**
 * Caption Translator - Dịch caption sử dụng Gemini API
 * Xử lý dịch batch với retry và progress callback
 */

import {
  SubtitleEntry,
  TranslationOptions,
  TranslationResult,
  TranslationProgress,
} from '../../../shared/types/caption';
import { callGeminiWithRotation, GEMINI_MODELS, type GeminiModel } from '../gemini';
import {
  splitForTranslation,
  mergeTranslatedTexts,
  createTranslationPrompt,
  parseTranslationResponse,
  TextBatch,
} from './textSplitter';

/**
 * Dịch một batch text
 */
async function translateBatch(
  batch: TextBatch,
  model: GeminiModel,
  targetLanguage: string
): Promise<{ success: boolean; translatedTexts: string[]; error?: string }> {
  console.log(`[CaptionTranslator] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);

  const prompt = createTranslationPrompt(batch.texts, targetLanguage);

  try {
    const response = await callGeminiWithRotation(prompt, model);

    if (!response.success || !response.data) {
      return {
        success: false,
        translatedTexts: [],
        error: response.error || 'Không có response',
      };
    }

    const translatedTexts = parseTranslationResponse(response.data, batch.texts.length);

    // Kiểm tra xem có đủ dịch không
    const validCount = translatedTexts.filter((t) => t.trim()).length;
    if (validCount < batch.texts.length * 0.8) {
      console.warn(
        `[CaptionTranslator] Batch ${batch.batchIndex + 1}: Chỉ dịch được ${validCount}/${batch.texts.length}`
      );
    }

    return {
      success: true,
      translatedTexts,
    };
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
 * Dịch tất cả entries với progress callback
 */
export async function translateAll(
  options: TranslationOptions,
  progressCallback?: (progress: TranslationProgress) => void
): Promise<TranslationResult> {
  const {
    entries,
    targetLanguage = 'Vietnamese',
    model = GEMINI_MODELS.FLASH_2_5,
    linesPerBatch = 50,
  } = options;

  console.log(`[CaptionTranslator] Bắt đầu dịch ${entries.length} entries`);
  console.log(`[CaptionTranslator] Model: ${model}, Target: ${targetLanguage}`);

  // Chia thành batches
  const batches = splitForTranslation(entries, linesPerBatch);
  const allTranslatedTexts: string[] = new Array(entries.length).fill('');
  const errors: string[] = [];

  let translatedCount = 0;
  let failedCount = 0;

  // Dịch từng batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    // Report progress
    if (progressCallback) {
      progressCallback({
        current: batch.startIndex,
        total: entries.length,
        batchIndex: i,
        totalBatches: batches.length,
        status: 'translating',
        message: `Đang dịch batch ${i + 1}/${batches.length}...`,
      });
    }

    // Dịch batch với retry
    let retryCount = 0;
    const maxRetries = 2;
    let batchResult = await translateBatch(batch, model as GeminiModel, targetLanguage);

    while (!batchResult.success && retryCount < maxRetries) {
      retryCount++;
      console.log(`[CaptionTranslator] Retry ${retryCount}/${maxRetries} cho batch ${i + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Đợi 2s trước khi retry
      batchResult = await translateBatch(batch, model as GeminiModel, targetLanguage);
    }

    // Xử lý kết quả
    if (batchResult.success) {
      // Copy translated texts vào đúng vị trí
      for (let j = 0; j < batchResult.translatedTexts.length; j++) {
        const globalIndex = batch.startIndex + j;
        allTranslatedTexts[globalIndex] = batchResult.translatedTexts[j];
        if (batchResult.translatedTexts[j].trim()) {
          translatedCount++;
        } else {
          failedCount++;
        }
      }
    } else {
      // Batch thất bại
      errors.push(`Batch ${i + 1}: ${batchResult.error}`);
      failedCount += batch.texts.length;
    }

    // Delay giữa các batch để tránh rate limit
    if (i < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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
    });
  }

  console.log(
    `[CaptionTranslator] Hoàn thành: ${translatedCount} dịch, ${failedCount} lỗi`
  );

  return {
    success: failedCount === 0,
    entries: resultEntries,
    totalLines: entries.length,
    translatedLines: translatedCount,
    failedLines: failedCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Dịch nhanh một đoạn text đơn lẻ (không batch)
 */
export async function translateSingleText(
  text: string,
  targetLanguage: string = 'Vietnamese',
  model: GeminiModel = GEMINI_MODELS.FLASH_2_5
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
