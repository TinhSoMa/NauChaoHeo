export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1'

export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini'

export const OPENROUTER_IPC_CHANNELS = {
  CHAT: 'openrouter:chat',
  STREAM: 'openrouter:stream',
  GET_MODELS: 'openrouter:getModels',
  GET_KEY_INFO: 'openrouter:getKeyInfo',
  SET_CONFIG: 'openrouter:setConfig',
  GET_CONFIG: 'openrouter:getConfig',
  STREAM_CHUNK: 'openrouter:streamChunk',

  // Key Management
  GET_ALL_ACCOUNTS: 'openrouter:getAllAccounts',
  ADD_ACCOUNT: 'openrouter:addAccount',
  REMOVE_ACCOUNT: 'openrouter:removeAccount',
  ADD_PROJECT: 'openrouter:addProject',
  REMOVE_PROJECT: 'openrouter:removeProject',
  ENABLE_ACCOUNT: 'openrouter:enableAccount',
  DISABLE_ACCOUNT: 'openrouter:disableAccount',
  ENABLE_PROJECT: 'openrouter:enableProject',
  DISABLE_PROJECT: 'openrouter:disableProject',
  IMPORT_KEYS: 'openrouter:importKeys',
  EXPORT_KEYS: 'openrouter:exportKeys',
  HAS_KEYS: 'openrouter:hasKeys',
  GET_KEY_STATS: 'openrouter:getKeyStats',
} as const

export interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  name?: string
}

export interface OpenRouterRequest {
  model?: string
  messages: OpenRouterMessage[]
  stream?: boolean
  max_tokens?: number
  temperature?: number
  top_p?: number
  top_k?: number
  frequency_penalty?: number
  presence_penalty?: number
  repetition_penalty?: number
  seed?: number
  stop?: string | string[]
  response_format?: { type: 'json_object' } | { type: 'json_schema'; json_schema: { name: string; schema: object; strict?: boolean } }
  user?: string
  route?: 'fallback'
  models?: string[]
  plugins?: { id: string; enabled?: boolean; [key: string]: unknown }[]
  provider?: {
    order?: string[]
    allow_fallbacks?: boolean
    data_collection?: 'deny' | 'allow'
  }
}

export interface OpenRouterUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: { cached_tokens: number }
  completion_tokens_details?: { reasoning_tokens: number }
  cost?: number
}

export interface OpenRouterResponseChoice {
  index: number
  finish_reason: string | null
  message: {
    role: string
    content: string | null
  }
}

export interface OpenRouterResponse {
  id: string
  choices: OpenRouterResponseChoice[]
  usage?: OpenRouterUsage
  model: string
  object: string
  created: number
}

export interface OpenRouterStreamChunk {
  id: string
  choices: {
    index: number
    delta: { content?: string; role?: string }
    finish_reason: string | null
  }[]
  model: string
  object: string
  created: number
  usage?: OpenRouterUsage
}

export type OpenRouterModelCapability = 'text' | 'vision' | 'image' | 'audio' | 'file' | 'video'

export const CAPABILITY_LABELS: Record<OpenRouterModelCapability, string> = {
  text: 'Text',
  vision: 'Vision',
  image: 'Image Gen',
  audio: 'Audio',
  file: 'File/PDF',
  video: 'Video',
}

export const CAPABILITY_COLORS: Record<OpenRouterModelCapability, string> = {
  text: '',
  vision: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  image: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  audio: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  file: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  video: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
}

const MODALITY_MODIFIERS: Record<string, OpenRouterModelCapability> = {
  image: 'vision',
  audio: 'audio',
  file: 'file',
  video: 'video',
}

export function getModelCapabilities(model: OpenRouterModel): OpenRouterModelCapability[] {
  const caps: Set<OpenRouterModelCapability> = new Set(['text'])

  if (model.architecture?.modality) {
    const parts = model.architecture.modality.split('->')
    for (const part of parts) {
      const modalities = part.split('+')
      for (const mod of modalities) {
        const mapped = MODALITY_MODIFIERS[mod]
        if (mapped) caps.add(mapped)
      }
    }
  }

  if (model.architecture?.input_modalities) {
    for (const mod of model.architecture.input_modalities) {
      const mapped = MODALITY_MODIFIERS[mod]
      if (mapped) caps.add(mapped)
    }
  }

  if (model.architecture?.output_modalities) {
    for (const mod of model.architecture.output_modalities) {
      const mapped = MODALITY_MODIFIERS[mod]
      if (mapped) caps.add(mapped)
    }
  }

  if (model.id.toLowerCase().includes('image')) caps.add('vision')
  if (model.id.toLowerCase().includes('audio')) caps.add('audio')

  return Array.from(caps)
}

