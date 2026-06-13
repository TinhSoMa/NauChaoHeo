import { useState, useRef, useEffect, useMemo } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import type { OpenRouterModel, OpenRouterModelCapability } from '@shared/types/openrouter'
import { getModelCapabilities, CAPABILITY_LABELS, CAPABILITY_COLORS } from '@shared/types/openrouter'

// ==================== HELPERS ====================

export function isFree(pricing?: { prompt: string; completion: string }): boolean {
  if (!pricing) return false
  return pricing.prompt === '0' && pricing.completion === '0'
}

export function formatPrice(pricing?: { prompt: string; completion: string }): string {
  if (!pricing) return ''
  const prompt = parseFloat(pricing.prompt)
  const completion = parseFloat(pricing.completion)
  if (prompt === -1 || completion === -1) return ''
  const maxPerToken = Math.max(
    isNaN(prompt) ? 0 : prompt,
    isNaN(completion) ? 0 : completion,
  )
  if (maxPerToken === 0) return ''
  const perMillion = maxPerToken * 1_000_000
  if (perMillion < 0.01) return `~$${perMillion.toFixed(4)}/M`
  return `$${perMillion.toFixed(2)}/M`
}

export function formatContext(len?: number): string {
  if (!len) return ''
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(0)}M`
  return `${(len / 1_000).toFixed(0)}K`
}

function getProvider(modelId: string): string {
  return modelId.includes('/') ? modelId.split('/')[0] : 'other'
}

function getShortName(modelId: string): string {
  return modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId
}

// ==================== PROPS ====================

interface ModelPickerProps {
  models: OpenRouterModel[]
  value: string
  onChange: (modelId: string) => void
  placeholder?: string
}

// ==================== COMPONENT ====================

type FilterMode = 'all' | 'free' | 'paid'

export function ModelPicker({ models, value, onChange, placeholder }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('free')
  const [capabilityFilter, setCapabilityFilter] = useState<OpenRouterModelCapability | 'all'>('all')
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set())
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Unique providers
  const allProviders = useMemo(() => {
    const set = new Set<string>()
    models.forEach(m => set.add(getProvider(m.id)))
    return Array.from(set).sort()
  }, [models])

  // Filter + sort logic
  const { groups, providerOrder } = useMemo(() => {
    let filtered = models

    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(m =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q)
      )
    }

    if (filterMode === 'free') {
      filtered = filtered.filter(m => isFree(m.pricing))
    } else if (filterMode === 'paid') {
      filtered = filtered.filter(m => !isFree(m.pricing))
    }

    if (selectedProviders.size > 0) {
      filtered = filtered.filter(m => selectedProviders.has(getProvider(m.id)))
    }

    if (capabilityFilter !== 'all') {
      filtered = filtered.filter(m => getModelCapabilities(m).includes(capabilityFilter))
    }

    const groups: Record<string, OpenRouterModel[]> = {}
    filtered.forEach(m => {
      const p = getProvider(m.id)
      if (!groups[p]) groups[p] = []
      groups[p].push(m)
    })

    // Sort within each group: free first → short name
    Object.values(groups).forEach(g => {
      g.sort((a, b) => {
        const aFree = isFree(a.pricing)
        const bFree = isFree(b.pricing)
        if (aFree && !bFree) return -1
        if (!aFree && bFree) return 1
        return getShortName(a.id).localeCompare(getShortName(b.id))
      })
    })

    // Sort providers: those with free models first → alphabetically
    const providerOrder = Object.keys(groups).sort((a, b) => {
      const aHasFree = groups[a].some(m => isFree(m.pricing))
      const bHasFree = groups[b].some(m => isFree(m.pricing))
      if (aHasFree && !bHasFree) return -1
      if (!aHasFree && bHasFree) return 1
      return a.localeCompare(b)
    })

    return { groups, providerOrder }
  }, [models, search, filterMode, capabilityFilter, selectedProviders])

  const totalFiltered = providerOrder.reduce((sum, p) => sum + groups[p].length, 0)
  const selected = models.find(m => m.id === value)

  function toggleProvider(p: string) {
    const next = new Set(selectedProviders)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    setSelectedProviders(next)
  }

  return (
    <div className="flex flex-col gap-1 relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => { setOpen(!open); if (!open) setSearch('') }}
        className="flex items-center justify-between bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary min-w-0"
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {selected ? (
            <>
              <span className="truncate">{selected.name}</span>
              {isFree(selected.pricing) && (
                <span className="text-2xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium shrink-0">Free</span>
              )}
              {selected.context_length && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted shrink-0">{formatContext(selected.context_length)}</span>
              )}
              {getModelCapabilities(selected).filter(c => c !== 'text').map(c => (
                <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${CAPABILITY_COLORS[c]}`}>{CAPABILITY_LABELS[c]}</span>
              ))}
            </>
          ) : (
            <span className="text-text-muted">{placeholder || 'Chọn model...'}</span>
          )}
        </span>
        <ChevronsUpDown size={14} className="text-text-muted shrink-0 ml-1" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* ── Search ── */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search size={13} className="text-text-muted shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm model theo tên, ID, mô tả..."
              className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>

          {/* ── Free / Paid filter ── */}
          <div className="flex gap-1.5 px-3 py-1.5 border-b border-border">
            {(['all', 'free', 'paid'] as FilterMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`text-xs px-2.5 py-0.5 rounded-full transition-colors ${
                  filterMode === mode
                    ? 'bg-primary/10 text-primary border border-primary/30 font-medium'
                    : 'text-text-muted border border-transparent hover:text-text-primary'
                }`}
              >
                {mode === 'all' ? 'Tất cả' : mode === 'free' ? 'Free' : 'Trả phí'}
              </button>
            ))}
          </div>

          {/* ── Provider chips ── */}
          <div className="flex gap-1.5 px-3 py-1.5 border-b border-border overflow-x-auto">
            <button
              onClick={() => setSelectedProviders(new Set())}
              className={`text-xs px-2 py-0.5 rounded whitespace-nowrap transition-colors shrink-0 ${
                selectedProviders.size === 0
                  ? 'bg-primary/10 text-primary border border-primary/30 font-medium'
                  : 'text-text-muted border border-border hover:text-text-primary'
              }`}
            >
              Tất cả
            </button>
            {allProviders.map(p => (
              <button
                key={p}
                onClick={() => toggleProvider(p)}
                className={`text-xs px-2 py-0.5 rounded whitespace-nowrap transition-colors shrink-0 ${
                  selectedProviders.has(p)
                    ? 'bg-primary/10 text-primary border border-primary/30 font-medium'
                    : 'text-text-muted border border-border hover:text-text-primary'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* ── Capability filter chips ── */}
          <div className="flex gap-1.5 px-3 py-1.5 border-b border-border overflow-x-auto">
            <button
              onClick={() => setCapabilityFilter('all')}
              className={`text-xs px-2 py-0.5 rounded whitespace-nowrap transition-colors shrink-0 ${
                capabilityFilter === 'all'
                  ? 'bg-primary/10 text-primary border border-primary/30 font-medium'
                  : 'text-text-muted border border-border hover:text-text-primary'
              }`}
            >
              Tất cả
            </button>
            {(['vision', 'image', 'audio', 'file', 'video'] as OpenRouterModelCapability[]).map(cap => (
              <button
                key={cap}
                onClick={() => setCapabilityFilter(cap === capabilityFilter ? 'all' : cap)}
                className={`text-xs px-2 py-0.5 rounded whitespace-nowrap transition-colors shrink-0 ${
                  capabilityFilter === cap
                    ? 'bg-primary/10 text-primary border border-primary/30 font-medium'
                    : 'text-text-muted border border-border hover:text-text-primary'
                }`}
              >
                {CAPABILITY_LABELS[cap]}
              </button>
            ))}
          </div>

          {/* ── Model list ── */}
          <div className="overflow-y-auto max-h-56">
            {totalFiltered === 0 && (
              <div className="text-xs text-text-secondary text-center py-6">Không tìm thấy model</div>
            )}
            {providerOrder.map(provider => (
              <div key={provider}>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted bg-surface/50 sticky top-0">
                  {provider}
                </div>
                {groups[provider].map(m => {
                  const active = m.id === value
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { onChange(m.id); setOpen(false); setSearch('') }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface transition-colors ${
                        active ? 'bg-primary/5 text-primary' : 'text-text-primary'
                      }`}
                    >
                      <span className="w-4 shrink-0">{active && <Check size={14} />}</span>
                      <span className="flex-1 min-w-0 truncate">{m.name}</span>
                      <span className="text-xs text-text-muted truncate max-w-[140px] hidden sm:inline">{m.id}</span>
                      {isFree(m.pricing) && (
                        <span className="text-2xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium shrink-0">Free</span>
                      )}
                      {!isFree(m.pricing) && m.pricing && (
                        <span className="text-2xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-medium shrink-0">{formatPrice(m.pricing)}</span>
                      )}
                      {m.context_length && (
                        <span className="text-2xs px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted shrink-0">{formatContext(m.context_length)}</span>
                      )}
                      {getModelCapabilities(m).filter(c => c !== 'text').map(c => (
                        <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${CAPABILITY_COLORS[c]}`}>{CAPABILITY_LABELS[c]}</span>
                      ))}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
