import { useState, useCallback } from 'react';
import { SubtitleEntry } from '../CaptionTypes';
import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';

interface UseCaptionFileManagementProps {
  inputType: 'srt' | 'draft';
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
}

export function useCaptionFileManagement({ inputType, onProgress }: UseCaptionFileManagementProps) {
  const [filePath, setFilePath] = useState('');
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);

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
      const filters = inputType === 'srt' 
        ? [{ name: 'SRT Files', extensions: ['srt'] }]
        : [{ name: 'JSON Files', extensions: ['json'] }];

      // @ts-ignore - electronAPI is globally defined
      const result = await window.electronAPI.invoke('dialog:openFile', { filters }) as { 
        canceled: boolean; 
        filePaths: string[] 
      };

      if (result?.canceled || !result?.filePaths?.length) return;

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

  return {
    filePath, setFilePath,
    entries, setEntries,
    handleBrowseFile
  };
}
