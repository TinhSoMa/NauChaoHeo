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
  projectsBasePath: string | null; // null = use default userData/projects
  theme: 'light' | 'dark' | 'system';
  language: 'vi' | 'en';
  recentProjectIds: string[]; // IDs của các project gần đây, tối đa 5
  lastActiveProjectId: string | null; // Project cuối cùng được chọn
  useProxy: boolean; // Bật/tắt sử dụng proxy cho API calls
}

const DEFAULT_SETTINGS: AppSettings = {
  projectsBasePath: null,
  theme: 'dark',
  language: 'vi',
  recentProjectIds: [],
  lastActiveProjectId: null,
  useProxy: true, // Mặc định bật proxy
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

  /**
   * Update settings (partial update)
   */
  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.getAll();
  }

  /**
   * Get projects base path (returns custom path + NauChapHeoContent or default)
   * Projects will be stored in: [selectedPath]/NauChapHeoContent/
   */
  getProjectsBasePath(): string {
    if (this.settings.projectsBasePath) {
      return path.join(this.settings.projectsBasePath, 'NauChapHeoContent');
    }
    return path.join(app.getPath('userData'), 'projects');
  }

  /**
   * Set projects base path and create NauChapHeoContent folder
   */
  setProjectsBasePath(basePath: string | null): void {
    this.settings.projectsBasePath = basePath;
    this.save();
    
    // Auto-create NauChapHeoContent folder if custom path is set
    if (basePath) {
      const fullPath = path.join(basePath, 'NauChapHeoContent');
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log('[AppSettings] Created NauChapHeoContent folder:', fullPath);
      }
    }
  }

  /**
   * Add project to recent list
   */
  addRecentProject(projectId: string): void {
    // Remove if already exists
    this.settings.recentProjectIds = this.settings.recentProjectIds.filter(id => id !== projectId);
    // Add to front
    this.settings.recentProjectIds.unshift(projectId);
    // Keep only last 5
    this.settings.recentProjectIds = this.settings.recentProjectIds.slice(0, 5);
    // Also update last active
    this.settings.lastActiveProjectId = projectId;
    this.save();
  }

  /**
   * Get last active project ID
   */
  getLastActiveProjectId(): string | null {
    return this.settings.lastActiveProjectId;
  }

  /**
   * Get recent project IDs
   */
  getRecentProjectIds(): string[] {
    return [...this.settings.recentProjectIds];
  }

  /**
   * Clear last active project
   */
  clearLastActiveProject(): void {
    this.settings.lastActiveProjectId = null;
    this.save();
  }

  /**
   * Remove project from recent list (when deleted)
   */
  removeFromRecent(projectId: string): void {
    this.settings.recentProjectIds = this.settings.recentProjectIds.filter(id => id !== projectId);
    if (this.settings.lastActiveProjectId === projectId) {
      this.settings.lastActiveProjectId = null;
    }
    this.save();
  }
}

// Singleton instance
export const AppSettingsService = new AppSettingsServiceClass();
