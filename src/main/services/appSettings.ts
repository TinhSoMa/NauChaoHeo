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
  proxyMode: 'off' | 'direct-list' | 'rotating-endpoint';
  rotatingProxyEndpoint: string | null;
  proxyScopes: ProxyScopesSettings;
  createChatOnWeb: boolean; // Bật/tắt tạo hộp thoại chat trên web
  useStoredContextOnFirstSend: boolean; // Bật/tắt dùng ngữ cảnh cũ cho lần gửi đầu
  geminiMinSendIntervalMs: number; // Khoảng chờ tối thiểu giữa mỗi lần gửi Gemini (ms)
  geminiMaxSendIntervalMs: number; // Khoảng chờ tối đa giữa mỗi lần gửi Gemini (ms)
  geminiSendIntervalMode: 'fixed' | 'random'; // Chế độ khoảng gửi: cố định hoặc ngẫu nhiên
  apiWorkerCount: number; // Số worker API song song (Story + Caption Step3)
  apiRequestDelayMs: number; // Delay giữa request API (ms)
  translationPromptId: string | null; // Prompt ID cho chức năng dịch truyện
  summaryPromptId: string | null; // Prompt ID cho chức năng tóm tắt
  captionPromptId: string | null; // Prompt ID cho chức năng dịch caption (Step 3)
  // Caption logo (global — dùng lại khi edit nhiều video)
  captionLogoPath: string | null;
  captionLogoPosition: { x: number; y: number } | null;
  captionLogoScale: number;
  captionTypographyDefaults: CaptionTypographyDefaults | null;
  captionStandaloneSettings: string | null;
  capcutTtsSecrets: CapcutTtsSecrets;
  geminiWebApiCookieFallback: GeminiWebApiCookieFallback;
}

export interface CapcutTtsSecrets {
  appKey: string | null;
  token: string | null;
  wsUrl: string | null;
  userAgent: string | null;
  xSsDp: string | null;
  extraHeaders: Record<string, string> | null;
}

export interface GeminiWebApiCookieFallback {
  cookie: string | null;
  sourceBrowser: 'chrome' | 'edge' | null;
  updatedAt: number | null;
}

export type ProxyScopeName = 'caption' | 'story' | 'chat' | 'tts' | 'other';
export type ProxyScopeMode = 'off' | 'direct-list' | 'rotating-endpoint';
export type ProxyTypePreference = 'any' | 'http' | 'https' | 'socks5';

export interface ProxyScopeSettings {
  mode: ProxyScopeMode;
  typePreference: ProxyTypePreference;
}

export type ProxyScopesSettings = Record<ProxyScopeName, ProxyScopeSettings>;

export interface CaptionTypographyLayoutDefaults {
  fontSizeScaleVersion?: number;
  style: ASSStyleConfig;
  subtitleFontSizeRel?: number;
  subtitlePosition: { x: number; y: number } | null;
  thumbnailTextPrimaryFontName: string;
  thumbnailTextPrimaryFontSize: number;
  thumbnailTextPrimaryFontSizeRel?: number;
  thumbnailTextSecondaryFontName: string;
  thumbnailTextSecondaryFontSize: number;
  thumbnailTextSecondaryFontSizeRel?: number;
  thumbnailLineHeightRatio: number;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
}

export interface CaptionTypographyDefaults {
  schemaVersion: 1;
  landscape: CaptionTypographyLayoutDefaults;
  portrait: CaptionTypographyLayoutDefaults;
}

export const GEMINI_MIN_SEND_INTERVAL_DEFAULT_MS = 20_000;
export const GEMINI_MIN_SEND_INTERVAL_MIN_MS = 5_000;
export const GEMINI_MIN_SEND_INTERVAL_MAX_MS = 120_000;
export const API_WORKER_COUNT_DEFAULT = 1;
export const API_WORKER_COUNT_MIN = 1;
export const API_WORKER_COUNT_MAX = 10;
export const API_REQUEST_DELAY_DEFAULT_MS = 500;
export const API_REQUEST_DELAY_MIN_MS = 0;
export const API_REQUEST_DELAY_MAX_MS = 30_000;

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
    fontSizeScaleVersion: layout.fontSizeScaleVersion,
    style: { ...layout.style },
    subtitleFontSizeRel: layout.subtitleFontSizeRel,
    subtitlePosition: layout.subtitlePosition ? { ...layout.subtitlePosition } : null,
    thumbnailTextPrimaryFontName: layout.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: layout.thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryFontSizeRel: layout.thumbnailTextPrimaryFontSizeRel,
    thumbnailTextSecondaryFontName: layout.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: layout.thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryFontSizeRel: layout.thumbnailTextSecondaryFontSizeRel,
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

