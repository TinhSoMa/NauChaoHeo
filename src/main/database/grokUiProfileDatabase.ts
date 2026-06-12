/**
 * Grok UI Profile Database Service
 * Lưu danh sách profile Grok UI
 */

import { getDatabase } from './schema';
import type { GrokUiProfileConfig } from '../../shared/types/grokUi';

export type GrokUiProfileRow = {
  id: string;
  profile_dir: string | null;
  profile_name: string | null;
  anonymous: number;
  enabled: number;
  sort_order: number | null;
  created_at: number;
  updated_at: number;
};

export class GrokUiProfileDatabase {
  static getNextSortOrder(): number {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) as max_order
      FROM grok_ui_profiles
    `).get() as { max_order?: number | null };
    const maxOrder = row?.max_order ?? 0;
    return Math.max(0, maxOrder) + 1;
  }

  static getAll(): GrokUiProfileConfig[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM grok_ui_profiles
      ORDER BY sort_order ASC, created_at ASC
    `).all() as GrokUiProfileRow[];

    return rows.map((row) => ({
      id: row.id,
      profileDir: row.profile_dir || null,
      profileName: row.profile_name || null,
      anonymous: row.anonymous === 1,
      enabled: row.enabled === 1,
    }));
  }

  static replaceAll(profiles: GrokUiProfileConfig[]): void {
    const db = getDatabase();
    const now = Date.now();
    const insert = db.prepare(`
      INSERT INTO grok_ui_profiles (
        id, profile_dir, profile_name, anonymous, enabled, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM grok_ui_profiles').run();
      profiles.forEach((profile, index) => {
        insert.run(
          profile.id,
          profile.profileDir || null,
          profile.profileName || null,
          profile.anonymous ? 1 : 0,
          profile.enabled ? 1 : 0,
          index + 1,
          now,
          now
        );
      });
    });

    transaction();
  }

  static upsert(profile: GrokUiProfileConfig, sortOrder?: number): void {
    const db = getDatabase();
    const now = Date.now();
    const orderValue = Number.isFinite(sortOrder) ? Math.floor(sortOrder as number) : null;
    db.prepare(`
      INSERT INTO grok_ui_profiles (
        id, profile_dir, profile_name, anonymous, enabled, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        profile_dir = excluded.profile_dir,
        profile_name = excluded.profile_name,
        anonymous = excluded.anonymous,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run(
      profile.id,
      profile.profileDir || null,
      profile.profileName || null,
      profile.anonymous ? 1 : 0,
      profile.enabled ? 1 : 0,
      orderValue,
      now,
      now
    );
  }

  static setEnabled(id: string, enabled: boolean): boolean {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE grok_ui_profiles
      SET enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(enabled ? 1 : 0, Date.now(), id);
    return result.changes > 0;
  }

  static delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare(`DELETE FROM grok_ui_profiles WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  static count(): number {
    const db = getDatabase();
    const row = db.prepare(`SELECT COUNT(*) as count FROM grok_ui_profiles`).get() as { count: number };
    return row?.count ?? 0;
  }
}
