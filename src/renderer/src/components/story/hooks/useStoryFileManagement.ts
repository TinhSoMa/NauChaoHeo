import { Dispatch, SetStateAction } from 'react';
import { Chapter, ParseStoryResult, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';

interface UseStoryFileManagementParams {
  sourceLang: string;
  targetLang: string;
  model: string;
  setFilePath: Dispatch<SetStateAction<string>>;
  setChapters: Dispatch<SetStateAction<Chapter[]>>;
  setExcludedChapterIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedChapterId: Dispatch<SetStateAction<string | null>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setViewMode: Dispatch<SetStateAction<'original' | 'translated' | 'summary'>>;
  setStatus: Dispatch<SetStateAction<string>>;
}

export interface ParseFileOptions {
  keepTranslations?: boolean;
  keepSelection?: boolean;
}

/**
 * Custom hook to manage story file operations
 * Handles file browsing, parsing, and prompt saving
 */
export function useStoryFileManagement(params: UseStoryFileManagementParams) {
  const {
    sourceLang,
    targetLang,
    model,
    setFilePath,
    setChapters,
    setExcludedChapterIds,
    setSelectedChapterId,
    setTranslatedChapters,
    setViewMode,
    setStatus
  } = params;

  const handleBrowse = async () => {
    const result = await window.electronAPI.invoke('dialog:openFile', {
      filters: [{ name: 'Text/Epub', extensions: ['txt', 'epub'] }]
    }) as { canceled: boolean; filePaths: string[] };

    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0];
      setFilePath(path);
      parseFile(path);
    }
  };

  const parseFile = async (
    path: string,
    options?: ParseFileOptions
  ): Promise<boolean> => {
    setStatus('running');
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
      setStatus('idle');
    }
  };

  const handleSavePrompt = async (selectedChapterId: string | null, chapters: Chapter[]) => {
    if (!selectedChapterId) return;
    const chapter = chapters.find(c => c.id === selectedChapterId);
    if (!chapter) return;

    try {
      const result = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang,
        model
      }) as PreparePromptResult;

      if (result.success && result.prompt) {
        const promptString = JSON.stringify(result.prompt);
        await window.electronAPI.invoke(STORY_IPC_CHANNELS.SAVE_PROMPT, promptString);
      }
    } catch (e) {
      console.error('[useStoryFileManagement] Loi luu prompt:', e);
    }
  };

  return {
    handleBrowse,
    parseFile,
    handleSavePrompt
  };
}
