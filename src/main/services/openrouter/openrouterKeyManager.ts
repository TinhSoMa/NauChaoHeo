import { getAllAvailableKeys, updateProjectStats, getAllAccounts, setProjectStatus, setProjectRateLimitReset } from './openrouterDatabase.js'

interface KeyEntry {
  accountId: string
  projectIndex: number
  apiKey: string
  projectName: string
}

const RATE_LIMIT_COOLDOWN_MS = 65_000

class OpenRouterKeyManager {
  private keys: KeyEntry[] = []
  private currentIndex = 0
  private lastRecoveryCheck = 0
  private readonly RECOVERY_INTERVAL_MS = 30_000

  reload(): void {
    this.keys = getAllAvailableKeys()
    this.currentIndex = 0
  }

  getNextApiKey(): { apiKey: string; keyInfo: { accountId: string; projectName: string } } | null {
    if (this.keys.length === 0) {
      this.reload()
      if (this.keys.length === 0) return null
    }

    const key = this.keys[this.currentIndex]
    this.currentIndex = (this.currentIndex + 1) % this.keys.length
    return { apiKey: key.apiKey, keyInfo: { accountId: key.accountId, projectName: key.projectName } }
  }

  recordSuccess(apiKey: string): void {
    const entry = this.keys.find((k) => k.apiKey === apiKey)
    if (entry) {
      updateProjectStats(entry.accountId, entry.projectIndex, { success: true })
    }
  }

  recordError(apiKey: string, errorMessage: string): void {
    const entry = this.keys.find((k) => k.apiKey === apiKey)
    if (entry) {
      updateProjectStats(entry.accountId, entry.projectIndex, { error: errorMessage })
    }
  }

  recordRateLimitError(apiKey: string, retryAfterMs?: number): void {
    const entry = this.keys.find((k) => k.apiKey === apiKey)
    if (!entry) return

    const cooldown = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : RATE_LIMIT_COOLDOWN_MS
    const resetAt = new Date(Date.now() + cooldown).toISOString()

    setProjectStatus(entry.accountId, entry.projectIndex, 'rate_limited')
    setProjectRateLimitReset(entry.accountId, entry.projectIndex, resetAt)
    updateProjectStats(entry.accountId, entry.projectIndex, { error: 'rate_limited' })

    // Remove from in-memory keys so getNextApiKey() skips it
    this.keys = this.keys.filter((k) => k.apiKey !== apiKey)
  }

  autoRecover(): void {
    const now = Date.now()
    if (now - this.lastRecoveryCheck < this.RECOVERY_INTERVAL_MS) return
    this.lastRecoveryCheck = now

    // Reload will pick up expired rate_limited keys as 'available'
    this.reload()
  }

  hasKeys(): boolean {
    this.autoRecover()
    if (this.keys.length === 0) this.reload()
    return this.keys.length > 0
  }

  getKeyCount(): number {
    if (this.keys.length === 0) this.reload()
    return this.keys.length
  }

  getAllApiKeys(): string[] {
    if (this.keys.length === 0) this.reload()
    return this.keys.map((k) => k.apiKey)
  }

  getAllKeysWithStatus(): {
    accountId: string
    email: string
    accountStatus: string
    projects: {
      projectIndex: number
      projectName: string
      status: string
      apiKey: string
      totalRequestsToday: number
      successCount: number
      errorCount: number
      lastErrorMessage: string | null
      lastUsedTimestamp: string | null
    }[]
  }[] {
    const accounts = getAllAccounts()
    return accounts.map((acc) => ({
      accountId: acc.accountId,
      email: acc.email,
      accountStatus: acc.accountStatus,
      projects: acc.projects.map((p) => ({
        projectIndex: p.projectIndex,
        projectName: p.projectName,
        status: p.status,
        apiKey: p.apiKey,
        totalRequestsToday: p.totalRequestsToday,
        successCount: p.successCount,
        errorCount: p.errorCount,
        lastErrorMessage: p.lastErrorMessage,
        lastUsedTimestamp: p.lastUsedTimestamp,
      })),
    }))
  }
}

let instance: OpenRouterKeyManager | null = null

export function getKeyManager(): OpenRouterKeyManager {
  if (!instance) {
    instance = new OpenRouterKeyManager()
  }
  return instance
}
