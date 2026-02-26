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
  startVideoSplit: (options: {
    inputPath: string;
    clips: { name: string; startStr: string; durationStr: string }[];
  }) => Promise<{ success: boolean; error?: string }>;
  stopVideoSplit: () => Promise<{ success: boolean }>;
  onSplitProgress: (callback: (data: { totalPercent: number; currentClipName: string; currentPercent: number }) => void) => () => void;
  onSplitLog: (callback: (data: { clipName: string; status: string; time: string }) => void) => () => void;
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
  }
};
