import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download, FileText, Link2, RefreshCcw, Scissors, Image, StopCircle, Video,
  Cookie, Plus, Trash2, FolderOpen, ChevronDown, ChevronRight, Loader2,
  ListOrdered, CheckCircle2,
} from 'lucide-react'
import { Input } from '../common/Input'
import { Button } from '../common/Button'
import { Checkbox } from '../common/Checkbox'
import type { VideoInfo, VideoFormat, CookieEntry, DownloadOptions, DownloadProgress, PlaylistInfo } from '@shared/types/downloader'
import styles from './DownloaderPage.module.css'

type StatusTone = 'idle' | 'fetching' | 'ready' | 'running' | 'done' | 'error'
type DownloadMode = 'single' | 'multi'
type QueueStatus = 'queued' | 'running' | 'done' | 'error' | 'stopped'

type QueueItem = {
  id: string
  url: string
  status: QueueStatus
  title?: string
  outputDir?: string
  error?: string
  progress?: DownloadProgress | null
}

const api = () => (window as any).electronAPI?.downloader

// ─── Format selector ────────────────────────────────────────────────────────
function formatSize(bytes?: number): string {
  if (!bytes) return ''
  return ` ~${formatBytes(bytes)}`
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return ''
  const kb = value / 1024
  const mb = kb / 1024
  const gb = mb / 1024
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  if (mb >= 1) return `${mb.toFixed(2)} MB`
  if (kb >= 1) return `${kb.toFixed(1)} KB`
  return `${Math.round(value)} B`
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function resolveEmbedUrl(rawUrl: string): { provider?: 'youtube' | 'bilibili'; embedUrl?: string } {
  const trimmed = rawUrl.trim()
  if (!trimmed || !trimmed.startsWith('http')) return {}
  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const videoId = parsed.pathname.slice(1)
      return videoId ? { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0` } : {}
    }
    if (host.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v') || parsed.pathname.split('/').pop()
      return videoId ? { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0` } : {}
    }
    if (host.includes('bilibili.com')) {
      const match = parsed.pathname.match(/\/video\/([a-zA-Z0-9]+)/)
      if (match?.[1]) {
        return { provider: 'bilibili', embedUrl: `https://player.bilibili.com/player.html?bvid=${match[1]}&autoplay=0` }
      }
    }
  } catch {
    return {}
  }
  return {}
}

function parseUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('http'))
}

function extractVideoId(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      return parsed.pathname.slice(1) || undefined
    }
    if (host.includes('youtube.com')) {
      return parsed.searchParams.get('v') || parsed.pathname.split('/').pop() || undefined
    }
    if (host.includes('bilibili.com')) {
      const match = parsed.pathname.match(/\/video\/([a-zA-Z0-9]+)/)
      return match?.[1]
    }
  } catch {
    return undefined
  }
  return undefined
}

function buildSubfolderName(title?: string, id?: string): string {
  if (title && id) return `${title} [${id}]`
  if (title) return title
  if (id) return `video_${id}`
  return `video_${Date.now()}`
}

