import { ipcMain, shell, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { ytDlpService } from '../services/downloader/ytDlpService'
import { cookieDatabase, extractRootDomain } from '../database/cookieDatabase'
import { AppSettingsService } from '../services/appSettings'
import type { DownloadOptions, PlaylistInfo } from '../../shared/types/downloader'

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

export function registerDownloaderHandlers(): void {
  // ── Info fetch ────────────────────────────────────────────────────────────
  ipcMain.handle('downloader:fetchInfo', async (_event, payload: { url: string; allowPlaylist?: boolean }) => {
    const url = payload?.url
    if (!url) return { success: false, error: 'Missing URL' }
    try {
      const cookie = cookieDatabase.getByDomain(url)
      let tmpPath: string | undefined
      if (cookie) {
        tmpPath = ytDlpService.writeTempCookie(cookie.content)
      }
      try {
        const info = await ytDlpService.fetchVideoInfo(url, tmpPath, payload?.allowPlaylist)
        return { success: true, data: info, cookieFound: !!cookie, cookieDomain: cookie?.domain }
      } finally {
        if (tmpPath) ytDlpService.cleanupTempCookie(tmpPath)
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('downloader:checkPlaylist', async (_event, url: string) => {
    if (!url) return { success: false, error: 'Missing URL' }
    try {
      const cookie = cookieDatabase.getByDomain(url)
      let tmpPath: string | undefined
      if (cookie) {
        tmpPath = ytDlpService.writeTempCookie(cookie.content)
      }
      try {
        const info: PlaylistInfo = await ytDlpService.fetchPlaylistInfo(url, tmpPath)
        return { success: true, data: info, cookieFound: !!cookie, cookieDomain: cookie?.domain }
      } finally {
        if (tmpPath) ytDlpService.cleanupTempCookie(tmpPath)
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('downloader:fetchPreview', async (_event, url: string) => {
    if (!url) return { success: false, error: 'Missing URL' }
    try {
      const cookie = cookieDatabase.getByDomain(url)
      let tmpPath: string | undefined
      if (cookie) {
        tmpPath = ytDlpService.writeTempCookie(cookie.content)
      }
      try {
        const previewUrl = await ytDlpService.fetchPreviewUrl(url, tmpPath)
        return { success: true, data: previewUrl, cookieFound: !!cookie, cookieDomain: cookie?.domain }
      } finally {
        if (tmpPath) ytDlpService.cleanupTempCookie(tmpPath)
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Download ───────────────────────────────────────────────────────────────
  ipcMain.handle('downloader:startDownload', async (event, options: DownloadOptions & { cookiePath?: string }) => {
    const sender = event.sender

    let tmpCookiePath: string | undefined

    try {
      // Resolve cookie
      if (options.useCookie) {
        const cookie = cookieDatabase.getByDomain(options.url)
        if (cookie) {
          tmpCookiePath = ytDlpService.writeTempCookie(cookie.content)
          ;(options as any).cookiePath = tmpCookiePath
        }
      }

      await ytDlpService.startDownload(
        options,
        (line) => sender.send('downloader:log', line),
        (progress) => sender.send('downloader:progress', progress),
      )
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    } finally {
      if (tmpCookiePath) ytDlpService.cleanupTempCookie(tmpCookiePath)
    }
  })

  ipcMain.handle('downloader:stopDownload', async () => {
    ytDlpService.stopDownload()
    return { success: true }
  })

  // ── Cookie management ──────────────────────────────────────────────────────
  ipcMain.handle('downloader:getCookies', async () => {
    try {
      return { success: true, data: cookieDatabase.getAll() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('downloader:saveCookie', async (_event, entry: { domain: string; label: string; content: string }) => {
    try {
      const saved = cookieDatabase.upsert(entry)
      return { success: true, data: saved }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('downloader:deleteCookie', async (_event, id: string) => {
    try {
      cookieDatabase.remove(id)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Open output directory ──────────────────────────────────────────────────
  ipcMain.handle('downloader:openOutputDir', async (_event, dir: string) => {
    await shell.openPath(dir)
  })

  // ── Default output dir ─────────────────────────────────────────────────────
  ipcMain.handle('downloader:getDefaultOutputDir', async () => {
    const settings = AppSettingsService.getAll()
    const fromSettings = settings.downloaderOutputDir?.trim()
    return fromSettings && fromSettings.length > 0
      ? fromSettings
      : path.join(app.getPath('downloads'), 'NauChaoHeo')
  })

  ipcMain.handle('downloader:resolveOutputSubdir', async (_event, baseDir: string, rawName: string) => {
    const safeBase = baseDir || path.join(app.getPath('downloads'), 'NauChaoHeo')
    const safeName = sanitizeFolderName(rawName) || `video_${Date.now()}`
    const basePath = path.join(safeBase, safeName)
    let finalPath = basePath
    let index = 2
    while (fs.existsSync(finalPath)) {
      finalPath = `${basePath} (${index})`
      index += 1
    }
    return finalPath
  })

  // ── Extract domain helper ──────────────────────────────────────────────────
  ipcMain.handle('downloader:extractDomain', async (_event, url: string) => {
    return extractRootDomain(url)
  })
}
