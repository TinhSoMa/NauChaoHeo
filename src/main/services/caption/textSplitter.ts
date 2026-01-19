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

/**
 * Tạo prompt template cho việc dịch batch
 */
export function createTranslationPrompt(
  texts: string[],
  targetLanguage: string = 'Vietnamese'
): string {
  // Format: mỗi dòng một số, để dễ parse kết quả
  const numberedLines = texts.map((text, i) => `[${i + 1}] ${text}`).join('\n');
  
  return `Dịch các dòng subtitle sau sang tiếng ${targetLanguage}.
Quy tắc:
1. Dịch tự nhiên, phù hợp ngữ cảnh
2. Giữ nguyên số thứ tự [1], [2], ...
3. Không thêm giải thích
4. Mỗi dòng dịch tương ứng với dòng gốc

Nội dung cần dịch:
${numberedLines}

Kết quả (chỉ trả về các dòng đã dịch, giữ nguyên format [số]):`;
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
