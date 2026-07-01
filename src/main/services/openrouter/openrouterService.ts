import { AppSettingsService, getApiRequestTimeoutMs } from '../appSettings.js'
import { makeRequestWithProxy } from '../apiClient.js'
import {
  OPENROUTER_API_BASE,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_FALLBACK_MODELS,
  type OpenRouterMessage,
  type OpenRouterRequest,
  type OpenRouterResponse,
  type OpenRouterModel,
  type OpenRouterKeyInfo,
  type OpenRouterConfig,
  type OpenRouterAccountItem,
  type OpenRouterProjectItem,
  type OpenRouterKeyStatsResult,
} from '../../../shared/types/openrouter'
import { DEFAULT_HEADERS, MAX_RETRIES } from './openrouterConfig.js'
import { getKeyManager } from './openrouterKeyManager.js'
import {
  getAllAccounts as dbGetAllAccounts,
  addAccount as dbAddAccount,
  removeAccount as dbRemoveAccount,
  setAccountStatus as dbSetAccountStatus,
  addProject as dbAddProject,
  removeProject as dbRemoveProject,
  setProjectStatus as dbSetProjectStatus,
  importAccountsFromJson as dbImportAccountsFromJson,
  exportAccountsToJson as dbExportAccountsToJson,
} from './openrouterDatabase.js'

function getConfig(): OpenRouterConfig {
  const settings = AppSettingsService.getAll()
  return {
    apiKey: settings.openrouterApiKey ?? null,
    defaultModel: settings.openrouterDefaultModel || OPENROUTER_DEFAULT_MODEL,
    siteUrl: settings.openrouterSiteUrl ?? null,
    appTitle: settings.openrouterAppTitle ?? null,
  }
}

function buildHeaders(apiKey: string, config: OpenRouterConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (config.siteUrl) {
    headers['HTTP-Referer'] = config.siteUrl
  }
  if (config.appTitle) {
    headers['X-OpenRouter-Title'] = config.appTitle
  }
  return headers
}

// ============================================
// CHAT COMPLETIONS
// ============================================