export interface OpenRouterModel {
  id: string
  name: string
  created?: number
  description?: string
  context_length?: number
  pricing?: {
    prompt: string
    completion: string
  }
  architecture?: {
    modality: string
    input_modalities: string[]
    output_modalities: string[]
    tokenizer?: string
    instruct_type?: string | null
  }
}

export interface OpenRouterKeyInfo {
  data: {
    label: string
    limit: number | null
    limit_remaining: number | null
    usage: number
    usage_daily: number
    usage_weekly: number
    usage_monthly: number
    is_free_tier: boolean
  }
}

export interface OpenRouterApiError {
  error: {
    code: number
    message: string
    metadata?: Record<string, unknown>
  }
}

export interface OpenRouterConfig {
  apiKey: string | null
  defaultModel: string
  siteUrl: string | null
  appTitle: string | null
}

export interface OpenRouterServiceResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// Pricing values are per-token (matching OpenRouter API format):
//   "0" = free, "-1" = dynamic, "0.0000025" = $2.50 per million tokens
export const OPENROUTER_FALLBACK_MODELS: OpenRouterModel[] = [
  { id: 'openai/gpt-4o', name: 'GPT-4o', pricing: { prompt: '0.0000025', completion: '0.00001' }, context_length: 128000 },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', pricing: { prompt: '0.00000015', completion: '0.0000006' }, context_length: 128000 },
  { id: 'openai/o1-mini', name: 'O1 Mini', pricing: { prompt: '0.0000011', completion: '0.0000044' }, context_length: 128000 },
  { id: 'openai/o3-mini', name: 'O3 Mini', pricing: { prompt: '0.0000011', completion: '0.0000044' }, context_length: 200000 },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 200000 },
  { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 200000 },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', pricing: { prompt: '0.00000025', completion: '0.00000125' }, context_length: 200000 },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', pricing: { prompt: '0.0000001', completion: '0.0000004' }, context_length: 1048576 },
  { id: 'google/gemini-2.0-flash-lite-001', name: 'Gemini 2.0 Flash Lite', pricing: { prompt: '0.000000075', completion: '0.0000003' }, context_length: 1048576 },
  { id: 'google/gemini-2.5-pro-exp-03-25', name: 'Gemini 2.5 Pro (experimental)', pricing: { prompt: '0.00000125', completion: '0.000005' }, context_length: 1048576 },
  { id: 'google/gemini-2.5-pro-exp-03-25:free', name: 'Gemini 2.5 Pro (free)', pricing: { prompt: '0', completion: '0' }, context_length: 1048576 },
  { id: 'meta-llama/llama-3.2-3b-instruct', name: 'Llama 3.2 3B', pricing: { prompt: '0', completion: '0' }, context_length: 131072 },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', pricing: { prompt: '0', completion: '0' }, context_length: 131072 },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', pricing: { prompt: '0', completion: '0' }, context_length: 65536 },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', pricing: { prompt: '0', completion: '0' }, context_length: 65536 },
  { id: 'mistralai/mistral-7b-instruct', name: 'Mistral 7B', pricing: { prompt: '0', completion: '0' }, context_length: 32768 },
  { id: 'mistralai/mixtral-8x7b-instruct', name: 'Mixtral 8x7B', pricing: { prompt: '0', completion: '0' }, context_length: 32768 },
  { id: 'qwen/qwen-2.5-7b-instruct', name: 'Qwen 2.5 7B', pricing: { prompt: '0', completion: '0' }, context_length: 131072 },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', pricing: { prompt: '0.00000035', completion: '0.0000004' }, context_length: 131072 },
]

export interface OpenRouterAccountItem {
  accountId: string
  email: string
  accountStatus: 'active' | 'disabled'
  projects: OpenRouterProjectItem[]
}

export interface OpenRouterProjectItem {
  projectIndex: number
  projectName: string
  apiKey: string
  notes: string | null
  status: 'available' | 'rate_limited' | 'error' | 'disabled'
  totalRequestsToday: number
  successCount: number
  errorCount: number
  lastErrorMessage: string | null
  lastUsedTimestamp: string | null
  rateLimitResetAt?: string | null
}

export interface OpenRouterKeyStatsResult {
  totalAccounts: number
  totalKeys: number
  available: number
  error: number
  disabled: number
  totalRequestsToday: number
}
