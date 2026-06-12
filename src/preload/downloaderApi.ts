import { ipcRenderer } from 'electron'
import type { VideoInfo, DownloadOptions, DownloadProgress, CookieEntry, PlaylistInfo } from '../shared/types/downloader'

export interface DownloaderAPI {
  fetchInfo: (payload: { url: string; allowPlaylist?: boolean }) => Promise<{
    success: boolean
    data?: VideoInfo
    cookieFound?: boolean
    cookieDomain?: string
    error?: string
  }>
  checkPlaylist: (payload: string | { url: string; limit?: number }) => Promise<{
    success: boolean
    data?: PlaylistInfo
    cookieFound?: boolean
    cookieDomain?: string
    error?: string
  }>
  fetchPreview: (url: string) => Promise<{
    success: boolean
    data?: string
    cookieFound?: boolean
    cookieDomain?: string
    error?: string
  }>
  fetchPlaylistMetadata: (payload: { urls: string[] }) => Promise<{
    success: boolean
    data?: {
      items: Record<string, {
        id?: string
        title?: string
        duration?: number
        uploader?: string
        url?: string
      }>
    }
    error?: string
  }>
  startDownload: (options: DownloadOptions) => Promise<{ success: boolean; error?: string }>
  stopDownload: () => Promise<{ success: boolean }>
  onLog: (cb: (line: string) => void) => () => void
  onProgress: (cb: (data: DownloadProgress) => void) => () => void

  getCookies: () => Promise<{ success: boolean; data?: CookieEntry[]; error?: string }>
  saveCookie: (entry: { domain: string; label: string; content: string }) => Promise<{
    success: boolean; data?: CookieEntry; error?: string
  }>
  deleteCookie: (id: string) => Promise<{ success: boolean; error?: string }>

  openOutputDir: (dir: string) => Promise<void>
  getDefaultOutputDir: () => Promise<string>
  extractDomain: (url: string) => Promise<string>
  resolveOutputSubdir: (baseDir: string, rawName: string) => Promise<string>
}

export const downloaderApi: DownloaderAPI = {
  fetchInfo: (payload) => ipcRenderer.invoke('downloader:fetchInfo', payload),
  checkPlaylist: (payload) => ipcRenderer.invoke('downloader:checkPlaylist', payload),
  fetchPreview: (url) => ipcRenderer.invoke('downloader:fetchPreview', url),
  fetchPlaylistMetadata: (payload) => ipcRenderer.invoke('downloader:fetchPlaylistMetadata', payload),
  startDownload: (options) => ipcRenderer.invoke('downloader:startDownload', options),
  stopDownload: () => ipcRenderer.invoke('downloader:stopDownload'),

  onLog: (cb) => {
    const sub = (_e: any, line: string) => cb(line)
    ipcRenderer.on('downloader:log', sub)
    return () => ipcRenderer.removeListener('downloader:log', sub)
  },
  onProgress: (cb) => {
    const sub = (_e: any, data: DownloadProgress) => cb(data)
    ipcRenderer.on('downloader:progress', sub)
    return () => ipcRenderer.removeListener('downloader:progress', sub)
  },

  getCookies: () => ipcRenderer.invoke('downloader:getCookies'),
  saveCookie: (entry) => ipcRenderer.invoke('downloader:saveCookie', entry),
  deleteCookie: (id) => ipcRenderer.invoke('downloader:deleteCookie', id),

  openOutputDir: (dir) => ipcRenderer.invoke('downloader:openOutputDir', dir),
  getDefaultOutputDir: () => ipcRenderer.invoke('downloader:getDefaultOutputDir'),
  extractDomain: (url) => ipcRenderer.invoke('downloader:extractDomain', url),
  resolveOutputSubdir: (baseDir, rawName) => ipcRenderer.invoke('downloader:resolveOutputSubdir', baseDir, rawName),
}
