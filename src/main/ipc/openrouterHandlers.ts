import { ipcMain } from 'electron'
import { OPENROUTER_IPC_CHANNELS, type OpenRouterMessage, type OpenRouterConfig, type OpenRouterServiceResponse } from '../../shared/types/openrouter'
import {
  callChatCompletion,
  callChatCompletionWithRotation,
  getModels,
  getKeyInfo,
  getConfigInfo,
  setConfig,
  getAllAccounts,
  addAccount,
  removeAccount,
  setAccountStatus,
  addProject,
  removeProject,
  setProjectStatus,
  importKeys,
  exportKeys,
  hasKeys,
  getKeyStats,
} from '../services/openrouter/index.js'

export function registerOpenRouterHandlers(): void {
  console.log('[IPC] Đang đăng ký OpenRouter handlers...')

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.CHAT,
    async (
      _event,
      messages: OpenRouterMessage[],
      options?: { model?: string; temperature?: number; max_tokens?: number }
    ): Promise<OpenRouterServiceResponse> => {
      try {
        const result = await callChatCompletionWithRotation(messages, options)
        if (!result.success) {
          return { success: false, error: result.error }
        }
        return { success: true, data: result.data }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:chat:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.GET_MODELS,
    async (): Promise<OpenRouterServiceResponse> => {
      try {
        const models = await getModels()
        return { success: true, data: models }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:getModels:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.GET_KEY_INFO,
    async (): Promise<OpenRouterServiceResponse> => {
      try {
        const result = await getKeyInfo()
        if (!result.success) {
          return { success: false, error: result.error }
        }
        return { success: true, data: result.data }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:getKeyInfo:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<OpenRouterServiceResponse> => {
      try {
        const config = getConfigInfo()
        return { success: true, data: config }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:getConfig:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.SET_CONFIG,
    async (_event, partial: Partial<OpenRouterConfig>): Promise<OpenRouterServiceResponse> => {
      try {
        setConfig(partial)
        return { success: true, data: getConfigInfo() }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:setConfig:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // ==========================================
  // KEY MANAGEMENT HANDLERS
  // ==========================================

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.GET_ALL_ACCOUNTS,
    async (): Promise<OpenRouterServiceResponse> => {
      try {
        const accounts = getAllAccounts()
        const masked = accounts.map((acc) => ({
          ...acc,
          projects: acc.projects.map((p) => ({
            ...p,
            apiKey: p.apiKey.substring(0, 8) + '...' + p.apiKey.substring(p.apiKey.length - 4),
          })),
        }))
        return { success: true, data: masked }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:getAllAccounts:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.ADD_ACCOUNT,
    async (
      _event,
      email: string,
      projects: { projectName: string; apiKey: string; notes?: string }[]
    ): Promise<OpenRouterServiceResponse> => {
      try {
        const result = addAccount(email, projects)
        if (!result) {
          return { success: false, error: 'Không thể thêm account' }
        }
        return { success: true, data: result }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:addAccount:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.REMOVE_ACCOUNT,
    async (_event, accountId: string): Promise<OpenRouterServiceResponse> => {
      try {
        const removed = removeAccount(accountId)
        return { success: true, data: removed }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:removeAccount:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.ADD_PROJECT,
    async (
      _event,
      accountId: string,
      project: { projectName: string; apiKey: string; notes?: string }
    ): Promise<OpenRouterServiceResponse> => {
      try {
        const result = addProject(accountId, project)
        if (!result) {
          return { success: false, error: 'Không thể thêm key' }
        }
        return { success: true, data: result }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:addProject:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.REMOVE_PROJECT,
    async (_event, accountId: string, projectIndex: number): Promise<OpenRouterServiceResponse> => {
      try {
        const removed = removeProject(accountId, projectIndex)
        return { success: true, data: removed }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:removeProject:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.ENABLE_ACCOUNT,
    async (_event, accountId: string): Promise<OpenRouterServiceResponse> => {
      try {
        const result = setAccountStatus(accountId, 'active')
        return { success: true, data: result }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:enableAccount:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.DISABLE_ACCOUNT,
    async (_event, accountId: string): Promise<OpenRouterServiceResponse> => {
      try {
        const result = setAccountStatus(accountId, 'disabled')
        return { success: true, data: result }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:disableAccount:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.ENABLE_PROJECT,
    async (_event, accountId: string, projectIndex: number): Promise<OpenRouterServiceResponse> => {
      try {
        const result = setProjectStatus(accountId, projectIndex, 'available')
        return { success: true, data: result }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:enableProject:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.DISABLE_PROJECT,
    async (_event, accountId: string, projectIndex: number): Promise<OpenRouterServiceResponse> => {
      try {
        const result = setProjectStatus(accountId, projectIndex, 'disabled')
        return { success: true, data: result }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:disableProject:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.IMPORT_KEYS,
    async (_event, jsonString: string): Promise<OpenRouterServiceResponse> => {
      try {
        const result = importKeys(jsonString)
        if (!result.success) {
          return { success: false, error: result.error || 'Import thất bại' }
        }
        return { success: true, data: { count: result.count } }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:importKeys:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.EXPORT_KEYS,
    async (): Promise<OpenRouterServiceResponse> => {
      try {
        const json = exportKeys()
        return { success: true, data: json }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:exportKeys:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.HAS_KEYS,
    async (): Promise<OpenRouterServiceResponse> => {
      try {
        return { success: true, data: hasKeys() }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:hasKeys:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    OPENROUTER_IPC_CHANNELS.GET_KEY_STATS,
    async (): Promise<OpenRouterServiceResponse> => {
      try {
        const stats = getKeyStats()
        return { success: true, data: stats }
      } catch (error) {
        console.error('[IPC] Lỗi openrouter:getKeyStats:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  console.log('[IPC] Đã đăng ký xong OpenRouter handlers')
}
