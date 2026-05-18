import { createHash } from 'crypto';
import * as GeminiService from '../gemini/geminiService';
import { PromptService } from '../promptService';
import { GeminiChatService } from '../chatGemini/geminiChatService';
import { getMemoryContextService } from '../memoryContext';
import {
  AppSettingsService,
  normalizeGeminiMinSendIntervalMs,
  normalizeGeminiMaxSendIntervalMs,
  normalizeGeminiSendIntervalMode,
} from '../appSettings';
import { getDatabase } from '../../database/schema';
import { getGeminiWebApiRuntime } from '../geminiWebApi';
import {
  getQueueRuntimeOrCreate,
  RotationJobExecutionError,
  type RotationJobErrorCode
} from '../shared/universalRotationQueue';
import type {
  MemoryContextHealthResult,
  MemoryContextAddRequest,
  MemoryContextSearchRequest,
  StoryCancelGeminiWebQueueBatchResult,
  StoryGeminiWebQueueCapacity,
  StoryMemorySettings,
  StoryTranslateChapterPayload,
  StoryTranslationMemoryPayload
} from '../../../shared/types';

const STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY = 'story.translation.geminiWeb';
const STORY_GEMINI_WEB_QUEUE_POOL_ID = 'story-geminiweb-accounts';
const STORY_GEMINI_WEB_QUEUE_FEATURE = 'story.translate.geminiWeb';
const STORY_GEMINI_WEB_QUEUE_SERVICE_ID = 'story-translator-ui';
const STORY_GEMINI_WEB_QUEUE_DEFAULT_GAP_MS = 1_000;
const STORY_GEMINI_WEB_QUEUE_MAX_ATTEMPTS = 2; // 1 lan chay dau + 1 lan retry
const STORY_STICKY_BATCH_CAPABILITY_PREFIX = 'story_batch_sticky::';
const STORY_STICKY_STATE_TTL_MS = 6 * 60 * 60 * 1000;

interface StoryTranslateChapterWithGeminiWebQueueOptions {
  prompt: any;
  model?: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  priority?: 'high' | 'normal' | 'low';
  conversationKey?: string;
  resetConversation?: boolean;
  memory?: StoryTranslationMemoryPayload | null;
}

interface StoryTranslateChapterWithGeminiWebQueueResult {
  success: boolean;
  data?: string;
  error?: string;
  errorCode?: RotationJobErrorCode;
  resourceId?: string;
  queueRuntimeKey: string;
  metadata?: Record<string, unknown>;
}

interface StoryWebQueueTimingPayload {
  queuePacingMode: 'dispatch_spacing_global';
  queueGapMs: number;
  startedAt?: number;
  endedAt?: number;
  nextAllowedAt?: number;
}

interface StoryBatchStickyAccountState {
  batchId: string;
  capability: string;
  stickyResourceId: string | null;
  failedResourceIds: Set<string>;
  lastTouchedAt: number;
}

/**
 * Story Service - Handles story translation logic
 */
export class StoryService {
  private static readonly storyStickyAccountByBatchId = new Map<string, StoryBatchStickyAccountState>();

  /**
   * Translates a chapter using prepared prompt and Gemini API
   * Method: 'API' (Google Gemini API) hoặc 'IMPIT' (Web scraping qua impit)
   */
  static async translateChapter(options: StoryTranslateChapterPayload): Promise<{ success: boolean; data?: string; error?: string; context?: any; configId?: string; metadata?: any; retryable?: boolean }> {
    try {
      console.log('[StoryService] Starting translation...', options.method || 'API', options.model || 'default');
      
      if (options.method === 'IMPIT') {
           // WEB METHOD (Gemini Protocol)
           const promptText = this.extractPromptText(options.prompt);
            
            console.log('[StoryService] Extracted promptText length:', promptText.length);
            if (!promptText) console.warn('[StoryService] promptText is empty!');

           const webConfigId = options.webConfigId?.trim() || '';
           
           console.log('[StoryService] Using IMPIT for translation...');
           const result = await GeminiChatService.sendMessageImpit(promptText, webConfigId, options.context, options.useProxy, options.metadata, options.onRetry);
           
            if (result.success && result.data) {
              console.log('[StoryService] Translation completed.');
             
             // Log context update for debugging re-translation issues
             const ctx = result.data.context;
             if (ctx && (ctx.conversationId || ctx.responseId)) {
                 console.log(`[StoryService] Context updated: convId=${ctx.conversationId ? ctx.conversationId.slice(0, 20) + '...' : '(empty)'}, respId length=${ctx.responseId ? ctx.responseId.length : 0}`);
             } else {
                 console.warn('[StoryService] ⚠️ Response context is empty - context may not be updated properly');
             }
             
              await this.addStoryTranslationMemory(
                options.memory,
                String(result.data.text || ''),
                String(options.metadata?.chapterTitle || options.memory?.chapterTitle || ''),
                String(options.metadata?.sourceText || '')
              );

              return { 
                  success: true, 
                  data: result.data.text,
                 context: result.data.context, // Return new context
                 configId: result.configId,
                 metadata: result.metadata
             };
           } else {
             return { success: false, error: result.error || 'Gemini Web Error', configId: result.configId, metadata: result.metadata, retryable: result.retryable };
           }

      } else {
          // API METHOD (Default)
          const modelToUse = typeof options.model === 'string' && options.model.trim().length > 0
            ? options.model.trim()
            : undefined;
          
           const result = await GeminiService.callGeminiWithRotation(
             options.prompt, 
             modelToUse
           );
           
           if (result.success) {
             await this.addStoryTranslationMemory(
               options.memory,
               String(result.data || ''),
               String(options.metadata?.chapterTitle || options.memory?.chapterTitle || ''),
               String(options.metadata?.sourceText || '')
             );
             return { success: true, data: result.data, metadata: options.metadata };
           } else {
            return { success: false, error: result.error, metadata: options.metadata };
          }
      }
    } catch (error) {
      console.error('[StoryService] Error translating chapter:', error);
      return { success: false, error: String(error), metadata: options.metadata };
    }
  }

