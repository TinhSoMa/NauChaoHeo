import { type AIProvider, type AIProviderResult, type AIProviderStreamParams } from '../aiProvider'
import { callGeminiWithRotation, callGeminiWithAssignedKey, callGeminiWithRotationStream, callGeminiWithAssignedKeyStream } from '../../gemini'
import { type KeyInfo } from '../../../../shared/types/gemini'

type GeminiAssignedKey = { apiKey: string; keyInfo: KeyInfo }

function createControl(signal?: AbortSignal) {
  return signal
    ? { stopSignal: signal, stopErrorMessage: 'STOP_REQUESTED' }
    : undefined
}

function mapResponse(response: Awaited<ReturnType<typeof callGeminiWithRotation>>, accountLabel?: string): AIProviderResult {
  if (!response.success && response.error === 'STOP_REQUESTED') {
    return { success: false, error: 'STOP_REQUESTED', errorCode: 'STOP_REQUESTED' }
  }

  if (response.success && typeof response.data === 'string') {
    return { success: true, data: response.data, keySwitchCount: response.keySwitchCount, accountLabel }
  }

  return {
    success: false,
    error: response.error || 'Gemini API error',
    errorCode: response.errorCode,
    keySwitchCount: response.keySwitchCount,
    accountLabel,
  }
}

export function createGeminiProvider(assignedKey?: GeminiAssignedKey): AIProvider {
  return {
    transport: 'api',
    async call({ prompt, model, signal, imageBase64 }): Promise<AIProviderResult> {
      const control = createControl(signal)

      const response = assignedKey
        ? await callGeminiWithAssignedKey(prompt, assignedKey, model, control, imageBase64)
        : await callGeminiWithRotation(prompt, model, 10, control, imageBase64)

      return mapResponse(response, assignedKey?.keyInfo.name)
    },

    async callStream({ prompt, model, signal, imageBase64, onChunk }: AIProviderStreamParams): Promise<AIProviderResult> {
      const control = createControl(signal)

      const response = assignedKey
        ? await callGeminiWithAssignedKeyStream(prompt, assignedKey, onChunk, model, control, imageBase64)
        : await callGeminiWithRotationStream(prompt, onChunk, model, 10, control, imageBase64)

      return mapResponse(response, assignedKey?.keyInfo.name)
    },
  }
}
