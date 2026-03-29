import { spawn, spawnSync, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { existsSync } from 'fs'
import type {
  VideoInfo,
  VideoFormat,
  DownloadOptions,
  DownloadProgress,
  PlaylistInfo,
  DownloadNoLogoStrategy,
} from '../../../shared/types/downloader'
import { getYtDlpPath } from '../../utils/ytDlpPath'
import { getFFmpegPath } from '../../utils/ffmpegPath'
import { getAria2cPath } from '../../utils/aria2cPath'

// Try to resolve yt-dlp executable
function findYtDlp(): string {
  const bundledPath = getYtDlpPath()
  if (bundledPath && existsSync(bundledPath)) {
    return bundledPath
  }

  // Check common names on PATH
  const candidates = process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp']
  for (const name of candidates) {
    try {
      // Quick spawn test
      const result = require('child_process').spawnSync(name, ['--version'], { encoding: 'utf8', timeout: 5000 })
      if (result.status === 0) return name
    } catch {
      // continue
    }
  }
  return bundledPath || 'yt-dlp' // fallback, will error at runtime with a clear message
}

function findAria2c(): string {
  const bundledPath = getAria2cPath()
  if (bundledPath && existsSync(bundledPath)) {
    return bundledPath
  }

  const candidates = process.platform === 'win32' ? ['aria2c.exe', 'aria2c'] : ['aria2c']
  for (const name of candidates) {
    try {
      const result = require('child_process').spawnSync(name, ['--version'], { encoding: 'utf8', timeout: 5000 })
      if (result.status === 0) return name
    } catch {
      // continue
    }
  }
  return bundledPath || 'aria2c'
}

function parseSizeToBytes(value: string, unit: string): number | null {
  const num = Number.parseFloat(value)
  if (!Number.isFinite(num)) return null
  const normalized = unit.toLowerCase()
  const unitMap: Record<string, number> = {
    b: 1,
    kb: 1_000,
    mb: 1_000_000,
    gb: 1_000_000_000,
    kib: 1024,
    mib: 1024 * 1024,
    gib: 1024 * 1024 * 1024,
  }
  const factor = unitMap[normalized]
  if (!factor) return null
  return num * factor
}

function inferFileType(fileName: string): DownloadProgress['currentType'] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.srt') || lower.endsWith('.vtt') || lower.endsWith('.ass') || lower.endsWith('.xml')) {
    return 'subtitle'
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
    return 'thumbnail'
  }
  if (lower.endsWith('.m4a') || lower.endsWith('.mp3') || lower.endsWith('.aac') || lower.endsWith('.flac')) {
    return 'audio'
  }
  if (lower.endsWith('.mp4') || lower.endsWith('.mkv') || lower.endsWith('.webm') || lower.endsWith('.mov')) {
    return 'video'
  }
  return 'other'
}

