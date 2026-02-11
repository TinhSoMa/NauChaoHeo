import * as GeminiService from '../gemini/geminiService';
import { PromptService } from '../promptService';
import { GeminiChatService } from '../chatGemini/geminiChatService';
import { AppSettingsService } from '../appSettings';

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
           // Extract text from prompt (assuming preparedPrompt results in structured object/array)
           
           // Extract text from prompt (assuming preparedPrompt results in structured object/array)
           let promptText = "";
           const preparedPrompt = options.prompt;
           
           if (typeof preparedPrompt === 'string') {
               promptText = preparedPrompt;
           } else if (Array.isArray(preparedPrompt)) {
               // Chat history format: find the last user message
               const lastUserMsg = [...preparedPrompt].reverse().find(m => m.role === 'user');
               if (lastUserMsg) promptText = lastUserMsg.content;
           } else if (typeof preparedPrompt === 'object') {
               // Fallback: stringify? Or specific field?
               // Based on current promptService, it returns array or object.
               // Let's assume we want the full structured instruction. 
               // BUT Gemini Web Chat usually takes a single string message. 
               // We might need to flatten it or just take the content.
                promptText = JSON.stringify(preparedPrompt); 
               // Logic refinement: Web Interface is "Chat", so we send the "Prompt" as the message.
               // If preparedPrompt is chat history (Role/Content), we might lose history if we just send last message?
               // NO, Gemini Web *maintains* history via Context IDs. We just send the NEW message.
               
               // So if preparedPrompt contains the FULL history including system instructions, we are kinda double-dipping?
               // Ideally for Web Chat updates: We just want the NEW chapter content + instruction.
               // However, `prepareTranslationPrompt` returns a full constructed prompt.
               
               // Quick Fix: Convert the whole structure to a string representation if complex, 
               // OR better: Just extract the actual chapter content if we can, but `prepareTranslationPrompt` has already merged it.
               
               // Let's use the Last User Message Content if array, else Stringify.
                if (Array.isArray(preparedPrompt)) {
                    const lastMsg = preparedPrompt[preparedPrompt.length - 1];
                     if (lastMsg && lastMsg.role === 'user') promptText = lastMsg.content;
                     else promptText = JSON.stringify(preparedPrompt);
                }
           }
            
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
