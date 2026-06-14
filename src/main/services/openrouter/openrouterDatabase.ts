import { getDatabase } from '../../database/schema'

export interface OpenRouterDbAccount {
  account_id: string
  email: string
  account_status: 'active' | 'disabled'
  sort_order: number
  created_at: number
  updated_at: number
}

export interface OpenRouterDbProject {
  id?: number
  account_id: string
  project_index: number
  project_name: string
  api_key: string
  notes: string | null
  status: 'available' | 'rate_limited' | 'error' | 'disabled'
  total_requests_today: number
  success_count: number
  error_count: number
  last_error_message: string | null
  last_used_timestamp: string | null
  rate_limit_reset_at: string | null
  created_at: number
  updated_at: number
}

export interface OpenRouterAccountItem {
  accountId: string
  email: string
  accountStatus: 'active' | 'disabled'
  projects: OpenRouterProjectItem[]
}

export interface OpenRouterProjectItem {
  projectIndex: number
  projectName: string
  apiKey: string
  notes: string | null
  status: 'available' | 'rate_limited' | 'error' | 'disabled'
  totalRequestsToday: number
  successCount: number
  errorCount: number
  lastErrorMessage: string | null
  lastUsedTimestamp: string | null
  rateLimitResetAt: string | null
}

export function getAllAccounts(): OpenRouterAccountItem[] {
  try {
    const db = getDatabase()
    const accounts = db.prepare(
      `SELECT account_id, email, account_status, sort_order FROM openrouter_accounts ORDER BY sort_order ASC`
    ).all() as OpenRouterDbAccount[]

    return accounts.map((acc) => {
      const projects = db.prepare(
        `SELECT * FROM openrouter_projects WHERE account_id = ? ORDER BY project_index ASC`
      ).all(acc.account_id) as OpenRouterDbProject[]

      return {
        accountId: acc.account_id,
        email: acc.email,
        accountStatus: acc.account_status,
        projects: projects.map((p) => ({
          projectIndex: p.project_index,
          projectName: p.project_name,
          apiKey: p.api_key,
          notes: p.notes,
          status: p.status,
          totalRequestsToday: p.total_requests_today,
          successCount: p.success_count,
          errorCount: p.error_count,
          lastErrorMessage: p.last_error_message,
          lastUsedTimestamp: p.last_used_timestamp,
          rateLimitResetAt: p.rate_limit_reset_at,
        })),
      }
    })
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi đọc accounts:', error)
    return []
  }
}

