import { ipcRenderer } from 'electron'
import type { DetectedAgentMap, DetectedAgent, AgentId } from '../main/agents/types'

export interface AgentAPI {
  list: () => Promise<DetectedAgentMap>
  get: (id: AgentId) => Promise<DetectedAgent | null>
}

export const agentApi: AgentAPI = {
  list: () => ipcRenderer.invoke('agents:list'),
  get: (id: AgentId) => ipcRenderer.invoke('agents:get', id),
}
