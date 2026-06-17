export type CliAgentId =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'gemini-cli'
  | 'cursor-agent'
  | 'copilot'
  | 'qwen'
  | 'qoder'
  | 'deepseek'
  | 'aider'
  | 'pi'
  | 'kilo'
  | 'kiro'
  | 'vibe'
  | 'devin'
  | 'hermes'
  | 'kimi'
  | 'antigravity';

export interface CliAgentDef {
  id: CliAgentId;
  name: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  homepage?: string;
}

export interface DetectedCliAgent extends CliAgentDef {
  available: boolean;
  path: string | null;
  version: string | null;
  error?: string;
}

export type DetectedCliAgentMap = Record<CliAgentId, DetectedCliAgent>;
