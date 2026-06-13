import { getAllAvailableKeys, updateProjectStats, getAllAccounts } from './openrouterDatabase.js'

interface KeyEntry {
  accountId: string
  projectIndex: number
  apiKey: string
  projectName: string
}

class OpenRouterKeyManager {
  private keys: KeyEntry[] = []
  private currentIndex = 0

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

  hasKeys(): boolean {
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
