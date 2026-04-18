import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { DownloadOptions, VideoFormat } from '../../../../shared/types/downloader'
import { resolveDownloadIntent } from '../../../../shared/downloader/resolvedDownloadIntent'
import { buildArgs } from '../ytDlpArgs'

const videoFormats: VideoFormat[] = [
  { id: '137', resolution: '1080p', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none' },
  { id: '22', resolution: '720p', ext: 'mp4', vcodec: 'avc1.4d401f', acodec: 'mp4a.40.2' },
]

const audioFormats: VideoFormat[] = [
  { id: '140', resolution: 'audio only', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', tbr: 128 },
]

describe('resolveDownloadIntent', () => {
  test('enforces video-off precedence', () => {
    const resolved = resolveDownloadIntent({
      downloadVideo: false,
      mergeAudio: true,
      downloadSeparateAudio: true,
      selectedFormatId: '137',
      selectedAudioFormatId: '140',
      knownVideoFormats: videoFormats,
      knownAudioFormats: audioFormats,
      downloadSubtitle: false,
      downloadAllSubs: true,
      selectedSubLangs: [],
      allSubtitleLangs: [],
      convertSubs: 'srt',
      skipDanmakuConvert: true,
      downloadThumbnail: true,
      allowPlaylist: false,
    })

    assert.equal(resolved.options.downloadVideo, false)
    assert.equal(resolved.options.mergeAudio, false)
    assert.equal(resolved.options.downloadSeparateAudio, false)
    assert.equal(resolved.options.formatId, undefined)
    assert.equal(resolved.options.audioFormatId, undefined)
  })

  test('keeps manual subtitle selection when downloadAllSubs is false', () => {
    const resolved = resolveDownloadIntent({
      downloadVideo: true,
      mergeAudio: true,
      downloadSeparateAudio: false,
      selectedFormatId: '22',
      selectedAudioFormatId: '140',
      knownVideoFormats: videoFormats,
      knownAudioFormats: audioFormats,
      downloadSubtitle: true,
      downloadAllSubs: false,
      selectedSubLangs: ['en', 'vi'],
      allSubtitleLangs: ['vi', 'en', 'ja'],
      convertSubs: 'srt',
      skipDanmakuConvert: true,
      downloadThumbnail: false,
      allowPlaylist: false,
    })

    assert.deepEqual(resolved.options.subtitleLangs, ['en', 'vi'])
    assert.equal(resolved.options.convertSubs, 'srt')
  })

  test('returns error when explicit playlist selection has no valid item', () => {
    const resolved = resolveDownloadIntent({
      downloadVideo: true,
      mergeAudio: true,
      downloadSeparateAudio: false,
      selectedFormatId: '22',
      selectedAudioFormatId: '',
      knownVideoFormats: videoFormats,
      knownAudioFormats: audioFormats,
      downloadSubtitle: false,
      downloadAllSubs: true,
      selectedSubLangs: [],
      allSubtitleLangs: [],
      convertSubs: 'srt',
      skipDanmakuConvert: true,
      downloadThumbnail: false,
      allowPlaylist: true,
      selectedPlaylistIndexes: [0, -1],
      validPlaylistIndexes: [1, 2, 3],
    })

    assert.equal(resolved.error, 'Chưa chọn video nào trong playlist.')
  })
})

describe('buildArgs', () => {
  test('adds merge fallback for explicit video-only format in non-playlist', () => {
    const options: DownloadOptions = {
      url: 'https://www.youtube.com/watch?v=abc',
      outputDir: 'D:/tmp',
      downloadVideo: true,
      formatId: '137',
      mergeAudio: true,
      downloadSeparateAudio: false,
      subtitleLangs: undefined,
      convertSubs: undefined,
      skipDanmakuConvert: true,
      writeThumbnail: false,
      useCookie: false,
      speedProfile: 'balanced',
      noLogoPolicy: 'off',
      allowPlaylist: false,
    }

    const args = buildArgs(options, undefined, 'balanced', false, 'off')
    const formatIndex = args.findIndex((arg) => arg === '-f')
    assert.notEqual(formatIndex, -1)
    assert.match(args[formatIndex + 1], /137\+bestaudio/)
  })

  test('applies sorted unique playlist-items', () => {
    const options: DownloadOptions = {
      url: 'https://www.youtube.com/playlist?list=xyz',
      outputDir: 'D:/tmp',
      downloadVideo: true,
      mergeAudio: true,
      downloadSeparateAudio: false,
      subtitleLangs: undefined,
      convertSubs: undefined,
      skipDanmakuConvert: true,
      writeThumbnail: false,
      useCookie: false,
      speedProfile: 'balanced',
      noLogoPolicy: 'off',
      allowPlaylist: true,
      playlistItems: [3, 1, 3, 2],
    }

    const args = buildArgs(options, undefined, 'balanced', false, 'off')
    const idx = args.findIndex((arg) => arg === '--playlist-items')
    assert.notEqual(idx, -1)
    assert.equal(args[idx + 1], '1,2,3')
  })
})
