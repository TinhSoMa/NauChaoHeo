import { Dispatch, SetStateAction } from 'react';
import { Chapter, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import { buildTokenKey } from '../utils/tokenUtils';
import { extractTranslatedTitle } from '../utils/chapterUtils';
import type { GeminiChatConfigLite } from '../types';

interface UseStoryTranslationParams {
  chapters: Chapter[];
  sourceLang: string;
  targetLang: string;
  model: string;
  translateMode: 'api' | 'token' | 'both';
  retranslateExisting: boolean;
  useProxy: boolean;
  isChapterIncluded: (id: string) => boolean;
  getPreferredTokenConfig: () => GeminiChatConfigLite | null;
  loadConfigurations: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
  setProcessingChapters: Dispatch<SetStateAction<Map<string, { startTime: number; workerId: number; channel: 'api' | 'token' }>>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setTranslatedTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, 'api' | 'token'>>>;
  setTokenContexts: Dispatch<SetStateAction<Map<string, { conversationId: string; responseId: string; choiceId: string }>>>;
  setViewMode: Dispatch<SetStateAction<'original' | 'translated' | 'summary'>>;
  translatedChapters: Map<string, string>;
}

/**
 * Custom hook to handle single chapter translation
 * Manages translation process, metadata validation, and state updates
 */
export function useStoryTranslation(params: UseStoryTranslationParams) {
  const {
    chapters,
    sourceLang,
    targetLang,
    model,
    translateMode,
    retranslateExisting,
    useProxy,
    isChapterIncluded,
    getPreferredTokenConfig,
    loadConfigurations,
    setStatus,
    setProcessingChapters,
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods,
    setTokenContexts,
    setViewMode,
    translatedChapters
  } = params;

  const handleTranslate = async (selectedChapterId: string | null) => {
    if (!selectedChapterId) return;
    if (!isChapterIncluded(selectedChapterId)) {
      alert('Chuong nay da bi loai tru khoi danh sach dich. Vui long bo chon "Loai tru" hoac chon chuong khac.');
      return;
    }

    // Kiểm tra nếu chương đã dịch và checkbox chưa được tick
    if (translatedChapters.has(selectedChapterId) && !retranslateExisting) {
      alert('⚠️ Chương này đã được dịch rồi.\n\nNếu muốn dịch lại, vui lòng tick vào "Dịch lại các chương đã dịch" ở phần cấu hình.');
      return;
    }
    
    const chapter = chapters.find(c => c.id === selectedChapterId);
    if (!chapter) return;

    setStatus('running');
    
    // Add processing status for single chapter
    setProcessingChapters(prev => {
      const next = new Map(prev);
      next.set(chapter.id, { 
        startTime: Date.now(), 
        workerId: 0, 
        channel: translateMode === 'token' ? 'token' : 'api' 
      });
      return next;
    });
    
    try {
      console.log('[useStoryTranslation] Dang chuan bi prompt...');
      // 1. Prepare Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang,
        model
      }) as PreparePromptResult;
      
      if (!prepareResult.success || !prepareResult.prompt) {
        throw new Error(prepareResult.error || 'Loi chuan bi prompt');
      }

      console.log('[useStoryTranslation] Da chuan bi prompt, dang gui den Gemini...');
      
      const method = translateMode === 'token' ? 'IMPIT' : 'API';
      const methodKey: 'api' | 'token' = method === 'IMPIT' ? 'token' : 'api';

      let selectedTokenConfig = method === 'IMPIT' ? getPreferredTokenConfig() : null;
      if (method === 'IMPIT' && !selectedTokenConfig) {
        await loadConfigurations();
        selectedTokenConfig = getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          alert('Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return;
        }
      }

      const tokenKey = method === 'IMPIT' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

      // 2. Send to Gemini for Translation
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
        prompt: prepareResult.prompt,
        model: model,
        method,
        webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
        useProxy: method === 'IMPIT' && useProxy,
        metadata: { 
          chapterId: selectedChapterId,
          validationRegex: 'hết\\s+chương|end\\s+of\\s+chapter|---\\s*hết\\s*---'
        }
      }) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };

      if (translateResult.success && translateResult.data) {
        // Validate metadata to prevent race condition
        if (translateResult.metadata?.chapterId !== selectedChapterId) {
          console.error(`[useStoryTranslation] ⚠️ RACE CONDITION DETECTED! Response chapterId (${translateResult.metadata?.chapterId}) !== selected (${selectedChapterId})`);
          throw new Error('Metadata validation failed - race condition detected');
        }
        
        // Client-side retry removed - handled by service with validationRegex
        
        // Lưu bản dịch vào Map cache
        setTranslatedChapters(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, translateResult.data!);
          return next;
        });

        setTranslatedTitles(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, extractTranslatedTitle(translateResult.data!, selectedChapterId));
          return next;
        });

        setChapterModels(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, model);
          return next;
        });

        setChapterMethods(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, methodKey);
          return next;
        });

        if (translateResult.context && translateResult.context.conversationId && tokenKey) {
          setTokenContexts(prev => {
            const next = new Map(prev);
            next.set(tokenKey, translateResult.context!);
            return next;
          });
        }

        // REMOVED: Saving to Project DB

        setViewMode('translated');
        console.log('[useStoryTranslation] Dich thanh cong!');
      } else {
        throw new Error(translateResult.error || 'Dich that bai');
      }

    } catch (error) {
      console.error('[useStoryTranslation] Loi trong qua trinh dich:', error);
      alert(`Loi dich thuat: ${error}`);
    } finally {
      setProcessingChapters(prev => {
        const next = new Map(prev);
        next.delete(chapter.id);
        return next;
      });
      setStatus('idle');
    }
  };

  return {
    handleTranslate
  };
}
