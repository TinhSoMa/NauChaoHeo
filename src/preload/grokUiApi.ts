import { ipcRenderer } from 'electron';
import type {
  GrokUiHealthSnapshot,
  GrokUiProfileCreateResult,
  GrokUiProfileStatusEntry,
  GrokUiProfileConfig,
} from '../shared/types/grokUi';
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
  createProfile: (payload: { id?: string; profileDir?: string | null; profileName?: string | null; anonymous?: boolean }) => Promise<GrokUiApiResponse<GrokUiProfileCreateResult>>;
  getProfileStatuses: () => Promise<GrokUiApiResponse<GrokUiProfileStatusEntry[]>>;
  resetProfileStatuses: () => Promise<GrokUiApiResponse<void>>;
  getProfiles: () => Promise<GrokUiApiResponse<GrokUiProfileConfig[]>>;
  saveProfiles: (payload: { profiles: GrokUiProfileConfig[] }) => Promise<GrokUiApiResponse<void>>;
  setProfileEnabled: (payload: { id: string; enabled: boolean }) => Promise<GrokUiApiResponse<void>>;
  deleteProfile: (payload: { id: string }) => Promise<GrokUiApiResponse<void>>;
}

export const grokUiApi: GrokUiAPI = {
  getHealth: () => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.GET_HEALTH),
  testAsk: (payload) => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.TEST_ASK, payload),
  shutdown: () => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.SHUTDOWN),
  createProfile: (payload) => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.CREATE_PROFILE, payload),
  getProfileStatuses: () => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.GET_PROFILE_STATUSES),
  resetProfileStatuses: () => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.RESET_PROFILE_STATUSES),
  getProfiles: () => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.GET_PROFILES),
  saveProfiles: (payload) => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.SAVE_PROFILES, payload),
  setProfileEnabled: (payload) => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.SET_PROFILE_ENABLED, payload),
  deleteProfile: (payload) => ipcRenderer.invoke(GROK_UI_IPC_CHANNELS.DELETE_PROFILE, payload),
};
