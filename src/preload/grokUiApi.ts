import { ipcRenderer } from 'electron';
import type { GrokUiHealthSnapshot, GrokUiProfileCreateResult } from '../shared/types/grokUi';
import { GROK_UI_IPC_CHANNELS } from '../shared/types/grokUi';

export interface GrokUiApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface GrokUiAPI {
  getHealth: () => Promise<GrokUiApiResponse<GrokUiHealthSnapshot>>;
  testAsk: (payload: { prompt: string; timeoutMs?: number }) => Promise<GrokUiApiResponse<{ text: string }>>;
  shutdown: () => Promise<GrokUiApiResponse<void>>;
  createProfile: (payload: { profileDir?: string | null; profileName?: string | null; anonymous?: boolean }) => Promise<GrokUiApiResponse<GrokUiProfileCreateResult>>;
}

export const grokUiApi: GrokUiAPI = {
  getHealth: () => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.GET_HEALTH),
  testAsk: (payload) => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.TEST_ASK, payload),
  shutdown: () => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.SHUTDOWN),
  createProfile: (payload) => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.CREATE_PROFILE, payload),
};
