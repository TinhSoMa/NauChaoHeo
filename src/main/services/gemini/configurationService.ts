/**
 * ConfigurationService
 * 
 * Centralized configuration management for Gemini Web API credentials.
 * Provides validation, caching, and single source of truth for cookie config.
 */

import Database from 'better-sqlite3';

export interface GeminiCookieConfig {
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  reqId?: string;
  updatedAt: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ConfigurationService {
  private db: Database.Database;
  private cachedConfig: GeminiCookieConfig | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 5000; // Cache for 5 seconds

  constructor(database: Database.Database) {
    this.db = database;
  }

  /**
   * Validate cookie configuration
   */
  validateConfig(config: Partial<GeminiCookieConfig>): ValidationResult {
    const errors: string[] = [];

    if (!config.cookie || !config.cookie.trim()) {
      errors.push('Cookie is required');
    } else {
      // Check for required cookies
      if (!config.cookie.includes('__Secure-1PSID')) {
        errors.push('Cookie must contain __Secure-1PSID');
      }
      if (!config.cookie.includes('__Secure-3PSID')) {
        errors.push('Cookie must contain __Secure-3PSID');
      }
    }

    if (!config.blLabel || !config.blLabel.trim()) {
      errors.push('BL_LABEL is required');
    }

    if (!config.fSid || !config.fSid.trim()) {
      errors.push('F_SID is required');
    }

    if (!config.atToken || !config.atToken.trim()) {
      errors.push('AT_TOKEN is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get active cookie configuration (with caching)
   */
  getActiveConfig(): GeminiCookieConfig | null {
    // Return cached config if still valid
    const now = Date.now();
    if (this.cachedConfig && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return { ...this.cachedConfig };
    }

    // Fetch from database
    try {
      const row = this.db
        .prepare('SELECT * FROM gemini_cookie WHERE id = 1')
        .get() as any;

      if (row) {
        const config: GeminiCookieConfig = {
          cookie: row.cookie,
          blLabel: row.bl_label,
          fSid: row.f_sid,
          atToken: row.at_token,
          reqId: row.req_id,
          updatedAt: row.updated_at
        };

        // Update cache
        this.cachedConfig = config;
        this.cacheTimestamp = now;

        return { ...config };
      }

      return null;
    } catch (error) {
      console.error('[ConfigurationService] Error fetching config:', error);
      return null;
    }
  }

  /**
   * Save or update cookie configuration
   */
  saveConfig(config: Omit<GeminiCookieConfig, 'updatedAt'>): { success: boolean; error?: string } {
    // Validate first
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join(', ')}`
      };
    }

    try {
      const now = Date.now();

      // Check if config exists
      const existing = this.db
        .prepare('SELECT id FROM gemini_cookie WHERE id = 1')
        .get();

      if (existing) {
        // Update
        this.db
          .prepare(
            `UPDATE gemini_cookie 
             SET cookie = ?, bl_label = ?, f_sid = ?, at_token = ?, req_id = ?, updated_at = ?
             WHERE id = 1`
          )
          .run(
            config.cookie,
            config.blLabel,
            config.fSid,
            config.atToken,
            config.reqId || null,
            now
          );
      } else {
        // Insert
        this.db
          .prepare(
            `INSERT INTO gemini_cookie (id, cookie, bl_label, f_sid, at_token, req_id, updated_at)
             VALUES (1, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            config.cookie,
            config.blLabel,
            config.fSid,
            config.atToken,
            config.reqId || null,
            now
          );
      }

      // Invalidate cache
      this.invalidateCache();

      console.log('[ConfigurationService] Config saved successfully');
      return { success: true };
    } catch (error) {
      console.error('[ConfigurationService] Error saving config:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update only the reqId field (for incrementing request counter)
   */
  updateReqId(reqId: string): { success: boolean; error?: string } {
    try {
      this.db
        .prepare('UPDATE gemini_cookie SET req_id = ?, updated_at = ? WHERE id = 1')
        .run(reqId, Date.now());

      // Invalidate cache
      this.invalidateCache();

      return { success: true };
    } catch (error) {
      console.error('[ConfigurationService] Error updating reqId:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check if a valid configuration exists
   */
  hasValidConfig(): boolean {
    const config = this.getActiveConfig();
    if (!config) return false;

    const validation = this.validateConfig(config);
    return validation.valid;
  }

  /**
   * Invalidate the cache (force refresh on next access)
   */
  invalidateCache(): void {
    this.cachedConfig = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Get configuration age in milliseconds
   */
  getConfigAge(): number | null {
    const config = this.getActiveConfig();
    if (!config) return null;

    return Date.now() - config.updatedAt;
  }
}

// Singleton instance
let instance: ConfigurationService | null = null;

export function getConfigurationService(database: Database.Database): ConfigurationService {
  if (!instance) {
    instance = new ConfigurationService(database);
  }
  return instance;
}
