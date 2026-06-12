import type { DownloadOptions, VideoFormat } from '../types/downloader'

export interface ResolveDownloadIntentInput {
  downloadVideo: boolean
  mergeAudio: boolean
  downloadSeparateAudio: boolean
  selectedFormatId?: string | null
  selectedAudioFormatId?: string | null
  knownVideoFormats?: VideoFormat[]
  knownAudioFormats?: VideoFormat[]
  downloadSubtitle: boolean
  downloadAllSubs: boolean
  selectedSubLangs: string[]
  allSubtitleLangs: string[]
  convertSubs?: string
  skipDanmakuConvert: boolean
  downloadThumbnail: boolean
  allowPlaylist: boolean
  selectedPlaylistIndexes?: number[] | null
  validPlaylistIndexes?: number[]
}

export interface ResolvedDownloadIntent {
  options: Pick<
    DownloadOptions,
    | 'downloadVideo'
    | 'formatId'
    | 'audioFormatId'
    | 'mergeAudio'
    | 'downloadSeparateAudio'
    | 'subtitleLangs'
    | 'convertSubs'
    | 'skipDanmakuConvert'
    | 'writeThumbnail'
    | 'allowPlaylist'
    | 'playlistItems'
  >
  warnings: string[]
  error?: string
}

function pickDefaultSubtitleLangs(langs: string[]): string[] {
  if (langs.length === 0) return []
  const preferred = ['vi', 'en', 'ja']
  for (const pref of preferred) {
    const found = langs.find((lang) => lang.toLowerCase() === pref)
    if (found) return [found]
  }
  return [langs[0]]
}

function uniqSortedPositiveNumbers(values: number[]): number[] {
  return Array.from(
    new Set(
      values
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ).sort((a, b) => a - b)
}

function normalizeLangs(values: string[]): string[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean)
  return Array.from(new Set(cleaned))
}

export function resolveDownloadIntent(input: ResolveDownloadIntentInput): ResolvedDownloadIntent {
  const warnings: string[] = []

  const shouldDownloadVideo = input.downloadVideo === true
  const mergeAudio = shouldDownloadVideo ? input.mergeAudio === true : false
  const downloadSeparateAudio = shouldDownloadVideo && !mergeAudio && input.downloadSeparateAudio === true

  const rawFormatId = input.selectedFormatId?.trim() || ''
  const canValidateFormat = Array.isArray(input.knownVideoFormats) && input.knownVideoFormats.length > 0
  let formatId: string | undefined
  if (shouldDownloadVideo && rawFormatId) {
    if (canValidateFormat) {
      const exists = input.knownVideoFormats!.some((format) => format.id === rawFormatId)
      if (exists) {
        formatId = rawFormatId
      } else {
        warnings.push(`[Downloader] Format ${rawFormatId} không hợp lệ -> fallback best`)
      }
    } else {
      warnings.push(`[Downloader] Format ${rawFormatId} không xác minh được -> fallback best`)
    }
  }

  const requiresAudioChoice = shouldDownloadVideo && (mergeAudio || downloadSeparateAudio)
  const rawAudioFormatId = input.selectedAudioFormatId?.trim() || ''
  const canValidateAudio = Array.isArray(input.knownAudioFormats)
  let audioFormatId: string | undefined
  if (requiresAudioChoice && rawAudioFormatId) {
    if (canValidateAudio) {
      const exists = input.knownAudioFormats!.some((format) => format.id === rawAudioFormatId)
      if (exists) {
        audioFormatId = rawAudioFormatId
      } else {
        warnings.push(`[Downloader] Audio ${rawAudioFormatId} không hợp lệ -> fallback best`)
      }
    } else {
      warnings.push(`[Downloader] Audio ${rawAudioFormatId} không xác minh được -> fallback best`)
    }
  }

  let subtitleLangs: string[] | undefined
  let convertSubs: string | undefined
  if (input.downloadSubtitle) {
    if (input.downloadAllSubs) {
      subtitleLangs = ['all']
    } else {
      const selected = normalizeLangs(input.selectedSubLangs)
      if (selected.length > 0) {
        subtitleLangs = selected
      } else {
        subtitleLangs = pickDefaultSubtitleLangs(normalizeLangs(input.allSubtitleLangs))
      }
    }
    if (subtitleLangs.length === 0) {
      subtitleLangs = undefined
    }
    convertSubs = subtitleLangs ? (input.convertSubs || 'srt') : undefined
  }

  let playlistItems: number[] | undefined
  if (input.allowPlaylist) {
    const explicitSelection = input.selectedPlaylistIndexes
    if (explicitSelection) {
      const normalized = uniqSortedPositiveNumbers(explicitSelection)
      const validIndexes = uniqSortedPositiveNumbers(input.validPlaylistIndexes || [])
      const filtered = validIndexes.length > 0
        ? normalized.filter((value) => validIndexes.includes(value))
        : normalized

      if (normalized.length > 0 && filtered.length < normalized.length) {
        warnings.push('[Downloader] Một số playlist index không hợp lệ đã bị bỏ qua')
      }
      if (filtered.length === 0) {
        return {
          options: {
            downloadVideo: shouldDownloadVideo,
            formatId,
            audioFormatId,
            mergeAudio,
            downloadSeparateAudio,
            subtitleLangs,
            convertSubs,
            skipDanmakuConvert: input.skipDanmakuConvert,
            writeThumbnail: input.downloadThumbnail,
            allowPlaylist: true,
          },
          warnings,
          error: 'Chưa chọn video nào trong playlist.',
        }
      }

      const totalSelectable = validIndexes.length > 0 ? validIndexes.length : filtered.length
      if (filtered.length < totalSelectable) {
        playlistItems = filtered
      }
    }
  }

  return {
    options: {
      downloadVideo: shouldDownloadVideo,
      formatId: shouldDownloadVideo ? formatId : undefined,
      audioFormatId: shouldDownloadVideo ? audioFormatId : undefined,
      mergeAudio,
      downloadSeparateAudio,
      subtitleLangs,
      convertSubs,
      skipDanmakuConvert: input.skipDanmakuConvert,
      writeThumbnail: input.downloadThumbnail,
      allowPlaylist: input.allowPlaylist,
      playlistItems,
    },
    warnings,
  }
}
