import { type AIProvider, type AIProviderResult } from '../aiProvider'
import { callChatCompletionWithRotation } from '../../openrouter'
import { type OpenRouterMessage } from '../../../../shared/types/openrouter'
import { AppSettingsService } from '../../appSettings'
import { OPENROUTER_DEFAULT_MODEL } from '../../../../shared/types/openrouter'

export function createOpenRouterProvider(): AIProvider {
  return {
    transport: 'openrouter',
    async call({ prompt, model, signal }): Promise<AIProviderResult> {
      const config = AppSettingsService.getAll()
      const resolvedModel = model || config.openrouterDefaultModel || OPENROUTER_DEFAULT_MODEL

      const messages: OpenRouterMessage[] = [
        { role: 'user', content: prompt },
      ]

      const response = await callChatCompletionWithRotation(messages, {
        model: resolvedModel,
        signal,
      })

      if (response.success && response.data?.choices?.[0]?.message?.content) {
        return { success: true, data: response.data.choices[0].message.content }
      }

      return {
        success: false,
        error: response.error || 'OpenRouter API error',
      }
    },
  }
}
