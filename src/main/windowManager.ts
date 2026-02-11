import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// Lưu tham chiếu các cửa sổ để quản lý vòng đời
let dashboardWindow: BrowserWindow | null = null
const editorWindows = new Map<string, BrowserWindow>()

function buildRendererUrl(route: string, params?: Record<string, string>): string {
  const search = params ? new URLSearchParams(params).toString() : ''
  const hashPath = route.startsWith('/') ? route : `/${route}`
  const hash = search ? `${hashPath}?${search}` : hashPath

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}#${hash}`
  }

  const filePath = join(__dirname, '../renderer/index.html')
  return `file://${filePath}#${hash}`
}

function createBaseWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })
}

function attachCommonHandlers(win: BrowserWindow): void {
  // Mở liên kết ngoài bằng trình duyệt hệ thống
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

export function createDashboardWindow(): BrowserWindow {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus()
    return dashboardWindow
  }

  dashboardWindow = createBaseWindow()
  attachCommonHandlers(dashboardWindow)

  dashboardWindow.on('ready-to-show', () => {
    dashboardWindow?.maximize()
    dashboardWindow?.show()
  })

  const url = buildRendererUrl('/projects')
  dashboardWindow.loadURL(url)

  dashboardWindow.on('closed', () => {
    dashboardWindow = null
  })

  console.log('[Cửa sổ] Đã mở Dashboard')
  return dashboardWindow
}

export function createEditorWindow(projectId: string): BrowserWindow {
  const editorWindow = createBaseWindow()
  attachCommonHandlers(editorWindow)

  editorWindow.on('ready-to-show', () => {
    editorWindow.maximize()
    editorWindow.show()
  })

  const url = buildRendererUrl('story-translator', { projectId })
  editorWindow.loadURL(url)

  editorWindow.on('closed', () => {
    editorWindows.delete(projectId)
    // Khi đóng Editor, tự động quay lại Dashboard nếu chưa có
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      createDashboardWindow()
    }
  })

  editorWindows.set(projectId, editorWindow)
  console.log(`[Cửa sổ] Đã mở Editor cho project ${projectId}`)
  return editorWindow
}

export function getDashboardWindow(): BrowserWindow | null {
  return dashboardWindow
}
