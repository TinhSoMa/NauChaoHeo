/**
 * CapCut TTS Configs Database Service
 * Multi-version — mỗi version lưu toàn bộ fields riêng biệt
 */

import { getDatabase } from './schema';
import { AppSettingsService } from '../services/appSettings';

// ─── Types ───

export interface CapcutTtsVersionRow {
  version: string;
  label: string;
  appKey: string | null;
  token: string | null;
  wsUrl: string;
  userAgent: string;
  xSsDp: string | null;
  extraHeaders: Record<string, string> | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Defaults ───

const DEFAULT_WS_URL = 'wss://wss-global.zijieapi.com/ws';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ─── Helpers ───

function parseExtraHeaders(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function parseRow(row: any): CapcutTtsVersionRow {
  return {
    version: row?.version ?? '',
    label: row?.label ?? '',
    appKey: row?.app_key ?? null,
    token: row?.token ?? null,
    wsUrl: row?.ws_url || DEFAULT_WS_URL,
    userAgent: row?.user_agent || DEFAULT_USER_AGENT,
    xSsDp: row?.x_ss_dp ?? null,
    extraHeaders: parseExtraHeaders(row?.extra_headers),
    isActive: row?.is_active === 1,
    createdAt: row?.created_at ?? 0,
    updatedAt: row?.updated_at ?? 0,
  };
}

let migratorRan = false;

function migrateFromAppSettings(): void {
  if (migratorRan) return;
  migratorRan = true;
  try {
    const fallback = AppSettingsService.getAll().capcutTtsSecrets;
    if (!fallback) return;
    const db = getDatabase();
    const existing = db.prepare('SELECT version FROM capcut_tts_configs WHERE version = ?').get('1.5.0');
    if (existing) return;
    const now = Date.now();
    db.prepare(`
      INSERT INTO capcut_tts_configs (version, label, app_key, token, ws_url, user_agent, x_ss_dp, extra_headers, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      '1.5.0', 'Mặc định',
      fallback.appKey, fallback.token,
      fallback.wsUrl || DEFAULT_WS_URL,
      fallback.userAgent || DEFAULT_USER_AGENT,
      fallback.xSsDp,
      fallback.extraHeaders ? JSON.stringify(fallback.extraHeaders) : null,
      now, now
    );
  } catch (e) {
    console.error('[CapcutTtsConfigs] Migration from appSettings failed:', e);
  }
}

// ─── Database class ───

export class CapcutTtsConfigsDatabase {
  /** Lấy version đang active (is_active = 1), fallback env + appSettings */
  static getActive(): CapcutTtsVersionRow | null {
    migrateFromAppSettings();
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM capcut_tts_configs WHERE is_active = 1 LIMIT 1').get() as any;
    if (row) return parseRow(row);

    // Fallback env vars
    const envAppKey = process.env.CAPCUT_TTS_APPKEY || '';
    const envToken = process.env.CAPCUT_TTS_TOKEN || '';
    if (envAppKey || envToken) {
      return {
        version: '__env__',
        label: 'Environment',
        appKey: envAppKey || null,
        token: envToken || null,
        wsUrl: process.env.CAPCUT_TTS_WS_URL || DEFAULT_WS_URL,
        userAgent: process.env.CAPCUT_TTS_USER_AGENT || DEFAULT_USER_AGENT,
        xSsDp: process.env.CAPCUT_TTS_X_SS_DP || null,
        extraHeaders: null,
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      };
    }

    // Fallback appSettings.json
    const fallback = AppSettingsService.getAll().capcutTtsSecrets;
    if (fallback?.appKey || fallback?.token) {
      return {
        version: '__fallback__',
        label: 'AppSettings (legacy)',
        appKey: fallback.appKey ?? null,
        token: fallback.token ?? null,
        wsUrl: fallback.wsUrl || DEFAULT_WS_URL,
        userAgent: fallback.userAgent || DEFAULT_USER_AGENT,
        xSsDp: fallback.xSsDp ?? null,
        extraHeaders: fallback.extraHeaders ?? null,
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      };
    }

    return null;
  }

  static get(version: string): CapcutTtsVersionRow | null {
    migrateFromAppSettings();
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM capcut_tts_configs WHERE version = ?').get(version) as any;
    return row ? parseRow(row) : null;
  }

  static list(): CapcutTtsVersionRow[] {
    migrateFromAppSettings();
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM capcut_tts_configs ORDER BY created_at ASC').all() as any[];
    return rows.map(parseRow);
  }

  static upsert(
    version: string,
    label: string,
    payload: {
      appKey?: string | null;
      token?: string | null;
      wsUrl?: string;
      userAgent?: string;
      xSsDp?: string | null;
      extraHeaders?: Record<string, string> | null;
    }
  ): CapcutTtsVersionRow {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM capcut_tts_configs WHERE version = ?').get(version) as any;
    const now = Date.now();

    const appKey = payload.appKey !== undefined ? payload.appKey : (existing?.app_key ?? null);
    const token = payload.token !== undefined ? payload.token : (existing?.token ?? null);
    const wsUrl = payload.wsUrl !== undefined ? payload.wsUrl : (existing?.ws_url || DEFAULT_WS_URL);
    const userAgent = payload.userAgent !== undefined ? payload.userAgent : (existing?.user_agent || DEFAULT_USER_AGENT);
    const xSsDp = payload.xSsDp !== undefined ? payload.xSsDp : (existing?.x_ss_dp ?? null);
    const extraHeaders = payload.extraHeaders !== undefined
      ? (payload.extraHeaders ? JSON.stringify(payload.extraHeaders) : null)
      : (existing?.extra_headers ?? null);

    if (existing) {
      db.prepare(`
        UPDATE capcut_tts_configs SET label = ?, app_key = ?, token = ?, ws_url = ?, user_agent = ?, x_ss_dp = ?, extra_headers = ?, updated_at = ?
        WHERE version = ?
      `).run(label, appKey, token, wsUrl, userAgent, xSsDp, extraHeaders, now, version);
    } else {
      db.prepare(`
        INSERT INTO capcut_tts_configs (version, label, app_key, token, ws_url, user_agent, x_ss_dp, extra_headers, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(version, label, appKey, token, wsUrl, userAgent, xSsDp, extraHeaders, now, now);
    }

    return {
      version,
      label,
      appKey,
      token,
      wsUrl,
      userAgent,
      xSsDp,
      extraHeaders: parseExtraHeaders(extraHeaders),
      isActive: existing?.is_active === 1,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };
  }

  static delete(version: string): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT is_active FROM capcut_tts_configs WHERE version = ?').get(version) as any;
    if (!row) return false;
    if (row.is_active === 1) return false;
    db.prepare('DELETE FROM capcut_tts_configs WHERE version = ?').run(version);
    return true;
  }

  static setActive(version: string): CapcutTtsVersionRow | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM capcut_tts_configs WHERE version = ?').get(version) as any;
    if (!row) return null;
    const tx = db.transaction(() => {
      db.prepare('UPDATE capcut_tts_configs SET is_active = 0').run();
      db.prepare('UPDATE capcut_tts_configs SET is_active = 1, updated_at = ? WHERE version = ?').run(Date.now(), version);
    });
    tx();
    return parseRow({ ...row, is_active: 1, updated_at: Date.now() });
  }
}
