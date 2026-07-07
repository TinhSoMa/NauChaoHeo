import type { AIProvider, AIProviderResult, AIProviderParams } from '../aiProvider.js';
import { callDeepSeekChat } from '../../deepseek/deepseekService.js';

export function createDeepSeekProvider(): AIProvider {
  return {
    transport: 'deepseek',
    async call({ prompt, systemPrompt, model, signal, debugSaveDir, batchIndex, imageBase64 }: AIProviderParams): Promise<AIProviderResult> {
      const response = await callDeepSeekChat(prompt, { systemPrompt, model, signal, debugSaveDir, batchIndex, imageBase64 });

      if (!response.success) {
        return { success: false, error: response.error };
      }

      if (typeof response.data === 'string') {
        return { success: true, data: response.data };
      }

      return { success: false, error: 'DeepSeek API error' };
    },
  };
}
