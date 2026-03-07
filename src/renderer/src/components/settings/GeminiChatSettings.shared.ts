export interface GeminiChatConfig {
  id: string;
  name: string;
  cookie: string;
  blLabel?: string;
  fSid?: string;
  atToken?: string;
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

export const buildTokenKey = (cookie: string): string => {
  const normalized = (cookie || '').trim();
  const secure1psid = normalized.match(/__Secure-1PSID=([^;\s]+)/)?.[1] || '';
  const secure1psidts = normalized.match(/__Secure-1PSIDTS=([^;\s]+)/)?.[1] || '';
  const combined = [secure1psid, secure1psidts].filter(Boolean).join('|');
  return combined || normalized;
};

export const getTokenStats = (configs: GeminiChatConfig[]): TokenStats => {
  const seen = new Map<string, string>();
  const duplicateIds = new Set<string>();
  const activeConfigs = configs.filter((config) => config.isActive);

  for (const config of activeConfigs) {
    const key = buildTokenKey(config.cookie || '');
    if (!key) {
      continue;
    }
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
