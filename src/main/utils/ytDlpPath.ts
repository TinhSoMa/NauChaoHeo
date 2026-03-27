/**
 * yt-dlp Path Utilities - Lấy đường dẫn yt-dlp cho cả dev và production
 */

import { app } from 'electron'
import path from 'path'
import { existsSync } from 'fs'

/**
 * Lấy đường dẫn tới yt-dlp
 * - Dev mode (Windows): resources/yt-dlp/win64/yt-dlp.exe
 * - Production (Windows): resources/yt-dlp/yt-dlp.exe
 */
export function getYtDlpPath(): string {
  const isPackaged = app.isPackaged
  const isWin = process.platform === 'win32'

  if (isWin) {
    if (isPackaged) {
      return path.join(process.resourcesPath, 'yt-dlp', 'yt-dlp.exe')
    }
    return path.join(app.getAppPath(), 'resources', 'yt-dlp', 'win64', 'yt-dlp.exe')
  }

  if (isPackaged) {
    return path.join(process.resourcesPath, 'yt-dlp', 'yt-dlp')
  }
  return path.join(app.getAppPath(), 'resources', 'yt-dlp', 'bin', 'yt-dlp')
}

export function isYtDlpAvailable(): boolean {
  const ytDlpPath = getYtDlpPath()
  return existsSync(ytDlpPath)
}
