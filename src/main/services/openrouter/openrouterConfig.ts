import { OPENROUTER_API_BASE, OPENROUTER_DEFAULT_MODEL, OPENROUTER_FALLBACK_MODELS, type OpenRouterModel } from '../../../shared/types/openrouter'

export { OPENROUTER_API_BASE, OPENROUTER_DEFAULT_MODEL, OPENROUTER_FALLBACK_MODELS }
export type { OpenRouterModel }

export const DEFAULT_HEADERS = {
  'HTTP-Referer': 'https://github.com/TinhSoMa/NauChaoHeo',
  'X-OpenRouter-Title': 'NauChaoHeo',
}

export const REQUEST_TIMEOUT_MS = 60_000
export const STREAM_TIMEOUT_MS = 120_000
export const MAX_RETRIES = 3
