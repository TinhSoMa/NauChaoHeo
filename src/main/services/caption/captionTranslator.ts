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
    model = GEMINI_MODELS.FLASH_3_0,
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
  let completedBatches = 0;

  const MAX_CONCURRENT = 5;

  // Dịch song song tối đa MAX_CONCURRENT batch cùng lúc
  const processBatch = async (batch: TextBatch, i: number): Promise<void> => {
    // Report progress khi bắt đầu batch
    if (progressCallback) {
      progressCallback({
        current: batch.startIndex,
        total: entries.length,
        batchIndex: i,
        totalBatches: batches.length,
        status: 'translating',
        message: `Đang dịch batch ${i + 1}/${batches.length} (${MAX_CONCURRENT} song song)...`,
      });
    }

    // Dịch batch với retry
    let retryCount = 0;
    const maxRetries = 2;
    let batchResult = await translateBatch(batch, model as GeminiModel, targetLanguage);

    while (!batchResult.success && retryCount < maxRetries) {
      retryCount++;
      console.log(`[CaptionTranslator] Retry ${retryCount}/${maxRetries} cho batch ${i + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      batchResult = await translateBatch(batch, model as GeminiModel, targetLanguage);
    }

    // Xử lý kết quả (ghi vào mảng chung — mỗi batch dùng vị trí riêng, không conflict)
    if (batchResult.success) {
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
      errors.push(`Batch ${i + 1}: ${batchResult.error}`);
      failedCount += batch.texts.length;
    }

    completedBatches++;
    if (progressCallback) {
      progressCallback({
        current: completedBatches * (linesPerBatch || 50),
        total: entries.length,
        batchIndex: completedBatches,
        totalBatches: batches.length,
        status: 'translating',
        message: `Hoàn thành ${completedBatches}/${batches.length} batch...`,
      });
    }
  };

  // Chạy theo từng nhóm MAX_CONCURRENT batch
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const chunk = batches.slice(i, i + MAX_CONCURRENT);
    // Stagger start: mỗi batch trong chunk delay 300ms để tránh burst cùng lúc
    await Promise.all(
      chunk.map((batch, offset) =>
        new Promise<void>((resolve) =>
          setTimeout(() => processBatch(batch, i + offset).then(resolve), offset * 300)
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
