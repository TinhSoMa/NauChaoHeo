/**
 * Text Splitter - Chia text thành các batch để dịch
 * Giúp tránh rate limit và tối ưu hiệu suất
 */

import { SubtitleEntry, SplitOptions, SplitResult } from '../../../shared/types/caption';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Một batch text để dịch
 */
export interface TextBatch {
  batchIndex: number;
  startIndex: number;
  endIndex: number;
  entries: SubtitleEntry[];
  texts: string[];
}

/**
 * Chia entries thành các batch nhỏ hơn
 * @param entries - Danh sách SubtitleEntry
 * @param linesPerBatch - Số dòng mỗi batch (mặc định 50)
 */
export function splitForTranslation(
  entries: SubtitleEntry[],
  linesPerBatch: number = 50
): TextBatch[] {
  console.log(`[TextSplitter] Chia ${entries.length} entries thành batches (${linesPerBatch} dòng/batch)`);
  
  const batches: TextBatch[] = [];
  const totalBatches = Math.ceil(entries.length / linesPerBatch);
  
  for (let i = 0; i < totalBatches; i++) {
    const startIndex = i * linesPerBatch;
    const endIndex = Math.min(startIndex + linesPerBatch, entries.length);
    const batchEntries = entries.slice(startIndex, endIndex);
    
    batches.push({
      batchIndex: i,
      startIndex,
      endIndex,
      entries: batchEntries,
      texts: batchEntries.map(e => e.text),
    });
  }
  
  console.log(`[TextSplitter] Đã chia thành ${batches.length} batches`);
  return batches;
}

/**
 * Merge kết quả dịch vào entries gốc
 * @param entries - Entries gốc
 * @param translatedTexts - Danh sách text đã dịch (cùng thứ tự với entries)
 */
export function mergeTranslatedTexts(
  entries: SubtitleEntry[],
  translatedTexts: string[]
): SubtitleEntry[] {
  console.log(`[TextSplitter] Merge ${translatedTexts.length} translated texts`);
  
  return entries.map((entry, index) => ({
    ...entry,
    // Giữ undefined nếu không có bản dịch, tránh mask lỗi bằng text gốc
    translatedText: translatedTexts[index] || entry.translatedText || undefined,
  }));
}

export type TranslationResponseFormat = 'json' | 'numbered' | 'pipe';

export interface TranslationPromptResult {
  prompt: string;
  responseFormat: TranslationResponseFormat;
}

/**
 * Tạo prompt template cho việc dịch batch.
 * Nếu customTemplate được cung cấp, thay thế các biến:
 *   {{COUNT}}     → số dòng trong batch
 *   {{TEXT}}      → nội dung các dòng (thuần văn bản, mỗi dòng một câu)
 *   {{FILE_NAME}} → 'subtitle'
 * Step 3 đã chuyển sang JSON-only: luôn yêu cầu model trả về JSON hợp lệ.
 */
export function createTranslationPrompt(
  texts: string[],
  targetLanguage: string = 'Vietnamese',
  customTemplate?: string
): TranslationPromptResult {
  const count = texts.length;

  if (customTemplate) {
    // --- Custom prompt: thay thế biến, KHÔNG kết hợp với default ---
    // Nếu template có "{{TEXT}}" (có dấu nháy bao quanh) → thay bằng JSON array
    // Nếu template có {{TEXT}} (không dấu nháy) → thay bằng plain text
    const arrayText = JSON.stringify(texts);
    const rawText = texts.join('\n');
    const prompt = customTemplate
      .replace(/"\{\{TEXT\}\}"/g, arrayText)   // "{{TEXT}}" → ["line1","line2",...]
      .replace(/\{\{TEXT\}\}/g, rawText)          // {{TEXT}} → plain fallback
      .replace(/\{\{COUNT\}\}/g, String(count))
      .replace(/\{\{FILE_NAME\}\}/g, 'subtitle');

    console.log('[TextSplitter] Sử dụng custom prompt, format: json');
    return { prompt, responseFormat: 'json' };
  }

  // --- Default prompt: JSON-only, mỗi câu tương ứng 1 object ---
  const sourcePayload = texts.map((text, i) => ({ index: i + 1, text }));
  const prompt = `Dịch ${count} dòng subtitle sau sang tiếng ${targetLanguage}.
YÊU CẦU BẮT BUỘC:
1. CHỈ trả về JSON thuần túy, không markdown, không text thừa.
2. JSON success schema:
{
  "status": "success",
  "data": {
    "translations": [
      { "index": 1, "translated": "..." }
    ],
    "summary": {
      "total_sentences": ${count},
      "input_count": ${count},
      "output_count": ${count},
      "match": true,
      "language_style": "casual"
    }
  }
}
3. translations phải có CHÍNH XÁC ${count} object, index từ 1..${count}, không thiếu, không trùng.
4. Mỗi câu input tương ứng đúng 1 câu translated, không gộp/không tách câu.
5. Nếu không thể xử lý, trả JSON error:
{
  "status": "error",
  "error": {
    "code": "ERROR_PROCESSING_FAILED",
    "message": "..."
  }
}

Nguồn:
${JSON.stringify(sourcePayload)}`;

  console.log('[TextSplitter] Sử dụng default prompt, format: json');
  return { prompt, responseFormat: 'json' };
}

