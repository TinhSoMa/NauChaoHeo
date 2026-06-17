import { ipcRenderer } from 'electron'
import type { DetectedCliAgent } from '../main/cliAgentScan/types'
import type { CliAgentConfigEntry } from '../main/services/appSettings'

export interface CliAgentScanAPI {
  scan: () => Promise<DetectedCliAgent[]>
  getConfig: () => Promise<Record<string, CliAgentConfigEntry>>
  updateConfig: (agentId: string, entry: CliAgentConfigEntry) => Promise<Record<string, CliAgentConfigEntry>>
  getDiagnostics: () => Promise<{
    config: Record<string, CliAgentConfigEntry>
    platform: string
    arch: string
    nodeVersion: string
  }>
}

export const cliAgentScanApi: CliAgentScanAPI = {
  scan: () => ipcRenderer.invoke('cliAgentScan:scan'),
  getConfig: () => ipcRenderer.invoke('cliAgentScan:getConfig'),
  updateConfig: (agentId: string, entry: CliAgentConfigEntry) =>
    ipcRenderer.invoke('cliAgentScan:updateConfig', agentId, entry),
  getDiagnostics: () => ipcRenderer.invoke('cliAgentScan:getDiagnostics'),
}
