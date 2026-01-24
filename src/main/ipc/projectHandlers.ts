/**
 * Project Handlers - IPC handlers cho quản lý dự án dịch
 */

import { ipcMain } from 'electron';
import { ProjectService } from '../services/projectService';
import {
  PROJECT_IPC_CHANNELS,
  CreateProjectDTO,
  UpdateProjectDTO,
  SaveTranslationDTO,
} from '../../shared/types/project';

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export function registerProjectHandlers(): void {
  console.log('[ProjectHandlers] Đăng ký handlers...');

  // ============================================
  // PROJECT CRUD
  // ============================================

  // Get all projects
  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_ALL, async (): Promise<IpcApiResponse<any[]>> => {
    try {
      const projects = ProjectService.getAll();
      return { success: true, data: projects };
    } catch (error) {
      console.error('[ProjectHandlers] Error getting projects:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get project by ID
  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_BY_ID, async (_, id: string): Promise<IpcApiResponse<any>> => {
    try {
      const project = ProjectService.getById(id);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      return { success: true, data: project };
    } catch (error) {
      console.error('[ProjectHandlers] Error getting project:', error);
      return { success: false, error: String(error) };
    }
  });

  // Create project
  ipcMain.handle(PROJECT_IPC_CHANNELS.CREATE, async (_, data: CreateProjectDTO): Promise<IpcApiResponse<any>> => {
    try {
      const project = ProjectService.create(data);
      return { success: true, data: project };
    } catch (error) {
      console.error('[ProjectHandlers] Error creating project:', error);
      return { success: false, error: String(error) };
    }
  });

  // Update project
  ipcMain.handle(PROJECT_IPC_CHANNELS.UPDATE, async (_, id: string, data: UpdateProjectDTO): Promise<IpcApiResponse<any>> => {
    try {
      const project = ProjectService.update(id, data);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      return { success: true, data: project };
    } catch (error) {
      console.error('[ProjectHandlers] Error updating project:', error);
      return { success: false, error: String(error) };
    }
  });

  // Delete project
  ipcMain.handle(PROJECT_IPC_CHANNELS.DELETE, async (_, id: string): Promise<IpcApiResponse<boolean>> => {
    try {
      const result = ProjectService.delete(id);
      return { success: true, data: result };
    } catch (error) {
      console.error('[ProjectHandlers] Error deleting project:', error);
      return { success: false, error: String(error) };
    }
  });

  // ============================================
  // TRANSLATIONS
  // ============================================

  // Save translation
  ipcMain.handle(PROJECT_IPC_CHANNELS.SAVE_TRANSLATION, async (_, data: SaveTranslationDTO): Promise<IpcApiResponse<any>> => {
    try {
      const translation = ProjectService.saveTranslation(data);
      return { success: true, data: translation };
    } catch (error) {
      console.error('[ProjectHandlers] Error saving translation:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get all translations for project
  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_TRANSLATIONS, async (_, projectId: string): Promise<IpcApiResponse<any[]>> => {
    try {
      const translations = ProjectService.getTranslations(projectId);
      return { success: true, data: translations };
    } catch (error) {
      console.error('[ProjectHandlers] Error getting translations:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get single translation
  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_TRANSLATION, async (_, projectId: string, chapterId: string): Promise<IpcApiResponse<any>> => {
    try {
      const translation = ProjectService.getTranslation(projectId, chapterId);
      return { success: true, data: translation };
    } catch (error) {
      console.error('[ProjectHandlers] Error getting translation:', error);
      return { success: false, error: String(error) };
    }
  });

  // ============================================
  // HISTORY
  // ============================================

  // Get project history
  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_HISTORY, async (_, projectId: string, limit?: number): Promise<IpcApiResponse<any[]>> => {
    try {
      const history = ProjectService.getHistory(projectId, limit);
      return { success: true, data: history };
    } catch (error) {
      console.error('[ProjectHandlers] Error getting history:', error);
      return { success: false, error: String(error) };
    }
  });

  console.log('[ProjectHandlers] Đã đăng ký handlers thành công');
}
