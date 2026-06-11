import { ipcRenderer } from 'electron';
import { CAPTION_IPC_CHANNELS } from '../shared/types/caption';

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CapcutTtsVersionData {
  version: string;
  label: string;
  token: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CapcutTtsSecretsAPI {
  list: () => Promise<IpcApiResponse<CapcutTtsVersionData[]>>;
  get: (version?: string) => Promise<IpcApiResponse<CapcutTtsVersionData | null>>;
  save: (
    version: string,
    label: string,
    payload: { token?: string | null }
  ) => Promise<IpcApiResponse<CapcutTtsVersionData>>;
  delete: (version: string) => Promise<IpcApiResponse<{ deleted: boolean }>>;
  setActive: (version: string) => Promise<IpcApiResponse<CapcutTtsVersionData | null>>;
}

export const capcutTtsSecretsApi: CapcutTtsSecretsAPI = {
  list: () => ipcRenderer.invoke(CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_LIST),
  get: (version) => ipcRenderer.invoke(CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_GET, version),
  save: (version, label, payload) => ipcRenderer.invoke(CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_SAVE, version, label, payload),
  delete: (version) => ipcRenderer.invoke(CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_DELETE, version),
  setActive: (version) => ipcRenderer.invoke(CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_SET_ACTIVE, version),
};
