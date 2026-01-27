export interface ProjectPaths {
  story: string
  caption: string
  tts: string
  gemini: string
}

export type ProjectFeature = keyof ProjectPaths

export interface ProjectResolvedPaths {
  root: string
  story: string
  caption: string
  tts: string
  gemini: string
}

export interface ProjectMetadata {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  paths: ProjectPaths
}

export const PROJECT_IPC_CHANNELS = {
  OPEN: 'project:open',
  CREATE_AND_OPEN: 'project:createAndOpen',
  SCAN_PROJECTS: 'project:scanProjects',
  GET_METADATA: 'project:getMetadata',
  GET_RESOLVED_PATHS: 'project:getResolvedPaths',
  READ_FEATURE_FILE: 'project:readFeatureFile',
  WRITE_FEATURE_FILE: 'project:writeFeatureFile',
  GET_PROJECTS_PATH: 'project:getProjectsPath',
  SET_PROJECTS_PATH: 'project:setProjectsPath'
} as const;