export function addAccount(
  email: string,
  projects: { projectName: string; apiKey: string; notes?: string }[]
): OpenRouterAccountItem | null {
  try {
    const db = getDatabase()
    const now = Date.now()
    const accountId = `or_acc_${now}_${Math.random().toString(36).slice(2, 6)}`

    const tx = db.transaction(() => {
      const maxOrder = db.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) as max_order FROM openrouter_accounts`
      ).get() as { max_order: number }

      db.prepare(
        `INSERT INTO openrouter_accounts (account_id, email, account_status, sort_order, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)`
      ).run(accountId, email, maxOrder.max_order + 1, now, now)

      const insertProject = db.prepare(
        `INSERT INTO openrouter_projects (account_id, project_index, project_name, api_key, notes, status, total_requests_today, success_count, error_count, last_error_message, last_used_timestamp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'available', 0, 0, 0, null, null, ?, ?)`
      )

      projects.forEach((proj, i) => {
        insertProject.run(accountId, i, proj.projectName, proj.apiKey, proj.notes || null, now, now)
      })
    })
    tx()

    return getAllAccounts().find((a) => a.accountId === accountId) || null
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi thêm account:', error)
    return null
  }
}

export function removeAccount(accountId: string): boolean {
  try {
    const db = getDatabase()
    db.prepare(`DELETE FROM openrouter_projects WHERE account_id = ?`).run(accountId)
    const result = db.prepare(`DELETE FROM openrouter_accounts WHERE account_id = ?`).run(accountId)
    return (result as any).changes > 0
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi xóa account:', error)
    return false
  }
}

export function setAccountStatus(accountId: string, status: 'active' | 'disabled'): boolean {
  try {
    const db = getDatabase()
    const result = db.prepare(
      `UPDATE openrouter_accounts SET account_status = ?, updated_at = ? WHERE account_id = ?`
    ).run(status, Date.now(), accountId)
    return (result as any).changes > 0
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi set account status:', error)
    return false
  }
}

export function addProject(
  accountId: string,
  project: { projectName: string; apiKey: string; notes?: string }
): OpenRouterProjectItem | null {
  try {
    const db = getDatabase()
    const now = Date.now()

    const maxIndex = db.prepare(
      `SELECT COALESCE(MAX(project_index), -1) as max_idx FROM openrouter_projects WHERE account_id = ?`
    ).get(accountId) as { max_idx: number }

    const projectIndex = maxIndex.max_idx + 1
    db.prepare(
      `INSERT INTO openrouter_projects (account_id, project_index, project_name, api_key, notes, status, total_requests_today, success_count, error_count, last_error_message, last_used_timestamp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'available', 0, 0, 0, null, null, ?, ?)`
    ).run(accountId, projectIndex, project.projectName, project.apiKey, project.notes || null, now, now)

    const row = db.prepare(
      `SELECT * FROM openrouter_projects WHERE account_id = ? AND project_index = ?`
    ).get(accountId, projectIndex) as OpenRouterDbProject | undefined

    if (!row) return null
    return {
      projectIndex: row.project_index,
      projectName: row.project_name,
      apiKey: row.api_key,
      notes: row.notes,
      status: row.status,
      totalRequestsToday: row.total_requests_today,
      successCount: row.success_count,
      errorCount: row.error_count,
      lastErrorMessage: row.last_error_message,
      lastUsedTimestamp: row.last_used_timestamp,
    }
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi thêm project:', error)
    return null
  }
}

export function removeProject(accountId: string, projectIndex: number): boolean {
  try {
    const db = getDatabase()
    const result = db.prepare(
      `DELETE FROM openrouter_projects WHERE account_id = ? AND project_index = ?`
    ).run(accountId, projectIndex)
    return (result as any).changes > 0
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi xóa project:', error)
    return false
  }
}

export function setProjectStatus(
  accountId: string,
  projectIndex: number,
  status: 'available' | 'rate_limited' | 'error' | 'disabled'
): boolean {
  try {
    const db = getDatabase()
    const result = db.prepare(
      `UPDATE openrouter_projects SET status = ?, updated_at = ? WHERE account_id = ? AND project_index = ?`
    ).run(status, Date.now(), accountId, projectIndex)
    return (result as any).changes > 0
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi set project status:', error)
    return false
  }
}

export function setProjectRateLimitReset(
  accountId: string,
  projectIndex: number,
  resetAt: string | null
): boolean {
  try {
    const db = getDatabase()
    const result = db.prepare(
      `UPDATE openrouter_projects SET rate_limit_reset_at = ?, updated_at = ? WHERE account_id = ? AND project_index = ?`
    ).run(resetAt, Date.now(), accountId, projectIndex)
    return (result as any).changes > 0
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi set rate_limit_reset_at:', error)
    return false
  }
}

export function updateProjectStats(
  accountId: string,
  projectIndex: number,
  stats: { success?: boolean; error?: string }
): void {
  try {
    const db = getDatabase()
    const now = Date.now()
    const nowStr = new Date(now).toISOString()

    if (stats.success) {
      db.prepare(
        `UPDATE openrouter_projects SET success_count = success_count + 1, total_requests_today = total_requests_today + 1, last_used_timestamp = ?, updated_at = ? WHERE account_id = ? AND project_index = ?`
      ).run(nowStr, now, accountId, projectIndex)
    } else if (stats.error) {
      db.prepare(
        `UPDATE openrouter_projects SET error_count = error_count + 1, total_requests_today = total_requests_today + 1, last_error_message = ?, last_used_timestamp = ?, updated_at = ? WHERE account_id = ? AND project_index = ?`
      ).run(stats.error, nowStr, now, accountId, projectIndex)
    }
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi update stats:', error)
  }
}

export function getAllAvailableKeys(): { accountId: string; projectIndex: number; apiKey: string; projectName: string }[] {
  try {
    const db = getDatabase()
    const now = new Date().toISOString()
    const rows = db.prepare(
      `SELECT p.account_id, p.project_index, p.api_key, p.project_name, p.status, p.rate_limit_reset_at
       FROM openrouter_projects p
       INNER JOIN openrouter_accounts a ON a.account_id = p.account_id
       WHERE a.account_status = 'active'
         AND (
           p.status = 'available'
           OR (p.status = 'rate_limited' AND (p.rate_limit_reset_at IS NULL OR p.rate_limit_reset_at <= ?))
         )
       ORDER BY a.sort_order ASC, p.project_index ASC`
    ).all(now) as { account_id: string; project_index: number; api_key: string; project_name: string; status: string; rate_limit_reset_at: string | null }[]

    return rows.map((r) => ({
      accountId: r.account_id,
      projectIndex: r.project_index,
      apiKey: r.api_key,
      projectName: r.project_name,
    }))
  } catch (error) {
    console.error('[OpenRouterDatabase] Lỗi lấy available keys:', error)
    return []
  }
}

export function importAccountsFromJson(jsonString: string): { success: boolean; count: number; error?: string } {
  try {
    const data = JSON.parse(jsonString)
    if (!Array.isArray(data)) {
      return { success: false, count: 0, error: 'Dữ liệu phải là một mảng accounts' }
    }

    let importedCount = 0
    for (const item of data) {
      if (!item.email || !item.projects || !Array.isArray(item.projects)) continue
      const projects = item.projects.filter((p: any) => p.apiKey)
      if (projects.length === 0) continue
      const result = addAccount(item.email, projects.map((p: any) => ({ projectName: p.projectName || 'Key', apiKey: p.apiKey, notes: p.notes })))
      if (result) importedCount++
    }

    return { success: true, count: importedCount }
  } catch (error) {
    return { success: false, count: 0, error: String(error) }
  }
}

export function exportAccountsToJson(): string {
  const accounts = getAllAccounts()
  const data = accounts.map((acc) => ({
    email: acc.email,
    accountId: acc.accountId,
    projects: acc.projects.map((p) => ({
      projectName: p.projectName,
      apiKey: p.apiKey,
      notes: p.notes,
    })),
  }))
  return JSON.stringify(data, null, 2)
}
