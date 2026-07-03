import { ipcRenderer } from 'electron';
import { DEEPSEEK_IPC_CHANNELS } from '../shared/types/deepseek';

export interface DeepSeekAPI {
  getConfig: () => Promise<any>;
  setConfig: (partial: any) => Promise<any>;
  listModels: (apiKey: string) => Promise<any>;
}

export function createDeepSeekAPI(): DeepSeekAPI {
  return {
    getConfig: () =>
      ipcRenderer.invoke(DEEPSEEK_IPC_CHANNELS.GET_CONFIG),

    setConfig: (partial: any) =>
      ipcRenderer.invoke(DEEPSEEK_IPC_CHANNELS.SET_CONFIG, partial),

    listModels: (apiKey: string) =>
      ipcRenderer.invoke(DEEPSEEK_IPC_CHANNELS.LIST_MODELS, apiKey),
  };
}
