import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { extname } from 'path'

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:showOpenDialog', async (_event, options: Electron.OpenDialogOptions) => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return []
    const result = await dialog.showOpenDialog(window, options)
    return result.filePaths
  })

  ipcMain.handle('image:getDataUrl', async (_event, filePath: string) => {
    try {
      const cleanPath = filePath.replace(/^file:\/\//i, '')
      const ext = extname(cleanPath).toLowerCase()
      const mime = MIME_MAP[ext] || 'image/png'
      const buffer = await readFile(cleanPath)
      const base64 = buffer.toString('base64')
      return `data:${mime};base64,${base64}`
    } catch {
      return ''
    }
  })
}
