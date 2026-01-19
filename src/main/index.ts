import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc'
import { initDatabase } from './database/schema'
import { tryImportDevKeys } from './services/gemini/apiKeys'

function createWindow(): void {
  // Tạo cửa sổ ứng dụng
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Ẩn cho đến khi sẵn sàng
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  // Hiển thị và maximize khi đã load xong
  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize() // Toàn màn hình trừ taskbar
    mainWindow.show()
  })

  // Mở link external trong browser thay vì trong app
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // === ĐIỂM QUAN TRỌNG ===
  // Development: Load từ Vite dev server (có HMR)
  // Production: Load trực tiếp file HTML (KHÔNG CẦN LOCALHOST)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // Production: Load file HTML trực tiếp - KHÔNG CẦN SERVER
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Khởi tạo app khi Electron sẵn sàng
app.whenReady().then(() => {
  // Thiết lập app ID cho Windows
  electronApp.setAppUserModelId('com.veo3promptbuilder')

  // Khởi tạo Database
  initDatabase()

  // Đăng ký IPC handlers
  registerAllHandlers()

  // Auto import dev keys
  tryImportDevKeys()

  // Tối ưu hóa shortcuts trong development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // macOS: Tạo lại cửa sổ khi click vào dock icon
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Thoát app khi tất cả cửa sổ đóng (ngoại trừ macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
