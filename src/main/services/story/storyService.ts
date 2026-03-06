import * as GeminiService from '../gemini/geminiService';
import { PromptService } from '../promptService';
import { GeminiChatService } from '../chatGemini/geminiChatService';
import { AppSettingsService } from '../appSettings';
import { getDatabase } from '../../database/schema';
import { getGeminiWebApiRuntime } from '../geminiWebApi';
import {
  getQueueRuntimeOrCreate,
  RotationJobExecutionError,
  type RotationJobErrorCode
} from '../shared/universalRotationQueue';
import type { StoryGeminiWebQueueCapacity } from '../../../shared/types/story';
import type { StoryCancelGeminiWebQueueBatchResult } from '../../../shared/types/story';

const STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY = 'story.translation.geminiWeb';
const STORY_GEMINI_WEB_QUEUE_POOL_ID = 'story-geminiweb-accounts';
const STORY_GEMINI_WEB_QUEUE_FEATURE = 'story.translate.geminiWeb';
const STORY_GEMINI_WEB_QUEUE_SERVICE_ID = 'story-translator-ui';
const STORY_GEMINI_WEB_QUEUE_DEFAULT_GAP_MS = 10_000;

interface StoryTranslateChapterWithGeminiWebQueueOptions {
  prompt: any;
  model?: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  priority?: 'high' | 'normal' | 'low';
  conversationKey?: string;
  resetConversation?: boolean;
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

/**
 * Story Service - Handles story translation logic
 */
export class StoryService {
  /**
   * Translates a chapter using prepared prompt and Gemini API
   * Method: 'API' (Google Gemini API) hoặc 'IMPIT' (Web scraping qua impit)
   */
  static async translateChapter(options: { prompt: any, method?: 'API' | 'IMPIT', model?: string, webConfigId?: string, context?: any, useProxy?: boolean, metadata?: any, onRetry?: (attempt: number, maxRetries: number) => void }): Promise<{ success: boolean; data?: string; error?: string; context?: any; configId?: string; metadata?: any; retryable?: boolean }> {
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
          // Use the model from options, or fallback to FLASH_3_0
          const modelToUse = (options.model as any) || GeminiService.GEMINI_MODELS.FLASH_3_0;
          
          const result = await GeminiService.callGeminiWithRotation(
            options.prompt, 
            modelToUse
          );
          
          if (result.success) {
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
    try {
      if (!this.isStoryGeminiWebQueueEnabled()) {
        return {
          success: false,
          error: 'Story Gemini Web Queue is disabled by feature flag.',
          errorCode: 'EXECUTION_ERROR',
          queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
          metadata: options.metadata
        };
      }

      const promptText = this.extractPromptText(options.prompt);
      if (!promptText.trim()) {
        return {
          success: false,
          error: 'Prompt text is empty.',
          errorCode: 'EXECUTION_ERROR',
          queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
          metadata: options.metadata
        };
      }

      this.ensureStoryGeminiWebQueueResources();
      const queue = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
      const queueGapMs = this.getStoryWebQueueGapMs(queue);

      const queued = await queue.enqueue<{ promptText: string }, string>({
        poolId: STORY_GEMINI_WEB_QUEUE_POOL_ID,
        feature: STORY_GEMINI_WEB_QUEUE_FEATURE,
        serviceId: STORY_GEMINI_WEB_QUEUE_SERVICE_ID,
        jobType: 'translate-chapter',
        priority: options.priority ?? 'normal',
        requiredCapabilities: ['story_translate', 'gemini_webapi'],
        maxAttempts: 3,
        timeoutMs: options.timeoutMs ?? 120_000,
        metadata: options.metadata,
        payload: { promptText },
        execute: async (ctx) => {
          const response = await getGeminiWebApiRuntime().generateContent({
            prompt: ctx.payload.promptText,
            timeoutMs: options.timeoutMs ?? 120_000,
            accountConfigId: ctx.resource.resourceId,
            conversationKey: options.conversationKey,
            resetConversation: options.resetConversation,
            useChatSession: !!options.conversationKey,
          });

          if (!response.success) {
            const errorMessage = response.error || 'GeminiWebApi execution failed';
            if (response.errorCode === 'GEMINI_TIMEOUT') {
              throw new RotationJobExecutionError('TIMEOUT', errorMessage);
            }
            if (response.errorCode === 'COOKIE_INVALID' || response.errorCode === 'COOKIE_NOT_FOUND') {
              throw new RotationJobExecutionError('RESOURCE_UNAVAILABLE', errorMessage);
            }
            throw new RotationJobExecutionError('EXECUTION_ERROR', errorMessage);
          }

          return response.text || '';
        }
      });

      const timingPayload = this.buildStoryWebQueueTimingPayload(queued, queueGapMs);
      const metadataWithTiming = this.mergeStoryWebQueueMetadata(options.metadata, timingPayload);

      if (!queued.success) {
        return {
          success: false,
          error: queued.error || 'Queue job failed',
          errorCode: queued.errorCode,
          resourceId: queued.resourceId,
          queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
          metadata: metadataWithTiming
        };
      }

      return {
        success: true,
        data: queued.result || '',
        resourceId: queued.resourceId,
        queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
        metadata: metadataWithTiming
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
        errorCode: 'EXECUTION_ERROR',
        queueRuntimeKey: STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY,
        metadata: options.metadata
      };
    }
  }

  /**
   * Prepares the translation prompt by fetching the appropriate prompt from the database
   * and injecting the chapter content.
   */
  static async prepareTranslationPrompt(chapterContent: string, sourceLang: string, targetLang: string): Promise<{ success: boolean; prompt?: any; error?: string }> {
    try {
      let matchingPrompt;
      
      // 1. Check if user has configured a specific prompt in settings
      const appSettings = AppSettingsService.getAll();
      if (appSettings.translationPromptId) {
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

      // 3. Parse and inject content
      return this.injectContentIntoPrompt(matchingPrompt.content, chapterContent);

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
      if (appSettings.summaryPromptId) {
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
  private static injectContentIntoPrompt(promptContent: string, chapterContent: string): { success: boolean; prompt?: any; error?: string } {
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
          return { success: true, prompt: preparedPrompt };
      }

      return { success: false, error: 'Prompt content must be a JSON array or object' };

    } catch (error) {
      console.error('Error injecting content into prompt:', error);
      return { success: false, error: String(error) };
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

    return {
      success: true,
      cancelledJobIds,
      requestedJobCount: matchingJobs.length
    };
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
    const queue = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
    const queueGapMs = this.getStoryWebQueueGapMs(queue);
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
      secure_1psid: string | null;
      secure_1psidts: string | null;
    }>;

    const eligibleResourceIds = new Set<string>();

    for (const row of rows) {
      const isActive = row.is_active === 1;
      const hasSecureCookies = !!row.secure_1psid?.trim() && !!row.secure_1psidts?.trim();
      const enabled = isActive && hasSecureCookies;

      queue.upsertResource({
        poolId: STORY_GEMINI_WEB_QUEUE_POOL_ID,
        resourceId: row.id,
        label: row.name?.trim() || row.id,
        capabilities: ['story_translate', 'gemini_webapi'],
        enabled,
        maxConcurrency: 1,
        cooldownMinMs: 0,
        cooldownMaxMs: 0,
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

  private static getStoryWebQueueGapMs(queue: ReturnType<typeof getQueueRuntimeOrCreate>): number {
    const snapshot = queue.getSnapshot();
    const byPool = snapshot.dispatchThrottleByPool ?? {};
    const currentPool = byPool[STORY_GEMINI_WEB_QUEUE_POOL_ID];
    const spacingMs = Number(currentPool?.spacingMs);
    if (Number.isFinite(spacingMs) && spacingMs >= 0) {
      return Math.floor(spacingMs);
    }
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
  }): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
        const nodepub = require('nodepub');
        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        
        const { chapters, title, author, outputDir, filename, cover } = options;
        
        // Define output path
        const downloadDir = outputDir || path.join(os.homedir(), 'Downloads');
        const safeTitle = (filename || title).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        // Create temporary cover file if needed
        let coverPath: string | undefined = cover;
        let tempCoverPath: string | undefined = undefined;
        
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
            author: author || 'AI Translator',
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
                 if (tempCoverPath && fs.existsSync(tempCoverPath)) {
                     fs.unlinkSync(tempCoverPath);
                 }
                 
                 // nodepub writes to [folder]/[filename].epub
                 resolve({ success: true, filePath: finalPath });
             } catch (e) {
                 // Clean up temp cover file on error too
                 if (tempCoverPath && fs.existsSync(tempCoverPath)) {
                     try { fs.unlinkSync(tempCoverPath); } catch {}
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
