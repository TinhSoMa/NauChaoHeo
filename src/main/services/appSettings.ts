/**
 * App Settings Service - Quản lý cài đặt cấp ứng dụng
 * Lưu trữ đường dẫn Projects, theme, ngôn ngữ, v.v.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// TYPES
// ============================================

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: 'vi' | 'en';
  projectsBasePath: string | null;
  recentProjectIds: string[]; // IDs của các project gần đây, tối đa 10
  lastActiveProjectId: string | null; // Project cuối cùng được chọn
  useProxy: boolean; // Bật/tắt sử dụng proxy cho API calls
  createChatOnWeb: boolean; // Bật/tắt tạo hộp thoại chat trên web
  useStoredContextOnFirstSend: boolean; // Bật/tắt dùng ngữ cảnh cũ cho lần gửi đầu
  translationPromptId: string | null; // Prompt ID cho chức năng dịch truyện
  summaryPromptId: string | null; // Prompt ID cho chức năng tóm tắt
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'vi',
  projectsBasePath: null,
  recentProjectIds: [],
  lastActiveProjectId: null,
  useProxy: true, // Mặc định bật proxy
  createChatOnWeb: false,
  useStoredContextOnFirstSend: false,
  translationPromptId: null, // Tự động tìm prompt dịch
  summaryPromptId: null, // Tự động tìm prompt tóm tắt
};

// ============================================
// SERVICE
// ============================================

class AppSettingsServiceClass {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private settingsPath: string = '';

  constructor() {
    // Will be initialized after app is ready
  }

  /**
   * Initialize the service - must be called after app is ready
   */
  initialize(): void {
    const userDataPath = app.getPath('userData');
    this.settingsPath = path.join(userDataPath, 'appSettings.json');
    this.load();
    console.log('[AppSettings] Initialized at:', this.settingsPath);
  }

  /**
   * Load settings from file
   */
  private load(): void {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const content = fs.readFileSync(this.settingsPath, 'utf-8');
        const loaded = JSON.parse(content);
        this.settings = { ...DEFAULT_SETTINGS, ...loaded };
        console.log('[AppSettings] Loaded settings successfully');
      } else {
        console.log('[AppSettings] No settings file found, using defaults');
        this.settings = { ...DEFAULT_SETTINGS };
      }
    } catch (error) {
      console.error('[AppSettings] Error loading settings:', error);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Save settings to file
   */
  private save(): void {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
      console.log('[AppSettings] Saved settings');
    } catch (error) {
      console.error('[AppSettings] Error saving settings:', error);
    }
  }

  /**
   * Get all settings
   */
  getAll(): AppSettings {
    return { ...this.settings };
  }

  getProjectsBasePath(): string | null {
    return this.settings.projectsBasePath ?? null;
  }

  setProjectsBasePath(basePath: string | null): void {
    this.settings.projectsBasePath = basePath ?? null;
    this.save();
  }

  /**
   * Update settings (partial update)
   */
  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.getAll();
  }

  addRecentProject(projectId: string): void {
    if (!projectId) return;
    // Đưa lên đầu danh sách, loại bỏ trùng lặp, giới hạn 10
    const filtered = this.settings.recentProjectIds.filter((id) => id !== projectId);
    this.settings.recentProjectIds = [projectId, ...filtered].slice(0, 10);
    this.settings.lastActiveProjectId = projectId;
    this.save();
  }

  getRecentProjectIds(): string[] {
    return [...this.settings.recentProjectIds];
  }

  getLastActiveProjectId(): string | null {
    return this.settings.lastActiveProjectId ?? null;
  }

  setLastActiveProjectId(projectId: string | null): void {
    this.settings.lastActiveProjectId = projectId ?? null;
    if (projectId) {
      this.addRecentProject(projectId);
    } else {
      this.save();
    }
  }

  removeFromRecent(projectId: string): void {
    this.settings.recentProjectIds = this.settings.recentProjectIds.filter((id) => id !== projectId);
    if (this.settings.lastActiveProjectId === projectId) {
      this.settings.lastActiveProjectId = null;
    }
    this.save();
  }

  /**
   * Remove project from recent list (when deleted) - REMOVED
   */
  // removeFromRecent(projectId: string): void {
  //   this.settings.recentProjectIds = this.settings.recentProjectIds.filter(id => id !== projectId);
  //   if (this.settings.lastActiveProjectId === projectId) {
  //     this.settings.lastActiveProjectId = null;
  //   }
  //   this.save();
  // }
}

// Singleton instance
export const AppSettingsService = new AppSettingsServiceClass();
