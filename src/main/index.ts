import { app, BrowserWindow, ipcMain } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc'
import { initDatabase } from './database/schema'
import { tryImportDevKeys } from './services/gemini/apiKeys'
import { AppSettingsService } from './services/appSettings'
import { createDashboardWindow } from './windowManager'
import { cleanTempFiles } from './services/caption/garbageCollector'
import { installMainConsoleCapture } from './services/logging/consoleCapture'

installMainConsoleCapture()
let isQuitInProgress = false

// Khởi tạo app khi Electron sẵn sàng
app.whenReady().then(() => {
  // Thiết lập app ID cho Windows
  electronApp.setAppUserModelId('com.veo3promptbuilder')

  // Khởi tạo Database (chỉ cho prompts table)
  initDatabase()

  // Khởi tạo App Settings
  AppSettingsService.initialize()

  // Đăng ký IPC handlers
  registerAllHandlers()

  // Auto import dev keys
  tryImportDevKeys()

  // Tối ưu hóa shortcuts trong development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createDashboardWindow()

  // macOS: Tạo lại cửa sổ khi click vào dock icon
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createDashboardWindow()
    }
  })
})

// Thoát app khi tất cả cửa sổ đóng (ngoại trừ macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Dọn dẹp rác và flush caption settings trước khi ứng dụng đóng
app.on('before-quit', (event) => {
  if (isQuitInProgress) {
    cleanTempFiles()
    return
  }

  event.preventDefault()
  isQuitInProgress = true

  const windows = BrowserWindow.getAllWindows()
  const finishQuit = () => {
    cleanTempFiles()
    app.quit()
  }

  if (windows.length === 0) {
    finishQuit()
    return
  }

  const timeout = setTimeout(() => {
    finishQuit()
  }, 1500)

  ipcMain.once('app:flushCaptionSettings:done', () => {
    clearTimeout(timeout)
    finishQuit()
  })

  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:flushCaptionSettings')
    }
  }
})
