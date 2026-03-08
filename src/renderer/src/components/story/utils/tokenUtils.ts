import type { GeminiChatConfigLite } from '../types';

/**
 * Extract cookie key from cookie string
 * Extracts __Secure-1PSID and __Secure-3PSID values
 */
export const extractCookieKey = (cookie: string): string => {
  const trimmed = cookie.trim();
  const psid1 = trimmed.match(/__Secure-1PSID=([^;\s]+)/)?.[1] || '';
  const psid3 = trimmed.match(/__Secure-3PSID=([^;\s]+)/)?.[1] || '';
  const combined = [psid1, psid3].filter(Boolean).join('|');
  return combined || trimmed;
};

/**
 * Build normalized token key from config
 * Format: "cookieKey|atToken"
 */
export const buildTokenKey = (config: GeminiChatConfigLite): string => {
  return `${extractCookieKey(config.cookie || '')}|${(config.atToken || '').trim()}`;
};
