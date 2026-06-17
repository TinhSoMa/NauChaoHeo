import type { AgentDef } from '../types';

export const geminiAgentDef = {
  id: 'gemini',
  name: 'Google Gemini',
  description: 'Google Gemini API with automatic key rotation',
  transports: ['api'],
  capabilities: ['translation', 'chat', 'summarization', 'memory', 'streaming'],
  fallbackModels: [
    { id: 'default', label: 'Default' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  ],
  envKeys: ['GEMINI_API_KEY'],
} satisfies AgentDef;
