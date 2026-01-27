import { BrowserWindow, ipcMain } from 'electron'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { PROJECT_IPC_CHANNELS, ProjectMetadata } from '../../shared/types/project'
import { createEditorWindow } from '../windowManager'
import { AppSettingsService } from '../services/appSettings'

const PROJECT_FILE = 'project.json'

// Quét thư mục projects để tìm tất cả project hợp lệ
function scanProjects(basePath: string): ProjectMetadata[] {
  try {
    if (!fs.existsSync(basePath)) {
      console.log('[ProjectHandlers] Thư mục projects không tồn tại:', basePath)
      return []
    }

    const entries = fs.readdirSync(basePath, { withFileTypes: true })
    const projects: ProjectMetadata[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const projectPath = path.join(basePath, entry.name)
      const metadataPath = path.join(projectPath, PROJECT_FILE)

      if (fs.existsSync(metadataPath)) {
        try {
          const content = fs.readFileSync(metadataPath, 'utf-8')
          const metadata: ProjectMetadata = JSON.parse(content)
          projects.push(metadata)
        } catch (err) {
          console.error(`[ProjectHandlers] Lỗi đọc metadata của project ${entry.name}:`, err)
        }
      }
    }

    return projects.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (error) {
    console.error('[ProjectHandlers] Lỗi quét thư mục projects:', error)
    return []
  }
}

// Tạo project mới với thư mục và file metadata
function createProject(basePath: string, projectName: string): ProjectMetadata | null {
  try {
    const projectId = projectName.toLowerCase().replace(/[^a-z0-9-_]/g, '-')
    const projectPath = path.join(basePath, projectId)

    if (fs.existsSync(projectPath)) {
      throw new Error('Project đã tồn tại')
    }

    // Tạo thư mục project
    fs.mkdirSync(projectPath, { recursive: true })

    // Tạo metadata
    const metadata: ProjectMetadata = {
      id: projectId,
      name: projectName,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    // Lưu file project.json
    const metadataPath = path.join(projectPath, PROJECT_FILE)
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')

    console.log('[ProjectHandlers] Đã tạo project:', projectId)
    return metadata
  } catch (error) {
    console.error('[ProjectHandlers] Lỗi tạo project:', error)
    return null
  }
}

// Xử lý luồng mở project và tráo đổi cửa sổ Dashboard ↔ Editor
export function registerProjectHandlers(): void {
  ipcMain.handle(PROJECT_IPC_CHANNELS.OPEN, async (event, projectId: string) => {
    try {
      if (!projectId) {
        console.error('[Lỗi] Thiếu projectId để mở project')
        return { success: false, error: 'Thiếu projectId để mở project' }
      }

      createEditorWindow(projectId)

      // Lưu lại project vừa mở
      AppSettingsService.addRecentProject(projectId)

      const currentWin = BrowserWindow.fromWebContents(event.sender)
      if (currentWin) {
        currentWin.close()
      }

      console.log(`[Hệ thống] Đã mở project ${projectId} và đóng Dashboard`)
      return { success: true }
    } catch (error) {
      console.error('[Lỗi] Không thể chuyển đổi cửa sổ:', error)
      return { success: false, error: 'Chuyển đổi cửa sổ thất bại' }
    }
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.CREATE_AND_OPEN, async (event, projectName: string) => {
    try {
      if (!projectName || !projectName.trim()) {
        return { success: false, error: 'Thiếu tên project' }
      }

      const basePath = AppSettingsService.getProjectsBasePath()
      if (!basePath) {
        return { success: false, error: 'Chưa cấu hình thư mục Projects trong Settings' }
      }

      const metadata = createProject(basePath, projectName.trim())
      if (!metadata) {
        return { success: false, error: 'Không thể tạo project' }
      }

      createEditorWindow(metadata.id)
      AppSettingsService.setLastActiveProjectId(metadata.id)

      const currentWin = BrowserWindow.fromWebContents(event.sender)
      if (currentWin) {
        currentWin.close()
      }

      console.log(`[Hệ thống] Đã tạo và mở project ${metadata.id}`)
      return { success: true, data: metadata }
    } catch (error) {
      console.error('[Lỗi] Không thể tạo và mở project:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.SCAN_PROJECTS, async () => {
    try {
      const basePath = AppSettingsService.getProjectsBasePath()
      if (!basePath) {
        return { success: true, data: [] }
      }

      const projects = scanProjects(basePath)
      return { success: true, data: projects }
    } catch (error) {
      console.error('[Lỗi] Không thể quét projects:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_PROJECTS_PATH, async () => {
    try {
      const basePath = AppSettingsService.getProjectsBasePath()
      return { success: true, data: basePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.SET_PROJECTS_PATH, async (event, newPath: string) => {
    try {
      AppSettingsService.setProjectsBasePath(newPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
