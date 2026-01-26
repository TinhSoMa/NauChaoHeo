/**
 * Proxy Database Service
 * CRUD operations cho proxies table
 */

import { getDatabase } from './schema';
import { ProxyConfig } from '../../shared/types/proxy';

export class ProxyDatabase {
  /**
   * Get all proxies
   */
  static getAll(): ProxyConfig[] {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM proxies ORDER BY created_at DESC
    `);
    
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username || undefined,
      password: row.password || undefined,
      type: row.type as 'http' | 'https' | 'socks5',
      enabled: row.enabled === 1,
      platform: row.platform || undefined,
      country: row.country || undefined,
      city: row.city || undefined,
      successCount: row.success_count || 0,
      failedCount: row.failed_count || 0,
      lastUsedAt: row.last_used_at || undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get proxy by ID
   */
  static getById(id: string): ProxyConfig | null {
    const db = getDatabase();
    const stmt = db.prepare(`SELECT * FROM proxies WHERE id = ?`);
    const row = stmt.get(id) as any;
    
    if (!row) return null;

    return {
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username || undefined,
      password: row.password || undefined,
      type: row.type as 'http' | 'https' | 'socks5',
      enabled: row.enabled === 1,
      platform: row.platform || undefined,
      country: row.country || undefined,
      city: row.city || undefined,
      successCount: row.success_count || 0,
      failedCount: row.failed_count || 0,
      lastUsedAt: row.last_used_at || undefined,
      createdAt: row.created_at,
    };
  }

  /**
   * Create new proxy
   */
  static create(proxy: Omit<ProxyConfig, 'successCount' | 'failedCount'>): ProxyConfig {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO proxies (
        id, host, port, username, password, type, enabled,
        platform, country, city, success_count, failed_count,
        last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      proxy.id,
      proxy.host,
      proxy.port,
      proxy.username || null,
      proxy.password || null,
      proxy.type,
      proxy.enabled ? 1 : 0,
      proxy.platform || null,
      proxy.country || null,
      proxy.city || null,
      0, // success_count
      0, // failed_count
      proxy.lastUsedAt || null,
      proxy.createdAt
    );

    return {
      ...proxy,
      successCount: 0,
      failedCount: 0,
    };
  }

  /**
   * Update proxy
   */
  static update(id: string, updates: Partial<ProxyConfig>): boolean {
    const db = getDatabase();
    
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.host !== undefined) {
      fields.push('host = ?');
      values.push(updates.host);
    }
    if (updates.port !== undefined) {
      fields.push('port = ?');
      values.push(updates.port);
    }
    if (updates.username !== undefined) {
      fields.push('username = ?');
      values.push(updates.username || null);
    }
    if (updates.password !== undefined) {
      fields.push('password = ?');
      values.push(updates.password || null);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.platform !== undefined) {
      fields.push('platform = ?');
      values.push(updates.platform || null);
    }
    if (updates.country !== undefined) {
      fields.push('country = ?');
      values.push(updates.country || null);
    }
    if (updates.city !== undefined) {
      fields.push('city = ?');
      values.push(updates.city || null);
    }
    if (updates.successCount !== undefined) {
      fields.push('success_count = ?');
      values.push(updates.successCount);
    }
    if (updates.failedCount !== undefined) {
      fields.push('failed_count = ?');
      values.push(updates.failedCount);
    }
    if (updates.lastUsedAt !== undefined) {
      fields.push('last_used_at = ?');
      values.push(updates.lastUsedAt);
    }

    if (fields.length === 0) return false;

    values.push(id);
    const stmt = db.prepare(`UPDATE proxies SET ${fields.join(', ')} WHERE id = ?`);
    const result = stmt.run(...values);
    
    return result.changes > 0;
  }

  /**
   * Delete proxy
   */
  static delete(id: string): boolean {
    const db = getDatabase();
    const stmt = db.prepare(`DELETE FROM proxies WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Check if proxy exists by host:port
   */
  static exists(host: string, port: number): boolean {
    const db = getDatabase();
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM proxies WHERE host = ? AND port = ?`);
    const result = stmt.get(host, port) as { count: number };
    return result.count > 0;
  }

  /**
   * Increment success count
   */
  static incrementSuccess(id: string): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE proxies 
      SET success_count = success_count + 1,
          failed_count = 0,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }

  /**
   * Increment failed count
   */
  static incrementFailed(id: string): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE proxies 
      SET failed_count = failed_count + 1,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }

  /**
   * Delete all proxies
   */
  static deleteAll(): void {
    const db = getDatabase();
    db.prepare(`DELETE FROM proxies`).run();
  }
}
