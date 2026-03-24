import { ipcMain } from 'electron';
import { cutVideoService } from '../services/cutVideo/cutVideoService';
import { audioExtractorService } from '../services/cutVideo/audioExtractorService';
import { videoSplitterService } from '../services/cutVideo/videoSplitterService';
import { videoMergerService } from '../services/cutVideo/videoMergerService';
import { videoAudioMixerService } from '../services/cutVideo/videoAudioMixerService';
import { detectSilences } from '../services/cutVideo/silenceDetectService';
import { capcutProjectBatchService, DEFAULT_CAPCUT_DRAFTS_PATH } from '../services/cutVideo/capcutProjectBatchService';
import { AppSettingsService } from '../services/appSettings';

// To keep track of running extractions and allow stopping
let activeExtractionProcess = false;

export function registerCutVideoHandlers(): void {
  ipcMain.handle('cutVideo:scanFolder', async (_, folderPath: string) => {
    return await cutVideoService.scanFolderForMedia(folderPath);
  });

  ipcMain.handle('cutVideo:stopExtraction', async () => {
    activeExtractionProcess = false;
    return { success: true };
  });

  ipcMain.handle('cutVideo:startAudioExtraction', async (event, options: { 
    folders: string[], 
    format: 'mp3' | 'aac' | 'wav' | 'flac', 
    keepStructure: boolean, 
    overwrite: boolean,
    capcutProjectPath?: string,
    capcutDraftsPath?: string,
    autoAttachToCapcut?: boolean,
  }) => {
    activeExtractionProcess = true;
    const { folders, format, keepStructure, overwrite } = options;
    const capcutProjectPath = options.capcutProjectPath?.trim();
    const capcutDraftsPath = options.capcutDraftsPath
      || AppSettingsService.getAll().capcutDraftsPath
      || DEFAULT_CAPCUT_DRAFTS_PATH;
    const autoAttachToCapcut = options.autoAttachToCapcut !== false;
    const sender = event.sender;

    const emitLog = (
      file: string,
      folder: string,
      status: string,
      time: string,
      phase: 'extract' | 'capcut_attach' = 'extract',
      detail?: string,
    ) => {
       sender.send('cutVideo:extractionLog', { file, folder, status, time, phase, detail });
    };

    const emitProgress = (progressData: any) => {
       sender.send('cutVideo:extractionProgress', progressData);
    };

    try {
      // 1. First, gather all files to process
      const filesToProcess: { path: string, folder: string, name: string }[] = [];
      
      for (const folder of folders) {
        const scanResult = await cutVideoService.scanFolderForMedia(folder);
        if (scanResult.success && scanResult.data) {
          for (const mediaFile of scanResult.data.mediaFiles) {
            filesToProcess.push({
              path: mediaFile,
              folder: folder,
              name: mediaFile.split(/[/\\]/).pop() || mediaFile
            });
          }
        }
      }

      const totalFiles = filesToProcess.length;
      if (totalFiles === 0) {
        return { success: false, error: 'Không tìm thấy file media nào trong thư mục' };
      }

      let capcutAttachAvailable = autoAttachToCapcut;
      if (autoAttachToCapcut) {
        const env = await capcutProjectBatchService.checkEnvironment();
        if (!env.success) {
          capcutAttachAvailable = false;
          emitLog(
            '---',
            capcutDraftsPath,
            'error',
            new Date().toISOString(),
            'capcut_attach',
            env.error || 'Không thể sử dụng pycapcut.',
          );
        }
      }

      // 2. Process each file
      let currentIdx = 0;
      for (const fileItem of filesToProcess) {
        if (!activeExtractionProcess) {
          emitLog(fileItem.name, fileItem.folder, 'info', '--:--', 'extract', 'Đã dừng theo yêu cầu.');
          break; // Stopped by user
        }

        currentIdx++;
        // Update total progress
        emitProgress({ 
          totalPercent: Math.round(((currentIdx - 1) / totalFiles) * 100), 
          currentFile: fileItem.name,
          currentPercent: 0
        });
        
        emitLog(fileItem.name, fileItem.folder, 'processing', '--:--', 'extract');

        // Extract
        const result = await audioExtractorService.extractAudio({
          inputPath: fileItem.path,
          outputFormat: format,
          keepStructure,
          overwrite,
          onLog: (logStr) => {
            // Option to pipe detailed ffmpeg logs here if needed
            // console.log(logStr)
          }
        });

        // Update post-extraction
        if (result.success) {
          emitLog(
            fileItem.name,
            fileItem.folder,
            'completed',
            new Date().toISOString(),
            'extract',
            result.outputPath,
          );

          if (capcutAttachAvailable) {
            emitLog(
              fileItem.name,
              fileItem.folder,
              'processing',
              new Date().toISOString(),
              'capcut_attach',
              'Đang gắn audio vào project CapCut...',
            );
            const projectPathForAttach = capcutProjectPath || fileItem.folder;
            const attachResult = await capcutProjectBatchService.attachAudioToProject({
              capcutProjectPath: projectPathForAttach,
              extractedAudioPath: result.outputPath,
            });
            emitLog(
              fileItem.name,
              fileItem.folder,
              attachResult.success ? 'completed' : (attachResult.skipped ? 'info' : 'error'),
              new Date().toISOString(),
              'capcut_attach',
              `${attachResult.message} (project: ${projectPathForAttach})`,
            );
          }
        } else {
          emitLog(
            fileItem.name,
            fileItem.folder,
            'error',
            new Date().toISOString(),
            'extract',
            result.error,
          );
        }

        emitProgress({ 
          totalPercent: Math.round((currentIdx / totalFiles) * 100), 
          currentFile: fileItem.name,
          currentPercent: 100
        });
      }

      activeExtractionProcess = false;
      return { success: true };
    } catch (err: any) {
      activeExtractionProcess = false;
      return { success: false, error: err.message };
    }
  });

  // ---- Video Splitter Handlers ----

  ipcMain.handle('cutVideo:getVideoInfo', async (_, filePath: string) => {
    return await cutVideoService.getVideoInfo(filePath);
  });

  ipcMain.handle('cutVideo:getMediaInfo', async (_, filePath: string) => {
    return await videoAudioMixerService.getMediaInfo(filePath);
  });

  ipcMain.handle('cutVideo:detectSilences', async (_event, options: {
    inputPath: string;
    noiseDb?: number;
    minDurationSec?: number;
  }) => {
    const inputPath = options?.inputPath;
    if (!inputPath) {
      return { success: false, error: 'Thiếu inputPath.' };
    }

    const info = await videoAudioMixerService.getMediaInfo(inputPath);
    if (!info.success || !info.data) {
      return { success: false, error: info.error || 'Không đọc được metadata.' };
    }

    const durationSec = info.data.duration;
    if (!info.data.hasAudio) {
      return { success: true, data: { durationSec, silences: [] } };
    }

    return await detectSilences({
      inputPath,
      noiseDb: options.noiseDb,
      minDurationSec: options.minDurationSec,
      durationSec,
    });
  });

  ipcMain.handle('cutVideo:stopVideoSplit', async () => {
    videoSplitterService.stop();
    return { success: true };
  });

  ipcMain.handle('cutVideo:startVideoSplit', async (event, options: {
    inputPath: string,
    clips: { name: string; startStr: string; durationStr: string }[]
  }) => {
    const sender = event.sender;

    const emitLog = (logData: any) => {
       sender.send('cutVideo:splitLog', logData);
    };

    const emitProgress = (progressData: any) => {
       sender.send('cutVideo:splitProgress', progressData);
    };

    try {
      const result = await videoSplitterService.splitVideo({
        inputPath: options.inputPath,
        clips: options.clips,
        onProgress: emitProgress,
        onLog: emitLog
      });
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---- Video Merger Handlers ----
  ipcMain.handle('cutVideo:scanRenderedForMerge', async (_, options: {
    folders: string[];
    mode: '16_9' | '9_16';
  }) => {
    return await videoMergerService.scanFoldersForRenderedVideos(options);
  });

  ipcMain.handle('cutVideo:stopVideoMerge', async () => {
    videoMergerService.stop();
    return { success: true };
  });

  ipcMain.handle('cutVideo:startVideoMerge', async (event, options: {
    folders: string[];
    mode: '16_9' | '9_16';
    outputDir: string;
  }) => {
    const sender = event.sender;

    const emitProgress = (data: {
      percent: number;
      stage: 'scan' | 'preflight' | 'concat' | 'completed' | 'stopped' | 'error';
      message: string;
      currentFile?: string;
    }) => {
      sender.send('cutVideo:mergeProgress', data);
    };

    const emitLog = (data: {
      status: 'info' | 'success' | 'error' | 'processing';
      message: string;
      time: string;
    }) => {
      sender.send('cutVideo:mergeLog', data);
    };

    try {
      const result = await videoMergerService.mergeRenderedVideos({
        ...options,
        onProgress: emitProgress,
        onLog: emitLog,
      });
      return result;
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ---- Video Audio Mixer Handlers ----
  ipcMain.handle('cutVideo:stopVideoAudioMix', async () => {
    videoAudioMixerService.stop();
    return { success: true };
  });

  ipcMain.handle('cutVideo:startVideoAudioMix', async (event, options: {
    videoPath: string;
    audioPaths: string[];
    videoVolumePercent: number;
    musicVolumePercent: number;
    outputPath?: string;
  }) => {
    const sender = event.sender;

    const emitProgress = (data: {
      percent: number;
      stage: 'preflight' | 'building_playlist' | 'mixing' | 'completed' | 'stopped' | 'error';
      message: string;
      currentFile?: string;
    }) => {
      sender.send('cutVideo:audioMixProgress', data);
    };

    const emitLog = (data: {
      status: 'info' | 'success' | 'error' | 'processing';
      message: string;
      time: string;
    }) => {
      sender.send('cutVideo:audioMixLog', data);
    };

    try {
      const result = await videoAudioMixerService.mixVideoWithPlaylist({
        ...options,
        onProgress: emitProgress,
        onLog: emitLog,
      });
      return result;
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ---- CapCut Project Batch Handlers ----
  ipcMain.handle('cutVideo:scanVideosForCapcut', async (_, folderPath: string) => {
    return await capcutProjectBatchService.scanVideos(folderPath);
  });

  ipcMain.handle('cutVideo:stopCapcutProjectBatch', async () => {
    capcutProjectBatchService.stop();
    return { success: true };
  });

  ipcMain.handle('cutVideo:startCapcutProjectBatch', async (event, options: {
    sourceFolderPath: string;
    capcutDraftsPath?: string;
    namingMode: 'index_plus_filename' | 'month_day_suffix';
  }) => {
    const sender = event.sender;
    const draftsPath = options.capcutDraftsPath
      || AppSettingsService.getAll().capcutDraftsPath
      || DEFAULT_CAPCUT_DRAFTS_PATH;
    return await capcutProjectBatchService.createProjects({
      sourceFolderPath: options.sourceFolderPath,
      capcutDraftsPath: draftsPath,
      namingMode: options.namingMode,
      onProgress: (data) => sender.send('cutVideo:capcutProgress', data),
      onLog: (data) => sender.send('cutVideo:capcutLog', data),
    });
  });
}