function normalizeApiWorkerCount(rawValue: unknown): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return API_WORKER_COUNT_DEFAULT;
  }
  return clamp(Math.floor(numeric), API_WORKER_COUNT_MIN, API_WORKER_COUNT_MAX);
}

function normalizeApiRequestDelayMs(rawValue: unknown): number {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return API_REQUEST_DELAY_DEFAULT_MS;
  }
  return clamp(Math.floor(numeric), API_REQUEST_DELAY_MIN_MS, API_REQUEST_DELAY_MAX_MS);
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
  if (isFiniteNumber(layout.fontSizeScaleVersion)) {
    next.fontSizeScaleVersion = Math.max(1, Math.round(layout.fontSizeScaleVersion));
  }

  next.style = normalizeStyle(layout.style, fallback.style);
  if (isFiniteNumber(layout.subtitleFontSizeRel)) {
    next.subtitleFontSizeRel = clamp(layout.subtitleFontSizeRel, 1, 200);
  }
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
  if (isFiniteNumber(layout.thumbnailTextPrimaryFontSizeRel)) {
    next.thumbnailTextPrimaryFontSizeRel = clamp(layout.thumbnailTextPrimaryFontSizeRel, 8, 200);
  }
  if (typeof layout.thumbnailTextSecondaryFontName === 'string' && layout.thumbnailTextSecondaryFontName.trim().length > 0) {
    next.thumbnailTextSecondaryFontName = layout.thumbnailTextSecondaryFontName.trim();
  }
  if (isFiniteNumber(layout.thumbnailTextSecondaryFontSize)) {
    next.thumbnailTextSecondaryFontSize = clamp(Math.round(layout.thumbnailTextSecondaryFontSize), 24, 400);
  }
  if (isFiniteNumber(layout.thumbnailTextSecondaryFontSizeRel)) {
    next.thumbnailTextSecondaryFontSizeRel = clamp(layout.thumbnailTextSecondaryFontSizeRel, 8, 200);
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

function normalizeStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProxyMode(value: unknown): 'off' | 'direct-list' | 'rotating-endpoint' {
  return value === 'off' || value === 'rotating-endpoint' ? value : 'direct-list';
}

function normalizeProxyScopeMode(value: unknown): ProxyScopeMode {
  return value === 'off' || value === 'rotating-endpoint' ? value : 'direct-list';
}

function normalizeProxyTypePreference(value: unknown): ProxyTypePreference {
  return value === 'http' || value === 'https' || value === 'socks5' ? value : 'any';
}

function normalizeRotatingProxyEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCaptionStandaloneSettings(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCapcutExtraHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const headers = value as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(headers)) {
    const cleanKey = key.trim();
    if (!cleanKey || typeof rawVal !== 'string') {
      continue;
    }
    const cleanVal = rawVal.trim();
    if (!cleanVal) {
      continue;
    }
    normalized[cleanKey] = cleanVal;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeCapcutTtsSecrets(value: unknown): CapcutTtsSecrets {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    appKey: normalizeStringOrNull(src.appKey),
    token: normalizeStringOrNull(src.token),
    wsUrl: normalizeStringOrNull(src.wsUrl),
    userAgent: normalizeStringOrNull(src.userAgent),
    xSsDp: normalizeStringOrNull(src.xSsDp),
    extraHeaders: normalizeCapcutExtraHeaders(src.extraHeaders),
  };
}

function normalizeGeminiWebApiCookieFallback(value: unknown): GeminiWebApiCookieFallback {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    cookie: normalizeStringOrNull(src.cookie),
    sourceBrowser: src.sourceBrowser === 'chrome' || src.sourceBrowser === 'edge' ? src.sourceBrowser : null,
    updatedAt: isFiniteNumber(src.updatedAt) ? src.updatedAt : null,
  };
}

const PROXY_SCOPE_NAMES: ProxyScopeName[] = ['caption', 'story', 'chat', 'tts', 'other'];