function parseProgress(line: string): Partial<DownloadProgress> | null {
  if (line.includes('[download]') && line.lastIndexOf('[download]') > 0) {
    line = line.slice(line.lastIndexOf('[download]'))
  }

  const destinationMatch = line.match(/\[download\]\s+Destination:\s+(.+)/i)
  if (destinationMatch) {
    const fileName = destinationMatch[1].trim()
    return {
      percent: 0,
      stage: 'downloading',
      message: `Tải: ${fileName}`,
      currentFile: fileName,
      currentType: inferFileType(fileName),
    }
  }

  const subtitleMatch = line.match(/\[info\]\s+Writing video subtitles to:\s+(.+)/i)
  if (subtitleMatch) {
    const fileName = subtitleMatch[1].trim()
    return {
      percent: 0,
      stage: 'downloading',
      message: `Subtitles: ${fileName}`,
      currentFile: fileName,
      currentType: 'subtitle',
    }
  }

  const thumbMatch = line.match(/\[info\]\s+Writing video thumbnail to:\s+(.+)/i)
  if (thumbMatch) {
    const fileName = thumbMatch[1].trim()
    return {
      percent: 0,
      stage: 'downloading',
      message: `Thumbnail: ${fileName}`,
      currentFile: fileName,
      currentType: 'thumbnail',
    }
  }

  // e.g. [download]  45.3% of   25.65MiB at    9.24MiB/s ETA 00:01
  const match = line.match(/\[download\]\s+([\d.]+)%.*?of\s+~?\s*([\d.]+)\s*([KMG]?i?B).*?at\s+([\d.]+)\s*([KMG]?i?B)\/s.*?ETA\s+(\S+)/i)
  if (match) {
    const percent = parseFloat(match[1])
    const totalBytes = parseSizeToBytes(match[2], match[3]) ?? undefined
    const speedBytes = parseSizeToBytes(match[4], match[5]) ?? undefined
    const downloadedBytes = totalBytes != null ? (totalBytes * percent) / 100 : undefined
    return {
      percent,
      speed: `${match[4]}${match[5]}/s`,
      speedBytes,
      totalBytes,
      downloadedBytes,
      eta: match[6],
      stage: 'downloading',
    }
  }

  const matchNoPercent = line.match(/\[download\]\s+([\d.]+)\s*([KMG]?i?B)\s+at\s+([\d.]+)\s*([KMG]?i?B)\/s/i)
  if (matchNoPercent) {
    const downloadedBytes = parseSizeToBytes(matchNoPercent[1], matchNoPercent[2]) ?? undefined
    const speedBytes = parseSizeToBytes(matchNoPercent[3], matchNoPercent[4]) ?? undefined
    return {
      percent: undefined,
      downloadedBytes,
      speedBytes,
      speed: `${matchNoPercent[3]}${matchNoPercent[4]}/s`,
      stage: 'downloading',
    }
  }

  const matchNoSpeed = line.match(/\[download\]\s+([\d.]+)%.*?of\s+~?\s*([\d.]+)\s*([KMG]?i?B).*?in\s+(\S+)/i)
  if (matchNoSpeed) {
    const percent = parseFloat(matchNoSpeed[1])
    const totalBytes = parseSizeToBytes(matchNoSpeed[2], matchNoSpeed[3]) ?? undefined
    const downloadedBytes = totalBytes != null ? (totalBytes * percent) / 100 : undefined
    return {
      percent,
      totalBytes,
      downloadedBytes,
      eta: matchNoSpeed[4],
      stage: 'downloading',
    }
  }

  const matchPercentOnly = line.match(/\[download\]\s+([\d.]+)%/)
  if (matchPercentOnly) {
    return {
      percent: parseFloat(matchPercentOnly[1]),
      stage: 'downloading',
    }
  }

  // aria2c readout line when using external downloader, e.g.
  // [#abcd12 512.0MiB/1.99GiB(25%) CN:16 DL:35.0MiB ETA:45s]
  const aria2Full = line.match(/\[#([0-9a-f]+)\s+([\d.]+)\s*([KMG]?i?B)\/([\d.]+)\s*([KMG]?i?B)\((\d+(?:\.\d+)?)%\)\s+CN:(\d+)\s+DL:([\d.]+)\s*([KMG]?i?B)(?:\s+ETA:([^\]\s]+))?\]/i)
  if (aria2Full) {
    const downloadedBytes = parseSizeToBytes(aria2Full[2], aria2Full[3]) ?? undefined
    const totalBytes = parseSizeToBytes(aria2Full[4], aria2Full[5]) ?? undefined
    const speedBytes = parseSizeToBytes(aria2Full[8], aria2Full[9]) ?? undefined
    return {
      percent: parseFloat(aria2Full[6]),
      downloadedBytes,
      totalBytes,
      speedBytes,
      speed: `${aria2Full[8]}${aria2Full[9]}/s`,
      eta: aria2Full[10],
      connectionCount: Number.parseInt(aria2Full[7], 10) || undefined,
      stage: 'downloading',
    }
  }

  // aria2c line without total bytes in the same row, keep percent if present
  const aria2PercentSpeed = line.match(/\[#.+?\((\d+(?:\.\d+)?)%\).*?DL:([\d.]+)\s*([KMG]?i?B)(?:\s+ETA:([^\]\s]+))?.*\]/i)
  if (aria2PercentSpeed) {
    const speedBytes = parseSizeToBytes(aria2PercentSpeed[2], aria2PercentSpeed[3]) ?? undefined
    return {
      percent: parseFloat(aria2PercentSpeed[1]),
      speedBytes,
      speed: `${aria2PercentSpeed[2]}${aria2PercentSpeed[3]}/s`,
      eta: aria2PercentSpeed[4],
      stage: 'downloading',
    }
  }

  if (line.includes('[Merger]')) return { stage: 'merging', percent: 99, message: 'Merging...' }
  if (line.includes('has already been downloaded')) return { stage: 'done', percent: 100 }
  return null
}

type ResolvedSpeedProfile = 'balanced' | 'antiThrottle'
type ResolvedNoLogoPolicy = 'off' | 'sourcePreferred'

function isBilibiliUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return host.includes('bilibili.com') || host.includes('b23.tv')
  } catch {
    return false
  }
}

function resolveSpeedProfile(url: string, requested?: DownloadOptions['speedProfile']): ResolvedSpeedProfile {
  if (requested === 'balanced' || requested === 'antiThrottle') return requested
  if (isBilibiliUrl(url)) return 'antiThrottle'
  return 'balanced'
}

function resolveNoLogoPolicy(url: string, requested?: DownloadOptions['noLogoPolicy']): ResolvedNoLogoPolicy {
  if (requested === 'off') return 'off'
  if (!isBilibiliUrl(url)) return 'off'
  return 'sourcePreferred'
}

function getSpeedArgs(profile: ResolvedSpeedProfile): string[] {
  if (profile === 'antiThrottle') {
    return [
      '--concurrent-fragments', '1',
      '--buffer-size', '4M',
      '--http-chunk-size', '1M',
      '--retries', '15',
      '--fragment-retries', '15',
      '--retry-sleep', '2',
      '--socket-timeout', '30',
    ]
  }

  return [
    '--concurrent-fragments', '4',
    '--buffer-size', '16M',
    '--http-chunk-size', '10M',
    '--retries', '10',
    '--fragment-retries', '10',
    '--retry-sleep', '1',
  ]
}

function getAria2Args(profile: ResolvedSpeedProfile): string {
  if (profile === 'antiThrottle') {
    return [
      '--max-connection-per-server=16',
      '--split=16',
      '--min-split-size=1M',
      '--max-tries=0',
      '--retry-wait=1',
      '--connect-timeout=15',
      '--timeout=30',
      '--http-accept-gzip=false',
      '--summary-interval=1',
      '--file-allocation=none',
      '--allow-overwrite=true',
    ].join(' ')
  }

  return [
    '--max-connection-per-server=8',
    '--split=8',
    '--min-split-size=4M',
    '--max-tries=0',
    '--retry-wait=1',
    '--connect-timeout=20',
    '--timeout=30',
    '--http-accept-gzip=false',
    '--summary-interval=1',
    '--file-allocation=none',
    '--allow-overwrite=true',
  ].join(' ')
}

function sanitizeSubtitleLangsForAria2(langs: string[] | undefined): string[] | undefined {
  if (!langs || langs.length === 0) return langs

  const normalized = langs.map((lang) => lang.trim()).filter(Boolean)
  if (normalized.length === 0) return undefined

  const hasAll = normalized.includes('all')
  if (hasAll) {
    // Keep broad subtitle coverage but avoid danmaku xml endpoint that breaks aria2 on some Bilibili responses.
    return ['all', '-danmaku']
  }

  return normalized.filter((lang) => lang.toLowerCase() !== 'danmaku')
}

function sanitizeSubtitleLangsForNoLogo(langs: string[] | undefined): string[] | undefined {
  if (!langs || langs.length === 0) return langs

  const normalized = langs.map((lang) => lang.trim()).filter(Boolean)
  if (normalized.length === 0) return undefined

  const hasAll = normalized.includes('all')
  if (hasAll) {
    // Keep broad subtitle coverage but exclude danmaku track when no-logo policy is active.
    return ['all', '-danmaku']
  }

  return normalized.filter((lang) => lang.toLowerCase() !== 'danmaku')
}

function withBilibiliNoLogoSelector(selector: string): string {
  return [
    `${selector}[format_note*=无水印]`,
    `${selector}[format_note!*=watermark][format_note!*=水印]`,
    selector,
  ].join('/')
}

function withPrependedPathEnv(env: NodeJS.ProcessEnv, binPath: string): NodeJS.ProcessEnv {
  if (!binPath.includes('/') && !binPath.includes('\\')) {
    return env
  }
  const nextEnv: NodeJS.ProcessEnv = { ...env }
  const binDir = path.dirname(binPath)
  const pathKeys = process.platform === 'win32' ? ['Path', 'PATH'] : ['PATH']
  for (const key of pathKeys) {
    const cur = nextEnv[key]
    nextEnv[key] = cur ? `${binDir}${path.delimiter}${cur}` : binDir
  }
  return nextEnv
}

class YtDlpService {
  private ytDlpBin = findYtDlp()
  private aria2Bin = findAria2c()
  private activeProcess: ChildProcess | null = null

  /**
   * Fetch video info (formats, subtitles, title...) via --dump-json
   */
  async fetchVideoInfo(url: string, cookiePath?: string, allowPlaylist?: boolean): Promise<VideoInfo> {
    const args = [
      '--dump-json',
      allowPlaylist ? '--yes-playlist' : '--no-playlist',
      '--no-warnings',
    ]
    if (cookiePath) args.push('--cookies', cookiePath)
    args.push(url)

    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const proc = spawn(this.ytDlpBin, args)

      proc.stdout.on('data', (d) => (stdout += d.toString()))
      proc.stderr.on('data', (d) => (stderr += d.toString()))

      proc.on('close', (code) => {
        if (code !== 0) {
          const msg = stderr.split('\n').find(l => l.includes('ERROR:')) || stderr.slice(-300)
          return reject(new Error(msg || `yt-dlp exited with code ${code}`))
        }
        try {
          // yt-dlp may output multiple JSON objects for playlists; take first
          const firstLine = stdout.trim().split('\n')[0]
          const json = JSON.parse(firstLine)
          resolve(parseVideoInfo(json))
        } catch (e: any) {
          reject(new Error('Failed to parse yt-dlp output: ' + e.message))
        }
      })

      proc.on('error', (err) => {
        if ((err as any).code === 'ENOENT') {
          reject(new Error('yt-dlp không tìm thấy. Vui lòng cài yt-dlp và thêm vào PATH.'))
        } else {
          reject(err)
        }
      })
    })
  }

  /**
   * Fetch playlist info (title + entries) via --flat-playlist
   */
  async fetchPlaylistInfo(url: string, cookiePath?: string, limit = 6): Promise<PlaylistInfo> {
    const args = [
      '--yes-playlist',
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
    ]
    if (cookiePath) args.push('--cookies', cookiePath)
    args.push(url)

    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const proc = spawn(this.ytDlpBin, args)

      proc.stdout.on('data', (d) => (stdout += d.toString()))
      proc.stderr.on('data', (d) => (stderr += d.toString()))

      proc.on('close', (code) => {
        if (code !== 0) {
          const msg = stderr.split('\n').find(l => l.includes('ERROR:')) || stderr.slice(-300)
          return reject(new Error(msg || `yt-dlp exited with code ${code}`))
        }
        try {
          const json = JSON.parse(stdout.trim())
          const entries = Array.isArray(json.entries) ? json.entries : []
          const mapped = entries.slice(0, limit).map((entry: any) => ({
            id: entry.id ? String(entry.id) : undefined,
            title: entry.title,
            url: entry.url || entry.webpage_url,
          }))
          resolve({
            id: json.id ? String(json.id) : undefined,
            title: json.title || 'Playlist',
            entryCount: entries.length,
            entries: mapped,
          })
        } catch (e: any) {
          reject(new Error('Failed to parse yt-dlp output: ' + e.message))
        }
      })

      proc.on('error', (err) => {
        if ((err as any).code === 'ENOENT') {
          reject(new Error('yt-dlp không tìm thấy. Vui lòng cài yt-dlp và thêm vào PATH.'))
        } else {
          reject(err)
        }
      })
    })
  }

  /**
   * Fetch a direct preview URL (best single stream) for <video> playback.
   */
  async fetchPreviewUrl(url: string, cookiePath?: string): Promise<string> {
    const args = [
      '--get-url',
      '--no-playlist',
      '--no-warnings',
      '-f',
      'best[ext=mp4]/best',
    ]
    if (cookiePath) args.push('--cookies', cookiePath)
    args.push(url)

    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const proc = spawn(this.ytDlpBin, args)

      proc.stdout.on('data', (d) => (stdout += d.toString()))
      proc.stderr.on('data', (d) => (stderr += d.toString()))

      proc.on('close', (code) => {
        if (code !== 0) {
          const msg = stderr.split('\n').find(l => l.includes('ERROR:')) || stderr.slice(-300)
          return reject(new Error(msg || `yt-dlp exited with code ${code}`))
        }
        const line = stdout.trim().split('\n')[0]
        if (!line) return reject(new Error('Không lấy được preview URL'))
        resolve(line)
      })

      proc.on('error', (err) => {
        if ((err as any).code === 'ENOENT') {
          reject(new Error('yt-dlp không tìm thấy. Vui lòng cài yt-dlp và thêm vào PATH.'))
        } else {
          reject(err)
        }
      })
    })
  }

  /**
   * Start download, streaming log lines and progress via callbacks
   */
  async startDownload(
    options: DownloadOptions,
    onLog: (line: string) => void,
    onProgress: (p: DownloadProgress) => void,
  ): Promise<void> {
    const ffmpegPath = getFFmpegPath()
    const ffmpegLocation = existsSync(ffmpegPath) ? path.dirname(ffmpegPath) : ''
    if (!ffmpegLocation) {
      onLog(`[yt-dlp] WARN: ffmpeg không tìm thấy tại: ${ffmpegPath} (fallback dùng hệ thống)`)
    }
    const shouldDownloadVideo = options.downloadVideo !== false
    const mergeAudio = options.mergeAudio !== false
    if (!shouldDownloadVideo) {
      onLog('[Downloader] Video: OFF -> chỉ tải subtitles/thumbnail (skip media download)')
    } else if (mergeAudio) {
      onLog('[Downloader] Ghép audio: ON → merge')
    } else if (options.downloadSeparateAudio) {
      onLog('[Downloader] Ghép audio: OFF → tải audio riêng')
    } else {
      onLog('[Downloader] Ghép audio: OFF → video-only')
    }
    const speedProfile = resolveSpeedProfile(options.url, options.speedProfile)
    const noLogoPolicy = resolveNoLogoPolicy(options.url, options.noLogoPolicy)
    let useAria2 = speedProfile === 'antiThrottle'
    if (useAria2) {
      if (existsSync(this.aria2Bin) || this.aria2Bin === 'aria2c' || this.aria2Bin === 'aria2c.exe') {
        onLog('[Downloader] Engine: IDM-like segmented (aria2c)')
      } else {
        useAria2 = false
        onLog(`[Downloader] WARN: aria2c không tìm thấy tại ${this.aria2Bin} -> fallback yt-dlp native`)
      }
    }
    if (options.speedProfile === 'auto') {
      onLog(`[Downloader] Profile tốc độ: auto -> ${speedProfile}`)
    } else {
      onLog(`[Downloader] Profile tốc độ: ${speedProfile}`)
    }
    if (options.noLogoPolicy === 'auto' || options.noLogoPolicy === undefined) {
      onLog(`[Downloader] No-logo: auto -> ${noLogoPolicy}`)
    } else {
      onLog(`[Downloader] No-logo: ${noLogoPolicy}`)
    }
    if (noLogoPolicy === 'off' && options.noLogoPolicy && options.noLogoPolicy !== 'off' && !isBilibiliUrl(options.url)) {
      onLog('[Downloader] No-logo source filter hiện áp dụng chủ yếu cho Bilibili')
    }

    const effectiveOptions: DownloadOptions = { ...options }
    if (!shouldDownloadVideo) {
      effectiveOptions.formatId = undefined
      effectiveOptions.audioFormatId = undefined
      effectiveOptions.downloadSeparateAudio = false
      effectiveOptions.mergeAudio = false
    }
    let noLogoStrategy: DownloadNoLogoStrategy = 'off'
    if (noLogoPolicy === 'sourcePreferred') {
      noLogoStrategy = 'source-preferred'
      const before = effectiveOptions.subtitleLangs ?? []
      const after = sanitizeSubtitleLangsForNoLogo(before)
      const changed = JSON.stringify(before) !== JSON.stringify(after ?? [])
      if (changed) {
        noLogoStrategy = 'subtitle-filtered'
        onLog('[Downloader] No-logo: lọc danmaku subtitle để giảm overlay không mong muốn')
      }
      effectiveOptions.subtitleLangs = after
    }
    if (useAria2) {
      const before = effectiveOptions.subtitleLangs ?? []
      const after = sanitizeSubtitleLangsForAria2(before)
      const changed = JSON.stringify(before) !== JSON.stringify(after ?? [])
      if (changed) {
        if (noLogoStrategy !== 'off') {
          noLogoStrategy = 'subtitle-filtered'
        }
        onLog('[Downloader] IDM-like: bỏ danmaku subtitle để tránh lỗi aria2 gzip decode')
      }
      effectiveOptions.subtitleLangs = after
    }

    const args = buildArgs(effectiveOptions, ffmpegLocation || undefined, speedProfile, useAria2, noLogoPolicy)

    return new Promise((resolve, reject) => {
      onLog(`[yt-dlp] ${this.ytDlpBin} ${args.join(' ')}`)

      try {
        if (options.outputDir) {
          fs.mkdirSync(options.outputDir, { recursive: true })
        }
      } catch (e: any) {
        return reject(new Error(`Không tạo được thư mục lưu: ${options.outputDir || '(empty)'} (${e?.message || e})`))
      }

      const spawnEnv = useAria2 ? withPrependedPathEnv(process.env, this.aria2Bin) : process.env
      this.activeProcess = spawn(this.ytDlpBin, args, { cwd: options.outputDir, env: spawnEnv })

      let lastProgress: DownloadProgress = {
        percent: 0,
        stage: 'downloading',
        engine: useAria2 ? 'idm' : 'native',
        noLogoStrategy,
      }
      let speedBaseline: { timeMs: number; bytes: number } | null = null
      const speedWindow: Array<{ timeMs: number; bytes: number }> = []

      const handleLine = (line: string) => {
        onLog(line)
        const prog = parseProgress(line)
        if (prog) {
          const next: DownloadProgress = {
            ...lastProgress,
            ...prog,
            stage: prog.stage ?? lastProgress.stage,
          }
          if (next.downloadedBytes != null) {
            const now = Date.now()

            if (!speedBaseline || next.downloadedBytes < speedBaseline.bytes) {
              speedBaseline = { timeMs: now, bytes: next.downloadedBytes }
            }

            speedWindow.push({ timeMs: now, bytes: next.downloadedBytes })
            while (speedWindow.length > 1 && speedWindow[0].timeMs < now - 30_000) {
              speedWindow.shift()
            }

            if (speedBaseline && now > speedBaseline.timeMs && next.downloadedBytes >= speedBaseline.bytes) {
              const elapsed = (now - speedBaseline.timeMs) / 1000
              if (elapsed >= 1) {
                next.avgSpeedBytes = (next.downloadedBytes - speedBaseline.bytes) / elapsed
              }
            }

            if (speedWindow.length >= 2) {
              const first = speedWindow[0]
              const last = speedWindow[speedWindow.length - 1]
              if (last.timeMs > first.timeMs && last.bytes >= first.bytes) {
                const elapsed = (last.timeMs - first.timeMs) / 1000
                if (elapsed >= 1) {
                  next.windowSpeedBytes = (last.bytes - first.bytes) / elapsed
                }
              }
            }
          }
          if (prog.currentFile) {
            next.percent = 0
          }
          if (prog.percent === undefined && lastProgress.percent !== undefined) {
            next.percent = lastProgress.percent
          }
          lastProgress = next
          onProgress(next)
        }
      }

      let buffer = ''
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n|\r/)
        buffer = lines.pop() ?? ''
        lines.forEach(l => l && handleLine(l))
      }

      this.activeProcess.stdout?.on('data', onData)
      this.activeProcess.stderr?.on('data', onData)

      this.activeProcess.on('close', (code) => {
        if (buffer) handleLine(buffer)
        this.activeProcess = null
        if (code === 0 || code === null) {
          onProgress({ ...lastProgress, percent: 100, stage: 'done', message: 'Hoàn tất!' })
          resolve()
        } else {
          onProgress({ ...lastProgress, stage: 'error', message: `yt-dlp exited ${code}` })
          reject(new Error(`yt-dlp exited with code ${code}`))
        }
      })

      this.activeProcess.on('error', (err) => {
        this.activeProcess = null
        if ((err as any).code === 'ENOENT') {
          if (!existsSync(this.ytDlpBin)) {
            reject(new Error(`yt-dlp không tìm thấy tại: ${this.ytDlpBin}`))
          } else {
            reject(new Error(`Không thể chạy yt-dlp (ENOENT). Kiểm tra thư mục lưu: ${options.outputDir}`))
          }
        } else {
          reject(err)
        }
      })
    })
  }

  stopDownload(): void {
    if (this.activeProcess) {
      const pid = this.activeProcess.pid
      if (process.platform === 'win32' && pid) {
        try {
          spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'])
        } catch {
          this.activeProcess.kill()
        }
      } else {
        this.activeProcess.kill('SIGTERM')
      }
      this.activeProcess = null
    }
  }

  /**
   * Write cookie content to a temp file and return the path.
   * Caller is responsible for cleanup.
   */
  writeTempCookie(content: string): string {
    const tmpPath = path.join(os.tmpdir(), `nch_cookie_${Date.now()}.txt`)
    fs.writeFileSync(tmpPath, content, 'utf-8')
    return tmpPath
  }

  cleanupTempCookie(cookiePath: string): void {
    try { fs.unlinkSync(cookiePath) } catch { /* ignore */ }
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function normalizeSubtitleEntries(entries: any): { ext: string }[] {
  if (!entries) return []
  if (Array.isArray(entries)) {
    return entries
      .map((entry) => {
        const ext = entry?.ext || entry?.format || entry?.extension
        return ext ? { ext: String(ext) } : null
      })
      .filter(Boolean) as { ext: string }[]
  }
  if (typeof entries === 'object') {
    const ext = (entries as any).ext || (entries as any).format || (entries as any).extension
    return ext ? [{ ext: String(ext) }] : []
  }
  return []
}

function mergeSubtitleMap(target: Record<string, { ext: string }[]>, source: Record<string, { ext: string }[]>) {
  for (const [lang, entries] of Object.entries(source)) {
    if (!lang) continue
    if (!target[lang]) {
      target[lang] = [...entries]
      continue
    }
    const existing = new Set(target[lang].map(item => item.ext))
    for (const item of entries) {
      if (!existing.has(item.ext)) {
        target[lang].push(item)
        existing.add(item.ext)
      }
    }
  }
}

function extractSubtitleMap(raw: any): Record<string, { ext: string }[]> {
  const result: Record<string, { ext: string }[]> = {}
  if (!raw) return result

  const addLang = (lang: string | undefined, entries: any) => {
    if (!lang) return
    const normalized = normalizeSubtitleEntries(entries)
    if (normalized.length === 0) return
    if (!result[lang]) result[lang] = []
    const existing = new Set(result[lang].map(item => item.ext))
    for (const item of normalized) {
      if (!existing.has(item.ext)) {
        result[lang].push(item)
        existing.add(item.ext)
      }
    }
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item) continue
      const lang = item.lang || item.language || item.code || item.id
      if (item.subtitles || item.formats || item.entries) {
        addLang(lang, item.subtitles || item.formats || item.entries)
      } else {
        addLang(lang, item)
      }
    }
    return result
  }

  if (typeof raw === 'object') {
    if (Array.isArray((raw as any).subtitles)) {
      return extractSubtitleMap((raw as any).subtitles)
    }
    for (const [lang, entries] of Object.entries(raw)) {
      addLang(lang, entries)
    }
  }

  return result
}

