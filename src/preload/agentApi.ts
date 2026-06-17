import { ipcRenderer } from 'electron'
import type { DetectedAgentMap, DetectedAgent, AgentId } from '../main/agents/types'
import type { UnifiedAgentInfo } from '../main/agents/cliAgentBridge'

export interface AgentAPI {
  list: () => Promise<DetectedAgentMap>
  get: (id: AgentId) => Promise<DetectedAgent | null>
  listAll: () => Promise<UnifiedAgentInfo>
}

export const agentApi: AgentAPI = {
  list: () => ipcRenderer.invoke('agents:list'),
  get: (id: AgentId) => ipcRenderer.invoke('agents:get', id),
  listAll: () => ipcRenderer.invoke('agents:listAll'),
}
