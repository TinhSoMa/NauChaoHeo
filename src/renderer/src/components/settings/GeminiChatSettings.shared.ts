export interface GeminiChatConfig {
  id: string;
  name: string;
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  proxyId?: string;
  convId: string;
  respId: string;
  candId: string;
  reqId?: string;
  userAgent?: string;
  acceptLanguage?: string;
  platform?: string;
  isActive: boolean;
  isError?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GeminiChatSettingsProps {
  onBack: () => void;
}

export interface TokenStats {
  distinctActiveCount: number;
  activeCount: number;
  duplicateIds: Set<string>;
}

export interface LiveTokenStats {
  total: number;
  active: number;
  ready: number;
  busy: number;
  accounts: Array<{
    id: string;
    name: string;
    status: 'ready' | 'busy' | 'cooldown' | 'error';
    waitTimeMs: number;
    impitBrowser: string | null;
    proxyId: string | null;
  }>;
}

export interface ProxyInfo {
  id: string;
  host: string;
  port: number;
}

export type GeminiChatListTab = 'accounts' | 'webapi' | 'logs';

export const DEFAULT_UA = '';
export const DEFAULT_LANG = 'vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6,zh-CN;q=0.5,zh;q=0.4';

export const BROWSER_PRESETS = [
  {
    label: 'Chrome / Windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Windows',
    acceptLanguage: 'vi,en-US;q=0.9,en;q=0.8'
  },
  {
    label: 'Edge / Windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
    platform: 'Windows',
    acceptLanguage: 'vi,en-US;q=0.9,en;q=0.8'
  },
  {
    label: 'Chrome / macOS',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'macOS',
    acceptLanguage: 'vi,en-US;q=0.9,en;q=0.8'
  },
  {
    label: 'Firefox / Windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
    platform: 'Windows',
    acceptLanguage: 'vi,en-US;q=0.9,en;q=0.8'
  },
  {
    label: 'Tuy chinh / Custom',
    userAgent: '',
    platform: 'Windows',
    acceptLanguage: DEFAULT_LANG
  }
];

export const buildTokenKey = (_cookie: string, atToken: string): string => {
  return (atToken || '').trim();
};

export const getTokenStats = (configs: GeminiChatConfig[]): TokenStats => {
  const seen = new Map<string, string>();
  const duplicateIds = new Set<string>();
  const activeConfigs = configs.filter((config) => config.isActive);

  for (const config of activeConfigs) {
    const key = buildTokenKey(config.cookie || '', config.atToken || '');
    if (seen.has(key)) {
      duplicateIds.add(config.id);
      const firstId = seen.get(key);
      if (firstId) duplicateIds.add(firstId);
    } else {
      seen.set(key, config.id);
    }
  }

  return {
    distinctActiveCount: seen.size,
    activeCount: activeConfigs.length,
    duplicateIds
  };
};

export const formatDateTime = (value?: number | null): string => {
  if (!value || !Number.isFinite(value)) return '-';
  return new Date(value).toLocaleString();
};

export const formatLogMetadata = (metadata?: Record<string, unknown>): string => {
  if (!metadata) return '';
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      if (typeof value === 'object') {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${String(value)}`;
    })
    .join(' | ');
};
