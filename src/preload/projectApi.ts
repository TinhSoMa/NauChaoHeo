import { ipcRenderer } from 'electron'
import {
  PROJECT_IPC_CHANNELS,
  ProjectFeature,
  ProjectMetadata,
  ProjectResolvedPaths
} from '../shared/types/project'

interface IpcApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface ProjectAPI {
  openProject: (projectId: string) => Promise<IpcApiResponse<void>>
  createAndOpen: (projectName: string) => Promise<IpcApiResponse<ProjectMetadata>>
  scanProjects: () => Promise<IpcApiResponse<ProjectMetadata[]>>
  getMetadata: (projectId: string) => Promise<IpcApiResponse<ProjectMetadata>>
  getResolvedPaths: (projectId: string) => Promise<IpcApiResponse<ProjectResolvedPaths>>
  readFeatureFile: (payload: { projectId: string; feature: ProjectFeature; fileName: string }) => Promise<IpcApiResponse<string | null>>
  writeFeatureFile: (payload: { projectId: string; feature: ProjectFeature; fileName: string; content: unknown }) => Promise<IpcApiResponse<void>>
  getProjectsPath: () => Promise<IpcApiResponse<string | null>>
  setProjectsPath: (path: string) => Promise<IpcApiResponse<void>>
}

export const projectApi: ProjectAPI = {
  openProject: (projectId) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.OPEN, projectId),
  createAndOpen: (projectName) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.CREATE_AND_OPEN, projectName),
  scanProjects: () => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.SCAN_PROJECTS),
  getMetadata: (projectId) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_METADATA, projectId),
  getResolvedPaths: (projectId) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_RESOLVED_PATHS, projectId),
  readFeatureFile: (payload) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.READ_FEATURE_FILE, payload),
  writeFeatureFile: (payload) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.WRITE_FEATURE_FILE, payload),
  getProjectsPath: () => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_PROJECTS_PATH),
  setProjectsPath: (path) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.SET_PROJECTS_PATH, path)
}
