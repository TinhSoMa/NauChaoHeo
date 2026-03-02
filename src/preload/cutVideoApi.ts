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

export interface CutVideoAPI {
  scanFolder: (folderPath: string) => Promise<ScanFolderResult>;
  startAudioExtraction: (options: {
    folders: string[];
    format: 'mp3' | 'aac' | 'wav' | 'flac';
    keepStructure: boolean;
    overwrite: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  stopExtraction: () => Promise<{ success: boolean }>;
  onExtractionProgress: (callback: (data: { totalPercent: number; currentFile: string; currentPercent: number }) => void) => () => void;
  onExtractionLog: (callback: (data: { file: string; folder: string; status: string; time: string }) => void) => () => void;
  
  getVideoInfo: (filePath: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getMediaInfo: (filePath: string) => Promise<{ success: boolean; data?: { duration: number; hasVideo: boolean; hasAudio: boolean; width?: number; height?: number }; error?: string }>;
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
};
