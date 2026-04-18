import type { DownloadOptions } from '../../../shared/types/downloader'

export type ResolvedSpeedProfile = 'balanced' | 'antiThrottle'
export type ResolvedNoLogoPolicy = 'off' | 'sourcePreferred'

export function isBilibiliUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return host.includes('bilibili.com') || host.includes('b23.tv')
  } catch {
    return false
  }
}

export function resolveSpeedProfile(url: string, requested?: DownloadOptions['speedProfile']): ResolvedSpeedProfile {
  if (requested === 'balanced' || requested === 'antiThrottle') return requested
  if (isBilibiliUrl(url)) return 'antiThrottle'
  return 'balanced'
}

export function resolveNoLogoPolicy(url: string, requested?: DownloadOptions['noLogoPolicy']): ResolvedNoLogoPolicy {
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

export function sanitizeSubtitleLangsForAria2(langs: string[] | undefined): string[] | undefined {
  if (!langs || langs.length === 0) return langs

  const normalized = langs.map((lang) => lang.trim()).filter(Boolean)
  if (normalized.length === 0) return undefined

  const hasAll = normalized.includes('all')
  if (hasAll) {
    return ['all', '-danmaku']
  }

  return normalized.filter((lang) => lang.toLowerCase() !== 'danmaku')
}

export function sanitizeSubtitleLangsForNoLogo(langs: string[] | undefined): string[] | undefined {
  if (!langs || langs.length === 0) return langs

  const normalized = langs.map((lang) => lang.trim()).filter(Boolean)
  if (normalized.length === 0) return undefined

  const hasAll = normalized.includes('all')
  if (hasAll) {
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

export function buildArgs(
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
  const allowPlaylist = options.allowPlaylist === true
  const playlistFolderMode: 'flat' | 'per_video' =
    ((options as DownloadOptions & { playlistFolderMode?: 'flat' | 'per_video' }).playlistFolderMode === 'per_video'
      ? 'per_video'
      : 'flat')
  const shouldApplyNoLogoSource = noLogoPolicy === 'sourcePreferred' && isBilibiliUrl(options.url)
  const avcMp4Selector = shouldApplyNoLogoSource
    ? withBilibiliNoLogoSelector('bestvideo[vcodec^=avc][ext=mp4]')
    : 'bestvideo[vcodec^=avc][ext=mp4]'
  const avcSelector = shouldApplyNoLogoSource
    ? withBilibiliNoLogoSelector('bestvideo[vcodec^=avc]')
    : 'bestvideo[vcodec^=avc]'

  if (options.useCookie && options['cookiePath' as keyof DownloadOptions]) {
    args.push('--cookies', options['cookiePath' as keyof DownloadOptions] as string)
  }

  if (shouldDownloadVideo) {
    if (options.formatId) {
      if (mergeAudio) {
        if (allowPlaylist) {
          const preferred = hasAudioFormat
            ? `${options.formatId}+${audioFormatId}`
            : `${options.formatId}+bestaudio[acodec^=mp4a]`
          const fallback = hasAudioFormat
            ? `${avcMp4Selector}+${audioFormatId}/${avcSelector}+${audioFormatId}/best`
            : `${avcMp4Selector}+bestaudio[acodec^=mp4a]/${avcSelector}+bestaudio[acodec^=mp4a]/best`
          args.push('-f', `${preferred}/${fallback}`)
        } else {
          if (hasAudioFormat) {
            args.push('-f', `${options.formatId}+${audioFormatId}/${options.formatId}`)
          } else {
            args.push('-f', `${options.formatId}+bestaudio[acodec^=mp4a]/${options.formatId}+bestaudio/${options.formatId}`)
          }
        }
      } else if (options.downloadSeparateAudio) {
        if (allowPlaylist) {
          const preferred = hasAudioFormat
            ? `${options.formatId},${audioFormatId}`
            : `${options.formatId},bestaudio[acodec^=mp4a]`
          const fallback = hasAudioFormat
            ? `${avcMp4Selector},${audioFormatId}/${avcSelector},${audioFormatId}/bestvideo,bestaudio`
            : `${avcMp4Selector},bestaudio[acodec^=mp4a]/${avcSelector},bestaudio[acodec^=mp4a]/bestvideo,bestaudio`
          args.push('-f', `${preferred}/${fallback}`)
        } else {
          args.push('-f', hasAudioFormat
            ? `${options.formatId},${audioFormatId}`
            : `${options.formatId},bestaudio[acodec^=mp4a]/${options.formatId},bestaudio`)
        }
      } else {
        if (allowPlaylist) {
          args.push('-f', `${options.formatId}/${avcMp4Selector}/${avcSelector}/bestvideo`)
        } else {
          args.push('-f', options.formatId)
        }
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

  const subtitleLangs = options.subtitleLangs ?? []
  if (subtitleLangs.length > 0) {
    args.push('--write-subs', '--write-auto-subs')
    args.push('--sub-langs', subtitleLangs.join(','))
    const hasDanmaku = subtitleLangs.includes('danmaku') || subtitleLangs.includes('all')
    if (options.convertSubs && !(options.skipDanmakuConvert && hasDanmaku)) {
      args.push('--convert-subs', options.convertSubs)
    }
  }

  if (options.writeThumbnail) {
    args.push('--write-thumbnail')
  }

  const outputTemplate = allowPlaylist && playlistFolderMode === 'per_video'
    ? '%(title)s [%(id)s]/%(title)s [%(id)s].%(ext)s'
    : '%(title)s [%(id)s].%(ext)s'
  args.push('-o', outputTemplate)

  if (shouldDownloadVideo && mergeAudio) {
    args.push('--merge-output-format', 'mp4')
    args.push('--keep-video')
    args.push('--postprocessor-args', 'ffmpeg:-movflags +faststart')
  }

  if (ffmpegLocation) {
    args.push('--ffmpeg-location', ffmpegLocation)
  }

  if (useAria2) {
    args.push('--downloader', 'aria2c')
    args.push('--downloader-args', `aria2c:${getAria2Args(speedProfile)}`)
  }

  args.push('--continue')

  if (!useAria2) {
    args.push(...getSpeedArgs(speedProfile))
  }

  args.push('--newline')

  if (options.allowPlaylist) {
    args.push('--yes-playlist')
    if (options.playlistItems && options.playlistItems.length > 0) {
      const sanitized = options.playlistItems
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0)
      if (sanitized.length > 0) {
        const uniqueSorted = Array.from(new Set(sanitized)).sort((a, b) => a - b)
        console.log('[Downloader][Playlist] apply --playlist-items', uniqueSorted.join(','))
        args.push('--playlist-items', uniqueSorted.join(','))
      }
    }
  } else {
    args.push('--no-playlist')
  }
  args.push(options.url)

  return args
}
