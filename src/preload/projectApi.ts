import { ipcRenderer } from 'electron'
import { PROJECT_IPC_CHANNELS, ProjectMetadata } from '../shared/types/project'

interface IpcApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface ProjectAPI {
  openProject: (projectId: string) => Promise<IpcApiResponse<void>>
  createAndOpen: (projectName: string) => Promise<IpcApiResponse<ProjectMetadata>>
  scanProjects: () => Promise<IpcApiResponse<ProjectMetadata[]>>
  getProjectsPath: () => Promise<IpcApiResponse<string | null>>
  setProjectsPath: (path: string) => Promise<IpcApiResponse<void>>
}

export const projectApi: ProjectAPI = {
  openProject: (projectId) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.OPEN, projectId),
  createAndOpen: (projectName) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.CREATE_AND_OPEN, projectName),
  scanProjects: () => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.SCAN_PROJECTS),
  getProjectsPath: () => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_PROJECTS_PATH),
  setProjectsPath: (path) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.SET_PROJECTS_PATH, path)
}