export interface JsonTranslationParseResult {
  ok: boolean;
  translatedTexts: string[];
  errorCode?: string;
  errorMessage?: string;
}

function parseCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value >= 0 ? value : null;
}

function failJsonParse(
  translatedTexts: string[],
  errorCode: string,
  errorMessage: string
): JsonTranslationParseResult {
  return {
    ok: false,
    translatedTexts,
    errorCode,
    errorMessage,
  };
}

/**
 * Parse response JSON schema cho Step 3 (JSON-only).
 */
export function parseJsonTranslationResponse(
  response: string,
  expectedCount: number
): JsonTranslationParseResult {
  const safeExpectedCount = Math.max(0, Math.floor(expectedCount));
  const translatedTexts = new Array<string>(safeExpectedCount).fill('');
  const raw = typeof response === 'string' ? response.trim() : '';

  console.log(`[TextSplitter] Parse JSON response, expected ${safeExpectedCount} lines`);

  if (!raw) {
    return failJsonParse(translatedTexts, 'JSON_PARSE_FAILED', 'Response rỗng');
  }
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    return failJsonParse(
      translatedTexts,
      'JSON_PARSE_FAILED',
      'Response không phải JSON thuần túy (có text thừa ngoài JSON)'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return failJsonParse(
      translatedTexts,
      'JSON_PARSE_FAILED',
      `JSON.parse thất bại: ${String(error)}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: root phải là object');
  }

  const root = parsed as Record<string, unknown>;
  const status = typeof root.status === 'string' ? root.status.trim() : '';

  if (status === 'error') {
    const errorNode =
      root.error && typeof root.error === 'object' && !Array.isArray(root.error)
        ? (root.error as Record<string, unknown>)
        : {};
    const upstreamCode = typeof errorNode.code === 'string' ? errorNode.code.trim() : '';
    const upstreamMessage = typeof errorNode.message === 'string' ? errorNode.message.trim() : '';
    return failJsonParse(
      translatedTexts,
      upstreamCode || 'ERROR_PROCESSING_FAILED',
      upstreamMessage || 'Model trả về status=error'
    );
  }

  if (status !== 'success') {
    return failJsonParse(
      translatedTexts,
      'ERROR_INVALID_INPUT',
      'Schema không hợp lệ: status phải là "success" hoặc "error"'
    );
  }

  const dataNode =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;
  if (!dataNode) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data object');
  }

  const translations = Array.isArray(dataNode.translations) ? dataNode.translations : null;
  if (!translations) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data.translations[]');
  }

  const seenIndexes = new Set<number>();

  for (const item of translations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: item translations phải là object');
    }
    const typed = item as Record<string, unknown>;
    const parsedIndex = parseCount(typed.index);
    if (parsedIndex === null || parsedIndex <= 0) {
      return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: index phải là số nguyên >= 1');
    }
    if (parsedIndex > safeExpectedCount) {
      return failJsonParse(
        translatedTexts,
        'ERROR_COUNT_MISMATCH',
        `Index ngoài phạm vi: ${parsedIndex} > ${safeExpectedCount}`
      );
    }
    if (seenIndexes.has(parsedIndex)) {
      return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', `Trùng index trong translations: ${parsedIndex}`);
    }
    if (typeof typed.translated !== 'string') {
      return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', `Schema không hợp lệ tại index ${parsedIndex}: thiếu translated string`);
    }

    seenIndexes.add(parsedIndex);
    translatedTexts[parsedIndex - 1] = typed.translated.trim();
  }

  if (seenIndexes.size !== safeExpectedCount) {
    return failJsonParse(
      translatedTexts,
      'ERROR_COUNT_MISMATCH',
      `Số dòng dịch không khớp: nhận ${seenIndexes.size}/${safeExpectedCount}`
    );
  }

  const summaryNode =
    dataNode.summary && typeof dataNode.summary === 'object' && !Array.isArray(dataNode.summary)
      ? (dataNode.summary as Record<string, unknown>)
      : null;
  if (!summaryNode) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data.summary object');
  }

  const totalSentences = parseCount(summaryNode.total_sentences);
  const inputCount = parseCount(summaryNode.input_count);
  const outputCount = parseCount(summaryNode.output_count);
  const match = summaryNode.match;
  const languageStyle = summaryNode.language_style;

  if (
    totalSentences !== safeExpectedCount ||
    inputCount !== safeExpectedCount ||
    outputCount !== safeExpectedCount ||
    match !== true
  ) {
    return failJsonParse(
      translatedTexts,
      'ERROR_COUNT_MISMATCH',
      `Summary mismatch: total=${String(totalSentences)}, input=${String(inputCount)}, output=${String(outputCount)}, match=${String(match)}`
    );
  }

  if (typeof languageStyle !== 'string' || !languageStyle.trim()) {
    return failJsonParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: summary.language_style phải là string');
  }

  console.log(`[TextSplitter] [JSON] Parse được ${translatedTexts.filter((r) => r).length}/${safeExpectedCount} dòng`);
  return {
    ok: true,
    translatedTexts,
  };
}

/**
 * Parse kết quả dịch dạng pipe: |Câu1|Câu2|...|CâuN|
 */
export function parsePipeResponse(
  response: string,
  expectedCount: number
): string[] {
  console.log(`[TextSplitter] Parse pipe response, expected ${expectedCount} lines`);

  // Tìm đoạn |...|...|...|  trong response (bỏ qua text thừa trước/sau)
  const pipeMatch = response.match(/\|[^]*/);
  const raw = pipeMatch ? pipeMatch[0] : response;

  // Tách theo '|', bỏ phần tử rỗng (do dòng bắt đầu/kết thúc bằng |)
  const parts = raw.split('|').map(s => s.trim());

  // Lọc phần tử rỗng ở 2 đầu (do dòng bắt đầu/kết thúc bằng |)
  const results: string[] = [];
  for (const part of parts) {
    if (results.length >= expectedCount) break;
    if (part !== '') {
      results.push(part);
    }
  }

  // Điền các dòng thiếu bằng chuỗi rỗng
  for (let i = results.length; i < expectedCount; i++) {
    results.push('');
    console.warn(`[TextSplitter] [Pipe] Thiếu dịch cho dòng ${i + 1}`);
  }

  console.log(`[TextSplitter] [Pipe] Parse được ${results.filter(r => r).length}/${expectedCount} dòng`);
  return results;
}

/**
 * Parse kết quả dịch từ response của Gemini
 * Format expected: [1] Text dịch 1\n[2] Text dịch 2\n...
 */
export function parseTranslationResponse(
  response: string,
  expectedCount: number
): string[] {
  console.log(`[TextSplitter] Parse translation response, expected ${expectedCount} lines`);
  
  const results: string[] = [];
  const lines = response.trim().split('\n');
  
  // Pattern: [1] Text hoặc 1. Text hoặc 1) Text
  const linePattern = /^\[?(\d+)\]?[.):]?\s*(.+)$/;
  
  for (const line of lines) {
    const match = line.trim().match(linePattern);
    if (match) {
      const index = parseInt(match[1], 10) - 1; // 0-indexed
      const text = match[2].trim();
      
      if (index >= 0 && index < expectedCount) {
        results[index] = text;
      }
    }
  }
  
  // Điền các dòng thiếu bằng chuỗi rỗng
  for (let i = 0; i < expectedCount; i++) {
    if (!results[i]) {
      results[i] = '';
      console.warn(`[TextSplitter] Thiếu dịch cho dòng ${i + 1}`);
    }
  }
  
  console.log(`[TextSplitter] Parse được ${results.filter(r => r).length}/${expectedCount} dòng`);
  return results;
}

/**
 * Chia entries thành nhiều file text
 * @param options - SplitOptions
 */
export async function splitText(options: SplitOptions): Promise<SplitResult> {
  const { entries, splitByLines, value, outputDir } = options;
  console.log(`[TextSplitter] Split text: ${entries.length} entries, splitByLines=${splitByLines}, value=${value}`);

  try {
    // Tạo thư mục output nếu chưa tồn tại
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const files: string[] = [];
    let batches: SubtitleEntry[][];

    if (splitByLines) {
      // Chia theo số dòng mỗi file
      batches = [];
      for (let i = 0; i < entries.length; i += value) {
        batches.push(entries.slice(i, i + value));
      }
    } else {
      // Chia đều thành N phần
      const partsCount = Math.max(1, Math.min(value, entries.length));
      const entriesPerPart = Math.ceil(entries.length / partsCount);
      batches = [];
      for (let i = 0; i < partsCount; i++) {
        const start = i * entriesPerPart;
        const end = Math.min(start + entriesPerPart, entries.length);
        if (start < entries.length) {
          batches.push(entries.slice(start, end));
        }
      }
    }

    // Ghi từng batch vào file
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const fileName = `part_${String(i + 1).padStart(3, '0')}.txt`;
      const filePath = path.join(outputDir, fileName);
      
      // Nội dung file: mỗi dòng là text của một entry
      const content = batch.map(entry => entry.text).join('\n');
      fs.writeFileSync(filePath, content, 'utf-8');
      
      files.push(filePath);
      console.log(`[TextSplitter] Đã ghi file: ${filePath} (${batch.length} dòng)`);
    }

    console.log(`[TextSplitter] Đã chia thành ${files.length} files`);
    return {
      success: true,
      partsCount: files.length,
      files,
    };
  } catch (error) {
    console.error('[TextSplitter] Lỗi split text:', error);
    return {
      success: false,
      partsCount: 0,
      files: [],
      error: String(error),
    };
  }
}
