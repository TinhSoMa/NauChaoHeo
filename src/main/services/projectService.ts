/**
 * Project Service - Quản lý dự án dịch truyện
 * CRUD operations cho projects, translations, và history
 * 
 * STORAGE: JSON files trong project folders (không dùng database)
 * 
 * Cấu trúc thư mục:
 * [projectsBasePath]/[projectId]/
 * ├── project.json           # Project metadata
 * ├── translations/
 * │   ├── [chapterId].json   # Bản dịch từng chương
 * └── history.json           # Lịch sử thao tác
 */


import * as fs from 'fs';
import * as path from 'path';
import { AppSettingsService } from './appSettings';
import {
  TranslationProject,
  CreateProjectDTO,
  UpdateProjectDTO,
  ChapterTranslation,
  SaveTranslationDTO,
  ProjectAction,
  ProjectActionType,
  ProjectSettings,
  DEFAULT_PROJECT_SETTINGS,
} from '../../shared/types/project';

// ============================================
// HELPER FUNCTIONS
// ============================================

function getProjectsBasePath(): string {
  return AppSettingsService.getProjectsBasePath();
}

function ensureProjectsFolder(): void {
  const basePath = getProjectsBasePath();
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
  }
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getProjectJsonPath(projectFolder: string): string {
  return path.join(projectFolder, 'project.json');
}

function getTranslationsDir(projectFolder: string): string {
  return path.join(projectFolder, 'translations');
}

function getHistoryPath(projectFolder: string): string {
  return path.join(projectFolder, 'history.json');
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    }
  } catch (error) {
    console.error(`[ProjectService] Error reading ${filePath}:`, error);
  }
  return null;
}

