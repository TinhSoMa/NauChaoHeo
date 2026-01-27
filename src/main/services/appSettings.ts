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
  // recentProjectIds: string[]; // IDs của các project gần đây, tối đa 5
  // lastActiveProjectId: string | null; // Project cuối cùng được chọn
  useProxy: boolean; // Bật/tắt sử dụng proxy cho API calls
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'vi',
  // recentProjectIds: [],
  // lastActiveProjectId: null,
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
