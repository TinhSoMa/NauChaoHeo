/**
 * SRT Parser - Parse và export file SRT
 * Xử lý đọc/ghi file subtitle theo chuẩn SRT
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { SubtitleEntry, ParseSrtResult } from '../../../shared/types/caption';

/**
 * Chuyển đổi thời gian SRT (00:00:01,500) sang milliseconds
 */
export function srtTimeToMs(timeStr: string): number {
  // Xử lý cả dấu phẩy và dấu chấm
  const normalized = timeStr.trim().replace('.', ',');
  const [time, ms] = normalized.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  
  return (hours * 3600 + minutes * 60 + seconds) * 1000 + Number(ms);
}

/**
 * Chuyển đổi milliseconds sang format SRT (00:00:01,500)
 */
export function msToSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

/**
 * Parse file SRT và trả về danh sách SubtitleEntry
 */
export async function parseSrtFile(filePath: string): Promise<ParseSrtResult> {
  console.log(`[SrtParser] Đang parse file: ${path.basename(filePath)}`);
  
  try {
    // Kiểm tra file tồn tại
    await fs.access(filePath);
    
    // Đọc nội dung file
    const buffer = await fs.readFile(filePath);
    const content = decodeTextContent(buffer);
    const entries: SubtitleEntry[] = [];
    
    // Tách các block SRT (cách nhau bởi dòng trống)
    const blocks = content.trim().split(/\n\s*\n/);
    
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      
      if (lines.length < 3) continue;
      
      try {
        // Dòng 1: Index
        const index = parseInt(lines[0].trim(), 10);
        if (isNaN(index)) continue;
        
        // Dòng 2: Timestamp (00:00:01,000 --> 00:00:03,500)
        const timeLine = lines[1].trim();
        const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
        
        if (!timeMatch) continue;
        
        const startTime = timeMatch[1].replace('.', ',');
        const endTime = timeMatch[2].replace('.', ',');
        const startMs = srtTimeToMs(startTime);
        const endMs = srtTimeToMs(endTime);
        
        // Dòng 3+: Text (có thể nhiều dòng - giữ nguyên line breaks)
        const text = lines.slice(2).join('\n').trim();
        
        if (text) {
          entries.push({
            index,
            startTime,
            endTime,
            startMs,
            endMs,
            durationMs: endMs - startMs,
            text,
          });
        }
      } catch (err) {
        console.warn(`[SrtParser] Lỗi parse block: ${lines[0]}`);
        continue;
      }
    }
    
    // Sort entries theo startMs để đảm bảo thứ tự đúng
    entries.sort((a, b) => a.startMs - b.startMs);
    
    console.log(`[SrtParser] Parse thành công: ${entries.length} entries`);
    
    return {
      success: true,
      entries,
      totalEntries: entries.length,
      filePath,
    };
    
  } catch (error) {
    const errorMsg = `Lỗi đọc file SRT: ${error}`;
    // ENOENT = file chưa tồn tại (bình thường khi chưa chạy các bước trước) — dùng debug thay vì error
    const isNotFound = String(error).includes('ENOENT');
    if (isNotFound) {
      console.debug(`[SrtParser] File chưa tồn tại (bỏ qua): ${filePath}`);
    } else {
      console.error(`[SrtParser] ${errorMsg}`);
    }
    
    return {
      success: false,
      entries: [],
      totalEntries: 0,
      filePath,
      error: errorMsg,
    };
  }
}

/**
 * Export danh sách SubtitleEntry ra file SRT
 */
export async function exportToSrt(
  entries: SubtitleEntry[],
  outputPath: string,
  useTranslated: boolean = true
): Promise<{ success: boolean; error?: string }> {
  console.log(`[SrtParser] Đang export ${entries.length} entries ra: ${path.basename(outputPath)}`);
  
  try {
    // Đảm bảo thư mục tồn tại
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });
    
    // Tạo nội dung SRT
    const srtContent = entries.map((entry, idx) => {
      const text = useTranslated && entry.translatedText 
        ? entry.translatedText 
        : entry.text;
      
      return `${idx + 1}\n${entry.startTime} --> ${entry.endTime}\n${text}`;
    }).join('\n\n');
    
    // Ghi file
    await fs.writeFile(outputPath, srtContent + '\n', 'utf-8');
    
    console.log(`[SrtParser] Export thành công: ${outputPath}`);
    return { success: true };
    
  } catch (error) {
    const errorMsg = `Lỗi export SRT: ${error}`;
    console.error(`[SrtParser] ${errorMsg}`);
    
    return { success: false, error: errorMsg };
  }
}

function decodeTextContent(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) {
    return '';
  }

  // BOM detection
  if (buffer.length >= 2) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    // UTF-16LE BOM
    if (b0 === 0xff && b1 === 0xfe) {
      return buffer.slice(2).toString('utf16le');
    }
    // UTF-16BE BOM
    if (b0 === 0xfe && b1 === 0xff) {
      const swapped = Buffer.allocUnsafe(buffer.length - 2);
      for (let i = 2; i < buffer.length; i += 2) {
        swapped[i - 2] = buffer[i + 1] || 0;
        swapped[i - 1] = buffer[i] || 0;
      }
      return swapped.toString('utf16le');
    }
  }

  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }

  const text = buffer.toString('utf8');
  return maybeFixMojibake(text);
}

function maybeFixMojibake(text: string): string {
  if (!text) return text;
  const suspect = /Ã|Â|á»/;
  if (!suspect.test(text)) {
    return text;
  }
  const fixed = Buffer.from(text, 'latin1').toString('utf8');
  if (!suspect.test(fixed)) {
    return fixed;
  }
  return text;
}

/**
 * Export text thuần (không timing) ra file
 */
export async function exportPlainText(
  content: string,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[SrtParser] Đang export text thuần ra: ${path.basename(outputPath)}`);

  try {
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    const safeContent = typeof content === 'string' ? content : '';
    await fs.writeFile(outputPath, safeContent.endsWith('\n') ? safeContent : `${safeContent}\n`, 'utf-8');

    console.log(`[SrtParser] Export text thuần thành công: ${outputPath}`);
    return { success: true };
  } catch (error) {
    const errorMsg = `Lỗi export text thuần: ${error}`;
    console.error(`[SrtParser] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Trích xuất danh sách text thuần từ entries (bỏ timing)
 */
export function extractTextLines(entries: SubtitleEntry[]): string[] {
  return entries.map(e => e.text);
}