function writeJsonFile(filePath: string, data: unknown): void {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[ProjectService] Error writing ${filePath}:`, error);
    throw error;
  }
}

// ============================================
// PROJECT CRUD
// ============================================

export class ProjectService {
  /**
   * Get all projects by scanning project folders
   */
  static getAll(): TranslationProject[] {
    try {
      ensureProjectsFolder();
      const basePath = getProjectsBasePath();
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      
      const projects: TranslationProject[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectFolder = path.join(basePath, entry.name);
          const projectJsonPath = getProjectJsonPath(projectFolder);
          
          const project = readJsonFile<TranslationProject>(projectJsonPath);
          if (project) {
            projects.push(project);
          }
        }
      }
      
      // Sort by updatedAt DESC
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      
      return projects;
    } catch (error) {
      console.error('[ProjectService] Error getting all projects:', error);
      return [];
    }
  }

  /**
   * Get project by ID
   */
  static getById(id: string): TranslationProject | null {
    try {
      const basePath = getProjectsBasePath();
      const projectFolder = path.join(basePath, id);
      const projectJsonPath = getProjectJsonPath(projectFolder);
      
      return readJsonFile<TranslationProject>(projectJsonPath);
    } catch (error) {
      console.error(`[ProjectService] Error getting project ${id}:`, error);
      return null;
    }
  }

  /**
   * Create new project
   */
  static create(data: CreateProjectDTO): TranslationProject {
    ensureProjectsFolder();
    
    const now = Date.now();
    // Dùng tên project làm folder name (sanitize để loại bỏ ký tự không hợp lệ)
    const sanitizedName = data.name.trim().replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
    const id = sanitizedName; // ID = tên folder = tên project
    const basePath = getProjectsBasePath();
    const projectFolder = path.join(basePath, sanitizedName);
    
    // Create project folder
    ensureDir(projectFolder);
    ensureDir(getTranslationsDir(projectFolder));
    
    // Merge settings with defaults
    const settings: ProjectSettings = {
      ...DEFAULT_PROJECT_SETTINGS,
      ...data.settings,
    };

    const project: TranslationProject = {
      id,
      name: data.name,
      sourceFilePath: data.sourceFilePath,
      projectFolderPath: projectFolder,
      settings,
      totalChapters: data.totalChapters || 0,
      translatedChapters: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    // Save project.json
    writeJsonFile(getProjectJsonPath(projectFolder), project);
    
    // Initialize empty history
    writeJsonFile(getHistoryPath(projectFolder), []);

    // Log action
    this.logAction(id, 'created', `Tạo dự án: ${project.name}`);

    console.log(`[ProjectService] Created project: ${project.name} (${id})`);
    return project;
  }

  /**
   * Update project
   */
  static update(id: string, data: UpdateProjectDTO): TranslationProject | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = Date.now();
    const updated: TranslationProject = {
      ...existing,
      ...data,
      settings: data.settings
        ? { ...existing.settings, ...data.settings }
        : existing.settings,
      updatedAt: now,
    };

    // Save updated project.json
    writeJsonFile(getProjectJsonPath(updated.projectFolderPath), updated);

    if (data.settings) {
      this.logAction(id, 'settings_changed', 'Cập nhật cài đặt dự án');
    }

    console.log(`[ProjectService] Updated project: ${id}`);
    return updated;
  }

  /**
   * Delete project
   */
  static delete(id: string): boolean {
    const project = this.getById(id);
    if (!project) return false;

    // Delete project folder
    if (fs.existsSync(project.projectFolderPath)) {
      fs.rmSync(project.projectFolderPath, { recursive: true, force: true });
    }

    console.log(`[ProjectService] Deleted project: ${id}`);
    return true;
  }

  // ============================================
  // TRANSLATIONS
  // ============================================

  /**
   * Save chapter translation to JSON file
   */
  static saveTranslation(data: SaveTranslationDTO): ChapterTranslation {
    const project = this.getById(data.projectId);
    if (!project) {
      throw new Error(`Project not found: ${data.projectId}`);
    }

    const now = Date.now();
    const translationsDir = getTranslationsDir(project.projectFolderPath);
    ensureDir(translationsDir);
    
    // Check if translation already exists
    const translationPath = path.join(translationsDir, `${data.chapterId}.json`);
    const existing = readJsonFile<ChapterTranslation>(translationPath);
    
    const translation: ChapterTranslation = {
      projectId: data.projectId,
      chapterId: data.chapterId,
      chapterTitle: data.chapterTitle,
      originalContent: data.originalContent,
      translatedContent: data.translatedContent,
      translatedAt: now,
    };

    // Save translation file
    writeJsonFile(translationPath, translation);

    // Update translated count
    if (!existing) {
      this.updateTranslatedCount(data.projectId);
      this.logAction(data.projectId, 'translated', `Dịch chương: ${data.chapterTitle}`);
    }

    console.log(`[ProjectService] Saved translation for chapter: ${data.chapterTitle}`);
    return translation;
  }

  /**
   * Get all translations for a project
   */
  static getTranslations(projectId: string): ChapterTranslation[] {
    const project = this.getById(projectId);
    if (!project) return [];

    const translationsDir = getTranslationsDir(project.projectFolderPath);
    if (!fs.existsSync(translationsDir)) return [];

    const translations: ChapterTranslation[] = [];
    const files = fs.readdirSync(translationsDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(translationsDir, file);
        const translation = readJsonFile<ChapterTranslation>(filePath);
        if (translation) {
          translations.push(translation);
        }
      }
    }

    // Sort by translatedAt ASC
    translations.sort((a, b) => a.translatedAt - b.translatedAt);
    
    return translations;
  }

  /**
   * Get single translation
   */
  static getTranslation(projectId: string, chapterId: string): ChapterTranslation | null {
    const project = this.getById(projectId);
    if (!project) return null;

    const translationPath = path.join(getTranslationsDir(project.projectFolderPath), `${chapterId}.json`);
    return readJsonFile<ChapterTranslation>(translationPath);
  }

  /**
   * Update translated count in project
   */
  private static updateTranslatedCount(projectId: string): void {
    const project = this.getById(projectId);
    if (!project) return;

    const translations = this.getTranslations(projectId);
    
    this.update(projectId, {
      translatedChapters: translations.length,
    });
  }

  // ============================================
  // HISTORY
  // ============================================

  /**
   * Log action to history.json
   */
  static logAction(projectId: string, action: ProjectActionType, details: string): void {
    try {
      const project = this.getById(projectId);
      if (!project) return;

      const historyPath = getHistoryPath(project.projectFolderPath);
      const history = readJsonFile<ProjectAction[]>(historyPath) || [];

      const newAction: ProjectAction = {
        id: `${action}_${Date.now()}`,
        projectId,
        action,
        details,
        timestamp: Date.now(),
      };

      history.push(newAction);
      
      // Keep only last 100 actions
      const trimmed = history.slice(-100);
      
      writeJsonFile(historyPath, trimmed);
    } catch (error) {
      console.error(`[ProjectService] Error logging action:`, error);
    }
  }

  /**
   * Get project history
   */
  static getHistory(projectId: string, limit: number = 50): ProjectAction[] {
    const project = this.getById(projectId);
    if (!project) return [];

    const historyPath = getHistoryPath(project.projectFolderPath);
    const history = readJsonFile<ProjectAction[]>(historyPath) || [];

    // Return most recent first, limited
    return history.slice(-limit).reverse();
  }
}
