/**
 * Database Schema - Chỉ dùng cho bảng prompts
 * Projects được lưu trong JSON files trong project folders
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type { GrokUiProfileConfig } from '../../shared/types/grokUi';
import { AppSettingsService } from '../services/appSettings';

type PromptRowLite = {
  id: string;
  name: string;
  description?: string | null;
  source_lang: string;
  target_lang: string;
  created_at: number;
  prompt_type?: string | null;
  language_bucket?: string | null;
  group_id?: string | null;
  family_id?: string | null;
  version_no?: number | null;
};

const extractCookieKey = (cookie: string): string => {
  const trimmed = (cookie || '').trim();
  const psid1 = trimmed.match(/__Secure-1PSID=([^;\s]+)/)?.[1] || '';
  const psid3 = trimmed.match(/__Secure-3PSID=([^;\s]+)/)?.[1] || '';
  const combined = [psid1, psid3].filter(Boolean).join('|');
  return combined || trimmed;
};

const buildTokenKey = (cookie: string, atToken: string): string => {
  const cookieKey = extractCookieKey(cookie);
  const atKey = (atToken || '').trim();
  const combined = `${cookieKey}|${atKey}`;
  return combined === '|' ? '' : combined;
};

function getDefaultGrokUiProfileDir(): string {
  try {
    return path.join(app.getPath('userData'), 'grok3_profile');
  } catch {
    return path.join(process.cwd(), 'grok3_profile');
  }
}

function buildLegacyGrokUiProfiles(settings: {
  grokUiProfiles?: GrokUiProfileConfig[];
  grokUiProfileDir?: string | null;
  grokUiProfileName?: string | null;
  grokUiAnonymous?: boolean;
}): GrokUiProfileConfig[] {
  const list = Array.isArray(settings.grokUiProfiles) ? settings.grokUiProfiles : [];
  if (list.length > 0) {
    return list;
  }
  const anonymous = settings.grokUiAnonymous === true;
  return [{
    id: 'default',
    profileDir: anonymous ? null : (settings.grokUiProfileDir ?? getDefaultGrokUiProfileDir()),
    profileName: anonymous ? null : (settings.grokUiProfileName ?? 'Default'),
    anonymous,
    enabled: true,
  }];
}

function normalizePromptType(raw: unknown, name: string): 'translation' | 'summary' | 'caption' {
  if (raw === 'translation' || raw === 'summary' || raw === 'caption') {
    return raw;
  }
  const lowered = (name || '').toLowerCase();
  if (lowered.includes('summary') || lowered.includes('[summary]') || lowered.includes('tóm tắt')) {
    return 'summary';
  }
  if (lowered.includes('caption') || lowered.includes('subtitle') || lowered.includes('phụ đề')) {
    return 'caption';
  }
  return 'translation';
}

function normalizePromptNameForFamily(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\bv\d+\b/g, '')
    .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 96);
}

function toLanguageBucket(sourceLang: string, targetLang: string): string {
  const src = (sourceLang || '').trim().toLowerCase() || 'unknown';
  const dst = (targetLang || '').trim().toLowerCase() || 'unknown';
  return `${src}->${dst}`;
}

function normalizeGroupName(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ').slice(0, 64) || 'General';
}

function normalizeGroupKey(name: string): string {
  return normalizeGroupName(name).toLowerCase();
}

function ensurePromptHierarchySchema(dbRef: Database.Database): void {
  dbRef.exec(`
    CREATE TABLE IF NOT EXISTS prompt_groups (
      id TEXT PRIMARY KEY,
      language_bucket TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(language_bucket, normalized_name)
    );
  `);

  const columns = dbRef.pragma('table_info(prompts)') as Array<{ name: string }>;
  const existing = new Set(columns.map((col) => col.name));
  const alterStatements: string[] = [];

  if (!existing.has('prompt_type')) {
    alterStatements.push("ALTER TABLE prompts ADD COLUMN prompt_type TEXT NOT NULL DEFAULT 'translation';");
  }
  if (!existing.has('language_bucket')) {
    alterStatements.push("ALTER TABLE prompts ADD COLUMN language_bucket TEXT;");
  }
  if (!existing.has('group_id')) {
    alterStatements.push('ALTER TABLE prompts ADD COLUMN group_id TEXT;');
  }
  if (!existing.has('family_id')) {
    alterStatements.push('ALTER TABLE prompts ADD COLUMN family_id TEXT;');
  }
  if (!existing.has('version_no')) {
    alterStatements.push('ALTER TABLE prompts ADD COLUMN version_no INTEGER NOT NULL DEFAULT 1;');
  }
  if (!existing.has('is_latest')) {
    alterStatements.push('ALTER TABLE prompts ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 1;');
  }
  if (!existing.has('archived')) {
    alterStatements.push('ALTER TABLE prompts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;');
  }

  for (const statement of alterStatements) {
    dbRef.exec(statement);
  }

  dbRef.exec('CREATE INDEX IF NOT EXISTS idx_prompts_language_bucket ON prompts(language_bucket);');
  dbRef.exec('CREATE INDEX IF NOT EXISTS idx_prompts_family_id ON prompts(family_id);');
  dbRef.exec('CREATE INDEX IF NOT EXISTS idx_prompts_group_id ON prompts(group_id);');
  dbRef.exec('CREATE INDEX IF NOT EXISTS idx_prompt_groups_bucket ON prompt_groups(language_bucket, normalized_name);');
}

function backfillPromptHierarchy(dbRef: Database.Database): void {
  const rows = dbRef.prepare(`
    SELECT
      id, name, description, source_lang, target_lang, created_at,
      prompt_type, language_bucket, group_id, family_id, version_no
    FROM prompts
    ORDER BY created_at ASC
  `).all() as PromptRowLite[];

  if (rows.length === 0) {
    return;
  }

  const now = Date.now();
  const familyIdByKey = new Map<string, string>();
  const groupIdByBucketAndName = new Map<string, string>();

  const ensureGroup = (languageBucket: string, groupNameInput: string): string => {
    const groupName = normalizeGroupName(groupNameInput);
    const groupKey = `${languageBucket}::${normalizeGroupKey(groupName)}`;
    const inMemory = groupIdByBucketAndName.get(groupKey);
    if (inMemory) {
      return inMemory;
    }

    const existing = dbRef.prepare(
      'SELECT id FROM prompt_groups WHERE language_bucket = ? AND normalized_name = ? LIMIT 1'
    ).get(languageBucket, normalizeGroupKey(groupName)) as { id: string } | undefined;

    if (existing?.id) {
      groupIdByBucketAndName.set(groupKey, existing.id);
      return existing.id;
    }

    const groupId = `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    dbRef.prepare(`
      INSERT INTO prompt_groups (id, language_bucket, name, normalized_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(groupId, languageBucket, groupName, normalizeGroupKey(groupName), now, now);
    groupIdByBucketAndName.set(groupKey, groupId);
    return groupId;
  };

  const updateStmt = dbRef.prepare(`
    UPDATE prompts
    SET prompt_type = ?, language_bucket = ?, group_id = ?, family_id = ?, version_no = ?, archived = COALESCE(archived, 0)
    WHERE id = ?
  `);

  const tx = dbRef.transaction(() => {
    for (const row of rows) {
      const languageBucket = (row.language_bucket && row.language_bucket.trim())
        ? row.language_bucket.trim().toLowerCase()
        : toLanguageBucket(row.source_lang, row.target_lang);
      const promptType = normalizePromptType(row.prompt_type, row.name || '');
      const groupId = (row.group_id && row.group_id.trim())
        ? row.group_id
        : ensureGroup(languageBucket, 'General');
      const normalizedName = normalizePromptNameForFamily(row.name || 'untitled');
      const familyKey = `${languageBucket}::${promptType}::${normalizedName}`;
      const familyId = (row.family_id && row.family_id.trim())
        ? row.family_id
        : (familyIdByKey.get(familyKey) || row.id);
      familyIdByKey.set(familyKey, familyId);
      const versionNo = typeof row.version_no === 'number' && row.version_no > 0 ? Math.floor(row.version_no) : 1;

      updateStmt.run(promptType, languageBucket, groupId, familyId, versionNo, row.id);
    }

    dbRef.exec('UPDATE prompts SET is_latest = 0;');
    dbRef.exec(`
      UPDATE prompts
      SET is_latest = 1
      WHERE id IN (
        SELECT p.id
        FROM prompts p
        INNER JOIN (
          SELECT family_id, MAX(version_no) AS max_version, MAX(updated_at) AS max_updated
          FROM prompts
          GROUP BY family_id
        ) latest
          ON p.family_id = latest.family_id
          AND p.version_no = latest.max_version
          AND p.updated_at = latest.max_updated
      );
    `);
  });

  tx();
}

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    if (app) {
      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'nauchaoheo.db');
      console.log('[Database] Path:', dbPath);
      db = new Database(dbPath);
    } else {
      throw new Error('Database not initialized and app is not ready');
    }
  }
  return db;
}

export function initDatabase(): void {
  const userDataPath = app.getPath('userData');
  
  // Ensure directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  const dbPath = path.join(userDataPath, 'nauchaoheo.db');
  console.log('[Database] Initializing at:', dbPath);
  
  db = new Database(dbPath);
  if (!db) {
    throw new Error('Database initialization failed');
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create prompts table (only table needed - projects use JSON files)
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source_lang TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  ensurePromptHierarchySchema(db);
  backfillPromptHierarchy(db);

  // Create gemini_cookie table - CHỈ lưu cookie và các thông số cố định (KHÔNG lưu convId/respId/candId)
  // Chỉ có 1 dòng duy nhất (id = 1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_cookie (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie TEXT NOT NULL,
      bl_label TEXT NOT NULL,
      f_sid TEXT NOT NULL,
      at_token TEXT NOT NULL,
      req_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migration: Add missing columns if not exists
  try {
    const tableInfo = db.pragma('table_info(gemini_chat_config)') as any[];
    const columnNames = tableInfo.map(col => col.name);
    
    if (!columnNames.includes('req_id')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN req_id TEXT');
        console.log('[Database] Added missing column: req_id');
    }
    if (!columnNames.includes('proxy_id')) {
      db.exec('ALTER TABLE gemini_chat_config ADD COLUMN proxy_id TEXT');
      console.log('[Database] Added missing column: proxy_id');
    }
    if (!columnNames.includes('user_agent')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN user_agent TEXT');
        console.log('[Database] Added missing column: user_agent');
    }
    if (!columnNames.includes('accept_language')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN accept_language TEXT');
        console.log('[Database] Added missing column: accept_language');
    }
    if (!columnNames.includes('platform')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN platform TEXT');
        console.log('[Database] Added missing column: platform');
    }
  } catch (e) {
      console.error('[Database] Migration error:', e);
  }

  // Migration: Copy data from gemini_cookie to gemini_chat_config if needed
  try {
    const cookieData = db.prepare('SELECT * FROM gemini_cookie WHERE id = 1').get() as any;
    const configCount = db.prepare('SELECT COUNT(*) as count FROM gemini_chat_config').get() as any;
    
    if (cookieData && configCount.count === 0) {
      console.log('[Database] Migrating data from gemini_cookie to gemini_chat_config...');
      const now = Date.now();
      const { v4: uuidv4 } = require('uuid');
      
      db.prepare(`
        INSERT INTO gemini_chat_config (
          id, name, cookie, bl_label, f_sid, at_token, req_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        uuidv4(),
        'Migrated Config',
        cookieData.cookie,
        cookieData.bl_label,
        cookieData.f_sid,
        cookieData.at_token,
        cookieData.req_id,
        now,
        now
      );
      console.log('[Database] Migration from gemini_cookie completed');
    }
  } catch (e) {
    // Ignore if gemini_cookie doesn't exist or migration fails
    console.log('[Database] No migration needed from gemini_cookie');
  }

  // Migration: Backfill gemini_chat_context from gemini_chat_config if empty
  try {
    const contextCount = db.prepare('SELECT COUNT(*) as count FROM gemini_chat_context').get() as any;
    if (contextCount.count === 0) {
      const rows = db.prepare('SELECT id, conv_id, resp_id, cand_id FROM gemini_chat_config').all() as any[];
      const insert = db.prepare(`
        INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const row of rows) {
        if (row.conv_id || row.resp_id || row.cand_id) {
          insert.run(row.id, row.conv_id || '', row.resp_id || '', row.cand_id || '', now);
        }
      }
      console.log('[Database] Backfilled gemini_chat_context from gemini_chat_config');
    }
  } catch (e) {
    console.error('[Database] Backfill gemini_chat_context failed:', e);
  }
  // Create gemini_chat_config table - luu cau hinh Gemini Chat (Web)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_chat_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'default',
      cookie TEXT NOT NULL,
      bl_label TEXT,
      f_sid TEXT,
      at_token TEXT,
      proxy_id TEXT,
      conv_id TEXT,
      resp_id TEXT,
      cand_id TEXT,
      req_id TEXT,
      user_agent TEXT,
      accept_language TEXT,
      platform TEXT,
      "__Secure-1PSID" TEXT,
      "__Secure-1PSIDTS" TEXT,
      is_active INTEGER DEFAULT 1,
      is_error INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Create gemini_cookie table - CHỈ lưu cookie và các thông số cố định (KHÔNG lưu convId/respId/candId)
  // Chỉ có 1 dòng duy nhất (id = 1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_cookie (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie TEXT NOT NULL,
      bl_label TEXT NOT NULL,
      f_sid TEXT NOT NULL,
      at_token TEXT NOT NULL,
      req_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migration: Add missing columns if not exists
  try {
    const tableInfo = db.pragma('table_info(gemini_chat_config)') as any[];
    const columnNames = tableInfo.map(col => col.name);
    
    if (!columnNames.includes('req_id')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN req_id TEXT');
        console.log('[Database] Added missing column: req_id');
    }
    if (!columnNames.includes('proxy_id')) {
      db.exec('ALTER TABLE gemini_chat_config ADD COLUMN proxy_id TEXT');
      console.log('[Database] Added missing column: proxy_id');
    }
    if (!columnNames.includes('user_agent')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN user_agent TEXT');
        console.log('[Database] Added missing column: user_agent');
    }
    if (!columnNames.includes('accept_language')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN accept_language TEXT');
        console.log('[Database] Added missing column: accept_language');
    }
    if (!columnNames.includes('platform')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN platform TEXT');
        console.log('[Database] Added missing column: platform');
    }
  } catch (e) {
      console.error('[Database] Migration error:', e);
  }

  // Migration: Copy data from gemini_cookie to gemini_chat_config if needed
  try {
    const cookieData = db.prepare('SELECT * FROM gemini_cookie WHERE id = 1').get() as any;
    const configCount = db.prepare('SELECT COUNT(*) as count FROM gemini_chat_config').get() as any;
    
    if (cookieData && configCount.count === 0) {
      console.log('[Database] Migrating data from gemini_cookie to gemini_chat_config...');
      const now = Date.now();
      const { v4: uuidv4 } = require('uuid');
      
      db.prepare(`
        INSERT INTO gemini_chat_config (
          id, name, cookie, bl_label, f_sid, at_token, req_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        uuidv4(),
        'Migrated Config',
        cookieData.cookie,
        cookieData.bl_label,
        cookieData.f_sid,
        cookieData.at_token,
        cookieData.req_id,
        now,
        now
      );
      console.log('[Database] Migration from gemini_cookie completed');
    }
  } catch (e) {
    // Ignore if gemini_cookie doesn't exist or migration fails
    console.log('[Database] No migration needed from gemini_cookie');
  }

  // Migration: Backfill gemini_chat_context from gemini_chat_config if empty
  try {
    const contextCount = db.prepare('SELECT COUNT(*) as count FROM gemini_chat_context').get() as any;
    if (contextCount.count === 0) {
      const rows = db.prepare('SELECT id, conv_id, resp_id, cand_id FROM gemini_chat_config').all() as any[];
      const insert = db.prepare(`
        INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const row of rows) {
        if (row.conv_id || row.resp_id || row.cand_id) {
          insert.run(row.id, row.conv_id || '', row.resp_id || '', row.cand_id || '', now);
        }
      }
      console.log('[Database] Backfilled gemini_chat_context from gemini_chat_config');
    }
  } catch (e) {
    console.error('[Database] Backfill gemini_chat_context failed:', e);
  }
  // Create gemini_chat_context table - luu ngữ cảnh theo từng token (config)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_chat_context (
      config_id TEXT PRIMARY KEY,
      conversation_id TEXT,
      response_id TEXT,
      choice_id TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (config_id) REFERENCES gemini_chat_config(id) ON DELETE CASCADE
    );
  `);

  // Create gemini_cookie table - CHỈ lưu cookie và các thông số cố định (KHÔNG lưu convId/respId/candId)
  // Chỉ có 1 dòng duy nhất (id = 1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_cookie (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie TEXT NOT NULL,
      bl_label TEXT NOT NULL,
      f_sid TEXT NOT NULL,
      at_token TEXT NOT NULL,
      req_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migration: Add missing columns if not exists
  try {
    const tableInfo = db.pragma('table_info(gemini_chat_config)') as any[];
    const columnNames = tableInfo.map(col => col.name);
    
    if (!columnNames.includes('req_id')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN req_id TEXT');
        console.log('[Database] Added missing column: req_id');
    }
    if (!columnNames.includes('proxy_id')) {
      db.exec('ALTER TABLE gemini_chat_config ADD COLUMN proxy_id TEXT');
      console.log('[Database] Added missing column: proxy_id');
    }
    if (!columnNames.includes('user_agent')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN user_agent TEXT');
        console.log('[Database] Added missing column: user_agent');
    }
    if (!columnNames.includes('accept_language')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN accept_language TEXT');
        console.log('[Database] Added missing column: accept_language');
    }
    if (!columnNames.includes('platform')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN platform TEXT');
        console.log('[Database] Added missing column: platform');
    }
  } catch (e) {
      console.error('[Database] Migration error:', e);
  }

  // Migration: Copy data from gemini_cookie to gemini_chat_config if needed
  try {
    const cookieData = db.prepare('SELECT * FROM gemini_cookie WHERE id = 1').get() as any;
    const configCount = db.prepare('SELECT COUNT(*) as count FROM gemini_chat_config').get() as any;
    
    if (cookieData && configCount.count === 0) {
      console.log('[Database] Migrating data from gemini_cookie to gemini_chat_config...');
      const now = Date.now();
      const { v4: uuidv4 } = require('uuid');
      
      db.prepare(`
        INSERT INTO gemini_chat_config (
          id, name, cookie, bl_label, f_sid, at_token, req_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        uuidv4(),
        'Migrated Config',
        cookieData.cookie,
        cookieData.bl_label,
        cookieData.f_sid,
        cookieData.at_token,
        cookieData.req_id,
        now,
        now
      );
      console.log('[Database] Migration from gemini_cookie completed');
    }
  } catch (e) {
    // Ignore if gemini_cookie doesn't exist or migration fails
    console.log('[Database] No migration needed from gemini_cookie');
  }

  // Migration: Backfill gemini_chat_context from gemini_chat_config if empty
  try {
    const contextCount = db.prepare('SELECT COUNT(*) as count FROM gemini_chat_context').get() as any;
    if (contextCount.count === 0) {
      const rows = db.prepare('SELECT id, conv_id, resp_id, cand_id FROM gemini_chat_config').all() as any[];
      const insert = db.prepare(`
        INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const row of rows) {
        if (row.conv_id || row.resp_id || row.cand_id) {
          insert.run(row.id, row.conv_id || '', row.resp_id || '', row.cand_id || '', now);
        }
      }
      console.log('[Database] Backfilled gemini_chat_context from gemini_chat_config');
    }
  } catch (e) {
    console.error('[Database] Backfill gemini_chat_context failed:', e);
  }


  // Create proxies table - lưu proxy rotation config
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxies (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      type TEXT DEFAULT 'http' CHECK(type IN ('http', 'https', 'socks5')),
      enabled INTEGER DEFAULT 1,
      platform TEXT,
      country TEXT,
      city TEXT,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(host, port, type)
    );
  `);

  // Create rotating_proxy_configs table - lưu cấu hình rotating endpoint theo scope
  db.exec(`
    CREATE TABLE IF NOT EXISTS rotating_proxy_configs (
      scope TEXT PRIMARY KEY,
      host TEXT,
      port INTEGER,
      username TEXT,
      password TEXT,
      protocol TEXT DEFAULT 'http' CHECK(protocol IN ('http', 'socks5')),
      updated_at INTEGER NOT NULL
    );
  `);

  // Create webshare_api_keys table - lưu Webshare API Key
  db.exec(`
    CREATE TABLE IF NOT EXISTS webshare_api_keys (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      api_key TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Create caption_default_settings table - lưu default settings caption
  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_default_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      settings_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Create grok_ui_profiles table - lưu profile Grok UI
  db.exec(`
    CREATE TABLE IF NOT EXISTS grok_ui_profiles (
      id TEXT PRIMARY KEY,
      profile_dir TEXT,
      profile_name TEXT,
      anonymous INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      sort_order INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Seed grok_ui_profiles from appSettings if empty
  try {
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM grok_ui_profiles`).get() as { count: number };
    if ((countRow?.count ?? 0) === 0) {
      const settings = AppSettingsService.getAll();
      const seedProfiles = buildLegacyGrokUiProfiles(settings);
      const now = Date.now();
      const insert = db.prepare(`
        INSERT INTO grok_ui_profiles (
          id, profile_dir, profile_name, anonymous, enabled, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      seedProfiles.forEach((profile, index) => {
        insert.run(
          profile.id,
          profile.profileDir || null,
          profile.profileName || null,
          profile.anonymous ? 1 : 0,
          profile.enabled ? 1 : 0,
          index + 1,
          now,
          now
        );
      });
      console.log('[Database] Seeded grok_ui_profiles from AppSettings');
    }
  } catch (e) {
    console.error('[Database] Seed grok_ui_profiles failed:', e);
  }

  // Migration: Update proxies unique constraint to include type
  try {
    const database = db;
    if (!database) {
      throw new Error('Database not initialized');
    }
    const indexList = database.pragma("index_list('proxies')") as any[];
    const uniqueIndexes = indexList.filter((idx) => idx.unique);
    const hasHostPortTypeUnique = uniqueIndexes.some((idx) => {
      const cols = database.pragma(`index_info('${idx.name}')`) as any[];
      const names = cols.map((c) => c.name);
      return names.length === 3 && names.includes('host') && names.includes('port') && names.includes('type');
    });
    const hasHostPortUnique = uniqueIndexes.some((idx) => {
      const cols = database.pragma(`index_info('${idx.name}')`) as any[];
      const names = cols.map((c) => c.name);
      return names.length === 2 && names.includes('host') && names.includes('port');
    });

    if (!hasHostPortTypeUnique && hasHostPortUnique) {
      console.log('[Database] Migrating proxies unique constraint to include type...');
      database.exec('BEGIN');
      database.exec('ALTER TABLE proxies RENAME TO proxies_old');
      database.exec(`
        CREATE TABLE proxies (
          id TEXT PRIMARY KEY,
          host TEXT NOT NULL,
          port INTEGER NOT NULL,
          username TEXT,
          password TEXT,
          type TEXT DEFAULT 'http' CHECK(type IN ('http', 'https', 'socks5')),
          enabled INTEGER DEFAULT 1,
          platform TEXT,
          country TEXT,
          city TEXT,
          success_count INTEGER DEFAULT 0,
          failed_count INTEGER DEFAULT 0,
          last_used_at INTEGER,
          created_at INTEGER NOT NULL,
          UNIQUE(host, port, type)
        );
      `);
      database.exec(`
        INSERT INTO proxies (
          id, host, port, username, password, type, enabled,
          platform, country, city, success_count, failed_count,
          last_used_at, created_at
        )
        SELECT
          id, host, port, username, password, type, enabled,
          platform, country, city, success_count, failed_count,
          last_used_at, created_at
        FROM proxies_old
      `);
      database.exec('DROP TABLE proxies_old');
      database.exec('COMMIT');
      console.log('[Database] Proxies unique constraint migration completed');
    }
  } catch (e) {
    try {
      db?.exec('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('[Database] Proxies unique constraint migration failed:', e);
  }

  // Create gemini_cookie table - CHỈ lưu cookie và các thông số cố định (KHÔNG lưu convId/respId/candId)
  // Chỉ có 1 dòng duy nhất (id = 1)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_cookie (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie TEXT NOT NULL,
      bl_label TEXT NOT NULL,
      f_sid TEXT NOT NULL,
      at_token TEXT NOT NULL,
      req_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migration: Add missing columns if not exists
  try {
    const tableInfo = db.pragma('table_info(gemini_chat_config)') as any[];
    const columnNames = tableInfo.map(col => col.name);
    
    if (!columnNames.includes('req_id')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN req_id TEXT');
        console.log('[Database] Added missing column: req_id');
    }
    if (!columnNames.includes('proxy_id')) {
      db.exec('ALTER TABLE gemini_chat_config ADD COLUMN proxy_id TEXT');
      console.log('[Database] Added missing column: proxy_id');
    }
    if (!columnNames.includes('user_agent')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN user_agent TEXT');
        console.log('[Database] Added missing column: user_agent');
    }
    if (!columnNames.includes('accept_language')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN accept_language TEXT');
        console.log('[Database] Added missing column: accept_language');
    }
    if (!columnNames.includes('platform')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN platform TEXT');
        console.log('[Database] Added missing column: platform');
    }
    if (!columnNames.includes('is_error')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN is_error INTEGER DEFAULT 0');
        console.log('[Database] Added missing column: is_error');
    }
    if (!columnNames.includes('__Secure-1PSID')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN "__Secure-1PSID" TEXT');
        console.log('[Database] Added missing column: __Secure-1PSID');
    }
    if (!columnNames.includes('__Secure-1PSIDTS')) {
        db.exec('ALTER TABLE gemini_chat_config ADD COLUMN "__Secure-1PSIDTS" TEXT');
        console.log('[Database] Added missing column: __Secure-1PSIDTS');
    }
  } catch (e) {
      console.error('[Database] Migration error:', e);
  }

  // Migration: Copy data from gemini_cookie to gemini_chat_config if needed
  try {
    const cookieData = db.prepare('SELECT * FROM gemini_cookie WHERE id = 1').get() as any;
    const configCount = db.prepare('SELECT COUNT(*) as count FROM gemini_chat_config').get() as any;
    
    if (cookieData && configCount.count === 0) {
      console.log('[Database] Migrating data from gemini_cookie to gemini_chat_config...');
      const now = Date.now();
      const { v4: uuidv4 } = require('uuid');
      
      db.prepare(`
        INSERT INTO gemini_chat_config (
          id, name, cookie, bl_label, f_sid, at_token, req_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        uuidv4(),
        'Migrated Config',
        cookieData.cookie,
        cookieData.bl_label,
        cookieData.f_sid,
        cookieData.at_token,
        cookieData.req_id,
        now,
        now
      );
      console.log('[Database] Migration from gemini_cookie completed');
    }
  } catch (e) {
    // Ignore if gemini_cookie doesn't exist or migration fails
    console.log('[Database] No migration needed from gemini_cookie');
  }

  // Migration: Backfill gemini_chat_context from gemini_chat_config if empty
  try {
    const contextCount = db.prepare('SELECT COUNT(*) as count FROM gemini_chat_context').get() as any;
    if (contextCount.count === 0) {
      const rows = db.prepare('SELECT id, conv_id, resp_id, cand_id FROM gemini_chat_config').all() as any[];
      const insert = db.prepare(`
        INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const row of rows) {
        if (row.conv_id || row.resp_id || row.cand_id) {
          insert.run(row.id, row.conv_id || '', row.resp_id || '', row.cand_id || '', now);
        }
      }
      console.log('[Database] Backfilled gemini_chat_context from gemini_chat_config');
    }
  } catch (e) {
    console.error('[Database] Backfill gemini_chat_context failed:', e);
  }

  // Migration: backfill __Secure-1PSID / __Secure-1PSIDTS from legacy cookie column
  try {
    const rows = db
      .prepare('SELECT id, cookie, "__Secure-1PSID" as secure_1psid, "__Secure-1PSIDTS" as secure_1psidts FROM gemini_chat_config')
      .all() as any[];
    const updateSecureColumns = db.prepare(
      'UPDATE gemini_chat_config SET "__Secure-1PSID" = ?, "__Secure-1PSIDTS" = ?, updated_at = ? WHERE id = ?',
    );
    const now = Date.now();
    let updatedCount = 0;

    for (const row of rows) {
      if (row.secure_1psid && row.secure_1psidts) {
        continue;
      }
      const cookie = String(row.cookie || '').trim();
      if (!cookie) {
        continue;
      }
      const parsed1psid = cookie.match(/__Secure-1PSID=([^;\s]+)/)?.[1] || null;
      const parsed1psidts = cookie.match(/__Secure-1PSIDTS=([^;\s]+)/)?.[1] || null;
      if (!parsed1psid || !parsed1psidts) {
        continue;
      }

      updateSecureColumns.run(parsed1psid, parsed1psidts, now, row.id);
      updatedCount += 1;
    }

    if (updatedCount > 0) {
      console.log(`[Database] Backfilled secure cookie columns for ${updatedCount} gemini_chat_config rows`);
    }
  } catch (e) {
    console.error('[Database] Backfill secure cookie columns failed:', e);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_gemini_web_conversation (
      project_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_path_hash TEXT NOT NULL,
      account_config_id TEXT NOT NULL,
      conversation_metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, source_path_hash, account_config_id),
      FOREIGN KEY (account_config_id) REFERENCES gemini_chat_config(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_caption_gemini_web_conversation_updated_at
    ON caption_gemini_web_conversation(updated_at);
  `);


  // Create downloader_cookies table  one Netscape cookie file per domain
  db.exec(`
    CREATE TABLE IF NOT EXISTS downloader_cookies (
      id         TEXT PRIMARY KEY,
      domain     TEXT NOT NULL UNIQUE,
      label      TEXT NOT NULL,
      content    TEXT NOT NULL,
      enabled    INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  console.log('[Database] Schema initialized (prompts, gemini_chat_config, gemini_chat_context, gemini_cookie, proxies, caption_gemini_web_conversation, downloader_cookies)');
}
