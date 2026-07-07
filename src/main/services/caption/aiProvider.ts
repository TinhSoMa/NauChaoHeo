export type TranslationTransport = 'api' | 'impit' | 'grok_ui' | 'gemini_webapi_queue' | 'openrouter' | 'deepseek';

export interface AIProviderResult {
  success: boolean
  data?: string
  error?: string
  errorCode?: string
  keySwitchCount?: number
  accountLabel?: string
}

export interface AIProviderParams {
  prompt: string
  systemPrompt?: string
  model: string
  signal?: AbortSignal
  debugSaveDir?: string
  batchIndex?: number
  imageBase64?: string
}

export interface AIProvider {
  call(params: AIProviderParams): Promise<AIProviderResult>
  transport: TranslationTransport
}
