/**
 * Draft Parser - Đọc subtitle từ file draft_content.json (CapCut)
 * 
 * Format draft_content.json:
 * - extra_info.subtitle_fragment_info_list: Chứa subtitle với timing
 * - materials.texts: Chứa text content
 */

import * as fs from 'fs/promises';

// Interface định nghĩa locally
interface SubtitleEntry {
  index: number;
  startTime: string;
  endTime: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  text: string;
  translatedText?: string;
}

interface ParseDraftResult {
  success: boolean;
  entries: SubtitleEntry[];
  totalEntries: number;
  filePath: string;
  error?: string;
}

/**
 * Chuyển đổi milliseconds sang định dạng SRT time (HH:MM:SS,mmm)
 */
function msToSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/**
 * Trích xuất text từ content (có thể là JSON string hoặc plain text)
 */
function extractTextFromContent(content: string): string {
  if (!content) return '';
  
  // Nếu content là JSON string
  if (content.startsWith('{') && content.endsWith('}')) {
    try {
      const parsed = JSON.parse(content);
      return parsed.text || content;
    } catch {
      return content;
    }
  }
  
  return content;
}

/**
 * Parse file draft_content.json và trả về danh sách subtitle entries
 */
export async function parseDraftJson(filePath: string): Promise<ParseDraftResult> {
  console.log(`[DraftParser] Đang parse: ${filePath}`);
  
  try {
    // Đọc file JSON
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(fileContent);
    
    const entries: SubtitleEntry[] = [];
    
    // Phương pháp 1: Lấy từ extra_info.subtitle_fragment_info_list
    if (data.extra_info?.subtitle_fragment_info_list) {
      const fragments = data.extra_info.subtitle_fragment_info_list;
      
      for (const fragment of fragments) {
        if (fragment.subtitle_cache_info) {
          try {
            const cacheInfo = JSON.parse(fragment.subtitle_cache_info);
            if (cacheInfo.sentence_list) {
              for (const sentence of cacheInfo.sentence_list) {
                const startMs = sentence.start_time || 0;
                const endMs = sentence.end_time || 0;
                const text = sentence.text || '';
                
                if (text) {
                  entries.push({
                    index: entries.length + 1,
                    startTime: msToSrtTime(startMs),
                    endTime: msToSrtTime(endMs),
                    startMs,
                    endMs,
                    durationMs: endMs - startMs,
                    text,
                    translatedText: sentence.translation_text || undefined,
                  });
                }
              }
            }
          } catch {
            continue;
          }
        }
      }
    }
    
    // Phương pháp 2: Nếu không có từ extra_info, lấy từ materials.texts + tracks
    if (entries.length === 0 && data.materials?.texts && data.tracks) {
      console.log('[DraftParser] Sử dụng phương pháp materials.texts + tracks');
      
      // Lấy text track
      const textTracks = data.tracks.filter((t: { type: string }) => t.type === 'text');
      
      for (const track of textTracks) {
        if (track.segments) {
          for (const segment of track.segments) {
            const materialId = segment.material_id;
            const startMs = segment.target_timerange?.start || 0;
            const durationMs = segment.target_timerange?.duration || 0;
            const endMs = startMs + durationMs;
            
            // Tìm text material tương ứng
            const textMaterial = data.materials.texts.find((t: { id: string }) => t.id === materialId);
            if (textMaterial) {
              const text = extractTextFromContent(textMaterial.content) || textMaterial.recognize_text || '';
              
              if (text) {
                entries.push({
                  index: entries.length + 1,
                  startTime: msToSrtTime(startMs),
                  endTime: msToSrtTime(endMs),
                  startMs,
                  endMs,
                  durationMs,
                  text,
                });
              }
            }
          }
        }
      }
    }
    
    // Phương pháp 3: Chỉ lấy từ materials.texts (không có timing)
    if (entries.length === 0 && data.materials?.texts) {
      console.log('[DraftParser] Sử dụng phương pháp materials.texts (không có timing)');
      
      for (const textItem of data.materials.texts) {
        const text = extractTextFromContent(textItem.content) || textItem.recognize_text || '';
        
        if (text) {
          entries.push({
            index: entries.length + 1,
            startTime: '00:00:00,000',
            endTime: '00:00:00,000',
            startMs: 0,
            endMs: 0,
            durationMs: 0,
            text,
          });
        }
      }
    }
    
    // Sắp xếp theo thời gian bắt đầu
    entries.sort((a, b) => a.startMs - b.startMs);
    
    // Đánh lại index sau khi sort
    entries.forEach((entry, idx) => {
      entry.index = idx + 1;
    });
    
    console.log(`[DraftParser] Đã parse ${entries.length} entries`);
    
    return {
      success: true,
      entries,
      totalEntries: entries.length,
      filePath,
    };
    
  } catch (error) {
    console.error('[DraftParser] Lỗi:', error);
    return {
      success: false,
      entries: [],
      totalEntries: 0,
      filePath,
      error: String(error),
    };
  }
}

/**
 * Xuất entries thành file SRT
 */
export async function exportDraftToSrt(
  entries: SubtitleEntry[],
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    let srtContent = '';
    
    for (const entry of entries) {
      srtContent += `${entry.index}\n`;
      srtContent += `${entry.startTime} --> ${entry.endTime}\n`;
      srtContent += `${entry.translatedText || entry.text}\n\n`;
    }
    
    await fs.writeFile(outputPath, srtContent, 'utf-8');
    console.log(`[DraftParser] Đã xuất SRT: ${outputPath}`);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
