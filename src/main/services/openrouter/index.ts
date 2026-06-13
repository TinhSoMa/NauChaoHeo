export {
  callChatCompletion,
  callChatCompletionWithRotation,
  getModels,
  getKeyInfo,
  getConfigInfo,
  setConfig,
  getAllAccounts,
  addAccount,
  removeAccount,
  addProject,
  removeProject,
  setAccountStatus,
  setProjectStatus,
  importKeys,
  exportKeys,
  hasKeys,
  getKeyStats,
} from './openrouterService.js'

export {
  OPENROUTER_API_BASE,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_FALLBACK_MODELS,
  DEFAULT_HEADERS,
} from './openrouterConfig.js'

export type { OpenRouterModel, OpenRouterConfig, OpenRouterMessage, OpenRouterResponse, OpenRouterKeyInfo } from '../../../shared/types/openrouter'
