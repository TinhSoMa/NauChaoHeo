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

export interface CliAgentModelOption {
  id: string;
  label: string;
}

export interface CliAgentListModels {
  args: string[];
  parse: (stdout: string) => CliAgentModelOption[] | null;
  timeoutMs?: number;
}

export interface CliAgentDef {
  id: CliAgentId;
  name: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  homepage?: string;
  models?: CliAgentModelOption[];
  supportsCustomModel?: boolean;
  listModels?: CliAgentListModels;
  fetchModels?: (
    resolvedBin: string,
    env: Record<string, string>,
  ) => Promise<CliAgentModelOption[] | null>;
}

export interface DetectedCliAgent extends CliAgentDef {
  available: boolean;
  path: string | null;
  version: string | null;
  error?: string;
  modelsSource?: 'live' | 'fallback';
}

export type DetectedCliAgentMap = Record<CliAgentId, DetectedCliAgent>;
