/**
 * Video Renderer - Render video từ file ASS bằng FFmpeg
 * Port từ caption_funtion.py
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { 
  RenderVideoOptions, 
  RenderProgress, 
  RenderResult,
  VideoMetadata,
  ExtractFrameResult
} from '../../../shared/types/caption';
import { getFFmpegPath, getFFprobePath, isFFmpegAvailable } from '../../utils/ffmpegPath';
import { parseSrtFile } from './srtParser';
import { hexToAssColor, srtTimeToAss } from './assConverter';

/**
 * Lấy metadata của video bằng ffprobe
 */
export async function getVideoMetadata(videoPath: string): Promise<{
  success: boolean;
  metadata?: VideoMetadata;
  error?: string;
}> {
  if (!existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }
  
  const ffprobePath = getFFprobePath();
  
  if (!existsSync(ffprobePath)) {
    return { success: false, error: `ffprobe không tìm thấy: ${ffprobePath}` };
  }
  
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath
    ];
    
    const process = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `ffprobe exit code: ${code}` });
        return;
      }
      
      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
        const audioStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');
        
        if (!videoStream && !audioStream) {
          resolve({ success: false, error: 'Không tìm thấy video hay audio stream' });
          return;
        }
        
        // Parse FPS từ r_frame_rate (VD: "30/1")
        const fpsStr = videoStream?.r_frame_rate || '30/1';
        const fpsParts = fpsStr.split('/');
        const fps = fpsParts.length === 2 
          ? parseInt(fpsParts[0]) / parseInt(fpsParts[1]) 
          : 30;
        
        const metadata: VideoMetadata = {
          width: videoStream?.width || 1920,
          // height: 100, // Fixed height specifically for caption strip rendering backward-compatibility
          height: videoStream?.height || 1080,
          actualHeight: videoStream?.height || 1080, // Store real height for filtering validation
          duration: parseFloat(info.format?.duration || '0'),
          frameCount: parseInt(videoStream?.nb_frames || '0') || Math.floor(parseFloat(info.format?.duration || '0') * fps),
          fps: Math.round(fps * 100) / 100,
          hasAudio: !!audioStream
        };
        
        console.log(`[VideoRenderer] Metadata (${videoPath}): ${metadata.width}x${metadata.height}, ${metadata.duration}s, ${metadata.fps}fps, hasAudio: ${metadata.hasAudio}, hasVideo: ${!!videoStream}`);
        resolve({ success: true, metadata });
        
      } catch (error) {
        resolve({ success: false, error: `Lỗi parse metadata: ${error}` });
      }
    });
    
    process.on('error', (error) => {
      resolve({ success: false, error: `Lỗi ffprobe: ${error.message}` });
    });
  });
}

/**
 * Extract một frame từ video để preview
 */
export async function extractVideoFrame(
  videoPath: string,
  frameNumber?: number
): Promise<ExtractFrameResult> {
  if (!existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }
  
  const ffmpegPath = getFFmpegPath();
  
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: `ffmpeg không tìm thấy: ${ffmpegPath}` };
  }
  
  // Lấy metadata để biết vị trí frame
  const metadataResult = await getVideoMetadata(videoPath);
  if (!metadataResult.success || !metadataResult.metadata) {
    return { success: false, error: metadataResult.error || 'Không lấy được metadata' };
  }
  
  const { duration, width, height, fps } = metadataResult.metadata;
  
  // Nếu không chỉ định frame, lấy random frame ở giữa video
  let seekTime: number;
  if (frameNumber !== undefined) {
    seekTime = frameNumber / fps;
  } else {
    // Random từ 10% đến 90% video
    seekTime = duration * (0.1 + Math.random() * 0.8);
  }
  
  return new Promise((resolve) => {
    const args = [
      '-ss', seekTime.toFixed(2),
      '-i', videoPath,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-'
    ];
    
    const process = spawn(ffmpegPath, args);
    const chunks: Buffer[] = [];
    
    process.stdout.on('data', (data) => {
      chunks.push(data);
    });
    
    process.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve({ success: false, error: 'Không thể extract frame' });
        return;
      }
      
      const frameBuffer = Buffer.concat(chunks);
      const frameData = frameBuffer.toString('base64');
      
      console.log(`[VideoRenderer] Extracted frame at ${seekTime.toFixed(2)}s, size: ${frameBuffer.length} bytes`);
      
      resolve({
        success: true,
        frameData,
        width,
        height,
      });
    });
    
    process.on('error', (error) => {
      resolve({ success: false, error: `Lỗi ffmpeg: ${error.message}` });
    });
  });
}

