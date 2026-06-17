import type { AgentDef } from '../types';

export const grokUiAgentDef = {
  id: 'grok-ui',
  name: 'Grok UI',
  description: 'Grok AI via browser-based Python bridge (cookie/profile-based)',
  transports: ['grok_ui'],
  capabilities: ['translation', 'chat', 'summarization', 'memory'],
  fallbackModels: [
    { id: 'default', label: 'Default' },
  ],
  envKeys: [],
} satisfies AgentDef;
