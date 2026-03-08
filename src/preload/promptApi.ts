import { ipcRenderer } from 'electron';
import { PROMPT_IPC_CHANNELS, CreatePromptDTO } from '../shared/types/prompt';

export interface PromptAPI {
  getAll: () => Promise<any>;
  getById: (id: string) => Promise<any>;
  create: (data: CreatePromptDTO) => Promise<any>;
  update: (id: string, data: Partial<CreatePromptDTO>) => Promise<any>;
  delete: (id: string) => Promise<any>;
  setDefault: (id: string) => Promise<any>;
}

export const promptApi: PromptAPI = {
  getAll: () => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.GET_ALL),
  getById: (id: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.GET_BY_ID, id),
  create: (data: CreatePromptDTO) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.CREATE, data),
  update: (id: string, data: Partial<CreatePromptDTO>) => 
    ipcRenderer.invoke(PROMPT_IPC_CHANNELS.UPDATE, { id, ...data }),
  delete: (id: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.DELETE, id),
  setDefault: (id: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.SET_DEFAULT, id)
};
