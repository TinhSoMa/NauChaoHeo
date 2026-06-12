/**
 * Caption Default Settings Database Service
 * Lưu 1 cấu hình default duy nhất (id = 1)
 */

import { getDatabase } from './schema';
import type { CaptionProjectSettingsValues } from '../../shared/types/caption';

export type CaptionDefaultSettingsRow = {
  schemaVersion: 1;
  settings: CaptionProjectSettingsValues;
  updatedAt: number;
};

export class CaptionDefaultSettingsDatabase {
  static get(): CaptionDefaultSettingsRow | null {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT schema_version, settings_json, updated_at FROM caption_default_settings WHERE id = 1`
    ).get() as any;
    if (!row?.settings_json) return null;
    try {
      const parsed = JSON.parse(row.settings_json);
      if (row.schema_version !== 1 || !parsed || typeof parsed !== 'object') {
        return null;
      }
      return {
        schemaVersion: 1,
        settings: parsed as CaptionProjectSettingsValues,
        updatedAt: Number(row.updated_at || 0),
      };
    } catch {
      return null;
    }
  }

  static upsert(settings: CaptionProjectSettingsValues): CaptionDefaultSettingsRow {
    const db = getDatabase();
    const updatedAt = Date.now();
    const payload = JSON.stringify(settings ?? {});
    db.prepare(`
      INSERT OR REPLACE INTO caption_default_settings (id, schema_version, settings_json, updated_at)
      VALUES (1, 1, ?, ?)
    `).run(payload, updatedAt);
    return {
      schemaVersion: 1,
      settings,
      updatedAt,
    };
  }
}

