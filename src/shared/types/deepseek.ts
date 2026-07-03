export const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';

export const DEEPSEEK_IPC_CHANNELS = {
  GET_CONFIG: 'deepseek:getConfig',
  SET_CONFIG: 'deepseek:setConfig',
  LIST_MODELS: 'deepseek:listModels',
};

export interface DeepSeekConfig {
  apiKey: string | null;
  defaultModel: string;
}

export interface DeepSeekModelInfo {
  id: string;
  object: string;
  owned_by: string;
  availability?: string;
}
