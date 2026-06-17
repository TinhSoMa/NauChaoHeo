import type { AgentDef } from '../types';

export const openrouterAgentDef = {
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'Multi-model access via OpenRouter API (Claude, GPT, Gemini, etc.)',
  transports: ['openrouter'],
  capabilities: ['translation', 'chat', 'summarization', 'memory', 'streaming'],
  fallbackModels: [
    { id: 'default', label: 'Default' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'google/gemini-2.5-pro-exp-03-25', label: 'Gemini 2.5 Pro' },
    { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
    { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3' },
    { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
  ],
  envKeys: ['OPENROUTER_API_KEY'],
} satisfies AgentDef;
