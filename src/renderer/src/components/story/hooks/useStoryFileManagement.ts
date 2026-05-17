import { Dispatch, SetStateAction } from 'react';
import { Chapter, ParseStoryResult, STORY_IPC_CHANNELS } from '@shared/types';
import { StoryStatus } from '../types';

interface UseStoryFileManagementParams {
  isTranslationActive?: boolean;
  setFilePath: Dispatch<SetStateAction<string>>;
  setChapters: Dispatch<SetStateAction<Chapter[]>>;
  setExcludedChapterIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedChapterId: Dispatch<SetStateAction<string | null>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setViewMode: Dispatch<SetStateAction<'original' | 'translated' | 'summary'>>;
  setStatus: Dispatch<SetStateAction<StoryStatus>>;
}

export interface ParseFileOptions {
  keepTranslations?: boolean;
  keepSelection?: boolean;
}

/**
 * Custom hook to manage story file operations
 * Handles file browsing and parsing
 */
export function useStoryFileManagement(params: UseStoryFileManagementParams) {
  const {
    isTranslationActive = false,
    setFilePath,
    setChapters,
    setExcludedChapterIds,
    setSelectedChapterId,
    setTranslatedChapters,
    setViewMode,
    setStatus
  } = params;

  const handleBrowse = async () => {
    if (isTranslationActive) {
      alert('Đang có tiến trình dịch. Vui lòng dừng dịch trước khi đổi file.');
      return;
    }

    const result = await window.electronAPI.invoke('dialog:openFile', {
      filters: [{ name: 'Text/Epub', extensions: ['txt', 'epub'] }]
    }) as { canceled: boolean; filePaths: string[] };

    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0];
      setFilePath(path);
      await parseFile(path);
    }
  };

  const parseFile = async (
    path: string,
    options?: ParseFileOptions
  ): Promise<boolean> => {
    if (isTranslationActive && !options?.keepTranslations) {
      console.warn('[useStoryFileManagement] Parse blocked while translation is running.');
      return false;
    }

    const shouldManageStatus = !isTranslationActive;
    if (shouldManageStatus) {
      setStatus('running');
    }
    try {
      const parseResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PARSE, path) as ParseStoryResult;
      if (parseResult.success && parseResult.chapters) {
        setChapters(parseResult.chapters);
        setExcludedChapterIds(new Set());
        if (parseResult.chapters.length > 0) {
          if (!options?.keepSelection) {
            setSelectedChapterId(parseResult.chapters[0].id);
          }
          if (!options?.keepTranslations) {
            setTranslatedChapters(new Map());
            setViewMode('original');
          }
        }
        return true;
      } else {
        console.error('[useStoryFileManagement] Loi parse file:', parseResult.error);
        return false;
      }
    } catch (error) {
      console.error('[useStoryFileManagement] Loi invoke story:parse:', error);
      return false;
    } finally {
      if (shouldManageStatus) {
        setStatus('idle');
      }
    }
  };

  return {
    handleBrowse,
    parseFile
  };
}
