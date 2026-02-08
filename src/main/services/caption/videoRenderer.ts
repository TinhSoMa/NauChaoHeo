/**
 * Video Renderer - Render video từ file ASS bằng FFmpeg
 * Port từ caption_funtion.py
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { 
  RenderVideoOptions, 
  RenderProgress, 
  RenderResult,
  VideoMetadata,
  ExtractFrameResult 
} from '../../../shared/types/caption';
import { getFFmpegPath, getFFprobePath, isFFmpegAvailable } from '../../utils/ffmpegPath';
import { getAssDuration } from './assConverter';

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
        
        if (!videoStream) {
          resolve({ success: false, error: 'Không tìm thấy video stream' });
          return;
        }
        
        // Parse FPS từ r_frame_rate (VD: "30/1")
        const fpsStr = videoStream.r_frame_rate || '30/1';
        const fpsParts = fpsStr.split('/');
        const fps = fpsParts.length === 2 
          ? parseInt(fpsParts[0]) / parseInt(fpsParts[1]) 
          : 30;
        
        const metadata: VideoMetadata = {
          width: videoStream.width || 1920,
          height: videoStream.height || 1080,
          duration: parseFloat(info.format?.duration || '0'),
          frameCount: parseInt(videoStream.nb_frames || '0') || Math.floor(parseFloat(info.format?.duration || '0') * fps),
          fps: Math.round(fps * 100) / 100,
        };
        
        console.log(`[VideoRenderer] Metadata: ${metadata.width}x${metadata.height}, ${metadata.duration}s, ${metadata.fps}fps`);
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
 * Render file ASS thành video với nền đen
 */
export async function renderAssToVideo(
  options: RenderVideoOptions,
  progressCallback?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  const { assPath, outputPath, width, height, useGpu } = options;
  
  console.log(`[VideoRenderer] Bắt đầu render: ${path.basename(assPath)}`);
  
  // Kiểm tra FFmpeg
  if (!isFFmpegAvailable()) {
    return { success: false, error: 'FFmpeg không được cài đặt' };
  }
  
  // Kiểm tra file ASS
  if (!existsSync(assPath)) {
    return { success: false, error: `File ASS không tồn tại: ${assPath}` };
  }
  
  // Lấy duration từ ASS
  const duration = await getAssDuration(assPath) || 60;
  const fps = 30;
  const totalFrames = Math.floor(duration * fps);
  
  console.log(`[VideoRenderer] Duration: ${duration}s, Total frames: ${totalFrames}`);
  
  // Đảm bảo thư mục output tồn tại
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });
  
  // Escape đường dẫn ASS cho FFmpeg filter
  const assFilter = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  
  // Thư mục chứa font tùy chỉnh (ZYVNA Fairy, v.v.)
  const { app } = await import('electron');
  const isPackaged = app.isPackaged;
  const fontsDir = isPackaged
    ? path.join(process.resourcesPath, 'fonts')
    : path.join(app.getAppPath(), 'resources', 'fonts');
  const fontsDirEscaped = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');
  
  // Build ASS filter với fontsdir để nhận font tùy chỉnh
  const assFilterFull = existsSync(fontsDir)
    ? `ass='${assFilter}':fontsdir='${fontsDirEscaped}'`
    : `ass='${assFilter}'`;
  
  console.log(`[VideoRenderer] Fonts dir: ${fontsDir} (exists: ${existsSync(fontsDir)})`);
  
  // Chọn codec
  let videoCodec: string;
  let codecParams: string[];
  
  if (useGpu) {
    // Thử Intel Quick Sync (phổ biến hơn trên laptop)
    videoCodec = 'h264_qsv';
    codecParams = ['-preset', 'medium', '-global_quality', '23'];
  } else {
    videoCodec = 'libx264';
    codecParams = ['-preset', 'medium', '-crf', '23'];
  }
  
  // Build FFmpeg command
  const ffmpegPath = getFFmpegPath();
  const args = [
    '-f', 'lavfi',
    '-i', `color=black:s=${width}x${height}:d=${duration}:r=${fps}`,
    '-vf', assFilterFull,
    '-c:v', videoCodec,
    ...codecParams,
    '-pix_fmt', 'yuv420p',
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
    
    process.on('close', (code) => {
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
        
        // Nếu GPU encoding thất bại, thử lại với CPU
        if (useGpu && (stderr.includes('qsv') || stderr.includes('encode') || stderr.includes('Error'))) {
          console.log('[VideoRenderer] GPU encoding thất bại, thử lại với CPU...');
          
          renderAssToVideo(
            { ...options, useGpu: false },
            progressCallback
          ).then(resolve);
          return;
        }
        
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
    
    process.on('error', (error) => {
      console.error(`[VideoRenderer] Process error: ${error.message}`);
      resolve({
        success: false,
        error: `Lỗi FFmpeg: ${error.message}`,
      });
    });
  });
}
