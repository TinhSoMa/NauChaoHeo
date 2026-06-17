import type { AgentDef, AgentId } from './types';
import { geminiAgentDef } from './defs/gemini';
import { openrouterAgentDef } from './defs/openrouter';
import { grokUiAgentDef } from './defs/grok-ui';
import { geminiWebApiAgentDef } from './defs/gemini-webapi';

const BASE_AGENT_DEFS: AgentDef[] = [
  geminiAgentDef,
  openrouterAgentDef,
  grokUiAgentDef,
  geminiWebApiAgentDef,
];

const ids = new Set<AgentId>();
for (const def of BASE_AGENT_DEFS) {
  if (ids.has(def.id)) {
    throw new Error(`Duplicate agent definition id: ${def.id}`);
  }
  ids.add(def.id);
}

export function getAgentDef(id: AgentId): AgentDef | undefined {
  return BASE_AGENT_DEFS.find((a) => a.id === id);
}

export function getAllAgentDefs(): AgentDef[] {
  return [...BASE_AGENT_DEFS];
}