/**
 * Render file SRT thành video (hoặc video nền đen nếu không có video gốc)
 * Pipeline: SRT → fix overlap → convert ASS (with Alignment=5 center) → FFmpeg ass filter
 */
export async function renderVideo(
  options: RenderVideoOptions,
  progressCallback?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  const { srtPath, outputPath, width, height: userHeight, videoPath } = options;
  
  console.log(`[VideoRenderer] Bắt đầu render: ${path.basename(srtPath)}`);
  
  // Kiểm tra FFmpeg
  if (!isFFmpegAvailable()) {
    return { success: false, error: 'FFmpeg không được cài đặt' };
  }
  
  // Kiểm tra file SRT
  if (!existsSync(srtPath)) {
    return { success: false, error: `File SRT không tồn tại: ${srtPath}` };
  }
  
  // Tính chiều cao tự động nếu là tạo nền đen
  let finalHeight = userHeight || 150;
  let finalWidth = width;
  
  // libx264 yêu cầu width và height phải chia hết cho 2
  if (finalWidth % 2 !== 0) finalWidth += 1;
  if (finalHeight % 2 !== 0) finalHeight += 1;
  
  // Validation: min size 64x64, max 7680x4320 (8K)
  finalWidth = Math.max(64, Math.min(7680, finalWidth));
  finalHeight = Math.max(64, Math.min(4320, finalHeight));
  
  console.log(`[VideoRenderer] Render size: ${finalWidth}x${finalHeight}`);
  
  const audioSpeed = options.audioSpeed && options.audioSpeed > 0 ? options.audioSpeed : 1.0;

  // Lấy duration (ưu tiên từ file audio nếu có vì file này quyết định độ dài chuẩn xác nhất)
  let rawDuration = options.targetDuration || 60;
  let isDurationFromAudio = false;

  if (options.audioPath && existsSync(options.audioPath)) {
    const audioMeta = await getVideoMetadata(options.audioPath);
    if (audioMeta.success && audioMeta.metadata) {
      rawDuration = audioMeta.metadata.duration;
      isDurationFromAudio = true;
      console.log(`[VideoRenderer] Sử dụng thời lượng tuyệt đối từ file audio: ${rawDuration}s (${options.audioPath})`);
    }
  }

  if (!isDurationFromAudio && !options.targetDuration) {
    try {
      const srtResult = await parseSrtFile(srtPath);
      if (srtResult.success && srtResult.entries.length > 0) {
        const lastEntry = srtResult.entries[srtResult.entries.length - 1];
        rawDuration = Math.ceil(lastEntry.endMs / 1000) + 2; 
      }
    } catch (e) {
      console.warn("[VideoRenderer] Lỗi đọc SRT để tính rawDuration:", e);
    }
  }
  
  const duration = rawDuration;
  const newAudioDuration = duration / audioSpeed;
  const fps = 30;
  const totalFrames = Math.floor(newAudioDuration * fps);
  
  console.log(`[VideoRenderer] Duration: ${duration}s, AudioSpeed: ${audioSpeed}x, Render Duration: ${newAudioDuration}s, Total frames: ${totalFrames}`);
  
  // Đảm bảo thư mục output tồn tại
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  // ========== CONVERT SRT → ASS ==========
  // Chuyển SRT sang ASS để bake alignment/style trực tiếp vào file
  // FFmpeg `ass` filter đọc style chính xác hơn `subtitles` filter + force_style
  const tempAssPath = path.join(os.tmpdir(), `sub_${Date.now()}.ass`);

  // Xác định chiều cao thực tế để tính font size chính xác
  let renderWidth = finalWidth;
  let renderHeight = finalHeight;
  let needsScale = false; // Có cần thêm scale filter không
  let hasVideoAudio = false;
  let originalVideoDuration = 0;
  let videoSpeedMultiplier = 1.0;

  if (videoPath && existsSync(videoPath)) {
    try {
      const probeResult = await getVideoMetadata(videoPath);
      if (probeResult.success && probeResult.metadata) {
        renderWidth = probeResult.metadata.width;
        renderHeight = probeResult.metadata.actualHeight || probeResult.metadata.height;
        hasVideoAudio = !!probeResult.metadata.hasAudio;
        originalVideoDuration = probeResult.metadata.duration;
        if (originalVideoDuration > 0 && newAudioDuration > 0) {
          videoSpeedMultiplier = originalVideoDuration / newAudioDuration;
        }
        console.log(`[VideoRenderer] Probed actual video: ${renderWidth}x${renderHeight}, duration: ${originalVideoDuration}s, autoSpeed: ${videoSpeedMultiplier}x, hasAudio: ${hasVideoAudio}`);
      }
    } catch (e) {
      console.warn(`[VideoRenderer] Không probe được video, dùng fallback:`, e);
    }
  }

  // scale xuống theo tuỳ chọn phân giải (nếu có)
  let MAX_OUTPUT_HEIGHT = 1080;
  
  if (options.renderResolution === '720p') MAX_OUTPUT_HEIGHT = 720;
  if (options.renderResolution === '540p') MAX_OUTPUT_HEIGHT = 540;
  if (options.renderResolution === '360p') MAX_OUTPUT_HEIGHT = 360;
  if (options.renderResolution === 'original') MAX_OUTPUT_HEIGHT = 99999;
  
  let scaleFactor = 1;

  if (renderHeight > MAX_OUTPUT_HEIGHT && videoPath && existsSync(videoPath)) {
    scaleFactor = MAX_OUTPUT_HEIGHT / renderHeight;
    renderWidth = Math.round(renderWidth * scaleFactor);
    if (renderWidth % 2 !== 0) renderWidth += 1; // libx264 yêu cầu chia hết cho 2
    renderHeight = MAX_OUTPUT_HEIGHT;
    needsScale = true;
    console.log(`[VideoRenderer] Sẽ scale xuống ${renderWidth}x${renderHeight} (cap ${options.renderResolution || '1080p'})`);
  }

  // Tính font size phù hợp với chiều cao thực tế (nhớ áp dụng scaleFactor nếu file bị thu nhỏ)
  const s = options.style || { fontName: 'Arial', fontSize: 48, fontColor: '#FFFF00', shadow: 2, marginV: 0, alignment: 5 };
  let effectiveFontSize = Math.round(s.fontSize * scaleFactor);
  let effectiveShadow = Math.max(0, Math.round(s.shadow * scaleFactor));
  let effectiveOutline = Math.max(1, Math.round(2 * scaleFactor));

  if (renderHeight < 400 && (!videoPath || !existsSync(videoPath))) {
    // Strip mode (1/10 height video) cho black_bg: font chiếm 90% chiều cao strip
    effectiveFontSize = Math.max(16, Math.floor(renderHeight * 0.9));
  } else if (effectiveFontSize > renderHeight * 0.15) {
    // Ngăn font quá lớn tràn ngoài khung
    effectiveFontSize = Math.floor(renderHeight * 0.08);
  }

  const assColor = hexToAssColor(s.fontColor);
  // Alignment=5 (middle center), MarginV=0 → caption nằm chính giữa video
  const assAlignment = 5;
  const assMarginV = 0;

  console.log(`[VideoRenderer] ASS style: FontSize=${effectiveFontSize}, Alignment=${assAlignment}, MarginV=${assMarginV}, PlayRes=${renderWidth}x${renderHeight}`);

  try {
    // Parse SRT và fix overlap timing
    const srtData = await parseSrtFile(srtPath);
    if (!srtData.success || srtData.entries.length === 0) {
      return { success: false, error: srtData.error || 'Không có subtitle entries' };
    }

    // Fix overlap timing (Capcut thường tạo SRT có overlap)
    for (let i = 0; i < srtData.entries.length - 1; i++) {
      const curr = srtData.entries[i];
      const next = srtData.entries[i + 1];
      if (curr.endMs >= next.startMs) {
        curr.endMs = next.startMs - 10;
        const d = new Date(curr.endMs);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        const ss = String(d.getUTCSeconds()).padStart(2, '0');
        const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
        curr.endTime = `${hh}:${mm}:${ss},${ms}`;
      }
    }

    // Build ASS content với style baked-in
    let assContent = `[Script Info]
Title: NauChaoHeo Render
ScriptType: v4.00+
PlayResX: ${renderWidth}
PlayResY: ${renderHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.fontName},${effectiveFontSize},${assColor},&H000000FF,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,1,${effectiveOutline},${effectiveShadow},${assAlignment},0,0,${assMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const msToAssTime = (ms: number): string => {
      const t = Math.max(0, Math.floor(ms));
      const h = Math.floor(t / 3600000);
      const m = Math.floor((t % 3600000) / 60000);
      const s = Math.floor((t % 60000) / 1000);
      const cs = Math.floor((t % 1000) / 10);
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
    };

    for (const entry of srtData.entries) {
      const startAss = msToAssTime(entry.startMs / videoSpeedMultiplier);
      const endAss = msToAssTime(entry.endMs / videoSpeedMultiplier);
      let text = (entry.translatedText || entry.text).replace(/\n/g, '\\N');
      if (options.position) {
        const posX = Math.round(options.position.x * scaleFactor);
        const posY = Math.round(options.position.y * scaleFactor);
        text = `{\\\\pos(${posX},${posY})}${text}`;
      }
      assContent += `Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${text}\n`;
    }

    await fs.writeFile(tempAssPath, assContent, 'utf-8');
    console.log(`[VideoRenderer] Created temp ASS: ${tempAssPath} (${srtData.entries.length} entries)`);
  } catch (e) {
    console.warn(`[VideoRenderer] Lỗi convert SRT→ASS:`, e);
    return { success: false, error: `Lỗi convert SRT→ASS: ${e}` };
  }

  // ========== BUILD FFMPEG FILTER ==========
  // Dùng FFmpeg `ass` filter thay vì `subtitles` filter
  // `ass` filter đọc trực tiếp file ASS với style đã bake sẵn, không cần force_style
  const assPathEscaped = tempAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  // Thêm fontsdir để FFmpeg tìm được custom font từ resources/fonts
  let fontsDirParam = '';
  try {
    const fontsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'fonts')
      : path.join(app.getAppPath(), 'resources', 'fonts');
    if (existsSync(fontsDir)) {
      const fontsDirEscaped = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');
      fontsDirParam = `:fontsdir='${fontsDirEscaped}'`;
      console.log(`[VideoRenderer] fontsdir: ${fontsDir}`);
    }
  } catch (e) {
    console.warn(`[VideoRenderer] Không lấy được fontsdir:`, e);
  }

  const subtitleFilter = `ass='${assPathEscaped}'${fontsDirParam}`;
  
  // Build complete video filter string: scale → drawbox (blackout) → ass subtitle
  const filterParts: string[] = [];

  // Thêm scale filter nếu cần giảm xuống 1080p
  if (needsScale) {
    filterParts.push(`scale=${renderWidth}:${renderHeight}`);
  }

  // Blackout band at the bottom of the video (fraction 0-1 from top)
  if (options.blackoutTop != null && options.blackoutTop < 1) {
    const blackoutY = Math.round(options.blackoutTop * renderHeight);
    const blackoutH = renderHeight - blackoutY;
    filterParts.push(`drawbox=x=0:y=${blackoutY}:w=iw:h=${blackoutH}:color=black:t=fill`);
    console.log(`[VideoRenderer] Blackout band: y=${blackoutY} h=${blackoutH} (${Math.round((1 - options.blackoutTop) * 100)}% bottom)`);
  }

  // ==========================================
  // AUTO-FIT VIDEO SPEED LOGIC
  // ==========================================
  
  // 1. Calculate new Audio duration
  // Được tính ở đoạn đầu `videoRenderer.ts` với audioSpeed và newAudioDuration
  // 2. videoSpeedMultiplier cũng đã được tính ở đoạn probe video bên trên
  

  // 3. Tốc độ video phải được áp dụng THAY ĐỔI TRƯỚC khi vẽ SRT
  if (videoSpeedMultiplier !== 1.0) {
    const ptsMultiplier = (1 / videoSpeedMultiplier).toFixed(4);
    filterParts.push(`setpts=${ptsMultiplier}*PTS`);
    console.log(`[VideoRenderer] Auto-scaling video speed: ${videoSpeedMultiplier.toFixed(3)}x (setpts=${ptsMultiplier}*PTS)`);
  }

  filterParts.push(subtitleFilter);

  const videoFilter = filterParts.join(',');

  // Chọn codec mặc định
  const videoCodec = options.useGpu ? 'h264_nvenc' : 'libx264';
  const codecParams = options.useGpu 
    ? ['-cq', '28', '-preset', 'p6', '-profile:v', 'high']
    : ['-preset', 'medium', '-crf', '23'];
  
  // Build FFmpeg command
  const ffmpegPath = getFFmpegPath();
  
  let inputArgs: string[];
  
  const finalDurationStr = newAudioDuration.toFixed(3);

  console.log(`[VideoRenderer] 🕒 THỜI GIAN RENDER (AUTO-FIT):
- Audio gốc truyền vào: ${options.audioPath}
- Duration Audio gốc: ${duration.toFixed(3)}s
- Tốc độ Audio (options.audioSpeed): ${audioSpeed}x
- 👉 Duration Audio mới (Render video length): ${newAudioDuration.toFixed(3)}s
- Duration Video gốc: ${originalVideoDuration.toFixed(3)}s
- 👉 Tốc độ Video tự động chỉnh: ${videoSpeedMultiplier.toFixed(3)}x
  `);
  if (videoPath && existsSync(videoPath)) {
    inputArgs = [
      '-stream_loop', '-1',
      '-i', videoPath
    ];
  } else {
    inputArgs = [
      '-f', 'lavfi',
      '-i', `color=black:s=${finalWidth}x${finalHeight}:r=${fps}`
    ];
  }

  // Thêm input tts audio
  let hasTtsAudio = false;
  if (options.audioPath && existsSync(options.audioPath)) {
    inputArgs.push('-i', options.audioPath);
    hasTtsAudio = true;
  }
  
  // Thêm input logo watermark
  let hasLogo = false;
  let logoInputIndex = -1;
  if (options.logoPath && existsSync(options.logoPath)) {
    inputArgs.push('-i', options.logoPath);
    hasLogo = true;
    logoInputIndex = inputArgs.filter(arg => arg === '-i').length - 1; // Index in ffmpeg is 0-based
  }

  const filterComplexParts: string[] = [];
  
  // Audio filter building
  const volVid = (options.videoVolume !== undefined) ? options.videoVolume / 100 : 1.0;
  const volAud = (options.audioVolume !== undefined) ? options.audioVolume / 100 : 1.0;

  const getAtempoFilter = (speed: number): string => {
    let s = speed;
    const filters = [];
    while (s < 0.5) { filters.push('atempo=0.5'); s /= 0.5; }
    while (s > 100.0) { filters.push('atempo=100.0'); s /= 100.0; }
    if (s !== 1.0) filters.push(`atempo=${s}`);
    return filters.join(',');
  };

  const vidAtempo = (videoSpeedMultiplier !== 1.0) ? `,${getAtempoFilter(videoSpeedMultiplier)}` : '';
  const audAtempo = (audioSpeed !== 1.0) ? `,${getAtempoFilter(audioSpeed)}` : '';

  if (hasVideoAudio && hasTtsAudio) {
    filterComplexParts.push(`[0:a]volume=${volVid}${vidAtempo}[a_vid]`);
    filterComplexParts.push(`[1:a]volume=${volAud}${audAtempo}[a_tts]`);
    filterComplexParts.push(`[a_vid][a_tts]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a_out]`);
  } else if (hasVideoAudio && !hasTtsAudio && (volVid !== 1.0 || vidAtempo)) {
    filterComplexParts.push(`[0:a]volume=${volVid}${vidAtempo}[a_out]`);
  } else if (!hasVideoAudio && hasTtsAudio && (volAud !== 1.0 || audAtempo)) {
    filterComplexParts.push(`[1:a]volume=${volAud}${audAtempo}[a_out]`);
  }
  
  // Video filter mapping
  // Nối filter video chính
  filterComplexParts.push(`[0:v]${videoFilter}[v_base]`);

  // Nếu có logo, sử dụng bộ lọc overlay
  if (hasLogo && logoInputIndex > 0) {
    // scale logo dựa trên scaleFactor và logoScale của user
    const userLogoScale = options.logoScale ?? 1.0;
    const totalLogoScale = scaleFactor * userLogoScale;
    const logoScaleFilter = totalLogoScale !== 1 ? `scale=iw*${totalLogoScale}:ih*${totalLogoScale}` : 'copy';
    
    // Tìm tọa độ
    let logoXAxis = `main_w-overlay_w-50*${scaleFactor}`; // Góc trên phải mặc định
    let logoYAxis = `50*${scaleFactor}`;
    
    if (options.logoPosition) {
      // Vì logoPosition là tọa độ tâm của logo trên độ phân giải gốc, ta cần scale tọa độ đó
      logoXAxis = `${Math.round(options.logoPosition.x * scaleFactor)}-overlay_w/2`;
      logoYAxis = `${Math.round(options.logoPosition.y * scaleFactor)}-overlay_w/2`;
    }
    
    filterComplexParts.push(`[${logoInputIndex}:v]${logoScaleFilter}[logo_scaled]`);
    filterComplexParts.push(`[v_base][logo_scaled]overlay=x=${logoXAxis}:y=${logoYAxis}[v_out]`);
  } else {
    // Nếu không có logo, thì truyền thẳng [v_base] ra [v_out] bằng cách đổi tên node cuối cùng hoặc alias
    // Thay vì đổi string đã push, ta chỉ map v_base sang v_out
    filterComplexParts.push(`[v_base]copy[v_out]`);
  }

  // Build mapping
  const mapArgs: string[] = ['-map', '[v_out]'];
  
  if (hasVideoAudio && hasTtsAudio) {
    mapArgs.push('-map', '[a_out]');
  } else if (hasVideoAudio && !hasTtsAudio) {
    mapArgs.push('-map', (volVid !== 1.0 || vidAtempo) ? '[a_out]' : '0:a');
  } else if (!hasVideoAudio && hasTtsAudio) {
    mapArgs.push('-map', (volAud !== 1.0 || audAtempo) ? '[a_out]' : '1:a');
  }

  const args = [
    ...inputArgs,
    '-filter_complex', filterComplexParts.join(';'),
    ...mapArgs,
    '-c:v', videoCodec,
    ...codecParams,
    '-pix_fmt', 'yuv420p',
    '-t', finalDurationStr,
    '-y',
    outputPath
  ];
  
  console.log(`[VideoRenderer] Command: ffmpeg ${args.join(' ')}`);
  
  return new Promise((resolve) => {
    const process = spawn(ffmpegPath, args);
    let stderr = '';
    
    // FFmpeg ghi progress ra stderr
    process.stderr.on('data', (data) => {
      const line = data.toString();
      stderr += line;
      
      // Log các dòng quan trọng ngay lập tức
      const lines = line.split('\n');
      for (const l of lines) {
        if (/subtitle|font|Unable|Error|Warning|fontsdir|libass|force_style|filter/i.test(l) && l.trim()) {
          console.log(`[VideoRenderer][FFmpeg] ${l.trim()}`);
        }
      }
      
      // Parse frame number từ output
      const frameMatch = line.match(/frame=\s*(\d+)/);
      if (frameMatch && progressCallback) {
        const currentFrame = parseInt(frameMatch[1], 10);
        const percent = Math.min(100, Math.round((currentFrame / totalFrames) * 100));
        
        progressCallback({
          currentFrame,
          totalFrames,
          fps,
          percent,
          status: 'rendering',
          message: `Đang render: ${percent}%`,
        });
      }
    });
    
    process.on('close', async (code) => {
      // Dọn dẹp file temp ASS
      try { await fs.unlink(tempAssPath); } catch (e) {}

      if (code === 0) {
        console.log(`[VideoRenderer] Render thành công: ${outputPath}`);
        
        if (progressCallback) {
          progressCallback({
            currentFrame: totalFrames,
            totalFrames,
            fps,
            percent: 100,
            status: 'completed',
            message: 'Hoàn thành!',
          });
        }
        
        resolve({
          success: true,
          outputPath,
          duration,
        });
      } else {
        console.error(`[VideoRenderer] Render thất bại, code: ${code}`);
        console.error(`[VideoRenderer] stderr: ${stderr}`);
        

        
        if (progressCallback) {
          progressCallback({
            currentFrame: 0,
            totalFrames,
            fps: 0,
            percent: 0,
            status: 'error',
            message: `Lỗi render: ${stderr.substring(0, 200)}`,
          });
        }
        
        resolve({
          success: false,
          error: stderr || `FFmpeg exit code: ${code}`,
        });
      }
    });
    
    process.on('error', async (error) => {
      console.error(`[VideoRenderer] Process error: ${error.message}`);
      // Dọn dẹp file temp ASS
      try { await fs.unlink(tempAssPath); } catch (e) {}

      resolve({
        success: false,
        error: `Lỗi FFmpeg: ${error.message}`,
      });
    });
  });
}

/**
 * Tìm video gốc tốt nhất (độ phân giải > 750p (chiều cao >= 720), mp4/mov)
 * từ danh sách các thư mục.
 * Trả về video có area (width * height) lớn nhất.
 */
export async function findBestVideoInFolders(folderPaths: string[]): Promise<{
  success: boolean;
  videoPath?: string;
  metadata?: VideoMetadata;
  error?: string;
}> {
  console.log(`[VideoRenderer] Tìm video tốt nhất trong ${folderPaths.length} thư mục`);
  
  const videoExtensions = ['.mp4', '.mov'];
  const potentialVideos: string[] = [];
  
  // 1. Quét tìm tất cả video file
  for (const dir of folderPaths) {
    if (!existsSync(dir)) continue;
    
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (videoExtensions.includes(ext)) {
          potentialVideos.push(path.join(dir, file));
        }
      }
    } catch (error) {
       console.error(`[VideoRenderer] Lỗi đọc thư mục ${dir}:`, error);
    }
  }

  if (potentialVideos.length === 0) {
    return { success: false, error: 'Không tìm thấy file video (.mp4, .mov) nào trong thư mục' };
  }

  // 2. Lấy metadata và lọc > 750p (coi >= 720 là chuẩn HD/750p)
  type VideoStat = { path: string; metadata: VideoMetadata; area: number };
  const validVideos: VideoStat[] = [];
  
  for (const videoPath of potentialVideos) {
    const res = await getVideoMetadata(videoPath);
    if (res.success && res.metadata) {
      // Ở đây >= 720 để đảm bảo bắt các video HD/Portrait (VD: 1080x1920 hoặc 1280x720)
      // Dùng actualHeight (chiều cao gốc) thay vì height (bị fixed 100px ở bước đọc metadata)
      const realHeight = res.metadata.actualHeight || 1080;
      const maxDim = Math.max(res.metadata.width, realHeight);
      const minDim = Math.min(res.metadata.width, realHeight);

      if (maxDim >= 720 && realHeight > 500) { // Chiều lớn hơn >= 720p và chiều cao > 500
        validVideos.push({
           path: videoPath,
           metadata: res.metadata,
           area: res.metadata.width * realHeight
        });
      }
    }
  }

  if (validVideos.length === 0) {
     return { success: false, error: 'Không có video nào đạt độ phân giải > 750p' };
  }

  // 3. Chọn video có area lớn nhất (nét nhất)
  validVideos.sort((a, b) => b.area - a.area);
  const bestVideo = validVideos[0];
  
  console.log(`[VideoRenderer] Video tốt nhất: ${bestVideo.path} (${bestVideo.metadata.width}x${bestVideo.metadata.height})`);

  return { success: true, videoPath: bestVideo.path, metadata: bestVideo.metadata };
}

