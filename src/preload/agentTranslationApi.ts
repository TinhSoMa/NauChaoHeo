import { ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AgentTranslationDetectResult,
  AgentTranslationStartPayload,
  AgentTranslationStartResult,
  AgentTranslationProgress,
  AgentTranslationStatus
} from '../shared/types/agentTranslation'

export interface AgentTranslationAPI {
  detect: (agentId?: string) => Promise<AgentTranslationDetectResult>
  start: (payload: AgentTranslationStartPayload) => Promise<AgentTranslationStartResult>
  cancel: () => Promise<{ success: boolean }>
  getStatus: () => Promise<AgentTranslationStatus>
  onProgress: (callback: (progress: AgentTranslationProgress) => void) => () => void
}

export function createAgentTranslationApi(): AgentTranslationAPI {
  return {
    detect: (agentId) => ipcRenderer.invoke('agentTranslation:detect', agentId),
    start: (payload) => ipcRenderer.invoke('agentTranslation:start', payload),
    cancel: () => ipcRenderer.invoke('agentTranslation:cancel'),
    getStatus: () => ipcRenderer.invoke('agentTranslation:status'),
    onProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, progress: AgentTranslationProgress) => callback(progress)
      ipcRenderer.on('agentTranslation:progress', listener)
      return () => {
        ipcRenderer.removeListener('agentTranslation:progress', listener)
      }
    }
  }
}

export const agentTranslationApi = createAgentTranslationApi()
