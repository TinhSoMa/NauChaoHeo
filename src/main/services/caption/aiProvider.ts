import type { TranslationTransport } from '../../../shared/types/caption'

export interface AIProviderResult {
  success: boolean
  data?: string
  error?: string
  errorCode?: string
}

export interface AIProviderParams {
  prompt: string
  model: string
  signal?: AbortSignal
}

export interface AIProvider {
  call(params: AIProviderParams): Promise<AIProviderResult>
  transport: TranslationTransport
}
