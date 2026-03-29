import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download, FileText, Link2, RefreshCcw, Scissors, StopCircle, Video,
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

function isH264Codec(codec?: string | null): boolean {
  if (!codec) return false
  const value = codec.toLowerCase()
  return value.startsWith('avc') || value.startsWith('h264')
}

function isAacCodec(codec?: string | null): boolean {
  if (!codec) return false
  const value = codec.toLowerCase()
  return value.startsWith('mp4a') || value === 'aac'
}

function getAudioCodecTag(codec?: string | null): string | null {
  if (!codec) return null
  const value = codec.toLowerCase()
  if (value.includes('mp4a') || value === 'aac') return 'AAC'
  if (value.includes('opus')) return 'OPUS'
  if (value.includes('vorbis')) return 'VORBIS'
  if (value.includes('mp3')) return 'MP3'
  if (value.includes('flac')) return 'FLAC'
  if (value.includes('alac')) return 'ALAC'
  return null
}

function getVideoCodecTag(codec?: string | null): string | null {
  if (!codec) return null
  const value = codec.toLowerCase()
  if (value.includes('av01') || value.includes('av1')) return 'AV1'
  if (value.includes('vp9')) return 'VP9'
  if (value.includes('hevc') || value.includes('hev') || value.includes('hvc1') || value.includes('h265') || value.includes('h.265')) {
    return 'HEVC'
  }
  if (value.startsWith('avc') || value.includes('h264') || value.includes('h.264')) return 'H264'
  return null
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
  const [previewTab, setPreviewTab] = useState<'video' | 'thumbnail'>('video')
  const lastPreviewUrlRef = useRef<string>('')

  // Download type toggles
  const [downloadVideo, setDownloadVideo] = useState(true)
  const [downloadSubtitle, setDownloadSubtitle] = useState(true)
  const [downloadThumbnail, setDownloadThumbnail] = useState(false)
  const [mergeAudio, setMergeAudio] = useState(true)
  const [downloadSeparateAudio, setDownloadSeparateAudio] = useState(false)
  const [allowPlaylist, setAllowPlaylist] = useState(false)
  const [downloadAllSubs, setDownloadAllSubs] = useState(true)
  const [manualSubLangs, setManualSubLangs] = useState('')
  const [skipDanmakuConvert, setSkipDanmakuConvert] = useState(true)

  // Options (populated from fetchInfo)
  const [selectedFormatId, setSelectedFormatId] = useState<string>('')
  const [selectedAudioFormatId, setSelectedAudioFormatId] = useState<string>('')
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
  const logScrollRef = useRef<HTMLDivElement>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null)
  const stopRequestedRef = useRef(false)
  const [lastResolvedOutputDir, setLastResolvedOutputDir] = useState<string>('')

  // Get output dir on mount (from settings or default)
  useEffect(() => {
    let cancelled = false
    const loadOutputDir = async () => {
      let resolved = ''
      try {
        const settingsRes = await window.electronAPI.appSettings.getAll()
        if (settingsRes?.success && settingsRes.data && typeof settingsRes.data.downloaderOutputDir === 'string') {
          const trimmed = settingsRes.data.downloaderOutputDir.trim()
          if (trimmed) {
            resolved = trimmed
          }
        }
      } catch (err) {
        console.warn('[Downloader] Không thể đọc downloaderOutputDir:', err)
      }
      if (!resolved) {
        try {
          resolved = await api().getDefaultOutputDir()
        } catch (err) {
          console.warn('[Downloader] Không thể lấy default output dir:', err)
        }
      }
      if (!cancelled) {
        setOutputDir(resolved || '')
      }
    }
    void loadOutputDir()
    return () => {
      cancelled = true
    }
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

  // Log scroll is user-controlled (no auto-scroll)

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
          const nextFormats = res.data.formats.filter((format: VideoFormat) => (
            format.vcodec && format.vcodec !== 'none'
          ))
          const bestH264WithAudio = nextFormats.find((format: VideoFormat) => (
            isH264Codec(format.vcodec) && isAacCodec(format.acodec)
          ))
          const bestH264 = nextFormats.find((format: VideoFormat) => isH264Codec(format.vcodec))
          const bestWithAudio = nextFormats.find((format: VideoFormat) => isAacCodec(format.acodec))
          const best = bestH264WithAudio || bestH264 || bestWithAudio || nextFormats[0]
          setSelectedFormatId(best ? best.id : '')
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

  useEffect(() => {
    if (!downloadThumbnail) {
      setPreviewTab('video')
    }
  }, [downloadThumbnail])

  useEffect(() => {
    if (mergeAudio) {
      setDownloadSeparateAudio(false)
    }
  }, [mergeAudio])

  const allLangs = useMemo(() => {
    if (!videoInfo) return []
    const langs = new Set([
      ...Object.keys(videoInfo.subtitles),
      ...Object.keys(videoInfo.autoSubtitles),
    ])
    return Array.from(langs).sort()
  }, [videoInfo])

  const availableFormats = useMemo(() => {
    if (!videoInfo) return []
    return videoInfo.formats.filter((format) => {
      if (!format.vcodec || format.vcodec === 'none') return false
      return true
    })
  }, [videoInfo])

  const availableAudioFormats = useMemo(() => {
    if (!videoInfo) return []
    return videoInfo.formats
      .filter((format) => format.vcodec === 'none' && format.acodec && format.acodec !== 'none')
      .sort((a, b) => (b.tbr || 0) - (a.tbr || 0))
  }, [videoInfo])

  useEffect(() => {
    if (!downloadVideo) return
    if (!selectedFormatId) return
    const stillValid = availableFormats.some((format) => format.id === selectedFormatId)
    if (!stillValid) {
      setSelectedFormatId('')
    }
  }, [availableFormats, downloadVideo, selectedFormatId])

  useEffect(() => {
    if (!downloadVideo || (!mergeAudio && !downloadSeparateAudio)) {
      if (selectedAudioFormatId) {
        setSelectedAudioFormatId('')
      }
      return
    }
    if (!selectedAudioFormatId) return
    const stillValid = availableAudioFormats.some((format) => format.id === selectedAudioFormatId)
    if (!stillValid) {
      setSelectedAudioFormatId('')
    }
  }, [
    availableAudioFormats,
    downloadSeparateAudio,
    downloadVideo,
    mergeAudio,
    selectedAudioFormatId,
  ])

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
    setDownloadAllSubs(false)
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

      let resolvedFormatId = downloadVideo ? selectedFormatId || undefined : undefined
      let resolvedDownloadSeparateAudio = false
      let resolvedAudioFormatId: string | undefined = undefined
      if (downloadVideo) {
        if (selectedFormatId && videoInfo) {
          const selectedFormat = availableFormats.find((format) => format.id === selectedFormatId)
          if (!selectedFormat) {
            setLogs(prev => [...prev, `[Downloader] Format ${selectedFormatId} không hợp lệ → fallback best H264/AAC`])
            resolvedFormatId = undefined
            if (!mergeAudio && downloadSeparateAudio) {
              resolvedDownloadSeparateAudio = true
            }
          } else if (mergeAudio) {
            if (!selectedAudioFormatId && !isAacCodec(selectedFormat.acodec)) {
              setLogs(prev => [...prev, `[Downloader] Format ${selectedFormatId} → ghép audio AAC`])
              resolvedFormatId = `${selectedFormatId}+bestaudio[acodec^=mp4a]/${selectedFormatId}+bestaudio`
            }
          } else if (downloadSeparateAudio && !isAacCodec(selectedFormat.acodec)) {
            resolvedDownloadSeparateAudio = true
          }
        } else if (!mergeAudio && downloadSeparateAudio) {
          resolvedDownloadSeparateAudio = true
        }
      }
      if (downloadVideo && (mergeAudio || resolvedDownloadSeparateAudio)) {
        if (selectedAudioFormatId) {
          const audioFormat = availableAudioFormats.find((format) => format.id === selectedAudioFormatId)
          if (audioFormat) {
            const tag = getAudioCodecTag(audioFormat.acodec)
            const bitrate = audioFormat.tbr ? `${Math.round(audioFormat.tbr)} kbps` : ''
            setLogs(prev => [
              ...prev,
              `[Downloader] Audio: ${selectedAudioFormatId}${tag ? ` · ${tag}` : ''}${bitrate ? ` · ${bitrate}` : ''}`,
            ])
            resolvedAudioFormatId = selectedAudioFormatId
          } else {
            setLogs(prev => [...prev, `[Downloader] Audio ${selectedAudioFormatId} không hợp lệ → fallback best`])
          }
        } else {
          setLogs(prev => [...prev, '[Downloader] Audio: best'])
        }
      }

      const options: DownloadOptions = {
        url: targetUrl,
        outputDir: resolvedDir,
        formatId: resolvedFormatId,
        audioFormatId: resolvedAudioFormatId,
        mergeAudio,
        downloadSeparateAudio: resolvedDownloadSeparateAudio,
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

      let resolvedFormatId = downloadVideo ? selectedFormatId || undefined : undefined
      let resolvedDownloadSeparateAudio = false
      let resolvedAudioFormatId: string | undefined = undefined
      if (downloadVideo) {
        if (selectedFormatId && info) {
          const itemFormats = info.formats.filter((format) => (
            format.vcodec && format.vcodec !== 'none'
          ))
          const selectedFormat = itemFormats.find((format) => format.id === selectedFormatId)
          if (!selectedFormat) {
            setLogs(prev => [...prev, `[Downloader] Format ${selectedFormatId} không hợp lệ cho link ${item.url} → fallback best H264/AAC`])
            resolvedFormatId = undefined
            if (!mergeAudio && downloadSeparateAudio) {
              resolvedDownloadSeparateAudio = true
            }
          } else if (mergeAudio) {
            if (!selectedAudioFormatId && !isAacCodec(selectedFormat.acodec)) {
              setLogs(prev => [...prev, `[Downloader] Format ${selectedFormatId} → ghép audio AAC`])
              resolvedFormatId = `${selectedFormatId}+bestaudio[acodec^=mp4a]/${selectedFormatId}+bestaudio`
            }
          } else if (downloadSeparateAudio && !isAacCodec(selectedFormat.acodec)) {
            resolvedDownloadSeparateAudio = true
          }
        } else if (!mergeAudio && downloadSeparateAudio) {
          resolvedDownloadSeparateAudio = true
        }
      }
      if (downloadVideo && (mergeAudio || resolvedDownloadSeparateAudio)) {
        if (selectedAudioFormatId) {
          if (info) {
            const itemAudioFormats = info.formats.filter((format) => format.vcodec === 'none' && format.acodec && format.acodec !== 'none')
            const audioFormat = itemAudioFormats.find((format) => format.id === selectedAudioFormatId)
            if (audioFormat) {
              const tag = getAudioCodecTag(audioFormat.acodec)
              const bitrate = audioFormat.tbr ? `${Math.round(audioFormat.tbr)} kbps` : ''
              setLogs(prev => [
                ...prev,
                `[Downloader] Audio: ${selectedAudioFormatId}${tag ? ` · ${tag}` : ''}${bitrate ? ` · ${bitrate}` : ''}`,
              ])
              resolvedAudioFormatId = selectedAudioFormatId
            } else {
              setLogs(prev => [...prev, `[Downloader] Audio ${selectedAudioFormatId} không hợp lệ cho link ${item.url} → fallback best`])
            }
          } else {
            setLogs(prev => [...prev, `[Downloader] Audio ${selectedAudioFormatId} không kiểm tra được → fallback best`])
          }
        } else {
          setLogs(prev => [...prev, '[Downloader] Audio: best'])
        }
      }

      const options: DownloadOptions = {
        url: item.url,
        outputDir: resolvedDir,
        formatId: resolvedFormatId,
        audioFormatId: resolvedAudioFormatId,
        mergeAudio,
        downloadSeparateAudio: resolvedDownloadSeparateAudio,
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
    mergeAudio,
    downloadSeparateAudio,
    selectedFormatId,
    selectedAudioFormatId,
    availableFormats,
    availableAudioFormats,
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
    setProgressInfo(null); setSelectedFormatId(''); setSelectedAudioFormatId(''); setSelectedSubLangs([])
    setDownloadVideo(true); setDownloadSubtitle(false); setDownloadThumbnail(false)
    setMergeAudio(true); setDownloadSeparateAudio(false)
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

  const handleOpenDir = async () => {
    const resolved = outputDir || await api().getDefaultOutputDir()
    if (resolved) {
      api().openOutputDir(resolved)
    }
  }

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
  const hasThumbnailPreview = Boolean(videoInfo?.thumbnail)
  const activePreviewTab = downloadThumbnail ? previewTab : 'video'

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

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.brandBadge}>
            <Download size={16} />
          </div>
          <div>
            <div className={styles.brandTitle}>Downloader</div>
          </div>
        </div>
        <div className={styles.toolbarStatus}>
          <span className={`${styles.statusChip} ${statusColor}`}>
            {isFetching ? <span className={styles.statusFetching}><Loader2 size={11} className={styles.spin} />Đang lấy...</span> : statusLabel}
          </span>
        </div>
        <div className={styles.toolbarActions}>
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
      </div>

      <div className={styles.shell}>
        <div className={styles.leftPane}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}><Link2 size={14} /> Nguồn tải</div>
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
            <div className={styles.panelBody}>
              {mode === 'single' ? (
                <div className={styles.fieldRow}>
                  <Input
                    value={url}
                    onChange={e => handleUrlChange(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=… hoặc bilibili.com/video/…"
                  />
                  <Button onClick={handlePaste} variant="secondary">Paste</Button>
                </div>
              ) : (
                <div className={styles.textareaRow}>
                  <textarea
                    className={styles.urlTextarea}
                    rows={5}
                    value={multiText}
                    onChange={e => setMultiText(e.target.value)}
                    placeholder="Mỗi dòng 1 link..."
                  />
                  <div className={styles.inlineRow}>
                    <Button onClick={handlePaste} variant="secondary">Paste</Button>
                    <span className={styles.helperTextMuted}>{multiUrls.length} link</span>
                  </div>
                </div>
              )}
              {fetchError && <p className={styles.errorText}>{fetchError}</p>}
              {cookieFoundDomain && (
                <p className={styles.warningText}>Cookie cho <b>{cookieFoundDomain}</b> sẽ được dùng nếu bật</p>
              )}
            </div>
          </div>

          {mode === 'multi' && (
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitle}><ListOrdered size={14} /> Queue</div>
                <span className={styles.panelMeta}>{multiUrls.length} link</span>
              </div>
              <div className={styles.queueTable}>
                <div className={styles.queueHeader}>
                  <span>Trạng thái</span>
                  <span>Video</span>
                  <span>Thư mục</span>
                  <span>Hành động</span>
                </div>
                <div className={styles.queueBody}>
                  {(queue.length > 0 ? queue : (multiUrls.map((u, idx) => ({
                    id: `draft_${idx}`,
                    url: u,
                    status: 'queued' as QueueStatus,
                  })) as QueueItem[])).map(item => {
                    const isActive = item.url === previewUrl
                    const statusTone = item.status === 'done'
                      ? styles.queueStatusDone
                      : item.status === 'error'
                        ? styles.queueStatusError
                        : item.status === 'running'
                          ? styles.queueStatusRunning
                          : item.status === 'stopped'
                            ? styles.queueStatusStopped
                            : styles.queueStatusQueued

                    return (
                      <div key={item.id} className={`${styles.queueRow} ${isActive ? styles.queueRowActive : ''}`}>
                        <span className={`${styles.queueStatus} ${statusTone}`}>{item.status}</span>
                        <div className={styles.queueMain}>
                          <div className={styles.queueTitle}>{item.title || item.url}</div>
                          {item.progress?.percent != null && item.status === 'running' && (
                            <div className={styles.queueProgress}>{Math.round(item.progress.percent)}%</div>
                          )}
                          {item.error && <div className={styles.queueError}>{item.error}</div>}
                        </div>
                        <div className={styles.queueOutput}>{item.outputDir || '—'}</div>
                        <div className={styles.queueActions}>
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
            </div>
          )}

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}><Cookie size={14} /> Cookie</div>
            </div>
            <div className={styles.panelBody}>
              <div className={styles.inlineRow}>
                <Checkbox label="Dùng cookie" checked={useCookie} onChange={setUseCookie} />
                <button
                  onClick={() => setShowCookieManager(true)}
                  className={styles.linkButton}
                >
                  Quản lý cookie
                </button>
              </div>
              {cookieFoundDomain && (
                <p className={styles.helperTextMuted}>Đã phát hiện cookie cho {cookieFoundDomain}</p>
              )}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}><FolderOpen size={14} /> Thư mục lưu</div>
            </div>
            <div className={styles.panelBody}>
              <div className={styles.outputActualRow}>
                <span className={styles.helperTextMuted}>Đang dùng:</span>
                <span className={styles.monoText}>{outputDir || 'Mặc định hệ thống'}</span>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void handleOpenDir()
                  }}
                  title="Mở thư mục"
                >
                  <FolderOpen size={12} />
                </Button>
              </div>
              {mode === 'single' && lastResolvedOutputDir && (
                <div className={styles.outputActualRow}>
                  <span className={styles.helperTextMuted}>Thư mục thực tế:</span>
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
          </div>
        </div>

        <div className={styles.centerPane}>
          <div className={`${styles.panel} ${styles.optionPanel}`}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}><Download size={14} /> Tuỳ chọn tải</div>
              <span className={styles.panelMeta}>{mode === 'multi' ? `${multiUrls.length} link` : 'Single'}</span>
            </div>
            <div className={`${styles.panelBody} ${styles.optionPanelBody}`}>
              <div className={styles.fieldGroup}>
                <div className={styles.fieldLabel}>Loại tải</div>
                <div className={styles.toggleRow}>
                  <Checkbox label="Video" checked={downloadVideo} onChange={setDownloadVideo} />
                  <Checkbox label="Subtitles" checked={downloadSubtitle} onChange={setDownloadSubtitle} />
                  <Checkbox label="Thumbnail" checked={downloadThumbnail} onChange={setDownloadThumbnail} />
                  <Checkbox label="Ghép audio" checked={mergeAudio} onChange={setMergeAudio} />
                </div>
                {!mergeAudio && (
                  <div className={styles.inlineRow}>
                    <Checkbox label="Tải audio riêng" checked={downloadSeparateAudio} onChange={setDownloadSeparateAudio} />
                  </div>
                )}
              </div>

              <div className={styles.fieldGroup}>
                <div className={styles.inlineRow}>
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
                    <span className={styles.successText}>
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

              {downloadVideo && (
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Chất lượng video</label>
                  {videoInfo ? (
                    <select
                      className={styles.selectInput}
                      value={selectedFormatId}
                      onChange={e => setSelectedFormatId(e.target.value)}
                    >
                      <option value="">Tự động (best)</option>
                      {availableFormats.map((f: VideoFormat) => {
                        const needsAudio = !isAacCodec(f.acodec)
                        const note = mergeAudio
                          ? (needsAudio ? ' • sẽ ghép audio' : '')
                          : (downloadSeparateAudio && needsAudio ? ' • sẽ tải audio riêng' : '')
                        const codecTag = getVideoCodecTag(f.vcodec)
                        return (
                        <option key={f.id} value={f.id}>
                          {f.resolution} — {f.ext.toUpperCase()}{f.note ? ` (${f.note})` : ''}{formatSize(f.filesize)}
                          {codecTag ? ` · ${codecTag}` : ''}{note}
                        </option>
                        )
                      })}
                    </select>
                  ) : (
                    <select className={styles.selectDisabled} disabled>
                      <option>{isFetching ? 'Đang tải danh sách...' : 'Nhập link để xem chất lượng'}</option>
                    </select>
                  )}
                </div>
              )}

              {downloadVideo && (mergeAudio || downloadSeparateAudio) && (
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    {mergeAudio ? 'Audio để ghép' : 'Audio để tải riêng'}
                  </label>
                  {videoInfo ? (
                    <select
                      className={styles.selectInput}
                      value={selectedAudioFormatId}
                      onChange={e => setSelectedAudioFormatId(e.target.value)}
                    >
                      <option value="">Tự động (best audio)</option>
                      {availableAudioFormats.map((f: VideoFormat) => {
                        const codecTag = getAudioCodecTag(f.acodec)
                        const bitrate = f.tbr ? `${Math.round(f.tbr)} kbps` : ''
                        return (
                          <option key={f.id} value={f.id}>
                            {f.ext.toUpperCase()}
                            {codecTag ? ` · ${codecTag}` : ''}
                            {bitrate ? ` · ${bitrate}` : ''}
                            {formatSize(f.filesize)}
                          </option>
                        )
                      })}
                    </select>
                  ) : (
                    <select className={styles.selectDisabled} disabled>
                      <option>{isFetching ? 'Đang tải danh sách...' : 'Nhập link để xem audio'}</option>
                    </select>
                  )}
                </div>
              )}

              {downloadSubtitle && (
                <div className={styles.fieldGroup}>
                  <div className={styles.inlineRow}>
                    <Checkbox label="Tải tất cả" checked={downloadAllSubs} onChange={setDownloadAllSubs} />
                    {downloadAllSubs && (
                      <span className={styles.successText}>Sub sẽ tải: all</span>
                    )}
                  </div>

                  {allLangs.length > 0 ? (
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
                        Không có danh sách. Nhập tay để tải.
                      </p>
                    </div>
                  )}

                  {allLangs.length === 0 && (
                    <p className={styles.helperTextMuted}>{isFetching ? 'Đang tải...' : 'Nhập link để xem subs'}</p>
                  )}
                  <div className={styles.subFormatRow}>
                    <label className={styles.subFormatLabel}>Định dạng</label>
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
                  <div className={styles.inlineRow}>
                    <Checkbox
                      label="Bỏ qua danmaku khi convert"
                      checked={skipDanmakuConvert}
                      onChange={setSkipDanmakuConvert}
                    />
                    {skipDanmakuConvert && (resolvedSubLangs.includes('danmaku') || resolvedSubLangs.includes('all')) && (
                      <span className={styles.warningText}>Có danmaku → tắt convert</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}><Loader2 size={14} /> Tiến trình</div>
              <span className={styles.stageLabel}>{stageLabel}</span>
            </div>
            <div className={styles.panelBody}>
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
          </div>

        </div>

        <div className={styles.rightPane}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}><Video size={14} /> Preview</div>
              {downloadThumbnail && (
                <div className={styles.tabRow}>
                  <button
                    className={`${styles.tabButton} ${activePreviewTab === 'video' ? styles.tabButtonActive : ''}`}
                    onClick={() => setPreviewTab('video')}
                  >
                    Video
                  </button>
                  <button
                    className={`${styles.tabButton} ${activePreviewTab === 'thumbnail' ? styles.tabButtonActive : ''} ${!hasThumbnailPreview ? styles.tabButtonDisabled : ''}`}
                    onClick={() => setPreviewTab('thumbnail')}
                    disabled={!hasThumbnailPreview}
                  >
                    Thumbnail
                  </button>
                </div>
              )}
            </div>
            <div className={styles.panelBody}>
              {mode === 'multi' && activeUrl && (
                <div className={styles.helperTextMuted}>{activeUrl}</div>
              )}
              {activePreviewTab === 'thumbnail' ? (
                hasThumbnailPreview ? (
                  <img
                    src={videoInfo?.thumbnail}
                    alt="thumbnail"
                    className={styles.thumbnailImage}
                  />
                ) : (
                  <div className={styles.previewPlaceholder}>Chưa có thumbnail để hiển thị</div>
                )
              ) : (
                <>
                  {embedInfo.embedUrl ? (
                    <div className={styles.previewFrame}>
                      <iframe
                        src={embedInfo.embedUrl}
                        className={styles.iframeFill}
                        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title="Video preview"
                      />
                    </div>
                  ) : (
                    <>
                      {previewLoading && (
                        <div className={styles.previewPlaceholder}>
                          <Loader2 size={14} className={styles.spin} />
                          <span>Đang tải preview...</span>
                        </div>
                      )}
                      {!previewLoading && previewDirectUrl && (
                        <video
                          className={styles.previewFrame}
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
                    </>
                  )}
                </>
              )}

              <div className={styles.metaGrid}>
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Title</span>
                  <span className={styles.metaValue}>{videoInfo?.title || '—'}</span>
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Uploader</span>
                  <span className={styles.metaValue}>{videoInfo?.uploader || '—'}</span>
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Duration</span>
                  <span className={styles.metaValue}>{videoInfo?.duration ? formatDuration(videoInfo.duration) : '—'}</span>
                </div>
              </div>
              {downloadThumbnail && (
                <div className={styles.helperTextMuted}>Thumbnail sẽ được tải khi chạy</div>
              )}
            </div>
          </div>
          {logs.length > 0 && (
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitle}>Nhật ký</div>
                <button
                  onClick={() => setShowLogs(p => !p)}
                  className={styles.linkButton}
                >
                  {showLogs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {showLogs ? 'Ẩn log' : `Xem log (${logs.length})`}
                </button>
              </div>
              {showLogs && (
                <div className={styles.logScroll} ref={logScrollRef}>
                  {logs.map((l, i) => (
                    <div key={i} className={l.startsWith('ERROR') ? styles.logError : ''}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
