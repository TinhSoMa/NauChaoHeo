import { useState, useCallback, useEffect } from 'react';
import { SubtitleEntry } from '../CaptionTypes';
import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';
import { InputType } from '../../../config/captionConfig';

interface UseCaptionFileManagementProps {
  inputType: InputType;
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
}

export function useCaptionFileManagement({ inputType, onProgress }: UseCaptionFileManagementProps) {
  const [filePath, setFilePath] = useState('');
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);
  const [folderVideos, setFolderVideos] = useState<Record<string, { name: string; fullPath: string; duration: number }>>({});

  // ========== AUTO SAVE/LOAD VÀO PROJECT ==========
  useProjectFeatureState<{
    filePath?: string;
    entries?: SubtitleEntry[];
  }>({
    feature: 'caption',
    fileName: 'caption-file.json',
    serialize: () => ({
      filePath,
      entries,
    }),
    deserialize: (saved) => {
      if (saved.filePath) setFilePath(saved.filePath);
      if (saved.entries) setEntries(saved.entries);
    },
    deps: [filePath, entries],
  });

  const handleBrowseFile = useCallback(async () => {
    try {
      let filters = undefined;
      let properties = ['openFile'];

      if (inputType === 'srt') {
        filters = [{ name: 'SRT Files', extensions: ['srt'] }];
      } else if (inputType === 'draft') {
        properties = ['openDirectory', 'multiSelections'];
      }

      // @ts-ignore - electronAPI is globally defined
      const result = await window.electronAPI.invoke('dialog:openFile', { filters, properties }) as { 
        canceled: boolean; 
        filePaths: string[] 
      };

      if (result?.canceled || !result?.filePaths?.length) return;

      if (inputType === 'draft') {
        setFilePath(result.filePaths.join('; '));
        setEntries([]);
        if (onProgress) {
            onProgress({ 
            current: 0, 
            total: result.filePaths.length, 
            message: `Đã chọn ${result.filePaths.length} thư mục dự án CapCut` 
            });
        }
        return;
      }

      const selectedPath = result.filePaths[0];
      setFilePath(selectedPath);

      // Parse depending on file type
      // @ts-ignore
      const parseResult = inputType === 'srt'
        ? await window.electronAPI.caption.parseSrt(selectedPath)
        : await window.electronAPI.caption.parseDraft(selectedPath);

      if (parseResult.success && parseResult.data) {
        setEntries(parseResult.data.entries);
        if (onProgress) {
            onProgress({ 
            current: 0, 
            total: parseResult.data.totalEntries, 
            message: `Đã load ${parseResult.data.totalEntries} dòng từ ${inputType === 'srt' ? 'SRT' : 'Draft JSON'}` 
            });
        }
      } else {
        if (onProgress) {
            onProgress({ current: 0, total: 0, message: `Lỗi: ${parseResult.error}` });
        }
      }
    } catch (err) {
        if (onProgress) {
            onProgress({ current: 0, total: 0, message: `Lỗi: ${err}` });
        }
    }
  }, [inputType, onProgress]);

  useEffect(() => {
    if (inputType !== 'draft' || !filePath) {
      setFolderVideos({});
      return;
    }

    const paths = filePath.split('; ');
    const fetchVideos = async () => {
      const newFolderVideos: Record<string, { name: string; fullPath: string; duration: number }> = {};
      for (const p of paths) {
        try {
          // @ts-ignore
          const res = await window.electronAPI.captionVideo.findBestVideoInFolders([p]);
          if (res.success && res.data?.videoPath) {
             const videoName = res.data.videoPath.split(/[/\\]/).pop();
             if (videoName) {
               newFolderVideos[p] = { 
                 name: videoName, 
                 fullPath: res.data.videoPath,
                 duration: res.data.metadata?.duration || 0
               };
             }
          }
        } catch (e) {
          console.error('Error finding video for folder', p, e);
        }
      }
      setFolderVideos(newFolderVideos);
    };

    fetchVideos();
  }, [filePath, inputType]);

  // First video path for preview
  const firstVideoPath = Object.values(folderVideos)[0]?.fullPath || null;

  return {
    filePath, setFilePath,
    entries, setEntries,
    folderVideos,
    firstVideoPath,
    handleBrowseFile
  };
}
