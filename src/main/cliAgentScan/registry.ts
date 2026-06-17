import type { CliAgentDef, CliAgentId } from './types';

const CLI_AGENT_DEFS: CliAgentDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    homepage: 'https://docs.anthropic.com/en/docs/claude-code/overview',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    homepage: 'https://codex.cli/',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode-cli',
    fallbackBins: ['opencode'],
    versionArgs: ['--version'],
    homepage: 'https://opencode.ai',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    bin: 'gemini',
    versionArgs: ['--version'],
    homepage: 'https://cloud.google.com/vertex-ai/generative-ai/docs/gemini-cli',
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor',
    versionArgs: ['--version'],
    homepage: 'https://cursor.com',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    bin: 'gh',
    versionArgs: ['--version'],
    homepage: 'https://github.com/github/gh-copilot',
  },
  {
    id: 'qwen',
    name: 'Qwen CLI',
    bin: 'qwen',
    versionArgs: ['--version'],
    homepage: 'https://github.com/QwenLM/qwen-agent',
  },
  {
    id: 'qoder',
    name: 'Qoder CLI',
    bin: 'qoder',
    versionArgs: ['--version'],
    homepage: 'https://qoder.ai',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek CLI',
    bin: 'deepseek',
    versionArgs: ['--version'],
    homepage: 'https://platform.deepseek.com',
  },
  {
    id: 'aider',
    name: 'Aider',
    bin: 'aider',
    versionArgs: ['--version'],
    homepage: 'https://aider.chat',
  },
  {
    id: 'pi',
    name: 'Pi Agent',
    bin: 'pi',
    versionArgs: ['--version'],
    homepage: 'https://pi.ai',
  },
  {
    id: 'kilo',
    name: 'Kilo',
    bin: 'kilo',
    versionArgs: ['--version'],
    homepage: 'https://github.com/kilox/kilox',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    bin: 'kiro',
    versionArgs: ['--version'],
    homepage: 'https://kiro.dev',
  },
  {
    id: 'vibe',
    name: 'Vibe',
    bin: 'vibe',
    versionArgs: ['--version'],
    homepage: 'https://vibe.dev',
  },
  {
    id: 'devin',
    name: 'Devin CLI',
    bin: 'devin',
    versionArgs: ['--version'],
    homepage: 'https://devin.ai',
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    bin: 'hermes',
    versionArgs: ['--version'],
    homepage: 'https://hermes.ai',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    bin: 'kimi',
    versionArgs: ['--version'],
    homepage: 'https://kimi.ai',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    bin: 'antigravity',
    versionArgs: ['--version'],
    homepage: 'https://antigravity.dev',
  },
];

const ids = new Set<CliAgentId>();
for (const def of CLI_AGENT_DEFS) {
  if (ids.has(def.id)) {
    throw new Error(`Duplicate CLI agent definition id: ${def.id}`);
  }
  ids.add(def.id);
}

export function getCliAgentDef(id: CliAgentId): CliAgentDef | undefined {
  return CLI_AGENT_DEFS.find((a) => a.id === id);
}

export function getAllCliAgentDefs(): CliAgentDef[] {
  return [...CLI_AGENT_DEFS];
}
