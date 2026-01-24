/**
 * Types cho Translation Projects
 * Quản lý dự án dịch truyện với persistence
 */

// ============================================
// PROJECT SETTINGS (Template mặc định)
// ============================================

export interface ProjectSettings {
  sourceLang: string;
  targetLang: string;
  geminiModel: string;
  promptTemplate?: string;
  autoSave: boolean;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  sourceLang: 'zh',
  targetLang: 'vi',
  geminiModel: 'gemini-3-flash-preview',
  autoSave: true,
};

// ============================================
// PROJECT TYPES
// ============================================

export type ProjectStatus = 'active' | 'completed' | 'paused';

export interface TranslationProject {
  id: string;
  name: string;
  sourceFilePath?: string;         // File gốc (.txt/.epub) - Có thể null
  outputFilePath?: string;         // File đã dịch (nếu có export)
  projectFolderPath: string;       // Đường dẫn thư mục project
  settings: ProjectSettings;       // Template mặc định
  totalChapters: number;
  translatedChapters: number;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProjectDTO {
  name: string;
  sourceFilePath?: string;
  settings?: Partial<ProjectSettings>;
  totalChapters?: number;
}

export interface UpdateProjectDTO {
  name?: string;
  sourceFilePath?: string;         // Thêm để cho phép cập nhật file gốc
  outputFilePath?: string;
  settings?: Partial<ProjectSettings>;
  status?: ProjectStatus;
  totalChapters?: number;
  translatedChapters?: number;
}

// ============================================
// CHAPTER TRANSLATION
// ============================================

export interface ChapterTranslation {
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  originalContent: string;
  translatedContent: string;
  translatedAt: number;
}

export interface SaveTranslationDTO {
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  originalContent: string;
  translatedContent: string;
}

// ============================================
// ACTION HISTORY
// ============================================

export type ProjectActionType = 'created' | 'translated' | 'exported' | 'settings_changed' | 'deleted';

export interface ProjectAction {
  id: string;
  projectId: string;
  action: ProjectActionType;
  details: string;
  timestamp: number;
}

// ============================================
// IPC CHANNELS
// ============================================

export const PROJECT_IPC_CHANNELS = {
  // Project CRUD
  GET_ALL: 'project:getAll',
  GET_BY_ID: 'project:getById',
  CREATE: 'project:create',
  UPDATE: 'project:update',
  DELETE: 'project:delete',
  
  // Translations
  SAVE_TRANSLATION: 'project:saveTranslation',
  GET_TRANSLATIONS: 'project:getTranslations',
  GET_TRANSLATION: 'project:getTranslation',
  
  // History
  GET_HISTORY: 'project:getHistory',
  
  // Export
  EXPORT_PROJECT: 'project:export',
} as const;
