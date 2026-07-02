import { type AIProvider, type AIProviderResult } from '../aiProvider'
import { callGeminiWithRotation, callGeminiWithAssignedKey } from '../../gemini'
import { type KeyInfo } from '../../../../shared/types/gemini'

type GeminiAssignedKey = { apiKey: string; keyInfo: KeyInfo }

export function createGeminiProvider(assignedKey?: GeminiAssignedKey): AIProvider {
  return {
    transport: 'api',
    async call({ prompt, model, signal }): Promise<AIProviderResult> {
      const control = signal
        ? { stopSignal: signal, stopErrorMessage: 'STOP_REQUESTED' }
        : undefined

      const response = assignedKey
        ? await callGeminiWithAssignedKey(prompt, assignedKey, model, control)
        : await callGeminiWithRotation(prompt, model, 10, control)

      if (!response.success && response.error === 'STOP_REQUESTED') {
        return { success: false, error: 'STOP_REQUESTED', errorCode: 'STOP_REQUESTED' }
      }

      if (response.success && typeof response.data === 'string') {
        return { success: true, data: response.data, keySwitchCount: response.keySwitchCount, accountLabel: assignedKey?.keyInfo.name }
      }

      return {
        success: false,
        error: response.error || 'Gemini API error',
        errorCode: response.errorCode,
        keySwitchCount: response.keySwitchCount,
        accountLabel: assignedKey?.keyInfo.name,
      }
    },
  }
}