  static async translateChapterWithGeminiWebQueue(
    options: StoryTranslateChapterWithGeminiWebQueueOptions
  ): Promise<StoryTranslateChapterWithGeminiWebQueueResult> {
    const batchId = this.resolveStoryBatchId(options);
    this.pruneStoryBatchStickyStates();
    const stickyState = this.getOrCreateStoryBatchStickyState(batchId);

    try {
      if (!this.isStoryGeminiWebQueueEnabled()) {
        return {
          success: false,
          error: 'Story Gemini Web Queue is disabled by feature flag.',
          errorCode: 'EXECUTION_ERROR',
          queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
          metadata: {
            ...(options.metadata ?? {}),
            batchId,
          }
        };
      }

      const promptText = this.extractPromptText(options.prompt);
      if (!promptText.trim()) {
        return {
          success: false,
          error: 'Prompt text is empty.',
          errorCode: 'EXECUTION_ERROR',
          queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
          metadata: {
            ...(options.metadata ?? {}),
            batchId,
          }
        };
      }
      const timeoutMs = options.timeoutMs ?? 120_000;
      const maxAttempts = Math.max(1, STORY_GEMINI_WEB_QUEUE_MAX_ATTEMPTS);

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        this.ensureStoryGeminiWebQueueResources();
        const queue = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
        const queueGapMs = this.getStoryWebQueueGapMs();
        const stickyResourceId = this.selectStoryStickyResourceId(queue, stickyState);

        if (!stickyResourceId) {
          const exhaustedError = 'Không còn account Gemini Web khả dụng cho batch hiện tại.';
          return {
            success: false,
            error: exhaustedError,
            errorCode: 'RESOURCE_UNAVAILABLE',
            queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
            metadata: {
              ...(options.metadata ?? {}),
              batchId,
              stickyMode: 'strict_single_account',
            }
          };
        }

        // Re-apply resources so only the sticky account has this batch capability.
        this.ensureStoryGeminiWebQueueResources();

        const requestMetadata = {
          ...(options.metadata ?? {}),
          batchId,
          stickyMode: 'strict_single_account',
          stickyResourceId,
          attempt,
          maxAttempts,
        };

        const queued = await queue.enqueue<{ promptText: string }, string>({
          poolId: STORY_GEMINI_WEB_QUEUE_POOL_ID,
          feature: STORY_GEMINI_WEB_QUEUE_FEATURE,
          serviceId: STORY_GEMINI_WEB_QUEUE_SERVICE_ID,
          jobType: 'translate-chapter',
          priority: options.priority ?? 'normal',
          requiredCapabilities: ['story_translate', 'gemini_webapi', stickyState.capability],
          preferredResourceId: stickyResourceId,
          maxAttempts: 1,
          timeoutMs,
          metadata: requestMetadata,
          payload: { promptText },
          execute: async (ctx) => {
            const response = await getGeminiWebApiRuntime().generateContent({
              prompt: ctx.payload.promptText,
              timeoutMs,
              accountConfigId: ctx.resource.resourceId,
              conversationKey: options.conversationKey,
              resetConversation: options.resetConversation,
              useChatSession: !!options.conversationKey,
              proxyScope: 'story',
            });

            if (!response.success) {
              const errorMessage = response.error || 'GeminiWebApi execution failed';
              if (response.errorCode === 'GEMINI_TIMEOUT') {
                GeminiChatService.markConfigError(ctx.resource.resourceId, errorMessage);
                throw new RotationJobExecutionError('TIMEOUT', errorMessage);
              }
              if (response.errorCode === 'COOKIE_INVALID' || response.errorCode === 'COOKIE_NOT_FOUND') {
                GeminiChatService.markConfigError(ctx.resource.resourceId, errorMessage);
                throw new RotationJobExecutionError('RESOURCE_UNAVAILABLE', errorMessage);
              }
              throw new RotationJobExecutionError('EXECUTION_ERROR', errorMessage);
            }

            return response.text || '';
          }
        });

        const timingPayload = this.buildStoryWebQueueTimingPayload(queued, queueGapMs);
        const metadataWithTiming = this.mergeStoryWebQueueMetadata(requestMetadata, timingPayload);

        if (queued.success) {
          this.touchStoryBatchStickyState(stickyState);
          await this.addStoryTranslationMemory(
            options.memory,
            queued.result || '',
            String(options.metadata?.chapterTitle || options.memory?.chapterTitle || ''),
            String(options.metadata?.sourceText || '')
          );
          return {
            success: true,
            data: queued.result || '',
            resourceId: queued.resourceId,
            queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
            metadata: metadataWithTiming
          };
        }

        const shouldFailover = this.isStoryAccountFailoverError(queued.errorCode, queued.error);
        if (shouldFailover) {
          const failedResourceId = (queued.resourceId || stickyResourceId || '').trim();
          if (failedResourceId) {
            this.markStoryStickyResourceFailed(
              stickyState,
              failedResourceId,
              queued.error || queued.errorCode || 'ACCOUNT_FAILED'
            );
          }

          const queueAfterFail = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
          const remaining = this.getStoryEnabledResourceIdsForBatch(queueAfterFail, stickyState);
          if (remaining.length === 0) {
            return {
              success: false,
              error: `${queued.error || 'Queue job failed'} (all Gemini Web accounts failed for this batch)`,
              errorCode: 'RESOURCE_UNAVAILABLE',
              resourceId: queued.resourceId,
              queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
              metadata: metadataWithTiming
            };
          }
        }

        if (attempt >= maxAttempts) {
          return {
            success: false,
            error: queued.error || 'Queue job failed',
            errorCode: queued.errorCode,
            resourceId: queued.resourceId,
            queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
            metadata: metadataWithTiming
          };
        }
      }

      return {
        success: false,
        error: 'Queue job failed',
        errorCode: 'EXECUTION_ERROR',
        queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
        metadata: {
          ...(options.metadata ?? {}),
          batchId,
          stickyMode: 'strict_single_account',
        }
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
        errorCode: 'EXECUTION_ERROR',
        queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
        metadata: {
          ...(options.metadata ?? {}),
          batchId,
        }
      };
    }
  }

  /**
   * Prepares the translation prompt by fetching the appropriate prompt from the database
   * and injecting the chapter content.
   */
  static async prepareTranslationPrompt(
    chapterContent: string,
    sourceLang: string,
    targetLang: string,
    memory?: StoryTranslationMemoryPayload | null
  ): Promise<{ success: boolean; prompt?: any; error?: string; memoryContext?: { namespace?: string; promptContext?: string; memories?: string[]; debug?: any[]; warning?: string; status?: 'ready' | 'missing_runtime' | 'missing_provider' | 'error' } }> {
    try {
      let matchingPrompt;
      
      // 1. Check if user has configured a specific prompt in settings
      const appSettings = AppSettingsService.getAll();
      if (appSettings.translationPromptFamilyId) {
        const familyPrompt = PromptService.resolveLatestByFamily(appSettings.translationPromptFamilyId);
        if (familyPrompt && familyPrompt.sourceLang === sourceLang && familyPrompt.targetLang === targetLang) {
          matchingPrompt = familyPrompt;
        } else if (familyPrompt) {
          console.warn(
            `[StoryService] translationPromptFamilyId mismatch (${familyPrompt.sourceLang}->${familyPrompt.targetLang}), expected ${sourceLang}->${targetLang}. Falling back.`
          );
        } else {
          console.warn(`[StoryService] Configured translation prompt family "${appSettings.translationPromptFamilyId}" not found, falling back.`);
        }
      }
      if (!matchingPrompt && appSettings.translationPromptId) {
        matchingPrompt = PromptService.getById(appSettings.translationPromptId);
        if (!matchingPrompt) {
          console.warn(`[StoryService] Configured translation prompt "${appSettings.translationPromptId}" not found, falling back to auto-detect`);
        }
      }
      
      // 2. Fallback: Auto-detect prompt based on language
      if (!matchingPrompt) {
        const prompts = PromptService.getAll();
        matchingPrompt = prompts.find(p => 
          p.sourceLang === sourceLang && 
          p.targetLang === targetLang && 
          p.isDefault
        ) || prompts.find(p => 
          p.sourceLang === sourceLang && 
          p.targetLang === targetLang
        );
      }

      if (!matchingPrompt) {
        return { 
          success: false, 
          error: `No translation prompt found for ${sourceLang} -> ${targetLang}` 
        };
      }

      const memoryContext = await this.resolveStoryMemoryContext(memory, chapterContent);
      const memoryPayload = this.buildTranslationMemoryPayload(
        memoryContext,
        typeof memory?.previousAssistantOutput === 'string' ? memory.previousAssistantOutput : ''
      );

      // 3. Parse and inject content
      const prepared = this.injectContentIntoPrompt(matchingPrompt.content, chapterContent, memoryPayload);
      return {
        ...prepared,
        memoryContext
      };

    } catch (error) {
      console.error('Error preparing translation prompt:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Prepares the summary prompt by fetching the appropriate summary prompt from the database
   * and injecting the chapter content.
   */
  static async prepareSummaryPrompt(chapterContent: string, sourceLang: string, targetLang: string): Promise<{ success: boolean; prompt?: any; error?: string }> {
    try {
      let matchingPrompt;
      
      // 1. Check if user has configured a specific prompt in settings
      const appSettings = AppSettingsService.getAll();
      if (appSettings.summaryPromptFamilyId) {
        const familyPrompt = PromptService.resolveLatestByFamily(appSettings.summaryPromptFamilyId);
        if (familyPrompt && familyPrompt.sourceLang === sourceLang && familyPrompt.targetLang === targetLang) {
          matchingPrompt = familyPrompt;
        } else if (familyPrompt) {
          console.warn(
            `[StoryService] summaryPromptFamilyId mismatch (${familyPrompt.sourceLang}->${familyPrompt.targetLang}), expected ${sourceLang}->${targetLang}. Falling back.`
          );
        } else {
          console.warn(`[StoryService] Configured summary prompt family "${appSettings.summaryPromptFamilyId}" not found, falling back.`);
        }
      }
      if (!matchingPrompt && appSettings.summaryPromptId) {
        matchingPrompt = PromptService.getById(appSettings.summaryPromptId);
        if (!matchingPrompt) {
          console.warn(`[StoryService] Configured summary prompt "${appSettings.summaryPromptId}" not found, falling back to auto-detect`);
        }
      }
      
      // 2. Fallback: Auto-detect prompt (name contains [SUMMARY] or tóm tắt)
      if (!matchingPrompt) {
        const prompts = PromptService.getAll();
        matchingPrompt = prompts.find(p => 
          p.sourceLang === sourceLang && 
          p.targetLang === targetLang && 
          (p.name.includes('[SUMMARY]') || p.name.toLowerCase().includes('tóm tắt'))
        );
      }

      if (!matchingPrompt) {
        return { 
          success: false, 
          error: `Không tìm thấy prompt tóm tắt cho ${sourceLang} -> ${targetLang}. Vui lòng chọn prompt trong Settings.` 
        };
      }

      // 3. Parse and inject content
      return this.injectContentIntoPrompt(matchingPrompt.content, chapterContent);

    } catch (error) {
      console.error('Error preparing summary prompt:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Helper function to inject content into prompt template
   */
  private static injectContentIntoPrompt(
    promptContent: string,
    chapterContent: string,
    memoryPayload?: {
      translation_memory: {
        confirmed_terms: Record<string, string>;
        style_rules: Record<string, string>;
      };
      continuity_context: {
        last_translated_excerpt: string[];
        active_entities: string[];
        continuity_notes: string[];
      };
      previous_assistant_output: string;
      current_input: string[];
    }
  ): { success: boolean; prompt?: any; error?: string } {
    try {
      // 3. Parse the prompt content (which is a JSON string)
      let promptData;
      try {
        promptData = JSON.parse(promptContent);
      } catch (e) {
        return { success: false, error: 'Invalid prompt content format (not valid JSON)' };
      }

      // Helper for recursive injection
      const injectContent = (obj: any): any => {
        if (typeof obj === 'string') {
          // Check for exact matches to return array
          if (obj === '{{text}}' || obj === '{{TEXT_TRUYEN_TRUNG_QUOC}}' || obj === '{{input}}') {
             return chapterContent.split(/\r?\n/).filter(line => line.trim() !== '');
          }

          let newStr = obj;
          if (newStr.includes('{{text}}')) newStr = newStr.replace('{{text}}', chapterContent);
          if (newStr.includes('{{TEXT_TRUYEN_TRUNG_QUOC}}')) newStr = newStr.replace('{{TEXT_TRUYEN_TRUNG_QUOC}}', chapterContent);
          if (newStr.includes('{{input}}')) newStr = newStr.replace('{{input}}', chapterContent);
          return newStr;
        }
        if (Array.isArray(obj)) {
          return obj.map(item => injectContent(item));
        }
        if (typeof obj === 'object' && obj !== null) {
          const result: Record<string, any> = {};
          for (const key in obj) {
            result[key] = injectContent(obj[key]);
          }
          return result;
        }
        return obj;
      };

      // Handle standard array format (chat history) specifically to ensure user message exists
      if (Array.isArray(promptData)) {
          let contentInjected = false;
          const preparedMessages = promptData.map((msg: any) => {
             if (msg.role === 'user' && typeof msg.content === 'string') {
                const originalContent = msg.content;
                const newContent = injectContent(msg.content);
                if (originalContent !== newContent) {
                   contentInjected = true;
                }
                return { ...msg, content: newContent };
             }
             return msg;
          });

          if (!contentInjected) {
             // specific fallback if user message exists but no placeholder found
             let lastUserMsgIndex = -1;
             for (let i = preparedMessages.length - 1; i >= 0; i--) {
               if (preparedMessages[i].role === 'user') {
                 lastUserMsgIndex = i;
                 break;
               }
             }
             if (lastUserMsgIndex !== -1) {
                 preparedMessages[lastUserMsgIndex].content += '\n\n' + chapterContent;
             } else {
                 // Create a new user message if none exists
                 preparedMessages.push({ role: 'user', content: chapterContent });
             }
          }
          return { success: true, prompt: preparedMessages };
      } 
      
      // Handle Object format (structured prompt)
      else if (typeof promptData === 'object' && promptData !== null) {
          const preparedPrompt = injectContent(promptData);
          const normalizedCurrentInput = chapterContent.split(/\r?\n/).filter((line) => line.trim() !== '');
          const promptWithoutLegacyInput = { ...(preparedPrompt as Record<string, any>) };
          if ('input_text' in promptWithoutLegacyInput) {
            delete promptWithoutLegacyInput.input_text;
          }
          const mergedPrompt = {
            ...promptWithoutLegacyInput,
            ...(memoryPayload ? {
              translation_memory: memoryPayload.translation_memory,
              continuity_context: memoryPayload.continuity_context,
              previous_assistant_output: memoryPayload.previous_assistant_output,
            } : {}),
            current_input: normalizedCurrentInput,
          };
          return { success: true, prompt: mergedPrompt };
      }

      return { success: false, error: 'Prompt content must be a JSON array or object' };

    } catch (error) {
      console.error('Error injecting content into prompt:', error);
      return { success: false, error: String(error) };
    }
  }

  private static normalizeStoryMemorySettings(memory?: StoryTranslationMemoryPayload | null): StoryMemorySettings | null {
    if (!memory?.settings) {
      return null;
    }
    return {
      enabled: Boolean(memory.settings.enabled),
      topK: Math.max(1, Math.min(20, Math.floor(memory.settings.topK || 5))),
      namespace: typeof memory.settings.namespace === 'string' ? memory.settings.namespace.trim() : undefined,
      status: memory.settings.status
    };
  }

  private static getStoryMemoryNamespace(memory?: StoryTranslationMemoryPayload | null): string | null {
    const projectId = (memory?.projectId || '').trim();
    if (!projectId) {
      return null;
    }
    const settings = this.normalizeStoryMemorySettings(memory);
    if (settings?.namespace) {
      return settings.namespace;
    }
    const fingerprintSource = (memory?.storyFilePath || '').trim() || '__default_story__';
    const fingerprint = createHash('sha1').update(fingerprintSource).digest('hex').slice(0, 12);
    return `story:${projectId}:${fingerprint}`;
  }

  private static buildTranslationMemoryPayload(memoryContext: {
    memories?: string[];
    facts?: Array<{ text?: string; kind?: string; aliases?: string[] }>;
    glossary?: Array<{ sourceTerm?: string; targetTerm?: string }>;
    entities?: Array<{ canonicalValue?: string; aliases?: string[] }>;
  }, previousAssistantOutput: string): {
    translation_memory: {
      confirmed_terms: Record<string, string>;
      style_rules: Record<string, string>;
    };
    continuity_context: {
      last_translated_excerpt: string[];
      active_entities: string[];
      continuity_notes: string[];
    };
    previous_assistant_output: string;
    current_input: string[];
  } {
    const glossary = Array.isArray(memoryContext.glossary) ? memoryContext.glossary : [];
    const facts = Array.isArray(memoryContext.facts) ? memoryContext.facts : [];
    const entities = Array.isArray(memoryContext.entities) ? memoryContext.entities : [];

    const confirmedTerms: Record<string, string> = {};
    for (const entry of glossary) {
      const source = String(entry.sourceTerm || '').trim();
      const target = String(entry.targetTerm || '').trim();
      if (source && target && !confirmedTerms[source]) {
        confirmedTerms[source] = target;
      }
      if (Object.keys(confirmedTerms).length >= 24) {
        break;
      }
    }

    const styleRules: Record<string, string> = {
      narration: 'van phong tu tien on dinh, uu tien tu nhien',
      dialogue: 'giu xung ho tien hiep nhat quan',
      translation_bias: 'uu tien muot va nhat quan thuat ngu',
    };

    const lastTranslatedExcerpt = facts
      .filter((fact) => fact && typeof fact.text === 'string' && fact.text.trim().length > 0)
      .filter((fact) => fact.kind === 'plot_fact' || fact.kind === 'style_rule')
      .map((fact) => String(fact.text || '').trim())
      .slice(0, 10);

    const activeEntityValues = new Set<string>();
    for (const entity of entities) {
      const value = String(entity.canonicalValue || '').trim();
      if (value) {
        activeEntityValues.add(value);
      }
      for (const alias of entity.aliases || []) {
        const normalized = String(alias || '').trim();
        if (normalized) {
          activeEntityValues.add(normalized);
        }
      }
      if (activeEntityValues.size >= 24) {
        break;
      }
    }

    const continuityNotes = (memoryContext.memories || [])
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0)
      .slice(0, 8);

    const previousAssistantWindow = this.extractPreviousAssistantWindow(previousAssistantOutput);

    return {
      translation_memory: {
        confirmed_terms: confirmedTerms,
        style_rules: styleRules,
      },
      continuity_context: {
        last_translated_excerpt: lastTranslatedExcerpt,
        active_entities: Array.from(activeEntityValues).slice(0, 24),
        continuity_notes: continuityNotes,
      },
      previous_assistant_output: previousAssistantWindow,
      current_input: [],
    };
  }

  private static extractPreviousAssistantWindow(previousAssistantOutput: string): string {
    const normalized = String(previousAssistantOutput || '').trim();
    if (!normalized) {
      return '';
    }
    const maxChars = 4000;
    if (normalized.length <= maxChars) {
      return normalized;
    }

    const lines = normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length <= 1) {
      return normalized.slice(0, maxChars);
    }

    const selected: string[] = [];
    const maxIndex = lines.length - 1;

    for (let count = 1; count <= lines.length; count += 1) {
      const nextSelection: string[] = [];
      const nextUsed = new Set<number>();

      for (let i = 0; i < count; i += 1) {
        const anchor = Math.round((i * maxIndex) / Math.max(1, count - 1));
        let index = anchor;
        while (nextUsed.has(index) && index < maxIndex) {
          index += 1;
        }
        while (nextUsed.has(index) && index > 0) {
          index -= 1;
        }
        if (!nextUsed.has(index)) {
          nextUsed.add(index);
          nextSelection.push(lines[index]);
        }
      }

      const candidate = nextSelection.join('\n');
      if (candidate.length > maxChars) {
        break;
      }

      selected.length = 0;
      selected.push(...nextSelection);
    }

    if (selected.length > 0) {
      return selected.join('\n');
    }

    return normalized.slice(0, maxChars);
  }

  private static getStoryMemoryStatusFromHealth(health: MemoryContextHealthResult): 'ready' | 'missing_runtime' | 'missing_provider' | 'error' {
    if (!health.success || !health.pythonOk || !health.mem0Ok || !health.spacyOk || !health.spacyModelOk) {
      return 'missing_runtime';
    }
    if (!health.providerConfigured) {
      return 'missing_provider';
    }
    return 'ready';
  }

  private static async resolveStoryMemoryContext(
    memory: StoryTranslationMemoryPayload | null | undefined,
    chapterContent: string
  ): Promise<{ namespace?: string; promptContext?: string; memories?: string[]; facts?: any[]; glossary?: any[]; entities?: any[]; debug?: any[]; warning?: string; status?: 'ready' | 'missing_runtime' | 'missing_provider' | 'error' }> {
    const settings = this.normalizeStoryMemorySettings(memory);
    const namespace = this.getStoryMemoryNamespace(memory);
    if (!settings?.enabled || !namespace) {
      return {
        namespace: namespace || undefined,
        promptContext: '',
        memories: [],
        facts: [],
        glossary: [],
        entities: [],
        debug: [],
        status: memory?.settings?.status || 'error'
      };
    }

    const projectId = (memory?.projectId || '').trim();
    const chapterIndex =
      typeof memory?.chapterIndex === 'number' && Number.isFinite(memory.chapterIndex)
        ? memory.chapterIndex
        : null;
    if (!projectId || chapterIndex === null) {
      return {
        namespace,
        promptContext: '',
        memories: [],
        facts: [],
        glossary: [],
        entities: [],
        debug: [],
        status: 'error',
        warning: 'Memory mode cần projectId và chapterIndex hợp lệ.'
      };
    }

    const health = await getMemoryContextService().getHealth();
    const status = this.getStoryMemoryStatusFromHealth(health);

    const searchRequest: MemoryContextSearchRequest = {
      projectId,
      feature: 'story.translation',
      namespace,
      queryText: chapterContent,
      topK: settings.topK,
      metadata: {
        chapterId: memory?.chapterId || undefined,
        chapterIndex,
        chapterTitle: memory?.chapterTitle || undefined,
        totalChapters: memory?.totalChapters || undefined
      }
    };

    const searchResult = await getMemoryContextService().searchContext(searchRequest);
    const extended = searchResult as any;
    return {
      namespace,
      promptContext: searchResult.promptContext || '',
      memories: searchResult.memories || [],
      facts: Array.isArray(extended.facts) ? extended.facts : [],
      glossary: Array.isArray(extended.glossary) ? extended.glossary : [],
      entities: Array.isArray(extended.entities) ? extended.entities : [],
      debug: searchResult.debug || [],
      warning: searchResult.warning || health.warning,
      status
    };
  }

  private static async addStoryTranslationMemory(
    memory: StoryTranslationMemoryPayload | null | undefined,
    translatedText: string,
    chapterTitle: string,
    sourceText: string
  ): Promise<void> {
    const settings = this.normalizeStoryMemorySettings(memory);
    const namespace = this.getStoryMemoryNamespace(memory);
    if (!settings?.enabled || !namespace) {
      return;
    }

    const projectId = (memory?.projectId || '').trim();
    const chapterIndex =
      typeof memory?.chapterIndex === 'number' && Number.isFinite(memory.chapterIndex)
        ? memory.chapterIndex
        : null;

    if (!projectId || !sourceText.trim() || !translatedText.trim() || chapterIndex === null) {
      return;
    }

    const request: MemoryContextAddRequest = {
      projectId,
      feature: 'story.translation',
      namespace,
      sourceText,
      translatedText,
      metadata: {
        chapterId: memory?.chapterId || undefined,
        chapterIndex,
        chapterTitle: chapterTitle || memory?.chapterTitle || undefined,
        totalChapters: memory?.totalChapters || undefined,
        storyFilePath: memory?.storyFilePath || undefined
      }
    };

    const result = await getMemoryContextService().addMemory(request);
    if (!result.success) {
      console.warn('[StoryService] Failed to add story translation memory:', result.error);
    }
  }

  static isStoryGeminiWebQueueEnabled(): boolean {
    return process.env.ENABLE_STORY_GEMINI_WEB_QUEUE !== '0';
  }

  static getStoryGeminiWebQueueCapacity(): StoryGeminiWebQueueCapacity {
    this.ensureStoryGeminiWebQueueResources();
    const queue = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
    const snapshot = queue.getSnapshot();

    let resourceCount = 0;
    let readyCount = 0;
    let busyCount = 0;
    let cooldownCount = 0;

    for (const resource of snapshot.resources) {
      if (resource.poolId !== STORY_GEMINI_WEB_QUEUE_POOL_ID) {
        continue;
      }

      const assignedServiceId = String(resource.assignedServiceId || '');
      if (
        assignedServiceId &&
        assignedServiceId !== '-' &&
        assignedServiceId !== STORY_GEMINI_WEB_QUEUE_SERVICE_ID
      ) {
        continue;
      }

      const state = String(resource.state || '').toLowerCase();
      if (state === 'disabled' || state === 'error') {
        continue;
      }

      resourceCount += 1;
      if (state === 'ready') {
        readyCount += 1;
      } else if (state === 'busy') {
        busyCount += 1;
      } else if (state === 'cooldown') {
        cooldownCount += 1;
      }
    }

    return {
      workerCount: Math.max(1, resourceCount),
      resourceCount,
      readyCount,
      busyCount,
      cooldownCount
    };
  }

  static cancelStoryGeminiWebQueueBatch(batchId: string): StoryCancelGeminiWebQueueBatchResult {
    const normalizedBatchId = batchId.trim();
    if (!normalizedBatchId) {
      return {
        success: false,
        cancelledJobIds: [],
        requestedJobCount: 0,
        error: 'Batch ID is required.'
      };
    }

    this.ensureStoryGeminiWebQueueResources();
    const queue = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
    const snapshot = queue.getInspectorSnapshot({
      poolId: STORY_GEMINI_WEB_QUEUE_POOL_ID,
      serviceId: STORY_GEMINI_WEB_QUEUE_SERVICE_ID,
      state: 'all',
      limit: 1000
    });

    const matchingJobs = snapshot.jobs.filter((job) => {
      const metadata =
        job && typeof job === 'object' && 'metadata' in job
          ? ((job as { metadata?: Record<string, unknown> }).metadata ?? {})
          : {};
      return metadata.batchId === normalizedBatchId;
    });

    const cancelledJobIds: string[] = [];
    for (const job of matchingJobs) {
      if (queue.cancel(job.jobId)) {
        cancelledJobIds.push(job.jobId);
      }
    }

    console.log('[StoryGeminiWebQueue][CancelBatch]', {
      batchId: normalizedBatchId,
      requestedJobCount: matchingJobs.length,
      cancelledJobIds
    });

    this.clearStoryBatchStickyState(normalizedBatchId, 'cancelled_by_user');

    return {
      success: true,
      cancelledJobIds,
      requestedJobCount: matchingJobs.length
    };
  }

  private static resolveStoryBatchId(options: StoryTranslateChapterWithGeminiWebQueueOptions): string {
    const metadataBatchId =
      typeof options.metadata?.batchId === 'string'
        ? options.metadata.batchId.trim()
        : '';
    if (metadataBatchId) {
      return metadataBatchId;
    }

    const conversationKey = typeof options.conversationKey === 'string'
      ? options.conversationKey.trim()
      : '';
    if (conversationKey) {
      return `conversation:${conversationKey}`;
    }

    return 'story-webqueue-default';
  }

  private static buildStoryStickyCapability(batchId: string): string {
    const sanitizedBatchId = batchId.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120);
    return `${STORY_STICKY_BATCH_CAPABILITY_PREFIX}${sanitizedBatchId || 'default'}`;
  }

  private static getOrCreateStoryBatchStickyState(batchId: string): StoryBatchStickyAccountState {
    const normalizedBatchId = batchId.trim() || 'story-webqueue-default';
    const existing = this.storyStickyAccountByBatchId.get(normalizedBatchId);
    if (existing) {
      this.touchStoryBatchStickyState(existing);
      return existing;
    }

    const created: StoryBatchStickyAccountState = {
      batchId: normalizedBatchId,
      capability: this.buildStoryStickyCapability(normalizedBatchId),
      stickyResourceId: null,
      failedResourceIds: new Set<string>(),
      lastTouchedAt: Date.now(),
    };
    this.storyStickyAccountByBatchId.set(normalizedBatchId, created);
    return created;
  }

  private static touchStoryBatchStickyState(state: StoryBatchStickyAccountState): void {
    state.lastTouchedAt = Date.now();
  }

  private static clearStoryBatchStickyState(batchId: string, reason: string): void {
    const normalizedBatchId = batchId.trim();
    if (!normalizedBatchId) {
      return;
    }
    if (!this.storyStickyAccountByBatchId.delete(normalizedBatchId)) {
      return;
    }
    console.log(
      `[StoryGeminiWebQueue][Sticky] Cleared sticky state batchId=${normalizedBatchId} reason=${reason}`
    );
  }

  private static pruneStoryBatchStickyStates(nowMs = Date.now()): void {
    for (const [batchId, state] of this.storyStickyAccountByBatchId.entries()) {
      if (nowMs - state.lastTouchedAt <= STORY_STICKY_STATE_TTL_MS) {
        continue;
      }
      this.storyStickyAccountByBatchId.delete(batchId);
      console.log(
        `[StoryGeminiWebQueue][Sticky] Pruned stale state batchId=${batchId}`
      );
    }
  }

  private static isStoryAccountFailoverError(errorCode?: string, errorText?: string): boolean {
    const normalizedCode = String(errorCode || '').trim().toUpperCase();
    const normalizedError = String(errorText || '').toLowerCase();

    if (
      normalizedCode === 'RESOURCE_UNAVAILABLE'
      || normalizedCode === 'COOKIE_INVALID'
      || normalizedCode === 'COOKIE_NOT_FOUND'
      || normalizedCode === 'GEMINI_TIMEOUT'
    ) {
      return true;
    }

    if (normalizedCode === 'TIMEOUT' && normalizedError.includes('gemini timeout')) {
      return true;
    }

    return (
      normalizedError.includes('cookie_invalid')
      || normalizedError.includes('cookie_not_found')
      || normalizedError.includes('__secure-1psid')
      || normalizedError.includes('gemini timeout')
    );
  }

  private static buildStoryStickyCapabilitiesByResource(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const stickyState of this.storyStickyAccountByBatchId.values()) {
      const stickyResourceId = stickyState.stickyResourceId?.trim();
      if (!stickyResourceId) {
        continue;
      }
      if (stickyState.failedResourceIds.has(stickyResourceId)) {
        continue;
      }

      const capabilitySet = map.get(stickyResourceId) || new Set<string>();
      capabilitySet.add(stickyState.capability);
      map.set(stickyResourceId, capabilitySet);
    }
    return map;
  }

  private static getStoryEnabledResourceIdsForBatch(
    queue: ReturnType<typeof getQueueRuntimeOrCreate>,
    stickyState: StoryBatchStickyAccountState
  ): string[] {
    const snapshot = queue.getSnapshot();
    return snapshot.resources
      .filter((resource) => {
        if (resource.poolId !== STORY_GEMINI_WEB_QUEUE_POOL_ID) {
          return false;
        }
        if (!resource.enabled) {
          return false;
        }
        if (stickyState.failedResourceIds.has(resource.resourceId)) {
          return false;
        }
        return true;
      })
      .map((resource) => resource.resourceId);
  }

  private static selectStoryStickyResourceId(
    queue: ReturnType<typeof getQueueRuntimeOrCreate>,
    stickyState: StoryBatchStickyAccountState
  ): string | null {
    const enabledResourceIds = this.getStoryEnabledResourceIdsForBatch(queue, stickyState);
    if (enabledResourceIds.length === 0) {
      stickyState.stickyResourceId = null;
      this.touchStoryBatchStickyState(stickyState);
      return null;
    }

    const currentSticky = stickyState.stickyResourceId?.trim() || null;
    if (currentSticky && enabledResourceIds.includes(currentSticky)) {
      this.touchStoryBatchStickyState(stickyState);
      return currentSticky;
    }

    if (currentSticky) {
      console.warn(
        `[StoryGeminiWebQueue][Sticky] Sticky account unavailable batchId=${stickyState.batchId} resourceId=${currentSticky}`
      );
    }

    stickyState.stickyResourceId = enabledResourceIds[0];
    this.touchStoryBatchStickyState(stickyState);
    console.log(
      `[StoryGeminiWebQueue][Sticky] Locked account batchId=${stickyState.batchId} resourceId=${stickyState.stickyResourceId}`
    );
    return stickyState.stickyResourceId;
  }

  private static markStoryStickyResourceFailed(
    stickyState: StoryBatchStickyAccountState,
    resourceId: string,
    reason: string
  ): void {
    const normalizedResourceId = resourceId.trim();
    if (!normalizedResourceId) {
      return;
    }
    stickyState.failedResourceIds.add(normalizedResourceId);
    if (stickyState.stickyResourceId === normalizedResourceId) {
      stickyState.stickyResourceId = null;
    }
    this.touchStoryBatchStickyState(stickyState);
    console.warn(
      `[StoryGeminiWebQueue][Sticky] Failover batchId=${stickyState.batchId} failedResourceId=${normalizedResourceId} reason=${reason}`
    );
  }

  private static extractPromptText(preparedPrompt: any): string {
    let promptText = '';

    if (typeof preparedPrompt === 'string') {
      promptText = preparedPrompt;
    } else if (Array.isArray(preparedPrompt)) {
      const lastUserMsg = [...preparedPrompt]
        .reverse()
        .find((msg) => msg?.role === 'user' && typeof msg?.content === 'string');
      if (lastUserMsg?.content) {
        promptText = lastUserMsg.content;
      } else {
        promptText = JSON.stringify(preparedPrompt);
      }
    } else if (preparedPrompt && typeof preparedPrompt === 'object') {
      promptText = JSON.stringify(preparedPrompt);
    }

    return promptText;
  }

  private static ensureStoryGeminiWebQueueResources(): void {
    this.pruneStoryBatchStickyStates();
    const queue = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
    const settings = AppSettingsService.getAll();
    const minIntervalMs = normalizeGeminiMinSendIntervalMs(settings.geminiMinSendIntervalMs);
    const maxIntervalMs = normalizeGeminiMaxSendIntervalMs(settings.geminiMaxSendIntervalMs, minIntervalMs);
    const intervalMode = normalizeGeminiSendIntervalMode(settings.geminiSendIntervalMode);
    const stickyCapabilitiesByResource = this.buildStoryStickyCapabilitiesByResource();
    const queueGapMs = minIntervalMs;
    queue.registerPool({
      poolId: STORY_GEMINI_WEB_QUEUE_POOL_ID,
      label: 'Story GeminiWeb Accounts',
      selector: 'round_robin',
      dispatchSpacingMs: queueGapMs,
      defaultCooldownMinMs: 0,
      defaultCooldownMaxMs: 0
    });

    const db = getDatabase();
    const rows = db
      .prepare(
        `
          SELECT
            id,
            name,
            is_active,
            is_error,
            "__Secure-1PSID" AS secure_1psid,
            "__Secure-1PSIDTS" AS secure_1psidts
          FROM gemini_chat_config
          ORDER BY updated_at DESC
        `
      )
      .all() as Array<{
      id: string;
      name: string;
      is_active: number;
        is_error: number;
      secure_1psid: string | null;
      secure_1psidts: string | null;
    }>;

    const eligibleResourceIds = new Set<string>();

    for (const row of rows) {
      const isActive = row.is_active === 1;
      const isError = row.is_error === 1;
      const hasSecureCookies = !!row.secure_1psid?.trim() && !!row.secure_1psidts?.trim();
      const enabled = isActive && !isError && hasSecureCookies;
      const stickyCapabilities = stickyCapabilitiesByResource.get(row.id);
      const capabilities = [
        'story_translate',
        'gemini_webapi',
        ...(stickyCapabilities ? Array.from(stickyCapabilities) : []),
      ];

      queue.upsertResource({
        poolId: STORY_GEMINI_WEB_QUEUE_POOL_ID,
        resourceId: row.id,
        label: row.name?.trim() || row.id,
        capabilities,
        enabled,
        maxConcurrency: 1,
        cooldownMinMs: intervalMode === 'random' ? minIntervalMs : 0,
        cooldownMaxMs: intervalMode === 'random' ? maxIntervalMs : 0,
        metadata: {
          accountName: row.name?.trim() || row.id
        }
      });

      if (enabled) {
        eligibleResourceIds.add(row.id);
      }
    }

    const snapshot = queue.getSnapshot();
    const existingResourceIds = snapshot.resources
      .filter((item) => item.poolId === STORY_GEMINI_WEB_QUEUE_POOL_ID)
      .map((item) => item.resourceId);

    for (const resourceId of existingResourceIds) {
      if (!eligibleResourceIds.has(resourceId)) {
        queue.setResourceEnabled(STORY_GEMINI_WEB_QUEUE_POOL_ID, resourceId, false);
      }
    }
  }

  private static getStoryWebQueueGapMs(): number {
    return STORY_GEMINI_WEB_QUEUE_DEFAULT_GAP_MS;
  }

  private static buildStoryWebQueueTimingPayload(
    queued: {
      startedAt?: number;
      endedAt: number;
      resourceId?: string;
    },
    queueGapMs: number
  ): StoryWebQueueTimingPayload {
    const endedAt = Number.isFinite(queued.endedAt) ? queued.endedAt : Date.now();
    const startedAt = Number.isFinite(queued.startedAt) ? queued.startedAt : undefined;
    const nextAllowedAt = startedAt !== undefined ? startedAt + queueGapMs : undefined;
    return {
      queuePacingMode: 'dispatch_spacing_global',
      queueGapMs,
      startedAt,
      endedAt,
      nextAllowedAt
    };
  }

  private static mergeStoryWebQueueMetadata(
    inputMetadata: Record<string, unknown> | undefined,
    timingPayload: StoryWebQueueTimingPayload
  ): Record<string, unknown> {
    return {
      ...(inputMetadata ?? {}),
      ...timingPayload
    };
  }

  static async createEbook(options: { 
      chapters: { title: string; content: string }[], 
      title: string, 
      author?: string, 
      outputDir?: string,
      filename?: string,
      cover?: string
    sourceEpubPath?: string;
  }): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
        const nodepub = require('nodepub');
        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const EPub = require('epub');
        
        const { chapters, title, author, outputDir, filename, cover, sourceEpubPath } = options;
        
        // Define output path
        const downloadDir = outputDir || path.join(os.homedir(), 'Downloads');
        const safeTitle = (filename || title).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        // Create temporary cover file if needed
        let coverPath: string | undefined = cover;
        let tempCoverPath: string | undefined = undefined;
        let sourceCoverTempPath: string | undefined = undefined;

        const resolveSourceEpubMeta = async (epubPath: string): Promise<{ author?: string; coverPath?: string }> => {
            return new Promise((resolve) => {
                try {
                    const epub = new EPub(epubPath);
                    epub.on('error', () => resolve({}));
                    epub.on('end', () => {
                        const meta = epub.metadata || {};
                        const normalizeAuthor = (value: any): string | undefined => {
                            if (Array.isArray(value)) {
                                return value.filter(Boolean).join(', ') || undefined;
                            }
                            if (value && typeof value === 'object') {
                                return value.name || value.creator || value.author || undefined;
                            }
                            return typeof value === 'string' ? value : undefined;
                        };
                        const sourceAuthor = normalizeAuthor(meta.creator) || normalizeAuthor(meta.author);
                        let coverId: any = meta.cover;

                        if (coverId && typeof coverId === 'object' && coverId.id) {
                            coverId = coverId.id;
                        }

                        if (!coverId && epub.manifest) {
                            const items = Object.values(epub.manifest) as any[];
                            const coverItem = items.find((item) => {
                                const id = item?.id || item?.ID;
                                const mediaType = item?.['media-type'] || item?.mediaType;
                                return id && typeof mediaType === 'string' && mediaType.startsWith('image/') && /cover/i.test(id);
                            });
                            if (coverItem?.id) coverId = coverItem.id;
                        }

                        if (!coverId) {
                            resolve({ author: sourceAuthor });
                            return;
                        }

                        epub.getImage(coverId, (err: any, data: Buffer, mimeType: string) => {
                            if (err || !data) {
                                resolve({ author: sourceAuthor });
                                return;
                            }

                            const ext =
                                mimeType === 'image/png' ? '.png'
                                : mimeType === 'image/jpeg' ? '.jpg'
                                : mimeType === 'image/webp' ? '.webp'
                                : '.img';
                            const tempPath = path.join(os.tmpdir(), `cover_src_${Date.now()}${ext}`);
                            try {
                                fs.writeFileSync(tempPath, data);
                                resolve({ author: sourceAuthor, coverPath: tempPath });
                            } catch {
                                resolve({ author: sourceAuthor });
                            }
                        });
                    });
                    epub.parse();
                } catch {
                    resolve({});
                }
            });
        };

        let sourceAuthor: string | undefined;
        if (sourceEpubPath && fs.existsSync(sourceEpubPath) && path.extname(sourceEpubPath).toLowerCase() === '.epub') {
            const sourceMeta = await resolveSourceEpubMeta(sourceEpubPath);
            sourceAuthor = sourceMeta.author;
            if (sourceMeta.coverPath) {
                coverPath = sourceMeta.coverPath;
                sourceCoverTempPath = sourceMeta.coverPath;
            }
        }

        const finalAuthor = sourceAuthor || author || 'AI Translator';
        
        if (!coverPath) {
            // Create a simple 1x1 transparent PNG as temp cover
            const coverBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
            tempCoverPath = path.join(os.tmpdir(), `cover_${Date.now()}.png`);
            fs.writeFileSync(tempCoverPath, coverBuffer);
            coverPath = tempCoverPath;
        }
        
        // nodepub uses document metadata
        const metadata = {
            id: safeTitle,
            title: title,
            author: finalAuthor,
            cover: coverPath
        };

        const epub = nodepub.document(metadata);
        
        for (const chapter of chapters) {
             const htmlContent = chapter.content
                 .replace(/\n/g, '<br/>')
                 .replace(/  /g, '&nbsp;&nbsp;');
             epub.addSection(chapter.title, htmlContent);
        }

        const finalPath = path.join(downloadDir, `${safeTitle}.epub`);

        return new Promise(async (resolve) => {
             try {
                 await epub.writeEPUB(downloadDir, safeTitle);
                 
                 // Clean up temp cover file if created
                  const tempPaths = [tempCoverPath, sourceCoverTempPath].filter(Boolean) as string[];
                  for (const tempPath of tempPaths) {
                      if (fs.existsSync(tempPath)) {
                          fs.unlinkSync(tempPath);
                      }
                  }
                 
                 // nodepub writes to [folder]/[filename].epub
                 resolve({ success: true, filePath: finalPath });
             } catch (e) {
                 // Clean up temp cover file on error too
                  const tempPaths = [tempCoverPath, sourceCoverTempPath].filter(Boolean) as string[];
                  for (const tempPath of tempPaths) {
                      if (fs.existsSync(tempPath)) {
                          try { fs.unlinkSync(tempPath); } catch {}
                      }
                  }
                 resolve({ success: false, error: String(e) });
             }
        });

    } catch (error) {
        console.error('[StoryService] Error creating ebook:', error);
        return { success: false, error: String(error) };
    }
  }
}