// ─── Cookie Manager Dialog ───────────────────────────────────────────────────
function CookieManager({ onClose }: { onClose: () => void }) {
  const [cookies, setCookies] = useState<CookieEntry[]>([])
  const [form, setForm] = useState({ domain: '', label: '', content: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api().getCookies().then((r: any) => r.success && setCookies(r.data ?? []))
  }, [])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result)
      setForm(prev => ({ ...prev, content: text, label: prev.label || file.name }))
    }
    reader.readAsText(file)
  }

  const handleSave = async () => {
    if (!form.domain.trim() || !form.content.trim()) {
      setError('Cần nhập domain và nội dung cookie.')
      return
    }
    setSaving(true); setError(null)
    const res = await api().saveCookie(form)
    setSaving(false)
    if (res.success) {
      const list = await api().getCookies()
      if (list.success) setCookies(list.data ?? [])
      setForm({ domain: '', label: '', content: '' })
      if (fileRef.current) fileRef.current.value = ''
    } else {
      setError(res.error || 'Lỗi lưu cookie')
    }
  }

  const handleDelete = async (id: string) => {
    await api().deleteCookie(id)
    setCookies(prev => prev.filter(c => c.id !== id))
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalCard}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <Cookie size={16} className={styles.iconWarning} /> Quản lý Cookie
          </div>
          <button onClick={onClose} className={styles.modalClose}>✕</button>
        </div>

        {/* Existing cookies */}
        {cookies.length > 0 && (
          <div className={styles.cookieList}>
            {cookies.map(c => (
              <div key={c.id} className={styles.cookieItem}>
                <div>
                  <span className={styles.cookieDomain}>{c.domain}</span>
                  {c.label && <span className={styles.cookieLabel}>— {c.label}</span>}
                </div>
                <button onClick={() => handleDelete(c.id)} className={styles.cookieDelete}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new */}
        <div className={styles.newCookieBox}>
          <div className={styles.newCookieTitle}>Thêm cookie mới</div>
          <Input
            placeholder="domain: bilibili.com"
            value={form.domain}
            onChange={e => setForm(p => ({ ...p, domain: e.target.value }))}
          />
          <Input
            placeholder="Tên gợi nhớ (không bắt buộc)"
            value={form.label}
            onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
          />
          <div className={styles.fileRow}>
            <input ref={fileRef} type="file" accept=".txt" className={styles.hiddenInput} onChange={handleFile} />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              <FileText size={13} /> Chọn file .txt
            </Button>
            {form.content && <span className={styles.fileLoaded}>✓ Đã nạp nội dung</span>}
          </div>
          {!form.content && (
            <textarea
              className={styles.cookieTextarea}
              rows={3}
              placeholder="Hoặc dán nội dung Netscape cookie..."
              value={form.content}
              onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
            />
          )}
          {error && <p className={styles.errorText}>{error}</p>}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={13} className={styles.spin} /> : <Plus size={13} />}
            Lưu cookie
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────
export const DownloaderPage = () => {
  const [mode, setMode] = useState<DownloadMode>('single')
  const [url, setUrl] = useState('')
  const [multiText, setMultiText] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [cookieFoundDomain, setCookieFoundDomain] = useState<string | null>(null)
  const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null)
  const [playlistError, setPlaylistError] = useState<string | null>(null)
  const [isCheckingPlaylist, setIsCheckingPlaylist] = useState(false)
  const [previewDirectUrl, setPreviewDirectUrl] = useState('')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const lastPreviewUrlRef = useRef<string>('')

  // Download type toggles
  const [downloadVideo, setDownloadVideo] = useState(true)
  const [downloadSubtitle, setDownloadSubtitle] = useState(false)
  const [downloadThumbnail, setDownloadThumbnail] = useState(false)
  const [allowPlaylist, setAllowPlaylist] = useState(false)
  const [downloadAllSubs, setDownloadAllSubs] = useState(false)
  const [manualSubLangs, setManualSubLangs] = useState('')
  const [skipDanmakuConvert, setSkipDanmakuConvert] = useState(true)

  // Options (populated from fetchInfo)
  const [selectedFormatId, setSelectedFormatId] = useState<string>('')
  const [selectedSubLangs, setSelectedSubLangs] = useState<string[]>([])
  const [convertSubs, setConvertSubs] = useState('srt')

  // Cookie
  const [useCookie, setUseCookie] = useState(true)
  const [showCookieManager, setShowCookieManager] = useState(false)

  // Output
  const [outputDir, setOutputDir] = useState('')

  // Download state
  const [status, setStatus] = useState<StatusTone>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [progressInfo, setProgressInfo] = useState<DownloadProgress | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null)
  const stopRequestedRef = useRef(false)
  const [lastResolvedOutputDir, setLastResolvedOutputDir] = useState<string>('')

  // Get default output dir on mount
  useEffect(() => {
    api()?.getDefaultOutputDir().then((dir: string) => dir && setOutputDir(dir))
  }, [])

  // Subscribe to yt-dlp events
  useEffect(() => {
    const unsubLog = api()?.onLog((line: string) =>
      setLogs(prev => [...prev.slice(-300), line])
    )
    const unsubProg = api()?.onProgress((p: any) => {
      setProgressInfo(p)
      if (mode === 'single' && !stopRequestedRef.current) {
        if (p.stage === 'done') setStatus('done')
        if (p.stage === 'error') setStatus('error')
      }
      if (activeQueueId) {
        setQueue(prev => prev.map(item => (
          item.id === activeQueueId ? { ...item, progress: p } : item
        )))
      }
    })
    return () => { unsubLog?.(); unsubProg?.() }
  }, [activeQueueId, mode])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // ── Debounced fetchInfo on URL change ──
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fetchInfoForUrl = useCallback((newUrl: string) => {
    setVideoInfo(null)
    setFetchError(null)
    setCookieFoundDomain(null)
    setPlaylistInfo(null)
    setPlaylistError(null)
    clearTimeout(fetchTimer.current)
    const trimmed = newUrl.trim()
    if (!trimmed || !trimmed.startsWith('http')) return

    fetchTimer.current = setTimeout(async () => {
      setIsFetching(true)
      setStatus('fetching')
      try {
        const res = await api().fetchInfo({ url: trimmed, allowPlaylist: false })
        if (res.success && res.data) {
          setVideoInfo(res.data)
          setCookieFoundDomain(res.cookieDomain ?? null)
          // Pre-select best format
          const best = res.data.formats[0]
          if (best) setSelectedFormatId(best.id)
          setStatus('ready')
        } else {
          setFetchError(res.error || 'Không lấy được thông tin video')
          setStatus('error')
        }
      } catch (e: any) {
        setFetchError(e.message)
        setStatus('error')
      } finally {
        setIsFetching(false)
      }
    }, 900)
  }, [])

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl)
    fetchInfoForUrl(newUrl)
  }

  const handlePreviewUrlChange = (newUrl: string) => {
    setPreviewUrl(newUrl)
    fetchInfoForUrl(newUrl)
  }

  const loadPreviewUrl = useCallback(async (targetUrl: string) => {
    if (!targetUrl || !targetUrl.startsWith('http')) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewDirectUrl('')
    try {
      const res = await api().fetchPreview(targetUrl)
      if (res.success && res.data) {
        setPreviewDirectUrl(res.data)
      } else {
        setPreviewError(res.error || 'Không lấy được preview URL')
      }
    } catch (e: any) {
      setPreviewError(e.message)
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        if (mode === 'single') {
          handleUrlChange(text)
        } else {
          setMultiText(prev => prev ? `${prev}\n${text}` : text)
        }
      }
    } catch { /* ignore */ }
  }

  const multiUrls = useMemo(() => parseUrls(multiText), [multiText])

  useEffect(() => {
    if (mode !== 'multi') return
    if (!previewUrl || !multiUrls.includes(previewUrl)) {
      const next = multiUrls[0] || ''
      setPreviewUrl(next)
      if (next) {
        fetchInfoForUrl(next)
      } else {
        setVideoInfo(null)
        setFetchError(null)
        setCookieFoundDomain(null)
      }
    }
  }, [mode, multiUrls, previewUrl, fetchInfoForUrl])

  const allLangs = useMemo(() => {
    if (!videoInfo) return []
    const langs = new Set([
      ...Object.keys(videoInfo.subtitles),
      ...Object.keys(videoInfo.autoSubtitles),
    ])
    return Array.from(langs).sort()
  }, [videoInfo])

  const resolvedSubLangs = useMemo(() => {
    if (!downloadSubtitle) return []
    if (downloadAllSubs) return ['all']
    if (allLangs.length === 0) {
      const manual = manualSubLangs
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      return manual.length > 0 ? manual : ['all']
    }
    return selectedSubLangs.length > 0 ? selectedSubLangs : ['all']
  }, [downloadSubtitle, downloadAllSubs, allLangs.length, manualSubLangs, selectedSubLangs])

  const toggleLang = (lang: string) => {
    setSelectedSubLangs(prev =>
      prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
    )
  }

  const activeUrl = mode === 'single' ? url : previewUrl

  const canDownload = (mode === 'single'
    ? url.trim().startsWith('http')
    : multiUrls.length > 0
  ) && (downloadVideo || downloadSubtitle || downloadThumbnail) && status !== 'running'

  const resolveJobOutputDir = useCallback(async (targetUrl: string, info?: VideoInfo | null, playlist?: PlaylistInfo | null) => {
    const baseDir = outputDir || await api().getDefaultOutputDir()
    let rawName = ''

    if (allowPlaylist && playlist && playlist.entryCount > 1) {
      rawName = buildSubfolderName(playlist.title, playlist.id)
    } else {
      const id = info?.id || extractVideoId(targetUrl)
      rawName = buildSubfolderName(info?.title, id)
    }

    return api().resolveOutputSubdir(baseDir, rawName)
  }, [allowPlaylist, outputDir])

  const handleCheckPlaylist = async () => {
    const target = activeUrl.trim()
    if (!target.startsWith('http')) return
    setIsCheckingPlaylist(true)
    setPlaylistError(null)
    setPlaylistInfo(null)
    try {
      const res = await api().checkPlaylist(target)
      if (res.success && res.data) {
        setPlaylistInfo(res.data)
      } else {
        setPlaylistError(res.error || 'Không kiểm tra được playlist')
      }
    } catch (e: any) {
      setPlaylistError(e.message)
    } finally {
      setIsCheckingPlaylist(false)
    }
  }

  const updateQueueItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const handleDownload = useCallback(async () => {
    if (!canDownload) return
    setStatus('running')
    setLogs([])
    setProgressInfo({ percent: 0, stage: 'downloading' })
    setShowLogs(true)
    stopRequestedRef.current = false

    if (mode === 'single') {
      const targetUrl = url.trim()
      const shouldStopAfter = () => stopRequestedRef.current
      let playlistMeta = playlistInfo
      if (allowPlaylist && !playlistMeta) {
        try {
          const resPlaylist = await api().checkPlaylist(targetUrl)
          if (resPlaylist.success && resPlaylist.data && resPlaylist.data.entryCount > 1) {
            playlistMeta = resPlaylist.data
            setPlaylistInfo(resPlaylist.data)
          }
        } catch {
          // ignore playlist check errors
        }
      }
      let resolvedDir = ''
      try {
        resolvedDir = await resolveJobOutputDir(targetUrl, videoInfo, playlistMeta)
        setLastResolvedOutputDir(resolvedDir)
      } catch (e: any) {
        setLogs(prev => [...prev, `ERROR: ${e?.message || 'Không tạo được thư mục lưu'}`])
        setStatus('error')
        return
      }

      const options: DownloadOptions = {
        url: targetUrl,
        outputDir: resolvedDir,
        formatId: downloadVideo ? selectedFormatId || undefined : undefined,
        subtitleLangs: downloadSubtitle ? resolvedSubLangs : undefined,
        convertSubs: downloadSubtitle ? convertSubs : undefined,
        skipDanmakuConvert,
        writeThumbnail: downloadThumbnail,
        useCookie,
        allowPlaylist,
      }

      const res = await api().startDownload(options)
      if (shouldStopAfter()) {
        stopRequestedRef.current = false
        setStatus('idle')
        return
      }
      if (!res.success) {
        setLogs(prev => [...prev, `ERROR: ${res.error}`])
        setStatus('error')
      }
      return
    }

    const urls = multiUrls
    const now = Date.now()
    const newQueue: QueueItem[] = urls.map((u, idx) => ({
      id: `${now}_${idx}`,
      url: u,
      status: 'queued',
    }))
    setQueue(newQueue)
    let hasError = false

    for (const item of newQueue) {
      if (stopRequestedRef.current) break
      setActiveQueueId(item.id)
      updateQueueItem(item.id, { status: 'running', error: undefined })
      setProgressInfo({ percent: 0, stage: 'downloading' })
      setLogs(prev => [...prev, `\n=== Download: ${item.url} ===`])

      let info: VideoInfo | null = null
      try {
        const resInfo = await api().fetchInfo({ url: item.url, allowPlaylist: false })
        if (resInfo.success && resInfo.data) {
          info = resInfo.data
          updateQueueItem(item.id, { title: resInfo.data.title })
        }
      } catch {
        // ignore info errors, still attempt download
      }

      let resolvedDir = ''
      let playlistMeta: PlaylistInfo | null = null
      if (allowPlaylist) {
        try {
          const resPlaylist = await api().checkPlaylist(item.url)
          if (resPlaylist.success && resPlaylist.data && resPlaylist.data.entryCount > 1) {
            playlistMeta = resPlaylist.data
          }
        } catch {
          // ignore playlist check errors
        }
      }
      try {
        resolvedDir = await resolveJobOutputDir(item.url, info, playlistMeta)
        updateQueueItem(item.id, { outputDir: resolvedDir })
      } catch (e: any) {
        updateQueueItem(item.id, { status: 'error', error: e?.message || 'Không tạo được thư mục' })
        hasError = true
        continue
      }

      const options: DownloadOptions = {
        url: item.url,
        outputDir: resolvedDir,
        formatId: downloadVideo ? selectedFormatId || undefined : undefined,
        subtitleLangs: downloadSubtitle ? resolvedSubLangs : undefined,
        convertSubs: downloadSubtitle ? convertSubs : undefined,
        skipDanmakuConvert,
        writeThumbnail: downloadThumbnail,
        useCookie,
        allowPlaylist,
      }

      try {
        const res = await api().startDownload(options)
        if (stopRequestedRef.current) {
          updateQueueItem(item.id, { status: 'stopped' })
          break
        }
        if (!res.success) {
          updateQueueItem(item.id, { status: 'error', error: res.error || 'Download failed' })
          hasError = true
        } else {
          updateQueueItem(item.id, { status: 'done' })
        }
      } catch (e: any) {
        if (stopRequestedRef.current) {
          updateQueueItem(item.id, { status: 'stopped' })
          break
        }
        updateQueueItem(item.id, { status: 'error', error: e?.message || 'Download failed' })
        hasError = true
      }
    }

    setActiveQueueId(null)
    if (stopRequestedRef.current) {
      setStatus('idle')
    } else {
      setStatus(hasError ? 'error' : 'done')
    }
  }, [
    canDownload,
    mode,
    url,
    multiUrls,
    videoInfo,
    playlistInfo,
    downloadVideo,
    downloadSubtitle,
    downloadThumbnail,
    selectedFormatId,
    selectedSubLangs,
    convertSubs,
    useCookie,
    allowPlaylist,
    resolvedSubLangs,
    skipDanmakuConvert,
    resolveJobOutputDir,
    updateQueueItem,
  ])

  const handleStop = () => {
    api().stopDownload()
    stopRequestedRef.current = true
    if (activeQueueId) {
      updateQueueItem(activeQueueId, { status: 'stopped' })
    }
    setStatus('idle')
  }

  const handleClear = () => {
    setUrl(''); setVideoInfo(null); setFetchError(null)
    setCookieFoundDomain(null); setStatus('idle'); setLogs([])
    setProgressInfo(null); setSelectedFormatId(''); setSelectedSubLangs([])
    setDownloadVideo(true); setDownloadSubtitle(false); setDownloadThumbnail(false)
    setAllowPlaylist(false); setPlaylistInfo(null); setPlaylistError(null)
    setQueue([]); setActiveQueueId(null); setMultiText(''); setPreviewUrl('')
    setLastResolvedOutputDir('')
    setIsCheckingPlaylist(false)
    setDownloadAllSubs(false)
    setManualSubLangs('')
    setSkipDanmakuConvert(true)
    setPreviewDirectUrl('')
    setPreviewError(null)
    setPreviewLoading(false)
    lastPreviewUrlRef.current = ''
  }

  const handleOpenDir = () => outputDir && api().openOutputDir(outputDir)

  // ── Status display ──
  const statusLabel = useMemo(() => {
    if (isFetching) return 'Đang lấy thông tin...'
    if (status === 'running') {
      if (mode === 'multi') {
        const idx = queue.findIndex(i => i.id === activeQueueId)
        const total = queue.length || multiUrls.length
        const pos = idx >= 0 ? idx + 1 : 1
        return `Đang tải ${pos}/${total} ${progressInfo?.percent ? `${Math.round(progressInfo.percent)}%` : ''}`
      }
      return `Đang tải... ${progressInfo?.percent ? `${Math.round(progressInfo.percent)}%` : ''}`
    }
    if (status === 'done') return 'Hoàn tất!'
    if (status === 'error') return 'Lỗi'
    if (status === 'ready' && videoInfo) return videoInfo.title.slice(0, 60)
    if (mode === 'multi' && multiUrls.length > 0) return `${multiUrls.length} link sẵn sàng`
    return 'Nhập link để bắt đầu'
  }, [status, isFetching, progressInfo?.percent, videoInfo, mode, queue, activeQueueId, multiUrls.length])

  const statusColor = useMemo(() => {
    if (status === 'running') return styles.statusRunning
    if (status === 'error') return styles.statusError
    if (status === 'done') return styles.statusDone
    if (status === 'ready') return styles.statusReady
    return styles.statusIdle
  }, [status])

  const stageLabel = useMemo(() => {
    const stage = progressInfo?.stage
    if (stage === 'fetching') return 'Đang lấy'
    if (stage === 'downloading') return 'Đang tải'
    if (stage === 'merging') return 'Đang ghép...'
    if (stage === 'done') return 'Hoàn tất'
    if (stage === 'error') return 'Lỗi'
    return status === 'running' ? 'Đang tải' : 'Chờ'
  }, [progressInfo?.stage, status])

  const embedInfo = useMemo(() => resolveEmbedUrl(activeUrl || videoInfo?.webpage_url || ''), [activeUrl, videoInfo?.webpage_url])

  useEffect(() => {
    const target = (activeUrl || '').trim()
    if (!target.startsWith('http')) {
      setPreviewDirectUrl('')
      setPreviewError(null)
      setPreviewLoading(false)
      lastPreviewUrlRef.current = ''
      return
    }
    if (embedInfo.embedUrl) {
      setPreviewDirectUrl('')
      setPreviewError(null)
      setPreviewLoading(false)
      lastPreviewUrlRef.current = ''
      return
    }
    if (lastPreviewUrlRef.current === target) return
    lastPreviewUrlRef.current = target
    loadPreviewUrl(target)
  }, [activeUrl, embedInfo.embedUrl, loadPreviewUrl])

  const handleOpenLink = () => {
    const target = (videoInfo?.webpage_url || activeUrl || '').trim()
    if (target) {
      window.open(target, '_blank')
    }
  }

  return (
    <div className={styles.page}>
      {showCookieManager && <CookieManager onClose={() => setShowCookieManager(false)} />}

      {/* Header */}
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <Download size={18} className={styles.iconAccent} />
          </div>
          <div>
            <h1 className={styles.headerTitle}>Downloader</h1>
            <p className={styles.headerSubtitle}>Tải video, subtitle và thumbnail qua yt-dlp</p>
          </div>
        </div>
        <span className={`${styles.statusBadge} ${statusColor}`}>
          {isFetching ? <span className={styles.statusFetching}><Loader2 size={11} className={styles.spin} />Đang lấy...</span> : statusLabel}
        </span>
      </div>

      <div className={styles.mainGrid}>
        {/* Main Card */}
        <div className={styles.card}>

        {/* URL Input */}
        <div className={styles.urlSection}>
          <div className={styles.urlHeaderRow}>
            <label className={styles.urlLabel}>
              <Link2 size={13} /> Link video
            </label>
            <div className={styles.modeSwitch}>
              <button
                className={`${styles.modeButton} ${mode === 'single' ? styles.modeButtonActive : ''}`}
                onClick={() => setMode('single')}
              >
                Single
              </button>
              <button
                className={`${styles.modeButton} ${mode === 'multi' ? styles.modeButtonActive : ''}`}
                onClick={() => setMode('multi')}
              >
                Multi
              </button>
            </div>
          </div>

          {mode === 'single' ? (
            <div className={styles.urlInputRow}>
              <Input
                value={url}
                onChange={e => handleUrlChange(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=… hoặc bilibili.com/video/…"
              />
              <Button onClick={handlePaste} variant="secondary">Paste</Button>
            </div>
          ) : (
            <div className={styles.urlTextareaRow}>
              <textarea
                className={styles.urlTextarea}
                rows={4}
                value={multiText}
                onChange={e => setMultiText(e.target.value)}
                placeholder="Mỗi dòng 1 link..."
              />
              <div className={styles.urlTextareaMeta}>
                <Button onClick={handlePaste} variant="secondary">Paste</Button>
                <span className={styles.helperTextMuted}>{multiUrls.length} link</span>
              </div>
            </div>
          )}

          {fetchError && <p className={styles.errorText}>{fetchError}</p>}
          {cookieFoundDomain && (
            <p className={styles.warningText}>🍪 Cookie cho <b>{cookieFoundDomain}</b> sẽ được dùng nếu bật</p>
          )}
        </div>

        {/* Output dir */}
        <div className={styles.outputSection}>
          <label className={styles.sectionLabel}>Thư mục lưu</label>
          <div className={styles.outputRow}>
            <Input
              value={outputDir}
              onChange={e => setOutputDir(e.target.value)}
              placeholder="D:\Downloads\..."
            />
            <Button variant="secondary" onClick={handleOpenDir} title="Mở thư mục">
              <FolderOpen size={14} />
            </Button>
          </div>
          {mode === 'single' && lastResolvedOutputDir && (
            <div className={styles.outputActualRow}>
              <span>Thư mục thực tế:</span>
              <span className={styles.monoText}>{lastResolvedOutputDir}</span>
              <Button variant="secondary" onClick={() => api().openOutputDir(lastResolvedOutputDir)}>
                <FolderOpen size={12} />
              </Button>
            </div>
          )}
          {mode === 'multi' && (
            <div className={styles.helperTextMuted}>Mỗi link sẽ lưu vào một thư mục con riêng.</div>
          )}
        </div>

        {mode === 'multi' && (
          <div className={styles.queueSection}>
            <div className={styles.sectionLabel}>Danh sách link</div>
            <div className={styles.queueList}>
              {(queue.length > 0 ? queue : (multiUrls.map((u, idx) => ({
                id: `draft_${idx}`,
                url: u,
                status: 'queued' as QueueStatus,
              })) as QueueItem[])).map(item => {
                const isActive = item.url === previewUrl
                const statusColor = item.status === 'done'
                  ? styles.queueStatusDone
                  : item.status === 'error'
                    ? styles.queueStatusError
                    : item.status === 'running'
                      ? styles.queueStatusRunning
                      : item.status === 'stopped'
                        ? styles.queueStatusStopped
                        : styles.queueStatusQueued

                return (
                  <div key={item.id} className={`${styles.queueItem} ${isActive ? styles.queueItemActive : ''}`}>
                    <div className={styles.queueItemInfo}>
                      <div className={styles.queueItemTitle}>{item.title || item.url}</div>
                      {item.outputDir && <div className={styles.queueItemOutput}>{item.outputDir}</div>}
                      {item.progress?.percent != null && item.status === 'running' && (
                        <div className={styles.queueItemPercent}>{Math.round(item.progress.percent)}%</div>
                      )}
                      {item.error && <div className={styles.queueItemError}>{item.error}</div>}
                    </div>
                    <div className={styles.queueItemActions}>
                      <span className={`${styles.queueStatus} ${statusColor}`}>{item.status}</span>
                      <Button variant="secondary" onClick={() => handlePreviewUrlChange(item.url)} disabled={status === 'running'}>
                        Preview
                      </Button>
                      {item.outputDir && (
                        <Button variant="secondary" onClick={() => api().openOutputDir(item.outputDir!)}>
                          <FolderOpen size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className={styles.sectionDivider} />

        {/* Download types */}
        <div className={styles.downloadTypeSection}>
          <div className={styles.sectionLabel}>Loại tải</div>
          <div className={styles.downloadTypeRow}>
            <Checkbox label="Video" checked={downloadVideo} onChange={setDownloadVideo} />
            <Checkbox label="Subtitles" checked={downloadSubtitle} onChange={setDownloadSubtitle} />
            <Checkbox label="Thumbnail" checked={downloadThumbnail} onChange={setDownloadThumbnail} />
          </div>
        </div>

        {/* Playlist */}
        <div className={styles.subSection}>
          <div className={styles.cookieRow}>
            <Checkbox label="Tải playlist (nếu có)" checked={allowPlaylist} onChange={setAllowPlaylist} />
            <Button
              variant="secondary"
              onClick={handleCheckPlaylist}
              disabled={!activeUrl.trim().startsWith('http') || isCheckingPlaylist || status === 'running'}
            >
              {isCheckingPlaylist ? <Loader2 size={13} className={styles.spin} /> : <ListOrdered size={13} />}
              Kiểm tra playlist
            </Button>
            {playlistInfo && playlistInfo.entryCount > 1 && (
              <span className={styles.successRow}>
                <CheckCircle2 size={12} /> Playlist: {playlistInfo.entryCount} video
              </span>
            )}
          </div>
          {playlistInfo && (
            <div className={styles.playlistInfoBox}>
              <div className={styles.playlistTitle}>{playlistInfo.title}</div>
              {playlistInfo.entries.length > 0 && (
                <div className={styles.playlistEntries}>
                  {playlistInfo.entries.map((e, idx) => (
                    <div key={`${e.id || idx}`} className={styles.playlistEntry}>• {e.title || e.id || e.url || 'item'}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {playlistError && <p className={styles.errorText}>{playlistError}</p>}
        </div>

        {/* Video format (dynamic from fetchInfo) */}
        {downloadVideo && (
          <div className={styles.outputSection}>
            <label className={styles.sectionLabel}>Chất lượng video</label>
            {videoInfo && videoInfo.formats.length > 0 ? (
              <select
                className={styles.selectInput}
                value={selectedFormatId}
                onChange={e => setSelectedFormatId(e.target.value)}
              >
                {videoInfo.formats.map((f: VideoFormat) => (
                  <option key={f.id} value={f.id}>
                    {f.resolution} — {f.ext.toUpperCase()}{f.note ? ` (${f.note})` : ''}{formatSize(f.filesize)}
                  </option>
                ))}
              </select>
            ) : (
              <select className={styles.selectDisabled} disabled>
                <option>{isFetching ? 'Đang tải danh sách...' : 'Nhập link để xem chất lượng'}</option>
              </select>
            )}
          </div>
        )}

        {/* Subtitles (dynamic) */}
        {downloadSubtitle && (
          <div className={styles.subSection}>
            <label className={styles.subHeader}>
              <Scissors size={13} /> Subtitles
            </label>
            <div className={styles.subAllRow}>
              <Checkbox label="Tải tất cả (all)" checked={downloadAllSubs} onChange={setDownloadAllSubs} />
              {downloadAllSubs && (
                <span className={styles.successText}>Sub sẽ tải: all</span>
              )}
            </div>

            {!downloadAllSubs && allLangs.length > 0 ? (
              <div className={styles.subLangsRow}>
                {allLangs.map(lang => (
                  <button
                    key={lang}
                    onClick={() => toggleLang(lang)}
                    className={`${styles.subLangButton} ${selectedSubLangs.includes(lang) ? styles.subLangButtonActive : ''}`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            ) : null}

            {!downloadAllSubs && allLangs.length === 0 && (
              <div className={styles.subManualRow}>
                <Input
                  value={manualSubLangs}
                  onChange={e => setManualSubLangs(e.target.value)}
                  placeholder="vd: vi,en,all"
                />
                <p className={styles.helperTextMuted}>
                  Không lấy được danh sách subtitle. Nhập tay ngôn ngữ để tải.
                </p>
              </div>
            )}

            {allLangs.length === 0 && (
              <p className={styles.helperTextMuted}>{isFetching ? 'Đang tải...' : 'Nhập link để xem subtitle có sẵn'}</p>
            )}
            <div className={styles.subFormatRow}>
              <label className={styles.subFormatLabel}>Định dạng:</label>
              <select
                className={styles.subFormatSelect}
                value={convertSubs}
                onChange={e => setConvertSubs(e.target.value)}
              >
                <option value="srt">srt</option>
                <option value="vtt">vtt</option>
                <option value="ass">ass</option>
              </select>
            </div>
            <div className={styles.subDanmakuRow}>
              <Checkbox
                label="Bỏ qua danmaku khi convert"
                checked={skipDanmakuConvert}
                onChange={setSkipDanmakuConvert}
              />
              {skipDanmakuConvert && (resolvedSubLangs.includes('danmaku') || resolvedSubLangs.includes('all')) && (
                <span className={styles.warningText}>Có danmaku → bỏ convert để tránh lỗi</span>
              )}
            </div>
          </div>
        )}

        {/* Cookie + Actions */}
        <div className={styles.cookieRow}>
          <Checkbox label="Dùng cookie" checked={useCookie} onChange={setUseCookie} />
          <button
            onClick={() => setShowCookieManager(true)}
            className={styles.cookieLink}
          >
            <Cookie size={12} /> Quản lý cookie
          </button>
        </div>

        <div className={styles.actionRow}>
          {status === 'running' ? (
            <Button variant="danger" onClick={handleStop}>
              <StopCircle size={15} /> Dừng
            </Button>
          ) : (
            <Button onClick={handleDownload} disabled={!canDownload}>
              <Download size={15} /> {mode === 'multi' ? 'Download all' : 'Download'}
            </Button>
          )}
          <Button variant="secondary" onClick={handleClear}>
            <RefreshCcw size={15} /> Clear
          </Button>
        </div>

        {/* Progress */}
        <div className={styles.progressCard}>
          <div className={styles.progressHeader}>
            <span className={styles.sectionLabel}>Tiến trình</span>
            <span className={styles.stageLabel}>{stageLabel}</span>
          </div>
          {mode === 'multi' && (
            <div className={styles.progressMeta}>
              Link hiện tại: {activeQueueId ? (queue.findIndex(i => i.id === activeQueueId) + 1) : 0}/{queue.length || multiUrls.length}
            </div>
          )}
          {progressInfo?.currentFile && (
            <div className={styles.helperTextMuted}>
              File: {progressInfo.currentFile}
            </div>
          )}
          <div className={styles.progressBar}>
            <div
              className={styles.progressBarFill}
              style={{ width: `${Math.max(0, Math.min(100, progressInfo?.percent ?? 0))}%` }}
            />
          </div>
          <div className={styles.progressDetailRow}>
            {progressInfo?.percent != null && (
              <span>{Math.round(progressInfo.percent)}%</span>
            )}
            {progressInfo?.downloadedBytes != null && progressInfo?.totalBytes != null && (
              <span>{formatBytes(progressInfo.downloadedBytes)} / {formatBytes(progressInfo.totalBytes)}</span>
            )}
            {progressInfo?.speedBytes
              ? <span>{formatBytes(progressInfo.speedBytes)}/s</span>
              : (progressInfo?.speed ? <span>{progressInfo.speed}</span> : null)}
            {progressInfo?.eta && <span>ETA {progressInfo.eta}</span>}
            {progressInfo?.message && <span>{progressInfo.message}</span>}
          </div>
        </div>

        {/* Logs */}
        {logs.length > 0 && (
          <div className={styles.logsSection}>
            <button
              onClick={() => setShowLogs(p => !p)}
              className={styles.logsToggle}
            >
              {showLogs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Nhật ký ({logs.length} dòng)
            </button>
            {showLogs && (
              <div className={styles.logScroll}>
                {logs.map((l, i) => (
                  <div key={i} className={l.startsWith('ERROR') ? styles.logError : ''}>{l}</div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        )}
        </div>

        {/* Preview Column */}
        <div className={styles.previewColumn}>
          <div className={styles.previewCard}>
            <div className={styles.previewHeader}>
              <Video size={14} /> Preview
            </div>
            {mode === 'multi' && activeUrl && (
              <div className={styles.previewUrl}>{activeUrl}</div>
            )}
            {embedInfo.embedUrl ? (
              <div className={styles.previewEmbedWrap}>
                <iframe
                  src={embedInfo.embedUrl}
                  className={styles.iframeFill}
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Video preview"
                />
              </div>
            ) : (
              <div className={styles.subSection}>
                {previewLoading && (
                  <div className={styles.previewPlaceholder}>
                    <Loader2 size={14} className={styles.spin} />
                    <span>Đang tải preview...</span>
                  </div>
                )}
                {!previewLoading && previewDirectUrl && (
                  <video
                    className={styles.previewEmbedWrap}
                    src={previewDirectUrl}
                    controls
                    preload="metadata"
                  />
                )}
                {!previewLoading && !previewDirectUrl && (
                  <div className={styles.previewPlaceholder}>
                    <span>{previewError ? 'Không thể preview video' : 'Không hỗ trợ nhúng preview'}</span>
                    {previewError && <span className={styles.errorText}>{previewError}</span>}
                    <div className={styles.actionRow}>
                      <Button variant="secondary" onClick={() => loadPreviewUrl(activeUrl)} disabled={!activeUrl.trim()}>
                        Thử lại preview
                      </Button>
                      <Button variant="secondary" onClick={handleOpenLink} disabled={!activeUrl.trim()}>
                        Mở link
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {videoInfo && (
              <div className={styles.previewInfo}>
                <div className={styles.previewTitle}>{videoInfo.title}</div>
                {videoInfo.uploader && <div>{videoInfo.uploader}</div>}
                {videoInfo.duration && <div>{formatDuration(videoInfo.duration)}</div>}
              </div>
            )}
          </div>

          {downloadThumbnail && videoInfo?.thumbnail && (
            <div className={styles.thumbnailCard}>
              <div className={styles.previewHeader}>
                <Image size={14} /> Thumbnail
              </div>
              <img
                src={videoInfo.thumbnail}
                alt="thumbnail"
                className={styles.thumbnailImage}
              />
              <div className={styles.helperTextMuted}>Thumbnail sẽ được tải</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