function buildProxyScopesFromLegacy(legacy: { useProxy?: boolean; proxyMode?: unknown } | null | undefined): ProxyScopesSettings {
  const useProxy = legacy?.useProxy !== false;
  const mode = useProxy ? normalizeProxyMode(legacy?.proxyMode) : 'off';
  return {
    caption: { mode, typePreference: 'any' },
    story: { mode, typePreference: 'any' },
    chat: { mode, typePreference: 'any' },
    tts: { mode, typePreference: 'socks5' },
    other: { mode, typePreference: 'any' },
  };
}

function normalizeProxyScopeSettings(
  value: unknown,
  fallback: ProxyScopeSettings
): ProxyScopeSettings {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }
  const raw = value as Record<string, unknown>;
  return {
    mode: normalizeProxyScopeMode(raw.mode),
    typePreference: normalizeProxyTypePreference(raw.typePreference),
  };
}

function normalizeProxyScopes(
  value: unknown,
  fallbackSource: { proxyScopes?: ProxyScopesSettings; useProxy?: boolean; proxyMode?: unknown }
): ProxyScopesSettings {
  const fallbackScopes = fallbackSource.proxyScopes || buildProxyScopesFromLegacy(fallbackSource);
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const next = {} as ProxyScopesSettings;
  for (const scope of PROXY_SCOPE_NAMES) {
    next[scope] = normalizeProxyScopeSettings(raw[scope], fallbackScopes[scope]);
  }
  return next;
}

export function normalizeGeminiMinSendIntervalMs(value: unknown): number {
  let numeric: number;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return GEMINI_MIN_SEND_INTERVAL_DEFAULT_MS;
    }
    numeric = Number(trimmed);
  } else {
    return GEMINI_MIN_SEND_INTERVAL_DEFAULT_MS;
  }

  if (!Number.isFinite(numeric)) {
    return GEMINI_MIN_SEND_INTERVAL_DEFAULT_MS;
  }
  return clamp(Math.floor(numeric), GEMINI_MIN_SEND_INTERVAL_MIN_MS, GEMINI_MIN_SEND_INTERVAL_MAX_MS);
}

export function normalizeGeminiSendIntervalMode(value: unknown): 'fixed' | 'random' {
  return value === 'random' ? 'random' : 'fixed';
}

