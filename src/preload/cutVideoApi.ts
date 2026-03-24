import { ipcRenderer } from 'electron';

export interface ScanFolderResult {
  success: boolean;
  data?: {
    folderPath: string;
    mediaFiles: string[];
    count: number;
  };
  error?: string;
}

export interface ScanVideosForCapcutResult {
  success: boolean;
  data?: {
    folderPath: string;
    videos: Array<{
      fileName: string;
      fullPath: string;
      ext: string;
    }>;
    count: number;
  };
  error?: string;
}

export interface CapcutBatchResult {
  success: boolean;
  data?: {
    total: number;
    created: number;
    failed: number;
    stopped: boolean;
    projects: Array<{
      videoName: string;
      projectName: string;
      status: 'success' | 'error';
      copiedClipCount?: number;
      assetFolder?: string;
      error?: string;
    }>;
  };
  error?: string;
}

export interface CutVideoAPI {
  scanFolder: (folderPath: string) => Promise<ScanFolderResult>;
  startAudioExtraction: (options: {
    folders: string[];
    format: 'mp3' | 'aac' | 'wav' | 'flac';
    keepStructure: boolean;
    overwrite: boolean;
    capcutProjectPath?: string;
    capcutDraftsPath?: string;
    autoAttachToCapcut?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  stopExtraction: () => Promise<{ success: boolean }>;
  onExtractionProgress: (callback: (data: { totalPercent: number; currentFile: string; currentPercent: number }) => void) => () => void;
  onExtractionLog: (callback: (data: {
    file: string;
    folder: string;
    status: string;
    time: string;
    phase?: 'extract' | 'capcut_attach';
    detail?: string;
  }) => void) => () => void;
  
  getVideoInfo: (filePath: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getMediaInfo: (filePath: string) => Promise<{ success: boolean; data?: { duration: number; hasVideo: boolean; hasAudio: boolean; width?: number; height?: number }; error?: string }>;
  detectSilences: (options: {
    inputPath: string;
    noiseDb?: number;
    minDurationSec?: number;
  }) => Promise<{ success: boolean; data?: { durationSec: number; silences: Array<{ startSec: number; endSec: number; durationSec: number }> }; error?: string }>;
  startVideoSplit: (options: {
    inputPath: string;
    clips: { name: string; startStr: string; durationStr: string }[];
  }) => Promise<{ success: boolean; error?: string }>;
  stopVideoSplit: () => Promise<{ success: boolean }>;
  onSplitProgress: (callback: (data: { totalPercent: number; currentClipName: string; currentPercent: number }) => void) => () => void;
  onSplitLog: (callback: (data: { clipName: string; status: string; time: string }) => void) => () => void;

  scanRenderedForMerge: (options: {
    folders: string[];
    mode: '16_9' | '9_16';
  }) => Promise<{
    success: boolean;
    data?: {
      canMerge: boolean;
      outputAspect: '16_9' | '9_16';
      items: Array<{
        inputFolder: string;
        scanDir: string;
        status: 'ok' | 'missing' | 'invalid' | 'mismatch';
        message?: string;
        matchedFilePath?: string;
        fileName?: string;
        metadata?: {
          duration: number;
          width: number;
          height: number;
          fps: number;
          hasAudio: boolean;
          videoCodec: string;
          audioCodec?: string;
        };
      }>;
      sortedVideoPaths: string[];
      blockingReason?: string;
    };
    error?: string;
  }>;
  startVideoMerge: (options: {
    folders: string[];
    mode: '16_9' | '9_16';
    outputDir: string;
  }) => Promise<{ success: boolean; data?: { outputPath: string }; error?: string }>;
  stopVideoMerge: () => Promise<{ success: boolean }>;
  onMergeProgress: (callback: (data: {
    percent: number;
    stage: 'scan' | 'preflight' | 'concat' | 'completed' | 'stopped' | 'error';
    message: string;
    currentFile?: string;
  }) => void) => () => void;
  onMergeLog: (callback: (data: {
    status: 'info' | 'success' | 'error' | 'processing';
    message: string;
    time: string;
  }) => void) => () => void;

  startVideoAudioMix: (options: {
    videoPath: string;
    audioPaths: string[];
    videoVolumePercent: number;
    musicVolumePercent: number;
    outputPath?: string;
  }) => Promise<{ success: boolean; data?: { outputPath: string }; error?: string }>;
  stopVideoAudioMix: () => Promise<{ success: boolean }>;
  onAudioMixProgress: (callback: (data: {
    percent: number;
    stage: 'preflight' | 'building_playlist' | 'mixing' | 'completed' | 'stopped' | 'error';
    message: string;
    currentFile?: string;
  }) => void) => () => void;
  onAudioMixLog: (callback: (data: {
    status: 'info' | 'success' | 'error' | 'processing';
    message: string;
    time: string;
  }) => void) => () => void;

  scanVideosForCapcut: (folderPath: string) => Promise<ScanVideosForCapcutResult>;
  startCapcutProjectBatch: (options: {
    sourceFolderPath: string;
    capcutDraftsPath: string;
    namingMode: 'index_plus_filename' | 'month_day_suffix';
  }) => Promise<CapcutBatchResult>;
  stopCapcutProjectBatch: () => Promise<{ success: boolean }>;
  onCapcutProgress: (callback: (data: {
    total: number;
    current: number;
    percent: number;
    currentVideoName?: string;
    stage: 'preflight' | 'scanning' | 'creating' | 'copying_clips' | 'completed' | 'stopped' | 'error';
    message: string;
  }) => void) => () => void;
  onCapcutLog: (callback: (data: {
    time: string;
    status: 'info' | 'processing' | 'success' | 'error';
    message: string;
    videoName?: string;
    projectName?: string;
  }) => void) => () => void;
}

export const cutVideoApi: CutVideoAPI = {
  scanFolder: (folderPath: string) => ipcRenderer.invoke('cutVideo:scanFolder', folderPath),
  startAudioExtraction: (options) => ipcRenderer.invoke('cutVideo:startAudioExtraction', options),
  stopExtraction: () => ipcRenderer.invoke('cutVideo:stopExtraction'),
  onExtractionProgress: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:extractionProgress', subscription);
    return () => {
      ipcRenderer.removeListener('cutVideo:extractionProgress', subscription);
    };
  },
  onExtractionLog: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:extractionLog', subscription);
    return () => {
      ipcRenderer.removeListener('cutVideo:extractionLog', subscription);
    };
  },

  getVideoInfo: (filePath: string) => ipcRenderer.invoke('cutVideo:getVideoInfo', filePath),
  getMediaInfo: (filePath: string) => ipcRenderer.invoke('cutVideo:getMediaInfo', filePath),
  detectSilences: (options) => ipcRenderer.invoke('cutVideo:detectSilences', options),
  startVideoSplit: (options) => ipcRenderer.invoke('cutVideo:startVideoSplit', options),
  stopVideoSplit: () => ipcRenderer.invoke('cutVideo:stopVideoSplit'),
  onSplitProgress: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:splitProgress', subscription);
    return () => ipcRenderer.removeListener('cutVideo:splitProgress', subscription);
  },
  onSplitLog: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:splitLog', subscription);
    return () => ipcRenderer.removeListener('cutVideo:splitLog', subscription);
  },
  scanRenderedForMerge: (options) => ipcRenderer.invoke('cutVideo:scanRenderedForMerge', options),
  startVideoMerge: (options) => ipcRenderer.invoke('cutVideo:startVideoMerge', options),
  stopVideoMerge: () => ipcRenderer.invoke('cutVideo:stopVideoMerge'),
  onMergeProgress: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:mergeProgress', subscription);
    return () => ipcRenderer.removeListener('cutVideo:mergeProgress', subscription);
  },
  onMergeLog: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:mergeLog', subscription);
    return () => ipcRenderer.removeListener('cutVideo:mergeLog', subscription);
  },
  startVideoAudioMix: (options) => ipcRenderer.invoke('cutVideo:startVideoAudioMix', options),
  stopVideoAudioMix: () => ipcRenderer.invoke('cutVideo:stopVideoAudioMix'),
  onAudioMixProgress: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:audioMixProgress', subscription);
    return () => ipcRenderer.removeListener('cutVideo:audioMixProgress', subscription);
  },
  onAudioMixLog: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:audioMixLog', subscription);
    return () => ipcRenderer.removeListener('cutVideo:audioMixLog', subscription);
  },
  scanVideosForCapcut: (folderPath: string) => ipcRenderer.invoke('cutVideo:scanVideosForCapcut', folderPath),
  startCapcutProjectBatch: (options) => ipcRenderer.invoke('cutVideo:startCapcutProjectBatch', options),
  stopCapcutProjectBatch: () => ipcRenderer.invoke('cutVideo:stopCapcutProjectBatch'),
  onCapcutProgress: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:capcutProgress', subscription);
    return () => ipcRenderer.removeListener('cutVideo:capcutProgress', subscription);
  },
  onCapcutLog: (callback) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on('cutVideo:capcutLog', subscription);
    return () => ipcRenderer.removeListener('cutVideo:capcutLog', subscription);
  },
};
