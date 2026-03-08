import { useState, useCallback } from 'react';
import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';

export interface CutVideoFolderInfo {
  path: string;
  count: number;
  firstVideoName?: string;
}

export function useFolderManager() {
  const [folders, setFolders] = useState<CutVideoFolderInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Optional: Auto-save via Project Feature State if needed on project load
  useProjectFeatureState<{
    folders?: CutVideoFolderInfo[];
    selectedFile?: string | null;
  }>({
    feature: 'caption', // Use 'caption' feature space, or another distinct space if CutVideo has its own
    fileName: 'cut-video-state.json',
    serialize: () => ({ folders, selectedFile }),
    deserialize: (saved) => {
      if (saved.folders) setFolders(saved.folders);
      if (saved.selectedFile) setSelectedFile(saved.selectedFile);
    },
    deps: [folders, selectedFile],
  });

  const handleAddFolders = useCallback(async () => {
    try {
      // @ts-ignore - electronAPI is setup in global.d.ts
      const result = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openDirectory', 'multiSelections']
      }) as { canceled: boolean; filePaths: string[] };

      if (result?.canceled || !result?.filePaths?.length) return;

      const newFolders = [...folders];
      
      for (const folderPath of result.filePaths) {
        // Skip if already added
        if (newFolders.some(f => f.path === folderPath)) continue;

        // @ts-ignore
        const scanResult = await window.electronAPI.cutVideo.scanFolder(folderPath);
        if (scanResult.success && scanResult.data) {
          const firstMedia = scanResult.data.mediaFiles[0];
          newFolders.push({
            path: scanResult.data.folderPath,
            count: scanResult.data.count,
            firstVideoName: firstMedia ? firstMedia.split(/[/\\]/).pop() : undefined
          });
        }
      }

      setFolders(newFolders);
    } catch (err) {
      console.error('Lỗi khi thêm thư mục:', err);
    }
  }, [folders]);

  const handleRemoveFolder = useCallback((pathToRemove: string) => {
    setFolders(prev => prev.filter(f => f.path !== pathToRemove));
  }, []);

  const handleSelectVideoFile = useCallback(async () => {
     try {
       // @ts-ignore
       const result = await window.electronAPI.invoke('dialog:openFile', {
         filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov'] }],
         properties: ['openFile']
       }) as { canceled: boolean; filePaths: string[] };

       if (!result?.canceled && result?.filePaths?.length) {
         setSelectedFile(result.filePaths[0]);
       }
     } catch (err) {
       console.error('Lỗi khi chọn file video:', err);
     }
  }, []);

  const handleRemoveVideoFile = useCallback(() => {
    setSelectedFile(null);
  }, []);

  return {
    folders,
    selectedFile,
    handleAddFolders,
    handleRemoveFolder,
    handleSelectVideoFile,
    handleRemoveVideoFile
  };
}
