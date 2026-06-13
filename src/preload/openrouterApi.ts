import { ipcRenderer } from 'electron'
import { OPENROUTER_IPC_CHANNELS } from '../shared/types/openrouter'

export interface OpenRouterAPI {
  chat: (messages: any[], options?: any) => Promise<any>
  getModels: () => Promise<any>
  getKeyInfo: () => Promise<any>
  getConfig: () => Promise<any>
  setConfig: (partial: any) => Promise<any>
  getAllAccounts: () => Promise<any>
  addAccount: (email: string, projects: { projectName: string; apiKey: string; notes?: string }[]) => Promise<any>
  removeAccount: (accountId: string) => Promise<any>
  addProject: (accountId: string, project: { projectName: string; apiKey: string; notes?: string }) => Promise<any>
  removeProject: (accountId: string, projectIndex: number) => Promise<any>
  enableAccount: (accountId: string) => Promise<any>
  disableAccount: (accountId: string) => Promise<any>
  enableProject: (accountId: string, projectIndex: number) => Promise<any>
  disableProject: (accountId: string, projectIndex: number) => Promise<any>
  importKeys: (jsonString: string) => Promise<any>
  exportKeys: () => Promise<any>
  hasKeys: () => Promise<any>
  getKeyStats: () => Promise<any>
}

export function createOpenRouterAPI(): OpenRouterAPI {
  return {
    chat: (messages: any[], options?: any) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.CHAT, messages, options),

    getModels: () =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.GET_MODELS),

    getKeyInfo: () =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.GET_KEY_INFO),

    getConfig: () =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.GET_CONFIG),

    setConfig: (partial: any) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.SET_CONFIG, partial),

    getAllAccounts: () =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.GET_ALL_ACCOUNTS),

    addAccount: (email: string, projects: { projectName: string; apiKey: string; notes?: string }[]) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.ADD_ACCOUNT, email, projects),

    removeAccount: (accountId: string) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.REMOVE_ACCOUNT, accountId),

    addProject: (accountId: string, project: { projectName: string; apiKey: string; notes?: string }) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.ADD_PROJECT, accountId, project),

    removeProject: (accountId: string, projectIndex: number) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.REMOVE_PROJECT, accountId, projectIndex),

    enableAccount: (accountId: string) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.ENABLE_ACCOUNT, accountId),

    disableAccount: (accountId: string) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.DISABLE_ACCOUNT, accountId),

    enableProject: (accountId: string, projectIndex: number) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.ENABLE_PROJECT, accountId, projectIndex),

    disableProject: (accountId: string, projectIndex: number) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.DISABLE_PROJECT, accountId, projectIndex),

    importKeys: (jsonString: string) =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.IMPORT_KEYS, jsonString),

    exportKeys: () =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.EXPORT_KEYS),

    hasKeys: () =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.HAS_KEYS),

    getKeyStats: () =>
      ipcRenderer.invoke(OPENROUTER_IPC_CHANNELS.GET_KEY_STATS),
  }
}
