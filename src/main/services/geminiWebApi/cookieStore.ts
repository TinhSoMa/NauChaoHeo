import { AppSettingsService } from '../appSettings';
import { getDatabase } from '../../database/schema';
import {
  ParsedGeminiCookieTokens,
  ResolvedStoredCookie,
  GeminiCookieSource,
  GeminiBrowserType,
} from './types';

export interface PersistCookieResult {
  updatedPrimary: boolean;
  updatedFallback: boolean;
  warnings: string[];
}

export interface GeminiCookieFallbackRecord {
  cookie: string | null;
  sourceBrowser: GeminiBrowserType | null;
  updatedAt: number | null;
}

const SECURE_1PSID = '__Secure-1PSID';
const SECURE_1PSIDTS = '__Secure-1PSIDTS';

type GeminiChatCookieRow = {
  id: string;
  cookie?: string | null;
  secure_1psid?: string | null;
  secure_1psidts?: string | null;
};

export function parseGeminiCookieTokens(cookie: string | null | undefined): ParsedGeminiCookieTokens {
  if (!cookie || !cookie.trim()) {
    return {};
  }

  const map = new Map<string, string>();
  const parts = cookie.split(';');
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    const idx = part.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) {
      continue;
    }
    map.set(key, value);
  }

  return {
    secure1psid: map.get(SECURE_1PSID),
    secure1psidts: map.get(SECURE_1PSIDTS),
  };
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) {
    return '<empty>';
  }
  const text = value.trim();
  if (text.length <= 8) {
    return '****';
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export class GeminiWebApiCookieStore {
  resolveStoredCookie(accountConfigId?: string): ResolvedStoredCookie {
    try {
      const row = this.getPreferredGeminiChatConfigRow(accountConfigId);
      if (row) {
        const cookie = row.cookie?.trim() || null;
        const secure1psid = row.secure_1psid?.trim() || null;
        const secure1psidts = row.secure_1psidts?.trim() || null;

        if (secure1psid && secure1psidts) {
          return {
            cookie,
            secure1psid,
            secure1psidts,
            source: 'sqlite',
          };
        }

        if (cookie) {
          const parsed = parseGeminiCookieTokens(cookie);
          return {
            cookie,
            secure1psid: parsed.secure1psid || null,
            secure1psidts: parsed.secure1psidts || null,
            source: 'sqlite',
          };
        }
      }
    } catch (error) {
      console.warn('[GeminiWebApiCookieStore] Failed to read gemini_chat_config cookie columns:', String(error));
    }

    const settings = AppSettingsService.getAll();
    const fallbackCookie = settings.geminiWebApiCookieFallback?.cookie?.trim() || null;
    if (fallbackCookie) {
      const parsed = parseGeminiCookieTokens(fallbackCookie);
      return {
        cookie: fallbackCookie,
        secure1psid: parsed.secure1psid || null,
        secure1psidts: parsed.secure1psidts || null,
        source: 'app_settings',
      };
    }

    return {
      cookie: null,
      secure1psid: null,
      secure1psidts: null,
      source: 'none',
    };
  }

  persistRefreshedCookie(
    cookie: string,
    browser: GeminiBrowserType,
    accountConfigId?: string
  ): PersistCookieResult {
    const warnings: string[] = [];
    let updatedPrimary = false;
    let updatedFallback = false;

    const parsed = parseGeminiCookieTokens(cookie);

    try {
      if (parsed.secure1psid && parsed.secure1psidts) {
        const db = getDatabase();
        const targetRow = this.getPreferredGeminiChatConfigRow(accountConfigId);
        if (!targetRow?.id) {
          warnings.push('Primary store update skipped: no row in gemini_chat_config');
        } else {
          const now = Date.now();
          db.prepare(
            'UPDATE gemini_chat_config SET "__Secure-1PSID" = ?, "__Secure-1PSIDTS" = ?, updated_at = ? WHERE id = ?'
          ).run(parsed.secure1psid, parsed.secure1psidts, now, targetRow.id);
          updatedPrimary = true;
        }
      } else {
        warnings.push('Primary store update skipped: refreshed cookie missing __Secure-1PSID or __Secure-1PSIDTS');
      }
    } catch (error) {
      warnings.push(`Primary store update failed: ${String(error)}`);
    }

    if (!updatedPrimary) {
      try {
        AppSettingsService.update({
          geminiWebApiCookieFallback: {
            cookie,
            sourceBrowser: browser,
            updatedAt: Date.now(),
          },
        });
        updatedFallback = true;
      } catch (error) {
        warnings.push(`Fallback settings update failed: ${String(error)}`);
      }
    }

    return {
      updatedPrimary,
      updatedFallback,
      warnings,
    };
  }

  getCookieSourceAfterRefresh(updatedPrimary: boolean, updatedFallback: boolean): GeminiCookieSource {
    if (updatedPrimary) {
      return 'sqlite';
    }
    if (updatedFallback) {
      return 'app_settings';
    }
    return 'none';
  }

  private getPreferredGeminiChatConfigRow(accountConfigId?: string): GeminiChatCookieRow | null {
    const db = getDatabase();
    const normalizedConfigId = accountConfigId?.trim();

    if (normalizedConfigId) {
      const byId = db
        .prepare(
          'SELECT id, cookie, "__Secure-1PSID" as secure_1psid, "__Secure-1PSIDTS" as secure_1psidts FROM gemini_chat_config WHERE id = ? LIMIT 1',
        )
        .get(normalizedConfigId) as GeminiChatCookieRow | undefined;
      if (byId) {
        return byId;
      }
    }

    const activeRow = db
      .prepare(
        'SELECT id, cookie, "__Secure-1PSID" as secure_1psid, "__Secure-1PSIDTS" as secure_1psidts FROM gemini_chat_config WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1',
      )
      .get() as GeminiChatCookieRow | undefined;

    if (activeRow) {
      return activeRow;
    }

    const fallbackRow = db
      .prepare(
        'SELECT id, cookie, "__Secure-1PSID" as secure_1psid, "__Secure-1PSIDTS" as secure_1psidts FROM gemini_chat_config ORDER BY updated_at DESC LIMIT 1',
      )
      .get() as GeminiChatCookieRow | undefined;

    return fallbackRow || null;
  }
}
