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
    const content = await fs.readFile(filePath, 'utf-8');
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
        
        // Dòng 3+: Text (có thể nhiều dòng)
        const text = lines.slice(2).join(' ').trim();
        
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
    
    console.log(`[SrtParser] Parse thành công: ${entries.length} entries`);
    
    return {
      success: true,
      entries,
      totalEntries: entries.length,
      filePath,
    };
    
  } catch (error) {
    const errorMsg = `Lỗi đọc file SRT: ${error}`;
    console.error(`[SrtParser] ${errorMsg}`);
    
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

/**
 * Trích xuất danh sách text thuần từ entries (bỏ timing)
 */
export function extractTextLines(entries: SubtitleEntry[]): string[] {
  return entries.map(e => e.text);
}
