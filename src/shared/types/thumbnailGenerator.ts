export const THUMBNAIL_IPC_CHANNELS = {
  GENERATE: 'thumbnail:generate',
  GENERATE_FROM_IMAGE: 'thumbnail:generateFromImage',
  GET_HISTORY: 'thumbnail:getHistory',
  DELETE_HISTORY_ENTRY: 'thumbnail:deleteHistoryEntry',
  CLEAR_HISTORY: 'thumbnail:clearHistory',
  GET_SETTINGS: 'thumbnail:getSettings',
  UPDATE_SETTINGS: 'thumbnail:updateSettings',
  GET_CONFIG: 'thumbnail:getConfig',
  UPDATE_CONFIG: 'thumbnail:updateConfig',
} as const

export interface ThumbnailGenerationOptions {
  prompt: string
  enhancePrompt?: boolean
  imageCount?: number
  category?: string
  mood?: string
  theme?: string
  primaryColor?: string
  includeText?: boolean
  textStyle?: string
  thumbnailStyle?: string
  customPrompt?: string
  inputImageInfo?: { originalName: string; size: number; mimeType: string }
}

export interface ThumbnailGenerationResult {
  success: boolean
  imagePaths: string[]
  finalPrompt: string
  enhanced: boolean
  error?: string
}

export interface ThumbnailHistoryEntry {
  id: string
  type: 'text-to-image' | 'image-to-image'
  originalPrompt: string
  finalPrompt: string
  enhancedPrompt: boolean
  category?: string
  mood?: string
  theme?: string
  primaryColor?: string
  includeText?: boolean
  textStyle?: string
  thumbnailStyle?: string
  customPrompt?: string
  inputImagePath?: string
  inputImageInfo?: { originalName: string; size: number; mimeType: string }
  imagesGenerated: number
  imagePaths: string[]
  createdAt: number
}

export interface ThumbnailHistoryResult {
  entries: ThumbnailHistoryEntry[]
  total: number
  hasMore: boolean
}

export interface ThumbnailSettings {
  outputDir: string
}

export interface ThumbnailGeneratorConfig {
  geminiApiKey: string
  openaiApiKey: string
}
