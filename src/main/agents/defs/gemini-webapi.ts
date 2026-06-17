import type { AgentDef } from '../types';

export const geminiWebApiAgentDef = {
  id: 'gemini-webapi',
  name: 'Gemini WebAPI',
  description: 'Cookie-based Gemini access via Python bridge (free tier)',
  transports: ['gemini_webapi_queue'],
  capabilities: ['translation', 'chat', 'summarization', 'memory'],
  fallbackModels: [
    { id: 'default', label: 'Default' },
  ],
  envKeys: [],
} satisfies AgentDef;
