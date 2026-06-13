import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Download, Upload, RefreshCw, ChevronDown, ChevronRight,
  Eye, EyeOff, AlertTriangle, ToggleLeft, ToggleRight
} from 'lucide-react'
import styles from './OpenRouterApiKeys.module.css'

interface Project {
  projectIndex: number
  projectName: string
  apiKey: string
  notes: string | null
  status: 'available' | 'error' | 'disabled'
  totalRequestsToday: number
  successCount: number
  errorCount: number
  lastErrorMessage: string | null
  lastUsedTimestamp: string | null
}

interface Account {
  accountId: string
  email: string
  accountStatus: 'active' | 'disabled'
  projects: Project[]
}

interface KeyStats {
  totalAccounts: number
  totalKeys: number
  available: number
  error: number
  disabled: number
  totalRequestsToday: number
}

function formatRelativeTime(ts: string | null): string {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'vừa xong'
  if (mins < 60) return `${mins}p trước`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h trước`
  const days = Math.floor(hrs / 24)
  return `${days}d trước`
}

function getWorstStatus(projects: Project[]): 'available' | 'error' | 'disabled' {
  if (projects.some(p => p.status === 'error')) return 'error'
  if (projects.some(p => p.status === 'disabled')) return 'disabled'
  return 'available'
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + '****'
  return key.slice(0, 8) + '...' + key.slice(-4)
}

export function OpenRouterApiKeys() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [stats, setStats] = useState<KeyStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showAddForm, setShowAddForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set())

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const [accRes, statsRes] = await Promise.all([
        window.electronAPI.openRouter.getAllAccounts(),
        window.electronAPI.openRouter.getKeyStats(),
      ])
      if (accRes.success) setAccounts(accRes.data || [])
      if (statsRes.success) setStats(statsRes.data)
    } catch (err) {
      console.error('[OpenRouterApiKeys] Lỗi tải:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleKey = (key: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const toggleError = (id: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleToggleAccount = async (id: string, current: boolean) => {
    const res = current
      ? await window.electronAPI.openRouter.disableAccount(id)
      : await window.electronAPI.openRouter.enableAccount(id)
    if (res.success) loadAccounts()
    else setMessage({ type: 'error', text: res.error || 'Lỗi' })
  }

  const handleToggleProject = async (accId: string, idx: number, current: boolean) => {
    const res = current
      ? await window.electronAPI.openRouter.disableProject(accId, idx)
      : await window.electronAPI.openRouter.enableProject(accId, idx)
    if (res.success) loadAccounts()
    else setMessage({ type: 'error', text: res.error || 'Lỗi' })
  }

  const handleRemoveAccount = async (id: string) => {
    const res = await window.electronAPI.openRouter.removeAccount(id)
    if (res.success) loadAccounts()
    else setMessage({ type: 'error', text: res.error || 'Lỗi' })
  }

  const handleRemoveProject = async (accId: string, idx: number) => {
    const res = await window.electronAPI.openRouter.removeProject(accId, idx)
    if (res.success) loadAccounts()
    else setMessage({ type: 'error', text: res.error || 'Lỗi' })
  }

  const handleExport = async () => {
    const res = await window.electronAPI.openRouter.exportKeys()
    if (res.success) {
      const blob = new Blob([res.data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'openrouter-keys.json'; a.click()
      URL.revokeObjectURL(url)
      setMessage({ type: 'success', text: 'Đã export' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Lỗi export' })
    }
  }

  const handleImport = async () => {
    try { JSON.parse(importText) } catch { setMessage({ type: 'error', text: 'JSON không hợp lệ' }); return }
    const res = await window.electronAPI.openRouter.importKeys(importText)
    if (res.success) {
      setMessage({ type: 'success', text: 'Đã import' })
      setShowImport(false); setImportText(''); loadAccounts()
    } else {
      setMessage({ type: 'error', text: res.error || 'Lỗi import' })
    }
  }

  if (loading) {
    return <div className="text-sm text-text-secondary py-8 text-center">Đang tải...</div>
  }

  const allProjects = accounts.flatMap(a => a.projects)
  const totalReq = allProjects.reduce((s, p) => s + p.totalRequestsToday, 0)
  const totalErr = allProjects.reduce((s, p) => s + p.errorCount, 0)

  return (
    <div className={styles.container}>
      {message && (
        <div className={`${styles.message} ${message.type === 'success' ? styles.messageSuccess : styles.messageError}`}>
          {message.text}
          <button className="float-right text-inherit opacity-60 hover:opacity-100" onClick={() => setMessage(null)}>✕</button>
        </div>
      )}

      {/* KPI Bar */}
      {accounts.length > 0 && (
        <div className={styles.kpiBar}>
          {[
            { label: 'Tổng keys', value: allProjects.length, cls: styles.kpiValueBlue },
            { label: 'Available', value: allProjects.filter(p => p.status === 'available').length, cls: styles.kpiValueGreen },
            { label: 'Lỗi', value: allProjects.filter(p => p.status === 'error').length, cls: styles.kpiValueRed },
            { label: 'Disabled', value: allProjects.filter(p => p.status === 'disabled').length, cls: styles.kpiValueGray },
            { label: 'Yêu cầu hôm nay', value: totalReq, cls: stats ? styles.kpiValueBlue : styles.kpiValueGray },
            { label: 'Tổng lỗi', value: totalErr, cls: totalErr > 0 ? styles.kpiValueRed : styles.kpiValueGray },
          ].map(k => (
            <div key={k.label} className={styles.kpiCard}>
              <span className={styles.kpiLabel}>{k.label}</span>
              <span className={`${styles.kpiValue} ${k.cls}`}>{k.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.headerTitle}>
          {accounts.length > 0
            ? `${accounts.length} accounts · ${allProjects.length} keys`
            : 'OpenRouter API Keys'}
        </h2>
        <div className={styles.headerActions}>
          <button className={styles.headerBtn} onClick={() => setShowImport(true)}><Upload size={13} /> Import</button>
          <button className={styles.headerBtn} onClick={handleExport}><Download size={13} /> Export</button>
          <button className={`${styles.headerBtn} ${styles.headerBtnPrimary}`} onClick={() => setShowAddForm(true)}><Plus size={13} /> Add Account</button>
          <button className={styles.headerBtn} onClick={loadAccounts}><RefreshCw size={13} /></button>
        </div>
      </div>

      {/* Account list */}
      {accounts.length === 0 ? (
        <div className={styles.emptyState}>
          Chưa có OpenRouter account nào. Nhấn "Add Account" để thêm.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map(account => {
            const worst = getWorstStatus(account.projects)
            const cardClass = worst === 'error' ? styles.cardWorstError
              : worst === 'disabled' ? styles.cardWorstDisabled
              : styles.cardWorstAvailable
            const errCount = account.projects.filter(p => p.status === 'error').length
            const disCount = account.projects.filter(p => p.status === 'disabled').length
            const okCount = account.projects.filter(p => p.status === 'available').length

            return (
              <div key={account.accountId} className={`${styles.accountCard} ${cardClass}`}>
                <div className={styles.accountHeader} onClick={() => toggleExpand(account.accountId)}>
                  {expandedIds.has(account.accountId) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <span className={`${styles.accountBadge} ${account.accountStatus === 'active' ? styles.badgeActive : styles.badgeDisabled}`} />
                  <span className={styles.accountEmail}>{account.email}</span>
                  {account.projects.length > 0 && (
                    <div className={styles.accountSummary}>
                      {okCount > 0 && <span className={`${styles.summaryChip} ${styles.summaryOk}`}>{okCount}✓</span>}
                      {errCount > 0 && <span className={`${styles.summaryChip} ${styles.summaryErr}`}>{errCount}✗</span>}
                      {disCount > 0 && <span className={`${styles.summaryChip} ${styles.summaryDis}`}>{disCount}⊘</span>}
                    </div>
                  )}
                  <div className={styles.accountActions} onClick={e => e.stopPropagation()}>
                    <button className={styles.iconBtn} onClick={() => handleToggleAccount(account.accountId, account.accountStatus === 'active')} title={account.accountStatus === 'active' ? 'Disable' : 'Enable'}>
                      {account.accountStatus === 'active' ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleRemoveAccount(account.accountId)} title="Xóa account">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {expandedIds.has(account.accountId) && (
                  <div className={styles.accountBody}>
                    {account.projects.length === 0 && (
                      <div className="text-xs text-text-secondary text-center py-2">Chưa có project nào</div>
                    )}
                    {account.projects.map((project, idx) => {
                      const errId = `${account.accountId}-${idx}`
                      const showErr = expandedErrors.has(errId)

                      return (
                        <div key={errId} className={styles.projectRow}>
                          <div className={styles.projectMain}>
                            <span className={`${styles.projectStatusDot} ${
                              project.status === 'available' ? styles.projectStatusDotAvailable
                                : project.status === 'error' ? styles.projectStatusDotError
                                : styles.projectStatusDotDisabled
                            }`} />
                            <span className={styles.projectName}>{project.projectName}</span>
                            <span className={styles.projectKey}>
                              {visibleKeys.has(project.apiKey) ? project.apiKey : maskKey(project.apiKey)}
                              <button className="ml-1 align-middle text-text-secondary hover:text-text-primary" onClick={() => toggleKey(project.apiKey)}>
                                {visibleKeys.has(project.apiKey) ? <EyeOff size={11} /> : <Eye size={11} />}
                              </button>
                            </span>
                          </div>

                          <div className={styles.projectStats}>
                            <span className={`${styles.statChip} ${styles.statMuted}`}>
                              {project.totalRequestsToday} req
                            </span>
                            {project.successCount > 0 && (
                              <span className={`${styles.statChip} ${styles.statOk}`}>
                                {project.successCount}✓
                              </span>
                            )}
                            {project.errorCount > 0 && (
                              <span className={`${styles.statChip} ${styles.statErr}`}>
                                {project.errorCount}✗
                              </span>
                            )}
                            {project.lastUsedTimestamp && (
                              <span className={`${styles.statChip} ${styles.statMuted}`}>
                                {formatRelativeTime(project.lastUsedTimestamp)}
                              </span>
                            )}
                          </div>

                          <div className={styles.projectActions}>
                            <button
                              className={`${styles.iconBtn} ${project.status === 'error' ? styles.iconBtnDanger : ''}`}
                              onClick={() => handleToggleProject(account.accountId, idx, project.status !== 'disabled')}
                              title={project.status === 'disabled' ? 'Enable' : 'Disable'}
                            >
                              {project.status === 'disabled' ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
                            </button>
                            <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleRemoveProject(account.accountId, idx)} title="Xóa key">
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {project.lastErrorMessage && (
                            <div className={styles.errorBlock}>
                              <button className={styles.errorToggle} onClick={() => toggleError(errId)}>
                                <AlertTriangle size={11} />
                                {showErr ? 'Ẩn lỗi' : `Lỗi: ${project.lastErrorMessage.length > 50 ? project.lastErrorMessage.slice(0, 50) + '…' : project.lastErrorMessage}`}
                              </button>
                              {showErr && (
                                <div className={styles.errorMessage}>{project.lastErrorMessage}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <AddAccountForm
          onClose={() => setShowAddForm(false)}
          onDone={() => { setShowAddForm(false); loadAccounts() }}
          onError={text => setMessage({ type: 'error', text })}
        />
      )}

      {/* Import */}
      {showImport && (
        <div className={styles.importPanel}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">Import Keys (JSON)</span>
            <button className="text-text-secondary hover:text-text-primary" onClick={() => setShowImport(false)}>✕</button>
          </div>
          <textarea
            value={importText} onChange={e => setImportText(e.target.value)}
            className={styles.importTextarea}
            placeholder='[{"email": "...", "projects": [{"projectName": "...", "apiKey": "..."}]}]'
          />
          <div className={styles.formActions}>
            <button className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-surface" onClick={() => setShowImport(false)}>Hủy</button>
            <button className="text-xs px-3 py-1.5 rounded-lg bg-primary text-white hover:opacity-90" onClick={handleImport}>Import</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────── AddAccountForm ───────── */
function AddAccountForm({ onClose, onDone, onError }: {
  onClose: () => void; onDone: () => void; onError: (t: string) => void
}) {
  const [email, setEmail] = useState('')
  const [projects, setProjects] = useState([{ projectName: '', apiKey: '', notes: '' }])
  const [submitting, setSubmitting] = useState(false)

  const updateProject = (idx: number, field: string, value: string) => {
    setProjects(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }

  const handleSubmit = async () => {
    if (!email.trim()) { onError('Vui lòng nhập email'); return }
    const valid = projects.filter(p => p.projectName.trim() && p.apiKey.trim())
    if (valid.length === 0) { onError('Vui lòng thêm ít nhất một project'); return }
    setSubmitting(true)
    try {
      const res = await window.electronAPI.openRouter.addAccount(email.trim(), valid)
      if (res.success) onDone()
      else onError(res.error || 'Lỗi')
    } catch (err) { onError(String(err)) }
    setSubmitting(false)
  }

  return (
    <div className={styles.formOverlay} onClick={onClose}>
      <div className={styles.formPanel} onClick={e => e.stopPropagation()}>
        <h3 className={styles.formTitle}>Thêm OpenRouter Account</h3>
        <div className={styles.formField}>
          <label className={styles.formLabel}>Email</label>
          <input className={styles.formInput} value={email} onChange={e => setEmail(e.target.value)} placeholder="example@gmail.com" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary">Projects</span>
            <button className="text-xs text-primary hover:opacity-80 flex items-center gap-1" onClick={() => setProjects(p => [...p, { projectName: '', apiKey: '', notes: '' }])}>
              <Plus size={11} /> Add Project
            </button>
          </div>
          {projects.map((p, idx) => (
            <div key={idx} className="border border-border rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">#{idx + 1}</span>
                {projects.length > 1 && (
                  <button className="text-red-400 hover:text-red-300" onClick={() => setProjects(prev => prev.filter((_, i) => i !== idx))}><Trash2 size={12} /></button>
                )}
              </div>
              <input className={styles.formInput} value={p.projectName} onChange={e => updateProject(idx, 'projectName', e.target.value)} placeholder="Project name" />
              <input className={styles.formInput} value={p.apiKey} onChange={e => updateProject(idx, 'apiKey', e.target.value)} placeholder="sk-or-v1-..." />
              <input className={styles.formInput} value={p.notes} onChange={e => updateProject(idx, 'notes', e.target.value)} placeholder="Ghi chú (tùy chọn)" />
            </div>
          ))}
        </div>
        <div className={styles.formActions}>
          <button className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-surface" onClick={onClose}>Hủy</button>
          <button className="text-xs px-3 py-1.5 rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50" disabled={submitting} onClick={handleSubmit}>
            {submitting ? 'Đang thêm...' : 'Thêm'}
          </button>
        </div>
      </div>
    </div>
  )
}
