import { Dispatch, SetStateAction, useRef, useState } from 'react';
import {
  Chapter,
  PreparePromptResult,
  STORY_IPC_CHANNELS,
  StoryTranslateGeminiWebQueueResult
} from '@shared/types';
import { extractTranslatedTitle } from '../utils/chapterUtils';
import type { ProcessingChapterInfo, StoryStatus } from '../types';

interface UseStoryGeminiWebQueueTranslationParams {
  chapters: Chapter[];
  sourceLang: string;
  targetLang: string;
  model: string;
  retranslateExisting: boolean;
  isChapterIncluded: (id: string) => boolean;
  translatedChapters: Map<string, string>;
  setStatus: Dispatch<SetStateAction<StoryStatus>>;
  setProcessingChapters: Dispatch<SetStateAction<Map<string, ProcessingChapterInfo>>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setTranslatedTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, 'api' | 'token'>>>;
}

export function useStoryGeminiWebQueueTranslation(
  params: UseStoryGeminiWebQueueTranslationParams
) {
  const {
    chapters,
    sourceLang,
    targetLang,
    model,
    retranslateExisting,
    isChapterIncluded,
    translatedChapters,
    setStatus,
    setProcessingChapters,
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods
  } = params;

  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const shouldStopRef = useRef(false);
  const [isTranslating, setIsTranslating] = useState(false);

  const getEligibleChapters = (): Chapter[] => {
    return chapters.filter((chapter) => {
      if (!isChapterIncluded(chapter.id)) {
        return false;
      }
      if (!retranslateExisting && translatedChapters.has(chapter.id)) {
        return false;
      }
      return true;
    });
  };

  const handleStopTranslation = () => {
    shouldStopRef.current = true;
  };

  const handleTranslateAll = async () => {
    const chaptersToTranslate = getEligibleChapters();
    if (chaptersToTranslate.length === 0) {
      alert('Không có chương hợp lệ để dịch Web Queue.');
      return;
    }

    shouldStopRef.current = false;
    setIsTranslating(true);
    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });
    const batchConversationKey = `story-webqueue-${Date.now()}`;
    let isFirstTurn = true;

    let processed = 0;

    try {
      for (const chapter of chaptersToTranslate) {
        if (shouldStopRef.current) {
          break;
        }

        setProcessingChapters((prev) => {
          const next = new Map(prev);
          next.set(chapter.id, {
            startTime: Date.now(),
            workerId: 1,
            channel: 'token'
          });
          return next;
        });

        try {
          const prepareResult = await window.electronAPI.invoke(
            STORY_IPC_CHANNELS.PREPARE_PROMPT,
            {
              chapterContent: chapter.content,
              sourceLang,
              targetLang,
              model
            }
          ) as PreparePromptResult;

          if (!prepareResult.success || !prepareResult.prompt) {
            console.error(`[StoryGeminiWebQueue] Prepare prompt failed for chapter ${chapter.id}:`, prepareResult.error);
          } else {
            const translateResult = await window.electronAPI.invoke(
              STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_GEMINI_WEB_QUEUE,
              {
                prompt: prepareResult.prompt,
                model,
                timeoutMs: 120000,
                conversationKey: batchConversationKey,
                resetConversation: isFirstTurn,
                metadata: {
                  chapterId: chapter.id,
                  chapterTitle: chapter.title
                }
              }
            ) as StoryTranslateGeminiWebQueueResult;
            isFirstTurn = false;

            if (translateResult.success && translateResult.data) {
              setTranslatedChapters((prev) => {
                const next = new Map(prev);
                next.set(chapter.id, translateResult.data!);
                return next;
              });
              setTranslatedTitles((prev) => {
                const next = new Map(prev);
                next.set(chapter.id, extractTranslatedTitle(translateResult.data!, chapter.id));
                return next;
              });
              setChapterModels((prev) => new Map(prev).set(chapter.id, model));
              setChapterMethods((prev) => new Map(prev).set(chapter.id, 'token'));
            } else {
              console.error(
                `[StoryGeminiWebQueue] Translate failed for chapter ${chapter.id}:`,
                translateResult.errorCode,
                translateResult.error
              );
            }
          }
        } catch (error) {
          console.error(`[StoryGeminiWebQueue] Unexpected error at chapter ${chapter.id}:`, error);
        } finally {
          setProcessingChapters((prev) => {
            const next = new Map(prev);
            next.delete(chapter.id);
            return next;
          });
          processed += 1;
          setBatchProgress({
            current: processed,
            total: chaptersToTranslate.length
          });
        }
      }
    } finally {
      setIsTranslating(false);
      setStatus('idle');
      setBatchProgress(null);
    }
  };

  return {
    isTranslating,
    batchProgress,
    handleTranslateAll,
    handleStopTranslation,
    eligibleChapterCount: getEligibleChapters().length
  };
}
