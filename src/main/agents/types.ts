export type AgentId = 'gemini' | 'openrouter' | 'grok-ui' | 'gemini-webapi';

export type AgentAuthStatus = 'ok' | 'missing' | 'unknown';

export type AgentCapability =
  | 'translation'
  | 'chat'
  | 'memory'
  | 'summarization'
  | 'image-generation'
  | 'streaming';

export type AgentTransport = 'api' | 'openrouter' | 'grok_ui' | 'gemini_webapi_queue';

export interface AgentModelOption {
  id: string;
  label: string;
}

export interface AgentAuthProbe {
  args: string[];
  timeoutMs?: number;
}

export interface AgentDef {
  id: AgentId;
  name: string;
  description: string;
  transports: AgentTransport[];
  capabilities: AgentCapability[];
  fallbackModels: AgentModelOption[];
  authProbe?: AgentAuthProbe;
  envKeys?: string[];
}

export interface DetectedAgent extends AgentDef {
  available: boolean;
  authStatus: AgentAuthStatus;
  authMessage?: string;
  models: AgentModelOption[];
  modelsSource: 'live' | 'fallback';
}

export type DetectedAgentMap = Record<AgentId, DetectedAgent>;