function parseVideoInfo(json: any): VideoInfo {
  const formats: VideoFormat[] = (json.formats || [])
    .filter((f: any) => f.vcodec !== 'none' || f.acodec !== 'none')
    .map((f: any): VideoFormat => ({
      id: String(f.format_id),
      resolution: f.resolution || (f.height ? `${f.height}p` : 'audio only'),
      ext: f.ext || '',
      filesize: f.filesize || f.filesize_approx,
      note: f.format_note || undefined,
      vcodec: f.vcodec,
      acodec: f.acodec,
      tbr: f.tbr,
    }))
    // deduplicate + sort by resolution desc
    .sort((a: VideoFormat, b: VideoFormat) => {
      const numA = parseInt(a.resolution) || 0
      const numB = parseInt(b.resolution) || 0
      return numB - numA
    })

  const subtitles: Record<string, { ext: string }[]> = {}
  mergeSubtitleMap(subtitles, extractSubtitleMap(json.subtitles))
  mergeSubtitleMap(subtitles, extractSubtitleMap(json.subtitle))
  mergeSubtitleMap(subtitles, extractSubtitleMap(json.requested_subtitles))

  const autoSubtitles: Record<string, { ext: string }[]> = {}
  mergeSubtitleMap(autoSubtitles, extractSubtitleMap(json.automatic_captions))
  mergeSubtitleMap(autoSubtitles, extractSubtitleMap(json.auto_captions))

  return {
    id: json.id ? String(json.id) : undefined,
    title: json.title || 'Unknown',
    thumbnail: json.thumbnail,
    duration: json.duration,
    webpage_url: json.webpage_url || json.url || '',
    uploader: json.uploader,
    formats,
    subtitles,
    autoSubtitles,
  }
}

