import { getCliAgentDef, getAllCliAgentDefs } from '../../cliAgentScan/registry'
import { resolveOnPath } from '../../cliAgentScan/detection'
import type { CliAgentId } from '../../cliAgentScan/types'

export interface AgentDetectResult {
  detected: boolean
  agentId?: string
  agentName?: string
  executablePath?: string
  version?: string
  models?: Array<{ id: string; label: string }>
  error?: string
}

export function detectAgent(agentId?: string): AgentDetectResult {
  if (agentId) {
    const def = getCliAgentDef(agentId as CliAgentId)
    if (!def) {
      return { detected: false, error: `Unknown agent: ${agentId}` }
    }
    const binsToTry = [def.bin, ...(def.fallbackBins || [])]
    for (const bin of binsToTry) {
      const resolvedPath = resolveOnPath(bin)
      if (resolvedPath) {
        return {
          detected: true,
          agentId: def.id,
          agentName: def.name,
          executablePath: resolvedPath,
          models: def.models
        }
      }
    }
    return { detected: false, error: `${def.name} not found on PATH` }
  }

  const defs = getAllCliAgentDefs()
  for (const def of defs) {
    const result = detectAgent(def.id)
    if (result.detected) return result
  }
  return { detected: false, error: 'No supported coding agent found on PATH' }
}
