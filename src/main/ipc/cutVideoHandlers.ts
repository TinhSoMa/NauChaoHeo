import { ipcMain } from 'electron';
import { cutVideoService } from '../services/cutVideo/cutVideoService';
import { audioExtractorService } from '../services/cutVideo/audioExtractorService';
import { videoSplitterService } from '../services/cutVideo/videoSplitterService';
import { videoMergerService } from '../services/cutVideo/videoMergerService';

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
    overwrite: boolean 
  }) => {
    activeExtractionProcess = true;
    const { folders, format, keepStructure, overwrite } = options;
    const sender = event.sender;

    const emitLog = (file: string, folder: string, status: string, time: string) => {
       sender.send('cutVideo:extractionLog', { file, folder, status, time });
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

      // 2. Process each file
      let currentIdx = 0;
      for (const fileItem of filesToProcess) {
        if (!activeExtractionProcess) {
          emitLog(fileItem.name, fileItem.folder, 'error', '--:--');
          break; // Stopped by user
        }

        currentIdx++;
        // Update total progress
        emitProgress({ 
          totalPercent: Math.round(((currentIdx - 1) / totalFiles) * 100), 
          currentFile: fileItem.name,
          currentPercent: 0
        });
        
        emitLog(fileItem.name, fileItem.folder, 'processing', '--:--');

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
          emitLog(fileItem.name, fileItem.folder, 'completed', new Date().toISOString());
        } else {
          emitLog(fileItem.name, fileItem.folder, 'error', new Date().toISOString());
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
}
