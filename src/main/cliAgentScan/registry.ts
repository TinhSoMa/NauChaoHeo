import type { CliAgentDef, CliAgentId } from './types';

const CLI_AGENT_DEFS: CliAgentDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    homepage: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    supportsCustomModel: true,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    homepage: 'https://codex.cli/',
    supportsCustomModel: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode-cli',
    fallbackBins: ['opencode'],
    versionArgs: ['--version'],
    homepage: 'https://opencode.ai',
    supportsCustomModel: true,
    listModels: {
      args: ['models'],
      parse: (stdout) => {
        const ids = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
        if (ids.length === 0) return null;
        return ids.map((id) => ({ id, label: id }));
      },
      timeoutMs: 15000,
    },
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    bin: 'gemini',
    versionArgs: ['--version'],
    homepage: 'https://cloud.google.com/vertex-ai/generative-ai/docs/gemini-cli',
    supportsCustomModel: true,
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor',
    versionArgs: ['--version'],
    homepage: 'https://cursor.com',
    supportsCustomModel: true,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    bin: 'gh',
    versionArgs: ['--version'],
    homepage: 'https://github.com/github/gh-copilot',
    supportsCustomModel: false,
  },
  {
    id: 'qwen',
    name: 'Qwen CLI',
    bin: 'qwen',
    versionArgs: ['--version'],
    homepage: 'https://github.com/QwenLM/qwen-agent',
    supportsCustomModel: true,
  },
  {
    id: 'qoder',
    name: 'Qoder CLI',
    bin: 'qoder',
    versionArgs: ['--version'],
    homepage: 'https://qoder.ai',
    supportsCustomModel: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek CLI',
    bin: 'deepseek',
    versionArgs: ['--version'],
    homepage: 'https://platform.deepseek.com',
    supportsCustomModel: true,
  },
  {
    id: 'aider',
    name: 'Aider',
    bin: 'aider',
    versionArgs: ['--version'],
    homepage: 'https://aider.chat',
    supportsCustomModel: true,
  },
  {
    id: 'pi',
    name: 'Pi Agent',
    bin: 'pi',
    versionArgs: ['--version'],
    homepage: 'https://pi.ai',
    supportsCustomModel: false,
  },
  {
    id: 'kilo',
    name: 'Kilo',
    bin: 'kilo',
    versionArgs: ['--version'],
    homepage: 'https://github.com/kilox/kilox',
    supportsCustomModel: true,
  },
  {
    id: 'kiro',
    name: 'Kiro',
    bin: 'kiro',
    versionArgs: ['--version'],
    homepage: 'https://kiro.dev',
    supportsCustomModel: true,
  },
  {
    id: 'vibe',
    name: 'Vibe',
    bin: 'vibe',
    versionArgs: ['--version'],
    homepage: 'https://vibe.dev',
    supportsCustomModel: true,
  },
  {
    id: 'devin',
    name: 'Devin CLI',
    bin: 'devin',
    versionArgs: ['--version'],
    homepage: 'https://devin.ai',
    supportsCustomModel: false,
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    bin: 'hermes',
    versionArgs: ['--version'],
    homepage: 'https://hermes.ai',
    supportsCustomModel: true,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    bin: 'kimi',
    versionArgs: ['--version'],
    homepage: 'https://kimi.ai',
    supportsCustomModel: false,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    bin: 'antigravity',
    versionArgs: ['--version'],
    homepage: 'https://antigravity.dev',
    supportsCustomModel: true,
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
