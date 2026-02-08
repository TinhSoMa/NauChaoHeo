/**
 * ASS Converter - Chuyển đổi SRT sang ASS với styling
 * Port từ caption_funtion.py
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  ASSStyleConfig, 
  ConvertToAssOptions,
  SubtitleEntry 
} from '../../../shared/types/caption';
import { parseSrtFile } from './srtParser';

/**
 * Chuyển đổi thời gian SRT (00:00:01,000) sang ASS (H:MM:SS.cs)
 * SRT: 00:00:01,500 -> ASS: 0:00:01.50
 */
export function srtTimeToAss(srtTime: string): string {
  // Thay dấu phẩy thành dấu chấm
  const normalized = srtTime.replace(',', '.');
  const parts = normalized.split(':');
  
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parts[1];
    const sParts = parts[2].split('.');
    const s = sParts[0];
    const ms = sParts[1] || '000';
    // ASS dùng centiseconds (2 chữ số), SRT dùng milliseconds (3 chữ số)
    const cs = ms.substring(0, 2);
    return `${h}:${m}:${s}.${cs}`;
  }
  
  return srtTime;
}

/**
 * Chuyển đổi màu HEX (#RRGGBB) sang ASS (&H00BBGGRR)
 * VD: #FF0000 (đỏ) -> &H000000FF
 */
export function hexToAssColor(hexColor: string): string {
  const clean = hexColor.replace('#', '');
  
  if (clean.length === 6) {
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    // ASS dùng định dạng BGR ngược
    return `&H00${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
  }
  
  return '&H00FFFFFF'; // Default: trắng
}

/**
 * Lấy duration từ file ASS bằng cách tìm thời gian kết thúc lớn nhất
 */
export async function getAssDuration(assPath: string): Promise<number | null> {
  try {
    const content = await fs.readFile(assPath, 'utf-8');
    const lines = content.split('\n');
    
    let maxTime = 0;
    
    for (const line of lines) {
      if (line.trim().startsWith('Dialogue:')) {
        // Format: Dialogue: Layer,Start,End,Style,...
        const parts = line.split(',');
        if (parts.length >= 3) {
          const endTimeStr = parts[2].trim(); // H:MM:SS.cs
          const timeParts = endTimeStr.replace('.', ':').split(':');
          
          if (timeParts.length >= 3) {
            const h = parseInt(timeParts[0], 10);
            const m = parseInt(timeParts[1], 10);
            const s = parseInt(timeParts[2], 10);
            const totalSeconds = h * 3600 + m * 60 + s;
            maxTime = Math.max(maxTime, totalSeconds);
          }
        }
      }
    }
    
    if (maxTime > 0) {
      return maxTime + 2; // Thêm 2 giây buffer
    }
    
    return null;
  } catch (error) {
    console.error('[ASSConverter] Lỗi đọc duration:', error);
    return null;
  }
}

/**
 * Chuyển đổi file SRT sang ASS với styling
 */
export async function convertSrtToAss(options: ConvertToAssOptions): Promise<{
  success: boolean;
  assPath?: string;
  entriesCount?: number;
  error?: string;
}> {
  const { srtPath, assPath, videoResolution, style, position } = options;
  
  console.log(`[ASSConverter] Bắt đầu convert: ${path.basename(srtPath)}`);
  
  try {
    // Parse file SRT
    const srtResult = await parseSrtFile(srtPath);
    
    if (!srtResult.success || srtResult.entries.length === 0) {
      return {
        success: false,
        error: srtResult.error || 'Không có subtitle entries nào',
      };
    }
    
    const entries = srtResult.entries;
    const w = videoResolution?.width || 1920;
    const h = videoResolution?.height || 1080;
    
    // Chuyển đổi màu
    const assColor = hexToAssColor(style.fontColor);
    
    // Tạo nội dung ASS
    let content = `[Script Info]
Title: Converted by NauChaoHeo
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
ScaledBorderAndShadow: no

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontName},${style.fontSize},${assColor},&H000000FF,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,1,2,${style.shadow},${style.alignment},10,10,${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    
    // Thêm các dialogue
    for (const entry of entries) {
      const startAss = srtTimeToAss(entry.startTime);
      const endAss = srtTimeToAss(entry.endTime);
      // Thay \n thành \\N (ASS line break)
      let text = (entry.translatedText || entry.text).replace(/\n/g, '\\N');
      
      // Nếu có tọa độ position, inject \pos(x,y) vào đầu text
      if (position) {
        text = `{\\pos(${position.x},${position.y})}${text}`;
      }
      
      content += `Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${text}\n`;
    }
    
    // Đảm bảo thư mục tồn tại
    const dir = path.dirname(assPath);
    await fs.mkdir(dir, { recursive: true });
    
    // Ghi file ASS
    await fs.writeFile(assPath, content, 'utf-8');
    
    console.log(`[ASSConverter] Convert thành công: ${entries.length} entries -> ${path.basename(assPath)}`);
    
    return {
      success: true,
      assPath,
      entriesCount: entries.length,
    };
    
  } catch (error) {
    const errorMsg = `Lỗi convert SRT sang ASS: ${error}`;
    console.error(`[ASSConverter] ${errorMsg}`);
    
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Style ASS mặc định
 */
export const DEFAULT_ASS_STYLE: ASSStyleConfig = {
  fontName: 'Be Vietnam Pro',
  fontSize: 48,
  fontColor: '#FFFFFF',
  shadow: 2,
  marginV: 50,
  alignment: 2, // Bottom center
};
