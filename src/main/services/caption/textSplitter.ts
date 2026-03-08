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
    translatedText: translatedTexts[index] || entry.text,
  }));
}

export type TranslationResponseFormat = 'numbered' | 'pipe';

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
 * Nếu template có format pipe (|...|), responseFormat = 'pipe', ngược lại = 'numbered'.
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

    // Phát hiện format output: nếu template yêu cầu pipe format
    const isPipe = /response_format["']?\s*:\s*["']?\|/.test(customTemplate)
      || /"separator"\s*:\s*"\|"/.test(customTemplate)
      || /Format output.*\|/.test(customTemplate);

    console.log(`[TextSplitter] Sử dụng custom prompt, format: ${isPipe ? 'pipe' : 'numbered'}`);
    return { prompt, responseFormat: isPipe ? 'pipe' : 'numbered' };
  }

  // --- Default prompt: format [số] KHÔNG kết hợp với custom ---
  const numberedLines = texts.map((text, i) => `[${i + 1}] ${text}`).join('\n');
  const prompt = `Dịch các dòng subtitle sau sang tiếng ${targetLanguage}.
Quy tắc:
1. Dịch tự nhiên, phù hợp ngữ cảnh
2. Giữ nguyên số thứ tự [1], [2], ...
3. Không thêm giải thích
4. Mỗi dòng dịch tương ứng với dòng gốc

Nội dung cần dịch:
${numberedLines}

Kết quả (chỉ trả về các dòng đã dịch, giữ nguyên format [số]):`;

  console.log(`[TextSplitter] Sử dụng default prompt, format: numbered`);
  return { prompt, responseFormat: 'numbered' };
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