function buildArgs(
  options: DownloadOptions,
  ffmpegLocation?: string,
  speedProfile: ResolvedSpeedProfile = 'balanced',
  useAria2 = false,
  noLogoPolicy: ResolvedNoLogoPolicy = 'off',
): string[] {
  const args: string[] = []
  const shouldDownloadVideo = options.downloadVideo !== false
  const mergeAudio = options.mergeAudio !== false
  const audioFormatId = options.audioFormatId?.trim()
  const hasAudioFormat = !!audioFormatId
  const shouldApplyNoLogoSource = noLogoPolicy === 'sourcePreferred' && isBilibiliUrl(options.url)
  const avcMp4Selector = shouldApplyNoLogoSource
    ? withBilibiliNoLogoSelector('bestvideo[vcodec^=avc][ext=mp4]')
    : 'bestvideo[vcodec^=avc][ext=mp4]'
  const avcSelector = shouldApplyNoLogoSource
    ? withBilibiliNoLogoSelector('bestvideo[vcodec^=avc]')
    : 'bestvideo[vcodec^=avc]'

  // Cookie
  if (options.useCookie && options['cookiePath' as keyof DownloadOptions]) {
    args.push('--cookies', options['cookiePath' as keyof DownloadOptions] as string)
  }

  // Format
  if (shouldDownloadVideo) {
    if (options.formatId) {
      if (mergeAudio) {
        args.push('-f', hasAudioFormat ? `${options.formatId}+${audioFormatId}` : options.formatId)
      } else if (options.downloadSeparateAudio) {
        args.push('-f', hasAudioFormat
          ? `${options.formatId},${audioFormatId}`
          : `${options.formatId},bestaudio[acodec^=mp4a]/${options.formatId},bestaudio`)
      } else {
        args.push('-f', options.formatId)
      }
    } else if (mergeAudio) {
      if (hasAudioFormat) {
        args.push(
          '-f',
          `${avcMp4Selector}+${audioFormatId}/${avcSelector}+${audioFormatId}`
        )
      } else {
        args.push(
          '-f',
          `${avcMp4Selector}+bestaudio[acodec^=mp4a][ext=m4a]/best[ext=mp4]/best`
        )
      }
    } else if (options.downloadSeparateAudio) {
      if (hasAudioFormat) {
        args.push(
          '-f',
          `${avcMp4Selector},${audioFormatId}/${avcSelector},${audioFormatId}`
        )
      } else {
        args.push(
          '-f',
          `${avcMp4Selector},bestaudio[acodec^=mp4a]/${avcSelector},bestaudio`
        )
      }
    } else {
      args.push(
        '-f',
        `${avcMp4Selector}/${avcSelector}/bestvideo`
      )
    }
  } else {
    args.push('--skip-download')
  }

  // Subtitles
  const subtitleLangs = options.subtitleLangs ?? []
  if (subtitleLangs.length > 0) {
    args.push('--write-subs', '--write-auto-subs')
    args.push('--sub-langs', subtitleLangs.join(','))
    const hasDanmaku = subtitleLangs.includes('danmaku') || subtitleLangs.includes('all')
    if (options.convertSubs && !(options.skipDanmakuConvert && hasDanmaku)) {
      args.push('--convert-subs', options.convertSubs)
    }
  }

  // Thumbnail
  if (options.writeThumbnail) {
    args.push('--write-thumbnail')
  }

  // Output template
  args.push('-o', '%(title)s [%(id)s].%(ext)s')

  if (shouldDownloadVideo && mergeAudio) {
    // Merge to mp4 if possible
    args.push('--merge-output-format', 'mp4')
    args.push('--postprocessor-args', 'ffmpeg:-movflags +faststart')
  }

  if (ffmpegLocation) {
    args.push('--ffmpeg-location', ffmpegLocation)
  }

  if (useAria2) {
    args.push('--downloader', 'aria2c')
    args.push('--downloader-args', `aria2c:${getAria2Args(speedProfile)}`)
  }

  // Resume partial files if the previous attempt was interrupted.
  args.push('--continue')

  // Network tuning profile (for yt-dlp native downloader path)
  if (!useAria2) {
    args.push(...getSpeedArgs(speedProfile))
  }

  // Ensure progress updates are newline-delimited
  args.push('--newline')

  if (options.allowPlaylist) {
    args.push('--yes-playlist')
  } else {
    args.push('--no-playlist')
  }
  args.push(options.url)

  return args
}

export const ytDlpService = new YtDlpService()
