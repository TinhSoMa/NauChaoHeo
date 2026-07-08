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

export interface AIProviderStreamParams extends AIProviderParams {
  onChunk: (chunk: string) => void
  onStatus?: (status: string) => void
}

export interface AIProvider {
  call(params: AIProviderParams): Promise<AIProviderResult>
  callStream?(params: AIProviderStreamParams): Promise<AIProviderResult>
  transport: TranslationTransport
}
