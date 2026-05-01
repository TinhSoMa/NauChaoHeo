/**
 * Webshare API Key Database Service
 * Lưu 1 API key duy nhất (id = 1)
 */

import { getDatabase } from './schema';

export class WebshareApiKeyDatabase {
  static get(): { apiKey: string; updatedAt: number } | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT api_key, updated_at FROM webshare_api_keys WHERE id = 1`).get() as any;
    if (!row?.api_key) return null;
    return { apiKey: row.api_key, updatedAt: row.updated_at };
  }

  static upsert(apiKey: string): { apiKey: string; updatedAt: number } {
    const db = getDatabase();
    const updatedAt = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO webshare_api_keys (id, api_key, updated_at)
      VALUES (1, ?, ?)
    `).run(apiKey, updatedAt);
    return { apiKey, updatedAt };
  }
}
