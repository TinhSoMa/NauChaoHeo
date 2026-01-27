export interface ProjectMetadata {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export const PROJECT_IPC_CHANNELS = {
  OPEN: 'project:open',
  CREATE_AND_OPEN: 'project:createAndOpen',
  SCAN_PROJECTS: 'project:scanProjects',
  GET_PROJECTS_PATH: 'project:getProjectsPath',
  SET_PROJECTS_PATH: 'project:setProjectsPath'
} as const;
