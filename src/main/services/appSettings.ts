/**
 * App Settings Service - Quản lý cài đặt cấp ứng dụng
 * Lưu trữ đường dẫn Projects, theme, ngôn ngữ, v.v.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ASSStyleConfig } from '../../shared/types/caption';

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
  captionPromptId: string | null; // Prompt ID cho chức năng dịch caption (Step 3)
  // Caption logo (global — dùng lại khi edit nhiều video)
  captionLogoPath: string | null;
  captionLogoPosition: { x: number; y: number } | null;
  captionLogoScale: number;
  captionTypographyDefaults: CaptionTypographyDefaults | null;
}

export interface CaptionTypographyLayoutDefaults {
  style: ASSStyleConfig;
  subtitlePosition: { x: number; y: number } | null;
  thumbnailTextPrimaryFontName: string;
  thumbnailTextPrimaryFontSize: number;
  thumbnailTextSecondaryFontName: string;
  thumbnailTextSecondaryFontSize: number;
  thumbnailLineHeightRatio: number;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
}

export interface CaptionTypographyDefaults {
  schemaVersion: 1;
  landscape: CaptionTypographyLayoutDefaults;
  portrait: CaptionTypographyLayoutDefaults;
}

const DEFAULT_TYPOGRAPHY_STYLE: ASSStyleConfig = {
  fontName: 'ZYVNA Fairy',
  fontSize: 62,
  fontColor: '#FFFF00',
  shadow: 4,
  marginV: 50,
  alignment: 2,
};

const DEFAULT_TYPOGRAPHY_LAYOUT: CaptionTypographyLayoutDefaults = {
  style: { ...DEFAULT_TYPOGRAPHY_STYLE },
  subtitlePosition: null,
  thumbnailTextPrimaryFontName: 'BrightwallPersonal',
  thumbnailTextPrimaryFontSize: 145,
  thumbnailTextSecondaryFontName: 'BrightwallPersonal',
  thumbnailTextSecondaryFontSize: 145,
  thumbnailLineHeightRatio: 1.16,
  thumbnailTextPrimaryPosition: { x: 0.5, y: 0.5 },
  thumbnailTextSecondaryPosition: { x: 0.5, y: 0.64 },
};

function cloneTypographyLayout(layout: CaptionTypographyLayoutDefaults): CaptionTypographyLayoutDefaults {
  return {
    style: { ...layout.style },
    subtitlePosition: layout.subtitlePosition ? { ...layout.subtitlePosition } : null,
    thumbnailTextPrimaryFontName: layout.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: layout.thumbnailTextPrimaryFontSize,
    thumbnailTextSecondaryFontName: layout.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: layout.thumbnailTextSecondaryFontSize,
    thumbnailLineHeightRatio: layout.thumbnailLineHeightRatio,
    thumbnailTextPrimaryPosition: { ...layout.thumbnailTextPrimaryPosition },
    thumbnailTextSecondaryPosition: { ...layout.thumbnailTextSecondaryPosition },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePoint(
  value: unknown,
  fallback: { x: number; y: number },
  options: { min?: number; max?: number } = {}
): { x: number; y: number } {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }
  const min = isFiniteNumber(options.min) ? options.min : Number.NEGATIVE_INFINITY;
  const max = isFiniteNumber(options.max) ? options.max : Number.POSITIVE_INFINITY;
  const point = value as { x?: unknown; y?: unknown };
  const x = isFiniteNumber(point.x) ? clamp(point.x, min, max) : fallback.x;
  const y = isFiniteNumber(point.y) ? clamp(point.y, min, max) : fallback.y;
  return { x, y };
}

function normalizeStyle(value: unknown, fallback: ASSStyleConfig): ASSStyleConfig {
  const style = value && typeof value === 'object' ? (value as Partial<ASSStyleConfig>) : {};
  const fontName =
    typeof style.fontName === 'string' && style.fontName.trim().length > 0 ? style.fontName.trim() : fallback.fontName;
  const fontColor =
    typeof style.fontColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(style.fontColor)
      ? style.fontColor
      : fallback.fontColor;
  const fontSize = isFiniteNumber(style.fontSize) ? clamp(Math.round(style.fontSize), 1, 1000) : fallback.fontSize;
  const shadow = isFiniteNumber(style.shadow) ? clamp(style.shadow, 0, 20) : fallback.shadow;
  const marginV = isFiniteNumber(style.marginV) ? style.marginV : fallback.marginV;
  const alignment = style.alignment === 2 || style.alignment === 5 || style.alignment === 8 ? style.alignment : fallback.alignment;
  return {
    fontName,
    fontColor,
    fontSize,
    shadow,
    marginV,
    alignment,
  };
}

function normalizeTypographyLayout(
  value: unknown,
  fallback: CaptionTypographyLayoutDefaults
): CaptionTypographyLayoutDefaults {
  const layout = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const next = cloneTypographyLayout(fallback);

  next.style = normalizeStyle(layout.style, fallback.style);
  if (layout.subtitlePosition === null) {
    next.subtitlePosition = null;
  } else if (layout.subtitlePosition && typeof layout.subtitlePosition === 'object') {
    next.subtitlePosition = normalizePoint(layout.subtitlePosition, fallback.subtitlePosition ?? { x: 0.5, y: 0.9 });
  }

  if (typeof layout.thumbnailTextPrimaryFontName === 'string' && layout.thumbnailTextPrimaryFontName.trim().length > 0) {
    next.thumbnailTextPrimaryFontName = layout.thumbnailTextPrimaryFontName.trim();
  }
  if (isFiniteNumber(layout.thumbnailTextPrimaryFontSize)) {
    next.thumbnailTextPrimaryFontSize = clamp(Math.round(layout.thumbnailTextPrimaryFontSize), 24, 400);
  }
  if (typeof layout.thumbnailTextSecondaryFontName === 'string' && layout.thumbnailTextSecondaryFontName.trim().length > 0) {
    next.thumbnailTextSecondaryFontName = layout.thumbnailTextSecondaryFontName.trim();
  }
  if (isFiniteNumber(layout.thumbnailTextSecondaryFontSize)) {
    next.thumbnailTextSecondaryFontSize = clamp(Math.round(layout.thumbnailTextSecondaryFontSize), 24, 400);
  }
  if (isFiniteNumber(layout.thumbnailLineHeightRatio)) {
    next.thumbnailLineHeightRatio = clamp(layout.thumbnailLineHeightRatio, 0, 4);
  }

  next.thumbnailTextPrimaryPosition = normalizePoint(layout.thumbnailTextPrimaryPosition, fallback.thumbnailTextPrimaryPosition, {
    min: 0,
    max: 1,
  });
  next.thumbnailTextSecondaryPosition = normalizePoint(
    layout.thumbnailTextSecondaryPosition,
    fallback.thumbnailTextSecondaryPosition,
    { min: 0, max: 1 }
  );

  return next;
}

function normalizeCaptionTypographyDefaults(value: unknown): CaptionTypographyDefaults | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const defaults = value as Record<string, unknown>;
  if (defaults.schemaVersion !== 1) {
    return null;
  }

  return {
    schemaVersion: 1,
    landscape: normalizeTypographyLayout(defaults.landscape, DEFAULT_TYPOGRAPHY_LAYOUT),
    portrait: normalizeTypographyLayout(defaults.portrait, DEFAULT_TYPOGRAPHY_LAYOUT),
  };
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
  captionPromptId: null, // Tự động dùng prompt mặc định
  captionLogoPath: null,
  captionLogoPosition: null,
  captionLogoScale: 1.0,
  captionTypographyDefaults: null,
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
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...loaded,
          captionTypographyDefaults: normalizeCaptionTypographyDefaults(loaded?.captionTypographyDefaults),
        };
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
    const nextPartial: Partial<AppSettings> = { ...partial };
    if (Object.prototype.hasOwnProperty.call(partial, 'captionTypographyDefaults')) {
      nextPartial.captionTypographyDefaults = normalizeCaptionTypographyDefaults(partial.captionTypographyDefaults);
    }
    this.settings = { ...this.settings, ...nextPartial };
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
