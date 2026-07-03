/**
 * DeepSeek Config Database Service
 * Lưu 1 API key + default model duy nhất (id = 1)
 */

import { getDatabase } from './schema';

export interface DeepSeekDbRow {
  apiKey: string | null;
  defaultModel: string;
}

export class DeepSeekDatabase {
  static get(): DeepSeekDbRow | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT api_key, default_model FROM deepseek_config WHERE id = 1`).get() as any;
    if (!row) return null;
    return {
      apiKey: row.api_key ?? null,
      defaultModel: row.default_model || 'deepseek-v4-flash',
    };
  }

  static upsert(apiKey: string | null, defaultModel: string): void {
    const db = getDatabase();
    const updatedAt = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO deepseek_config (id, api_key, default_model, updated_at)
      VALUES (1, ?, ?, ?)
    `).run(apiKey, defaultModel, updatedAt);
  }
}
