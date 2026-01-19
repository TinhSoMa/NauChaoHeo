import * as GeminiService from '../gemini/geminiService';
import { PromptService } from '../promptService';

/**
 * Story Service - Handles story translation logic
 */
export class StoryService {
  /**
   * Translates a chapter using prepared prompt and Gemini API
   */
  static async translateChapter(preparedPrompt: any): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
      console.log('[StoryService] Starting translation...');
      
      const result = await GeminiService.callGeminiWithRotation(
        preparedPrompt, 
        GeminiService.GEMINI_MODELS.FLASH_2_5
      );
      
      if (result.success) {
        return { success: true, data: result.data };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('[StoryService] Error translating chapter:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Prepares the translation prompt by fetching the appropriate prompt from the database
   * and injecting the chapter content.
   */
  static async prepareTranslationPrompt(chapterContent: string, sourceLang: string, targetLang: string): Promise<{ success: boolean; prompt?: any; error?: string }> {
    try {
      // 1. Get all prompts
      const prompts = PromptService.getAll();
      
      // 2. Find matching prompt (prioritize default one)
      const matchingPrompt = prompts.find(p => 
        p.sourceLang === sourceLang && 
        p.targetLang === targetLang && 
        p.isDefault
      ) || prompts.find(p => 
        p.sourceLang === sourceLang && 
        p.targetLang === targetLang
      );

      if (!matchingPrompt) {
        return { 
          success: false, 
          error: `No translation prompt found for ${sourceLang} -> ${targetLang}` 
        };
      }

      // 3. Parse the prompt content (which is a JSON string)
      let promptData;
      try {
        promptData = JSON.parse(matchingPrompt.content);
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
      console.error('Error preparing translation prompt:', error);
      return { success: false, error: String(error) };
    }
  }
}
