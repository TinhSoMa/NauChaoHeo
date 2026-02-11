import { useState } from 'react';
import { Chapter, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import { GeminiChatConfigLite, TokenContext, ProcessingChapterInfo } from '../types';

interface UseStorySummaryGenerationProps {
  chapters: Chapter[];
  translatedChapters: Map<string, string>;
  translatedTitles: Map<string, string>;
  sourceLang: string;
  targetLang: string;
  model: string;
  translateMode: 'api' | 'token' | 'both';
  summaries: Map<string, string>;
  summaryTitles: Map<string, string>;
  chapterModels: Map<string, string>;
  chapterMethods: Map<string, 'api' | 'token'>;
  tokenContexts: Map<string, TokenContext>;
  setSummaries: (summaries: Map<string, string>) => void;
  setSummaryTitles: (titles: Map<string, string>) => void;
  setChapterModels: (models: Map<string, string>) => void;
  setChapterMethods: (methods: Map<string, 'api' | 'token'>) => void;
  setTokenContexts: (contexts: Map<string, TokenContext>) => void;
  setProcessingChapters: (update: (prev: Map<string, ProcessingChapterInfo>) => Map<string, ProcessingChapterInfo>) => void;
  setStatus: (status: string) => void;
  setViewMode: (mode: 'original' | 'translated' | 'summary') => void;
  useProxy: boolean;
  loadConfigurations: () => Promise<void>;
  getPreferredTokenConfig: () => GeminiChatConfigLite | null;
}

// Helper functions
const extractCookieKey = (cookie: string): string => {
  const trimmed = cookie.trim();
  const psid1 = trimmed.match(/__Secure-1PSID=([^;\s]+)/)?.[1] || '';
  const psid3 = trimmed.match(/__Secure-3PSID=([^;\s]+)/)?.[1] || '';
  const combined = [psid1, psid3].filter(Boolean).join('|');
  return combined || trimmed;
};

const buildTokenKey = (config: GeminiChatConfigLite): string => {
  return `${extractCookieKey(config.cookie || '')}|${(config.atToken || '').trim()}`;
};

export function useStorySummaryGeneration({
  chapters,
  translatedChapters,
  translatedTitles,
  sourceLang,
  targetLang,
  model,
  translateMode,
  summaries,
  summaryTitles,
  chapterModels,
  chapterMethods,
  tokenContexts,
  setSummaries,
  setSummaryTitles,
  setChapterModels,
  setChapterMethods,
  setTokenContexts,
  setStatus,
  setViewMode,
  useProxy,
  loadConfigurations,
  getPreferredTokenConfig,
  setProcessingChapters
}: UseStorySummaryGenerationProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateSummary = async (selectedChapterId: string | null, retranslateSummary: boolean = false) => {
    if (!selectedChapterId) return;
    
    // Check if chapter is already summarized and not forced re-summarize
    if (summaries.has(selectedChapterId) && !retranslateSummary) {
      const confirm = window.confirm('Chương này đã được tóm tắt rồi. Bạn có muốn tóm tắt lại không?');
      if (!confirm) return;
    }

    // Check source data (translated content)
    const sourceContent = translatedChapters.get(selectedChapterId);
    if (!sourceContent) {
      alert('Không tìm thấy bản dịch cho chương này. Vui lòng dịch truyện trước.');
      return;
    }

    setIsGenerating(true);
    setStatus('running');
    
    try {
      console.log('[useStorySummaryGeneration] Đang chuẩn bị prompt tóm tắt...');
      // 1. Prepare Summary Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT, {
        chapterContent: sourceContent,
        sourceLang,
        targetLang
      }) as PreparePromptResult;
      
      if (!prepareResult.success || !prepareResult.prompt) {
        throw new Error(prepareResult.error || 'Lỗi chuẩn bị prompt tóm tắt');
      }

      console.log('[useStorySummaryGeneration] Đã chuẩn bị prompt, đang gửi đến Gemini...');
      
      // Use IMPIT for token mode, consistent with useStoryTranslation
      const method = translateMode === 'token' ? 'IMPIT' : 'API';
      const methodKey: 'api' | 'token' = method === 'IMPIT' ? 'token' : 'api';

      // Set processing state
      setProcessingChapters(prev => {
        const next = new Map(prev);
        next.set(selectedChapterId, {
            startTime: Date.now(),
            workerId: 0, // 0 indicates manual/summary task
            channel: methodKey
        });
        return next;
      });

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

      // 2. Send to Gemini for Summarization
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
        prompt: prepareResult.prompt,
        model: model,
        method,
        webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
        useProxy: method === 'IMPIT' && useProxy,
        metadata: { 
          chapterId: selectedChapterId,
          // Include regex for server-side validation and retry
          validationRegex: 'hết\\s+tóm\\s+tắt|end\\s+of\\s+summary|---\\s*hết\\s*---|hết\\s+chương'
        }
      }) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };

      if (translateResult.success && translateResult.data) {
        // Validate metadata
        if (translateResult.metadata?.chapterId !== selectedChapterId) {
          console.error(`[useStorySummaryGeneration] ⚠️ RACE CONDITION DETECTED! Response chapterId (${translateResult.metadata?.chapterId}) !== selected (${selectedChapterId})`);
          throw new Error('Metadata validation failed - race condition detected');
        }
        
        // Save summary to Map cache
        setSummaries(new Map<string, string>(summaries).set(selectedChapterId, translateResult.data!));

        const nextModels = new Map<string, string>(chapterModels);
        nextModels.set(selectedChapterId, model);
        setChapterModels(nextModels);

        const nextMethods = new Map<string, 'api' | 'token'>(chapterMethods);
        nextMethods.set(selectedChapterId, methodKey);
        setChapterMethods(nextMethods);
        
        // Set Summary Title same as Translated Title or Chapter Title
        const chapter = chapters.find(c => c.id === selectedChapterId);
        if (chapter) {
            const nextSummaryTitles = new Map<string, string>(summaryTitles);
            const translatedTitle = translatedTitles.get(selectedChapterId);
            nextSummaryTitles.set(selectedChapterId, translatedTitle || chapter.title);
            setSummaryTitles(nextSummaryTitles);
        }

        if (translateResult.context && translateResult.context.conversationId && tokenKey) {
          const nextTokenContexts = new Map<string, TokenContext>(tokenContexts);
          nextTokenContexts.set(tokenKey, translateResult.context!);
          setTokenContexts(nextTokenContexts);
        }

        setViewMode('summary');
        console.log('[useStorySummaryGeneration] Tóm tắt thành công!');
      } else {
        throw new Error(translateResult.error || 'Tóm tắt thất bại');
      }

    } catch (error) {
      console.error('[useStorySummaryGeneration] Lỗi trong quá trình tóm tắt:', error);
      alert(`Lỗi tóm tắt: ${error}`);
    } finally {
      setIsGenerating(false);
      setStatus('idle');
      // Clear processing state
      setProcessingChapters(prev => {
          const next = new Map(prev);
          next.delete(selectedChapterId);
          return next;
      });
    }
  };

  return {
    isGenerating,
    handleGenerateSummary
  };
}

