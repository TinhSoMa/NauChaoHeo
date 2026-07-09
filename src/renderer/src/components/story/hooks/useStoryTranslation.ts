import { Dispatch, SetStateAction, useRef } from 'react';
import {
  Chapter,
  PreparePromptResult,
  STORY_IPC_CHANNELS,
  StoryTranslateGeminiWebQueueResult
} from '@shared/types';
import { buildTokenKey } from '../utils/tokenUtils';
import { extractTranslatedTitle } from '../utils/chapterUtils';
import type {
  GeminiChatConfigLite,
  ProcessingChapterInfo,
  StoryChapterMethod,
  StoryMemoryRuntimeState,
  StoryPromptSaveSettings,
  StoryStatus,
  StoryTranslationMethod
} from '../types';
import { buildStoryMemoryPayload } from '../types';
import { saveTranslationPromptArtifact } from '../utils/promptArtifact';
import { resolvePreviousAssistantOutputDebug } from '../utils/previousAssistantOutput';

interface UseStoryTranslationParams {
  chapters: Chapter[];
  sourceLang: string;
  targetLang: string;
  model: string;
  translationMethod: StoryTranslationMethod;
  retranslateExisting: boolean;
  useProxy: boolean;
  isChapterIncluded: (id: string) => boolean;
  getPreferredTokenConfig: () => GeminiChatConfigLite | null;
  loadConfigurations: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<StoryStatus>>;
  setProcessingChapters: Dispatch<SetStateAction<Map<string, ProcessingChapterInfo>>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setTranslatedTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, StoryChapterMethod>>>;
  setTokenContexts: Dispatch<SetStateAction<Map<string, { conversationId: string; responseId: string; choiceId: string }>>>;
  setViewMode: Dispatch<SetStateAction<'original' | 'translated' | 'summary'>>;
  translatedChapters: Map<string, string>;
  summaries: Map<string, string>;
  projectId: string | null;
  filePath: string;
  memorySettings: StoryMemoryRuntimeState;
  promptSaveSettings: StoryPromptSaveSettings;
  streamingEnabled?: boolean;
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
    translationMethod,
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
    translatedChapters,
    summaries,
    projectId,
    filePath,
    memorySettings,
    promptSaveSettings,
    streamingEnabled = false,
  } = params;
  const activeRunIdRef = useRef<string | null>(null);

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
    const chapterIndex = chapters.findIndex((entry) => entry.id === chapter.id);
    const previousAssistantOutputResult = resolvePreviousAssistantOutputDebug({
      chapters,
      chapterIndex,
      summaries,
      translatedChapters,
      mode: promptSaveSettings.previousAssistantOutputMode,
      chapterCount: promptSaveSettings.previousAssistantOutputChapterCount
    });
    const previousAssistantOutput = previousAssistantOutputResult.content;
    const memoryPayload = chapterIndex >= 0
      ? buildStoryMemoryPayload({
          projectId,
          filePath,
          chapter,
          chapterIndex: chapterIndex + 1,
          totalChapters: chapters.length,
          previousAssistantOutput,
          previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
          previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
          settings: memorySettings
        })
      : null;

    if (activeRunIdRef.current) {
      alert('Đang có tiến trình dịch chương khác. Vui lòng đợi hoàn tất.');
      return;
    }

    const runId = `story-single-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRunIdRef.current = runId;
    const queueMode = translationMethod === 'gemini_webapi_queue' || translationMethod === 'api_gemini_webapi_queue';
    const processingChannel: 'api' | 'token' = translationMethod === 'api' ? 'api' : 'token';

    setStatus('running');
    
    // Add processing status for single chapter
    setProcessingChapters(prev => {
      const next = new Map(prev);
      next.set(chapter.id, { 
        startTime: Date.now(), 
        workerId: 0, 
        channel: processingChannel,
        source: queueMode ? 'story_web_queue' : undefined,
        phase: queueMode ? 'running' : undefined
      });
      return next;
    });
    
    let wasTranslated = false;

    try {
      console.log('[useStoryTranslation] Dang chuan bi prompt...');
      // 1. Prepare Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang,
        model,
        memory: memoryPayload
      }) as PreparePromptResult;
      
      if (!prepareResult.success || !prepareResult.prompt) {
        throw new Error(prepareResult.error || 'Loi chuan bi prompt');
      }

      console.log('[useStoryTranslation] Da chuan bi prompt, dang gui den Gemini...');

      const commitTranslatedChapter = (
        text: string,
        methodKey: StoryChapterMethod,
        context?: { conversationId: string; responseId: string; choiceId: string },
        tokenKey?: string | null
      ) => {
        setTranslatedChapters(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, text);
          return next;
        });

        setTranslatedTitles(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, extractTranslatedTitle(text, selectedChapterId));
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

        if (context && context.conversationId && tokenKey) {
          setTokenContexts(prev => {
            const next = new Map(prev);
            next.set(tokenKey, context);
            return next;
          });
        }
      };

      const invokeApiOrToken = async (method: 'API' | 'IMPIT') => {
        let selectedTokenConfig = method === 'IMPIT' ? getPreferredTokenConfig() : null;
        if (method === 'IMPIT' && !selectedTokenConfig) {
          await loadConfigurations();
          selectedTokenConfig = getPreferredTokenConfig();
          if (!selectedTokenConfig) {
            alert('Không tìm thấy Cấu hình Web để chạy chế độ Token.');
            return null;
          }
        }

        const tokenKey = method === 'IMPIT' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

        const methodKey: StoryChapterMethod = method === 'IMPIT' ? 'token' : 'api';

        const streamEnabled = streamingEnabled && method === 'API';
        const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
          prompt: prepareResult.prompt,
          model,
          method,
          webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
          useProxy: method === 'IMPIT' && useProxy,
          metadata: {
            runId,
            chapterId: selectedChapterId,
            chapterTitle: chapter.title,
            chapterIndex: chapterIndex + 1,
            sourceText: chapter.content,
            validationRegex: 'hết\\s+chương|end\\s+of\\s+chapter|---\\s*hết\\s*---'
          },
          memory: memoryPayload,
          streamingEnabled: streamEnabled || undefined,
        }) as {
          success: boolean;
          data?: string;
          error?: string;
          context?: { conversationId: string; responseId: string; choiceId: string };
          configId?: string;
          metadata?: { chapterId?: string; runId?: string };
        };

        if (promptSaveSettings.autoSaveSentPrompt) {
          await saveTranslationPromptArtifact({
            projectId,
            chapter,
            chapterIndex: chapterIndex + 1,
            method: methodKey,
            model,
            preparedPrompt: prepareResult.prompt,
            prepareResult,
            storyFilePath: filePath,
            previousAssistantOutputDebug: previousAssistantOutputResult.debug,
            previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
            previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
            previousAssistantOutputSourceContent: previousAssistantOutputResult.content
          });
        }

        return {
          result: translateResult,
          tokenKey,
          methodKey
        };
      };

      if (translationMethod === 'gemini_webapi_queue' || translationMethod === 'api_gemini_webapi_queue') {
        const queueResult = await window.electronAPI.invoke(
          STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_GEMINI_WEB_QUEUE,
          {
            prompt: prepareResult.prompt,
            model,
            timeoutMs: 120000,
            resetConversation: true,
            metadata: {
              runId,
              chapterId: selectedChapterId,
              chapterTitle: chapter.title,
              chapterIndex: chapterIndex + 1,
              sourceText: chapter.content,
              validationRegex: 'hết\\s+chương|end\\s+of\\s+chapter|---\\s*hết\\s*---'
            },
            memory: memoryPayload
          }
        ) as StoryTranslateGeminiWebQueueResult;

        if (promptSaveSettings.autoSaveSentPrompt) {
          await saveTranslationPromptArtifact({
            projectId,
            chapter,
            chapterIndex: chapterIndex + 1,
            method: 'gemini_webapi_queue',
            model,
            preparedPrompt: prepareResult.prompt,
            prepareResult,
            storyFilePath: filePath,
            previousAssistantOutputDebug: previousAssistantOutputResult.debug,
            previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
            previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
            previousAssistantOutputSourceContent: previousAssistantOutputResult.content
          });
        }

        if (activeRunIdRef.current !== runId) {
          console.warn('[useStoryTranslation] Drop stale queue response from old run:', runId);
          return;
        }

        if (queueResult.success && queueResult.data) {
          const responseRunId = queueResult.metadata?.runId;
          if (responseRunId && responseRunId !== runId) {
            throw new Error('Run metadata validation failed - stale queue response detected');
          }
          const responseChapterId = queueResult.metadata?.chapterId;
          if (responseChapterId && responseChapterId !== selectedChapterId) {
            throw new Error('Metadata validation failed - queue chapter mismatch detected');
          }

          commitTranslatedChapter(queueResult.data, 'gemini_webapi_queue');
          wasTranslated = true;
        } else if (translationMethod === 'api_gemini_webapi_queue') {
          console.warn('[useStoryTranslation] Queue translation failed, fallback to API.', queueResult.error);
          const fallback = await invokeApiOrToken('API');
          if (!fallback) {
            return;
          }
          const translateResult = fallback.result;
          if (translateResult.success && translateResult.data) {
            const responseRunId = translateResult.metadata?.runId;
            if (responseRunId && responseRunId !== runId) {
              throw new Error('Run metadata validation failed - stale fallback response detected');
            }
            if (translateResult.metadata?.chapterId && translateResult.metadata.chapterId !== selectedChapterId) {
              throw new Error('Metadata validation failed - fallback race condition detected');
            }

            commitTranslatedChapter(translateResult.data, fallback.methodKey, translateResult.context, fallback.tokenKey);
            wasTranslated = true;
          } else {
            throw new Error(translateResult.error || queueResult.error || 'Dich that bai');
          }
        } else {
          throw new Error(queueResult.error || 'Dich that bai');
        }
      } else {
        const primaryMethod: 'API' | 'IMPIT' = translationMethod === 'token' ? 'IMPIT' : 'API';
        const primaryResult = await invokeApiOrToken(primaryMethod);
        if (!primaryResult) {
          return;
        }

        const translateResult = primaryResult.result;

        if (activeRunIdRef.current !== runId) {
          console.warn('[useStoryTranslation] Drop stale response from old run:', runId);
          return;
        }

        if (translateResult.success && translateResult.data) {
          const responseRunId = translateResult.metadata?.runId;
          if (responseRunId && responseRunId !== runId) {
            console.error(`[useStoryTranslation] ⚠️ STALE RUN DETECTED! ${responseRunId} !== ${runId}`);
            throw new Error('Run metadata validation failed - stale response detected');
          }

          if (translateResult.metadata?.chapterId && translateResult.metadata.chapterId !== selectedChapterId) {
            console.error(`[useStoryTranslation] ⚠️ RACE CONDITION DETECTED! Response chapterId (${translateResult.metadata?.chapterId}) !== selected (${selectedChapterId})`);
            throw new Error('Metadata validation failed - race condition detected');
          }

          commitTranslatedChapter(
            translateResult.data,
            primaryResult.methodKey,
            translateResult.context,
            primaryResult.tokenKey
          );
          wasTranslated = true;
        } else {
          throw new Error(translateResult.error || 'Dich that bai');
        }
      }

      if (activeRunIdRef.current !== runId) {
        console.warn('[useStoryTranslation] Drop stale response from old run:', runId);
        return;
      }

      if (wasTranslated) {
        setViewMode('translated');
        console.log('[useStoryTranslation] Dich thanh cong!');
      }

    } catch (error) {
      console.error('[useStoryTranslation] Loi trong qua trinh dich:', error);
      if (!streamingEnabled) {
        const rawMsg = error instanceof Error ? error.message : String(error);
        const friendlyMsg = rawMsg === 'SERVER_OVERLOADED' ? 'Server Gemini quá tải, vui lòng thử lại sau.' : rawMsg;
        alert(`Loi dich thuat: ${friendlyMsg}`);
      }
    } finally {
      if (!wasTranslated && streamingEnabled) {
        window.electronAPI.invoke(STORY_IPC_CHANNELS.STOP_STORY_TRANSLATION, runId).catch(() => {});
      }
      setProcessingChapters(prev => {
        const next = new Map(prev);
        next.delete(chapter.id);
        return next;
      });
      if (activeRunIdRef.current === runId) {
        activeRunIdRef.current = null;
        setStatus('idle');
      }
    }
  };

  return {
    handleTranslate
  };
}