export async function callChatCompletion(
  messages: OpenRouterMessage[],
  options?: {
    model?: string
    temperature?: number
    max_tokens?: number
    apiKey?: string
    signal?: AbortSignal
  }
): Promise<{ success: true; data: OpenRouterResponse } | { success: false; error: string }> {
  try {
    const config = getConfig()
    const apiKey = options?.apiKey || config.apiKey
    if (!apiKey) {
      return { success: false, error: 'OPENROUTER_NO_API_KEY' }
    }

    const url = `${OPENROUTER_API_BASE}/chat/completions`
    const body: OpenRouterRequest = {
      model: options?.model || config.defaultModel,
      messages,
      stream: false,
    }
    if (options?.temperature !== undefined) body.temperature = options.temperature
    if (options?.max_tokens !== undefined) body.max_tokens = options.max_tokens

    const headers = buildHeaders(apiKey, config)

    const result = await makeRequestWithProxy(url, {
      method: 'POST',
      headers,
      body,
      timeout: getApiRequestTimeoutMs(),
      signal: options?.signal,
      useProxy: false,
    }, MAX_RETRIES)

    if (!result.success) {
      return { success: false, error: result.error || 'OPENROUTER_API_ERROR' }
    }

    const responseData = result.data as OpenRouterResponse
    return { success: true, data: responseData }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

export async function callChatCompletionWithRotation(
  messages: OpenRouterMessage[],
  options?: {
    model?: string
    temperature?: number
    max_tokens?: number
    signal?: AbortSignal
  }
): Promise<{ success: true; data: OpenRouterResponse; keyUsed?: string } | { success: false; error: string }> {
  const manager = getKeyManager()
  if (!manager.hasKeys()) {
    return callChatCompletion(messages, options)
  }

  const keyEntry = manager.getNextApiKey()
  if (!keyEntry) {
    return { success: false, error: 'OPENROUTER_NO_AVAILABLE_KEYS' }
  }

  const result = await callChatCompletion(messages, { ...options, apiKey: keyEntry.apiKey })
  if (result.success) {
    manager.recordSuccess(keyEntry.apiKey)
    return { ...result, keyUsed: keyEntry.apiKey }
  }

  manager.recordError(keyEntry.apiKey, result.error)
  return result
}

// ============================================
// MODELS
// ============================================

function getProvider(modelId: string): string {
  return modelId.includes('/') ? modelId.split('/')[0] : 'other'
}

function getModelName(modelId: string): string {
  return modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId
}

function sortModels(models: OpenRouterModel[]): OpenRouterModel[] {
  return [...models].sort((a, b) => {
    const aFree = isModelFree(a)
    const bFree = isModelFree(b)
    if (aFree && !bFree) return -1
    if (!aFree && bFree) return 1

    const aProvider = getProvider(a.id)
    const bProvider = getProvider(b.id)
    if (aProvider !== bProvider) return aProvider.localeCompare(bProvider)

    return getModelName(a.id).localeCompare(getModelName(b.id))
  })
}

function isModelFree(model: OpenRouterModel): boolean {
  if (!model.pricing) return false
  return model.pricing.prompt === '0' && model.pricing.completion === '0'
}

export async function getModels(apiKey?: string): Promise<OpenRouterModel[]> {
  try {
    const manager = getKeyManager()
    if (apiKey) {
      return sortModels(await fetchModelsWithKey(apiKey) || await fetchModelsWithRotation() || [...OPENROUTER_FALLBACK_MODELS])
    }

    const config = getConfig()
    if (manager.hasKeys()) {
      const rotated = await fetchModelsWithRotation()
      if (rotated.length > 0) return sortModels(rotated)
    }

    if (config.apiKey) {
      const result = await fetchModelsWithKey(config.apiKey)
      if (result) return sortModels(result)
    }

    return !manager.hasKeys() ? [...OPENROUTER_FALLBACK_MODELS] : sortModels(await fetchModelsWithRotation())
  } catch {
    return [...OPENROUTER_FALLBACK_MODELS]
  }
}

async function fetchModelsWithKey(key: string): Promise<OpenRouterModel[] | null> {
  try {
    const url = `${OPENROUTER_API_BASE}/models`
    const result = await makeRequestWithProxy(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${key}` },
      timeout: getApiRequestTimeoutMs(),
      useProxy: false,
    }, 1)

    if (!result.success || !result.data?.data) return null
    const models: OpenRouterModel[] = result.data.data.map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
      created: m.created,
      description: m.description,
      context_length: m.context_length,
      pricing: m.pricing,
      architecture: m.architecture ? {
        modality: m.architecture.modality,
        input_modalities: m.architecture.input_modalities,
        output_modalities: m.architecture.output_modalities,
        tokenizer: m.architecture.tokenizer,
        instruct_type: m.architecture.instruct_type,
      } : undefined,
    }))
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

async function fetchModelsWithRotation(): Promise<OpenRouterModel[]> {
  const manager = getKeyManager()
  if (!manager.hasKeys()) return [...OPENROUTER_FALLBACK_MODELS]

  const allKeys = manager.getAllApiKeys()
  for (const key of allKeys) {
    const result = await fetchModelsWithKey(key)
    if (result) return result
  }
  return [...OPENROUTER_FALLBACK_MODELS]
}

// ============================================
// KEY INFO
// ============================================

export async function getKeyInfo(apiKey?: string): Promise<{ success: true; data: OpenRouterKeyInfo['data'] } | { success: false; error: string }> {
  try {
    const manager = getKeyManager()

    if (apiKey) {
      const result = await fetchKeyInfoWithKey(apiKey)
      if (result) return result
      const rotated = await fetchKeyInfoWithRotation()
      return rotated.success ? rotated : { success: false, error: 'OPENROUTER_KEY_INFO_FAILED' }
    }

    const config = getConfig()
    if (manager.hasKeys()) {
      const rotated = await fetchKeyInfoWithRotation()
      if (rotated.success) return rotated
    }

    if (config.apiKey) {
      const result = await fetchKeyInfoWithKey(config.apiKey)
      if (result) return result
    }

    return !manager.hasKeys()
      ? { success: false, error: 'OPENROUTER_NO_API_KEY' }
      : await fetchKeyInfoWithRotation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

async function fetchKeyInfoWithKey(apiKey: string): Promise<{ success: true; data: OpenRouterKeyInfo['data'] } | null> {
  try {
    const url = `${OPENROUTER_API_BASE}/key`
    const result = await makeRequestWithProxy(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 15_000,
      useProxy: false,
    }, 1)

    if (!result.success || !result.data?.data) return null
    return { success: true, data: result.data.data as OpenRouterKeyInfo['data'] }
  } catch {
    return null
  }
}

async function fetchKeyInfoWithRotation(): Promise<{ success: true; data: OpenRouterKeyInfo['data'] } | { success: false; error: string }> {
  const manager = getKeyManager()
  if (!manager.hasKeys()) return { success: false, error: 'OPENROUTER_NO_API_KEY' }

  const allKeys = manager.getAllApiKeys()
  for (const key of allKeys) {
    const result = await fetchKeyInfoWithKey(key)
    if (result) return result
  }
  return { success: false, error: 'OPENROUTER_KEY_INFO_FAILED' }
}

// ============================================
// CONFIG
// ============================================

export function getConfigInfo(): OpenRouterConfig {
  return getConfig()
}

export function setConfig(partial: Partial<OpenRouterConfig>): void {
  const update: Record<string, any> = {}
  if (partial.apiKey !== undefined) update.openrouterApiKey = partial.apiKey
  if (partial.defaultModel !== undefined) update.openrouterDefaultModel = partial.defaultModel
  if (partial.siteUrl !== undefined) update.openrouterSiteUrl = partial.siteUrl
  if (partial.appTitle !== undefined) update.openrouterAppTitle = partial.appTitle
  AppSettingsService.update(update)
}

// ============================================
// KEY MANAGEMENT (delegate to database + manager)
// ============================================

export function getAllAccounts(): OpenRouterAccountItem[] {
  return dbGetAllAccounts()
}

export function addAccount(
  email: string,
  projects: { projectName: string; apiKey: string; notes?: string }[]
): OpenRouterAccountItem | null {
  const result = dbAddAccount(email, projects)
  if (result) getKeyManager().reload()
  return result
}

export function removeAccount(accountId: string): boolean {
  const result = dbRemoveAccount(accountId)
  if (result) getKeyManager().reload()
  return result
}

export function setAccountStatus(accountId: string, status: 'active' | 'disabled'): boolean {
  const result = dbSetAccountStatus(accountId, status)
  if (result) getKeyManager().reload()
  return result
}

export function addProject(
  accountId: string,
  project: { projectName: string; apiKey: string; notes?: string }
): OpenRouterProjectItem | null {
  const result = dbAddProject(accountId, project)
  if (result) getKeyManager().reload()
  return result
}

export function removeProject(accountId: string, projectIndex: number): boolean {
  const result = dbRemoveProject(accountId, projectIndex)
  if (result) getKeyManager().reload()
  return result
}

export function setProjectStatus(accountId: string, projectIndex: number, status: 'available' | 'error' | 'disabled'): boolean {
  return dbSetProjectStatus(accountId, projectIndex, status)
}

export function importKeys(jsonString: string): { success: boolean; count: number; error?: string } {
  const result = dbImportAccountsFromJson(jsonString)
  if (result.success) getKeyManager().reload()
  return result
}

export function exportKeys(): string {
  return dbExportAccountsToJson()
}

export function hasKeys(): boolean {
  return getKeyManager().hasKeys()
}

export function getKeyStats(): OpenRouterKeyStatsResult {
  const accounts = dbGetAllAccounts()
  let totalKeys = 0
  let available = 0
  let error = 0
  let disabled = 0
  let totalRequestsToday = 0

  for (const acc of accounts) {
    for (const proj of acc.projects) {
      totalKeys++
      if (proj.status === 'available') available++
      else if (proj.status === 'error') error++
      else if (proj.status === 'disabled') disabled++
      totalRequestsToday += proj.totalRequestsToday
    }
  }

  return {
    totalAccounts: accounts.length,
    totalKeys,
    available,
    error,
    disabled,
    totalRequestsToday,
  }
}
