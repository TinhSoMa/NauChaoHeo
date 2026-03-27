/**
 * Shared types for the yt-dlp Downloader feature
 */

export interface VideoFormat {
  id: string
  resolution: string   // e.g. "1080p", "720p", "audio only"
  ext: string          // e.g. "mp4", "webm", "m4a"
  filesize?: number    // bytes, may be undefined
  note?: string        // e.g. "Premium", "60fps"
  vcodec?: string
  acodec?: string
  tbr?: number         // total bitrate kbps
}

export interface SubtitleInfo {
  ext: string          // e.g. "srt", "vtt"
}

export interface VideoInfo {
  id?: string
  title: string
  thumbnail?: string
  duration?: number    // seconds
  webpage_url: string
  uploader?: string
  formats: VideoFormat[]
  /** subtitles keyed by language code → list of available formats */
  subtitles: Record<string, SubtitleInfo[]>
  /** auto-generated subtitles (auto_captions in yt-dlp) */
  autoSubtitles: Record<string, SubtitleInfo[]>
}

export interface PlaylistEntry {
  id?: string
  title?: string
  url?: string
}

export interface PlaylistInfo {
  id?: string
  title: string
  entryCount: number
  entries: PlaylistEntry[]
}

export interface DownloadOptions {
  url: string
  outputDir: string
  /** yt-dlp format id, e.g. "137+140". undefined = best */
  formatId?: string
  /** subtitle language codes to download, e.g. ["vi", "en", "all"] */
  subtitleLangs?: string[]
  /** convert subtitles to this format, e.g. "srt" */
  convertSubs?: string
  /** skip convert when danmaku/xml may break conversion */
  skipDanmakuConvert?: boolean
  /** whether to write thumbnail */
  writeThumbnail?: boolean
  /** whether to use cookie from DB for this domain */
  useCookie: boolean
  /** allow downloading playlists */
  allowPlaylist?: boolean
}

export interface DownloadProgress {
  percent: number
  speed?: string
  speedBytes?: number
  downloadedBytes?: number
  totalBytes?: number
  eta?: string
  stage: 'fetching' | 'downloading' | 'merging' | 'done' | 'error'
  message?: string
  currentFile?: string
  currentType?: 'subtitle' | 'video' | 'audio' | 'thumbnail' | 'other'
}

export interface CookieEntry {
  id: string
  domain: string       // e.g. "bilibili.com"
  label: string        // display name
  content: string      // Netscape cookie file content
  enabled: boolean
  created_at: number
  updated_at: number
}
