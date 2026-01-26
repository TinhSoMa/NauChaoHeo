import { ipcRenderer } from 'electron';
import { ProxyConfig, ProxyStats, ProxyTestResult, PROXY_IPC_CHANNELS } from '../shared/types/proxy';

/**
 * Proxy API cho renderer process
 */
export interface ProxyAPI {
  getAll: () => Promise<{ success: boolean; data?: ProxyConfig[]; error?: string }>;
  add: (config: Omit<ProxyConfig, 'id' | 'createdAt' | 'successCount' | 'failedCount'>) => Promise<{ success: boolean; data?: ProxyConfig; error?: string }>;
  remove: (id: string) => Promise<{ success: boolean; error?: string }>;
  update: (id: string, updates: Partial<ProxyConfig>) => Promise<{ success: boolean; error?: string }>;
  test: (id: string) => Promise<ProxyTestResult>;
  getStats: () => Promise<{ success: boolean; data?: ProxyStats[]; error?: string }>;
  import: (data: string) => Promise<{ success: boolean; added?: number; skipped?: number; error?: string }>;
  export: () => Promise<{ success: boolean; data?: string; error?: string }>;
  reset: () => Promise<{ success: boolean; error?: string }>;
}

/**
 * Tạo proxy API object
 */
export const proxyApi: ProxyAPI = {
  getAll: () => ipcRenderer.invoke(PROXY_IPC_CHANNELS.GET_ALL),
  
  add: (config) => ipcRenderer.invoke(PROXY_IPC_CHANNELS.ADD, config),
  
  remove: (id) => ipcRenderer.invoke(PROXY_IPC_CHANNELS.REMOVE, id),
  
  update: (id, updates) => ipcRenderer.invoke(PROXY_IPC_CHANNELS.UPDATE, id, updates),
  
  test: (id) => ipcRenderer.invoke(PROXY_IPC_CHANNELS.TEST, id),
  
  getStats: async () => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.GET_STATS);
  },

  import: async (data: string) => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.IMPORT, data);
  },

  export: async () => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.EXPORT);
  },

  reset: async () => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.RESET);
  },
};
