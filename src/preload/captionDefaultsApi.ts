import { ipcRenderer } from 'electron';
import type { CaptionProjectSettingsValues } from '../shared/types/caption';
import { CAPTION_DEFAULTS_IPC_CHANNELS } from '../shared/types/caption';

export interface CaptionDefaultsApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CaptionDefaultsAPI {
  get: () => Promise<CaptionDefaultsApiResponse<{ schemaVersion: 1; settings: CaptionProjectSettingsValues; updatedAt: number } | null>>;
  save: (settings: CaptionProjectSettingsValues) => Promise<CaptionDefaultsApiResponse<{ updatedAt: number }>>;
}

export const captionDefaultsApi: CaptionDefaultsAPI = {
  get: () => ipcRenderer.invoke(CAPTION_DEFAULTS_IPC_CHANNELS.GET),
  save: (settings) => ipcRenderer.invoke(CAPTION_DEFAULTS_IPC_CHANNELS.SAVE, settings),
};

