/**
 * Rotating Proxy Database Service
 * CRUD operations cho rotating_proxy_configs table
 */

import { getDatabase } from './schema';
import { RotatingProxyConfig, RotatingProxyConfigInput } from '../../shared/types/proxy';

export class RotatingProxyDatabase {
  static getAll(): RotatingProxyConfig[] {
    const db = getDatabase();
    const stmt = db.prepare(`SELECT * FROM rotating_proxy_configs`);
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      scope: row.scope,
      host: row.host || '',
      port: Number(row.port || 0),
      username: row.username || undefined,
      password: row.password || undefined,
      protocol: row.protocol === 'socks5' ? 'socks5' : 'http',
      updatedAt: row.updated_at,
    }));
  }

  static getByScope(scope: RotatingProxyConfig['scope']): RotatingProxyConfig | null {
    const db = getDatabase();
    const stmt = db.prepare(`SELECT * FROM rotating_proxy_configs WHERE scope = ?`);
    const row = stmt.get(scope) as any;
    if (!row) return null;
    return {
      scope: row.scope,
      host: row.host || '',
      port: Number(row.port || 0),
      username: row.username || undefined,
      password: row.password || undefined,
      protocol: row.protocol === 'socks5' ? 'socks5' : 'http',
      updatedAt: row.updated_at,
    };
  }

  static upsert(config: RotatingProxyConfigInput): RotatingProxyConfig {
    const db = getDatabase();
    const updatedAt = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO rotating_proxy_configs (
        scope, host, port, username, password, protocol, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      config.scope,
      config.host || null,
      Number.isFinite(config.port) ? config.port : null,
      config.username || null,
      config.password || null,
      config.protocol,
      updatedAt
    );

    return {
      scope: config.scope,
      host: config.host,
      port: config.port,
      username: config.username || undefined,
      password: config.password || undefined,
      protocol: config.protocol,
      updatedAt,
    };
  }
}
