import { getDatabase } from './schema';

export interface CapcutTtsSharedConfig {
  appKey: string | null;
  wsUrl: string;
  userAgent: string;
  xSsDp: string | null;
  extraHeaders: Record<string, string> | null;
  updatedAt: number;
}

function parseExtraHeaders(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

const DEFAULT_WS_URL = 'wss://wss-global.zijieapi.com/ws';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function parseRow(row: any): CapcutTtsSharedConfig {
  return {
    appKey: row?.app_key ?? null,
    wsUrl: row?.ws_url || DEFAULT_WS_URL,
    userAgent: row?.user_agent || DEFAULT_USER_AGENT,
    xSsDp: row?.x_ss_dp ?? null,
    extraHeaders: parseExtraHeaders(row?.extra_headers),
    updatedAt: row?.updated_at ?? 0,
  };
}

export class CapcutTtsSharedConfigDatabase {
  static get(): CapcutTtsSharedConfig | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM capcut_tts_shared_config WHERE id = 1').get() as any;
    return row ? parseRow(row) : null;
  }

  static upsert(payload: {
    appKey?: string | null;
    wsUrl?: string;
    userAgent?: string;
    xSsDp?: string | null;
    extraHeaders?: Record<string, string> | null;
  }): CapcutTtsSharedConfig {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM capcut_tts_shared_config WHERE id = 1').get() as any;
    const now = Date.now();

    const appKey = payload.appKey !== undefined ? payload.appKey : (existing?.app_key ?? null);
    const wsUrl = payload.wsUrl !== undefined ? payload.wsUrl : (existing?.ws_url || DEFAULT_WS_URL);
    const userAgent = payload.userAgent !== undefined ? payload.userAgent : (existing?.user_agent || DEFAULT_USER_AGENT);
    const xSsDp = payload.xSsDp !== undefined ? payload.xSsDp : (existing?.x_ss_dp ?? null);
    const extraHeaders = payload.extraHeaders !== undefined
      ? (payload.extraHeaders ? JSON.stringify(payload.extraHeaders) : null)
      : (existing?.extra_headers ?? null);

    if (existing) {
      db.prepare(`
        UPDATE capcut_tts_shared_config
        SET app_key = ?, ws_url = ?, user_agent = ?, x_ss_dp = ?, extra_headers = ?, updated_at = ?
        WHERE id = 1
      `).run(appKey, wsUrl, userAgent, xSsDp, extraHeaders, now);
    } else {
      db.prepare(`
        INSERT INTO capcut_tts_shared_config (id, app_key, ws_url, user_agent, x_ss_dp, extra_headers, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?)
      `).run(appKey, wsUrl, userAgent, xSsDp, extraHeaders, now);
    }

    return {
      appKey,
      wsUrl,
      userAgent,
      xSsDp,
      extraHeaders: parseExtraHeaders(extraHeaders),
      updatedAt: now,
    };
  }
}