export function normalizeGeminiMaxSendIntervalMs(value: unknown, minMs: number): number {
  let numeric: number;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return minMs;
    }
    numeric = Number(trimmed);
  } else {
    return minMs;
  }

  if (!Number.isFinite(numeric)) {
    return minMs;
  }
  const clamped = clamp(Math.floor(numeric), GEMINI_MIN_SEND_INTERVAL_MIN_MS, GEMINI_MIN_SEND_INTERVAL_MAX_MS);
  return Math.max(minMs, clamped);
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'vi',
  projectsBasePath: null,
  recentProjectIds: [],
  lastActiveProjectId: null,
  useProxy: true, // Mặc định bật proxy
  proxyMode: 'direct-list',
  rotatingProxyEndpoint: null,
  proxyScopes: buildProxyScopesFromLegacy({ useProxy: true, proxyMode: 'direct-list' }),
  createChatOnWeb: false,
  useStoredContextOnFirstSend: false,
  geminiMinSendIntervalMs: GEMINI_MIN_SEND_INTERVAL_DEFAULT_MS,
  geminiMaxSendIntervalMs: GEMINI_MIN_SEND_INTERVAL_DEFAULT_MS,
  geminiSendIntervalMode: 'fixed',
  apiWorkerCount: API_WORKER_COUNT_DEFAULT,
  apiRequestDelayMs: API_REQUEST_DELAY_DEFAULT_MS,
  translationPromptId: null, // Tự động tìm prompt dịch
  summaryPromptId: null, // Tự động tìm prompt tóm tắt
  captionPromptId: null, // Tự động dùng prompt mặc định
  captionLogoPath: null,
  captionLogoPosition: null,
  captionLogoScale: 1.0,
  captionTypographyDefaults: null,
  captionStandaloneSettings: null,
  capcutTtsSecrets: {
    appKey: null,
    token: null,
    wsUrl: null,
    userAgent: null,
    xSsDp: null,
    extraHeaders: null,
  },
  geminiWebApiCookieFallback: {
    cookie: null,
    sourceBrowser: null,
    updatedAt: null,
  },
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
        const proxyScopes = normalizeProxyScopes(loaded?.proxyScopes, {
          proxyScopes: loaded?.proxyScopes,
          useProxy: loaded?.useProxy,
          proxyMode: loaded?.proxyMode,
        });
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...loaded,
          proxyMode: normalizeProxyMode(loaded?.proxyMode),
          rotatingProxyEndpoint: normalizeRotatingProxyEndpoint(loaded?.rotatingProxyEndpoint),
          proxyScopes,
          geminiMinSendIntervalMs: normalizeGeminiMinSendIntervalMs(loaded?.geminiMinSendIntervalMs),
          geminiMaxSendIntervalMs: normalizeGeminiMaxSendIntervalMs(
            loaded?.geminiMaxSendIntervalMs,
            normalizeGeminiMinSendIntervalMs(loaded?.geminiMinSendIntervalMs),
          ),
          geminiSendIntervalMode: normalizeGeminiSendIntervalMode(loaded?.geminiSendIntervalMode),
          apiWorkerCount: normalizeApiWorkerCount(loaded?.apiWorkerCount),
          apiRequestDelayMs: normalizeApiRequestDelayMs(loaded?.apiRequestDelayMs),
          captionTypographyDefaults: normalizeCaptionTypographyDefaults(loaded?.captionTypographyDefaults),
          captionStandaloneSettings: normalizeCaptionStandaloneSettings(loaded?.captionStandaloneSettings),
          capcutTtsSecrets: normalizeCapcutTtsSecrets(loaded?.capcutTtsSecrets),
          geminiWebApiCookieFallback: normalizeGeminiWebApiCookieFallback(loaded?.geminiWebApiCookieFallback),
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
    if (Object.prototype.hasOwnProperty.call(partial, 'captionStandaloneSettings')) {
      nextPartial.captionStandaloneSettings = normalizeCaptionStandaloneSettings(partial.captionStandaloneSettings);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'capcutTtsSecrets')) {
      nextPartial.capcutTtsSecrets = normalizeCapcutTtsSecrets(partial.capcutTtsSecrets);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'geminiWebApiCookieFallback')) {
      nextPartial.geminiWebApiCookieFallback = normalizeGeminiWebApiCookieFallback(partial.geminiWebApiCookieFallback);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'geminiMinSendIntervalMs')) {
      nextPartial.geminiMinSendIntervalMs = normalizeGeminiMinSendIntervalMs(partial.geminiMinSendIntervalMs);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'geminiMaxSendIntervalMs')) {
      const minMs = Object.prototype.hasOwnProperty.call(nextPartial, 'geminiMinSendIntervalMs')
        ? (nextPartial.geminiMinSendIntervalMs as number)
        : this.settings.geminiMinSendIntervalMs;
      nextPartial.geminiMaxSendIntervalMs = normalizeGeminiMaxSendIntervalMs(partial.geminiMaxSendIntervalMs, minMs);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'geminiSendIntervalMode')) {
      nextPartial.geminiSendIntervalMode = normalizeGeminiSendIntervalMode(partial.geminiSendIntervalMode);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'apiWorkerCount')) {
      nextPartial.apiWorkerCount = normalizeApiWorkerCount(partial.apiWorkerCount);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'apiRequestDelayMs')) {
      nextPartial.apiRequestDelayMs = normalizeApiRequestDelayMs(partial.apiRequestDelayMs);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'proxyMode')) {
      nextPartial.proxyMode = normalizeProxyMode(partial.proxyMode);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'rotatingProxyEndpoint')) {
      nextPartial.rotatingProxyEndpoint = normalizeRotatingProxyEndpoint(partial.rotatingProxyEndpoint);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'proxyScopes')) {
      nextPartial.proxyScopes = normalizeProxyScopes(partial.proxyScopes, {
        proxyScopes: this.settings.proxyScopes,
        useProxy: this.settings.useProxy,
        proxyMode: this.settings.proxyMode,
      });
    }

    if (Object.prototype.hasOwnProperty.call(partial, 'geminiMinSendIntervalMs')) {
      const minMs = nextPartial.geminiMinSendIntervalMs as number;
      const currentMax = Object.prototype.hasOwnProperty.call(nextPartial, 'geminiMaxSendIntervalMs')
        ? (nextPartial.geminiMaxSendIntervalMs as number)
        : this.settings.geminiMaxSendIntervalMs;
      if (currentMax < minMs) {
        nextPartial.geminiMaxSendIntervalMs = minMs;
      }
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
