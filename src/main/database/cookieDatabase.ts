import { v4 as uuidv4 } from 'uuid'
import { getDatabase } from './schema'
import type { CookieEntry } from '../../shared/types/downloader'

/**
 * Extract the root domain from a URL or hostname.
 * e.g. "https://www.bilibili.com/video/..." → "bilibili.com"
 */
export function extractRootDomain(urlOrHost: string): string {
  try {
    const hostname = urlOrHost.startsWith('http')
      ? new URL(urlOrHost).hostname
      : urlOrHost.replace(/^www\./, '')
    // Keep last 2 parts: "sub.bilibili.com" → "bilibili.com"
    const parts = hostname.split('.')
    return parts.length >= 2 ? parts.slice(-2).join('.') : hostname
  } catch {
    return urlOrHost
  }
}

function rowToEntry(row: any): CookieEntry {
  return {
    id: row.id,
    domain: row.domain,
    label: row.label,
    content: row.content,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export const cookieDatabase = {
  getAll(): CookieEntry[] {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM downloader_cookies ORDER BY domain ASC').all()
    return (rows as any[]).map(rowToEntry)
  },

  getByDomain(urlOrDomain: string): CookieEntry | null {
    const db = getDatabase()
    const domain = extractRootDomain(urlOrDomain)
    const row = db
      .prepare('SELECT * FROM downloader_cookies WHERE domain = ? AND enabled = 1')
      .get(domain)
    return row ? rowToEntry(row as any) : null
  },

  upsert(entry: { domain: string; label: string; content: string }): CookieEntry {
    const db = getDatabase()
    const domain = extractRootDomain(entry.domain)
    const now = Date.now()
    const existing = db
      .prepare('SELECT id FROM downloader_cookies WHERE domain = ?')
      .get(domain) as { id: string } | undefined

    if (existing) {
      db.prepare(
        'UPDATE downloader_cookies SET label = ?, content = ?, enabled = 1, updated_at = ? WHERE id = ?'
      ).run(entry.label, entry.content, now, existing.id)
      return rowToEntry(
        db.prepare('SELECT * FROM downloader_cookies WHERE id = ?').get(existing.id)
      )
    } else {
      const id = uuidv4()
      db.prepare(
        'INSERT INTO downloader_cookies (id, domain, label, content, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
      ).run(id, domain, entry.label, entry.content, now, now)
      return rowToEntry(
        db.prepare('SELECT * FROM downloader_cookies WHERE id = ?').get(id)
      )
    }
  },

  remove(id: string): void {
    const db = getDatabase()
    db.prepare('DELETE FROM downloader_cookies WHERE id = ?').run(id)
  },
}
