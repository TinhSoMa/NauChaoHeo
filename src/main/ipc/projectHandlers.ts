import { BrowserWindow, ipcMain } from 'electron'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  PROJECT_IPC_CHANNELS,
  ProjectMetadata,
  ProjectPaths,
  ProjectFeature,
  ProjectResolvedPaths
} from '../../shared/types/project'
import { createEditorWindow } from '../windowManager'
import { AppSettingsService } from '../services/appSettings'

const PROJECT_FILE = 'project.json'
const DEFAULT_PROJECT_PATHS: ProjectPaths = {
  story: 'story',
  caption: 'caption',
  tts: 'tts',
  gemini: 'gemini-chat'
}

function getProjectsBasePathOrThrow(): string {
  const basePath = AppSettingsService.getProjectsBasePath()
  if (!basePath) {
    throw new Error('Chưa cấu hình thư mục Projects trong Settings')
  }
  return basePath
}

function readProjectMetadata(projectId: string): ProjectMetadata {
  const basePath = getProjectsBasePathOrThrow()
  const projectPath = path.join(basePath, projectId)
  const metadataPath = path.join(projectPath, PROJECT_FILE)

  if (!fs.existsSync(metadataPath)) {
    throw new Error('Không tìm thấy project.json')
  }

  const content = fs.readFileSync(metadataPath, 'utf-8')
  const metadata: ProjectMetadata = JSON.parse(content)

  if (!metadata.paths) {
    metadata.paths = { ...DEFAULT_PROJECT_PATHS }
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')
  }

  return metadata
}

function resolveProjectPaths(projectId: string): ProjectResolvedPaths {
  const basePath = getProjectsBasePathOrThrow()
  const metadata = readProjectMetadata(projectId)
  const projectRoot = path.join(basePath, projectId)

  return {
    root: projectRoot,
    story: path.join(projectRoot, metadata.paths.story),
    caption: path.join(projectRoot, metadata.paths.caption),
    tts: path.join(projectRoot, metadata.paths.tts),
    gemini: path.join(projectRoot, metadata.paths.gemini)
  }
}

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
          if (!metadata.paths) {
            metadata.paths = { ...DEFAULT_PROJECT_PATHS }
          }
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

    // Tạo thư mục con theo cấu hình feature
    const featureFolders = Object.values(DEFAULT_PROJECT_PATHS)
    for (const folderName of featureFolders) {
      const featurePath = path.join(projectPath, folderName)
      fs.mkdirSync(featurePath, { recursive: true })
    }

    // Tạo metadata
    const metadata: ProjectMetadata = {
      id: projectId,
      name: projectName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paths: { ...DEFAULT_PROJECT_PATHS }
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
  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_METADATA, async (_event, projectId: string) => {
    try {
      if (!projectId) {
        return { success: false, error: 'Thiếu projectId' }
      }

      const metadata = readProjectMetadata(projectId)
      return { success: true, data: metadata }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_RESOLVED_PATHS, async (_event, projectId: string) => {
    try {
      if (!projectId) {
        return { success: false, error: 'Thiếu projectId' }
      }

      const paths = resolveProjectPaths(projectId)
      return { success: true, data: paths }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.READ_FEATURE_FILE,
    async (_event, payload: { projectId: string; feature: ProjectFeature; fileName: string }) => {
      try {
        const { projectId, feature, fileName } = payload
        if (!projectId || !feature || !fileName) {
          return { success: false, error: 'Thiếu tham số' }
        }

        const metadata = readProjectMetadata(projectId)
        const basePath = getProjectsBasePathOrThrow()
        const projectRoot = path.join(basePath, projectId)
        const featureDir = path.join(projectRoot, metadata.paths[feature])
        const filePath = path.join(featureDir, fileName)

        if (!fs.existsSync(filePath)) {
          return { success: true, data: null }
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        return { success: true, data: content }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.WRITE_FEATURE_FILE,
    async (
      _event,
      payload: { projectId: string; feature: ProjectFeature; fileName: string; content: unknown }
    ) => {
      try {
        const { projectId, feature, fileName, content } = payload
        if (!projectId || !feature || !fileName) {
          return { success: false, error: 'Thiếu tham số' }
        }

        const metadata = readProjectMetadata(projectId)
        const basePath = getProjectsBasePathOrThrow()
        const projectRoot = path.join(basePath, projectId)
        const featureDir = path.join(projectRoot, metadata.paths[feature])
        const filePath = path.join(featureDir, fileName)

        if (!fs.existsSync(featureDir)) {
          fs.mkdirSync(featureDir, { recursive: true })
        }

        const dataToWrite = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
        fs.writeFileSync(filePath, dataToWrite, 'utf-8')
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }
  )

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
