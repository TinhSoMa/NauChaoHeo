import { getDatabase } from './schema';

export interface CapcutTtsTokenRow {
  version: string;
  label: string;
  token: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

function parseRow(row: any): CapcutTtsTokenRow {
  return {
    version: row?.version ?? '',
    label: row?.label ?? '',
    token: row?.token ?? null,
    isActive: row?.is_active === 1,
    createdAt: row?.created_at ?? 0,
    updatedAt: row?.updated_at ?? 0,
  };
}

export class CapcutTtsTokensDatabase {
  static getActive(): CapcutTtsTokenRow | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM capcut_tts_tokens WHERE is_active = 1 LIMIT 1').get() as any;
    if (row) return parseRow(row);

    // Fallback env vars
    const envToken = process.env.CAPCUT_TTS_TOKEN || '';
    if (envToken) {
      return {
        version: '__env__',
        label: 'Environment',
        token: envToken,
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      };
    }

    return null;
  }

  static get(version: string): CapcutTtsTokenRow | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM capcut_tts_tokens WHERE version = ?').get(version) as any;
    return row ? parseRow(row) : null;
  }

  static list(): CapcutTtsTokenRow[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM capcut_tts_tokens ORDER BY created_at ASC').all() as any[];
    return rows.map(parseRow);
  }

  static upsert(
    version: string,
    label: string,
    payload: { token?: string | null }
  ): CapcutTtsTokenRow {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM capcut_tts_tokens WHERE version = ?').get(version) as any;
    const now = Date.now();

    const token = payload.token !== undefined ? payload.token : (existing?.token ?? null);
    const isActive = existing?.is_active ?? 0;

    if (existing) {
      db.prepare(`
        UPDATE capcut_tts_tokens SET label = ?, token = ?, updated_at = ?
        WHERE version = ?
      `).run(label, token, now, version);
    } else {
      db.prepare(`
        INSERT INTO capcut_tts_tokens (version, label, token, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `).run(version, label, token, now, now);
    }

    return {
      version,
      label,
      token,
      isActive: isActive === 1,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };
  }

  static delete(version: string): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT is_active FROM capcut_tts_tokens WHERE version = ?').get(version) as any;
    if (!row) return false;
    if (row.is_active === 1) return false;
    db.prepare('DELETE FROM capcut_tts_tokens WHERE version = ?').run(version);
    return true;
  }

  static setActive(version: string): CapcutTtsTokenRow | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM capcut_tts_tokens WHERE version = ?').get(version) as any;
    if (!row) return null;
    const tx = db.transaction(() => {
      db.prepare('UPDATE capcut_tts_tokens SET is_active = 0').run();
      db.prepare('UPDATE capcut_tts_tokens SET is_active = 1, updated_at = ? WHERE version = ?').run(Date.now(), version);
    });
    tx();
    return parseRow({ ...row, is_active: 1, updated_at: Date.now() });
  }
}
