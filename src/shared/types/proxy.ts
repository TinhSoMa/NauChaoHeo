/**
 * Proxy Configuration Types
 */

export interface ProxyConfig {
  id: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  type: 'http' | 'https' | 'socks5';
  enabled: boolean;
  platform?: string; // Webshare, Bright Data, Smartproxy, etc.
  isRotatingEndpoint?: boolean;
  country?: string; // US, GB, ES, etc.
  city?: string; // Los Angeles, London, etc.
  successCount?: number;
  failedCount?: number;
  lastUsedAt?: number;
  createdAt: number;
}

export interface ProxyStats {
  id: string;
  host: string;
  port: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  lastUsedAt?: number;
  isHealthy: boolean;
}

export interface ProxyTestResult {
  success: boolean;
  latency?: number; // ms
  error?: string;
  testedAt: number;
}

export interface RotatingProxyConfig {
  scope: 'caption' | 'story' | 'chat' | 'tts' | 'other';
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'socks5';
  updatedAt: number;
}

export interface RotatingProxyConfigInput {
  scope: RotatingProxyConfig['scope'];
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: RotatingProxyConfig['protocol'];
}

export const PROXY_IPC_CHANNELS = {
  GET_ALL: 'proxy:getAll',
  ADD: 'proxy:add',
  REMOVE: 'proxy:remove',
  UPDATE: 'proxy:update',
  TEST: 'proxy:test',
  CHECK_ALL: 'proxy:checkAll',
  GET_STATS: 'proxy:getStats',
  IMPORT: 'proxy:import',
  EXPORT: 'proxy:export',
  RESET: 'proxy:reset', // Reset failed counts
  TEST_ROTATING_ENDPOINT: 'proxy:testRotatingEndpoint',
  WEBSHARE_SYNC: 'proxy:webshareSync',
  GET_ROTATING_CONFIGS: 'proxy:getRotatingConfigs',
  SAVE_ROTATING_CONFIG: 'proxy:saveRotatingConfig',
  GET_WEBSHARE_API_KEY: 'proxy:getWebshareApiKey',
  SAVE_WEBSHARE_API_KEY: 'proxy:saveWebshareApiKey',
} as const;
