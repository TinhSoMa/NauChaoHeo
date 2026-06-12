/**
 * Database Schema - Chỉ dùng cho bảng prompts
 * Projects được lưu trong JSON files trong project folders
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type { GrokUiProfileConfig } from '../../shared/types/grokUi';
import { GEMINI_MODEL_LIST } from '../../shared/types/gemini';
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

function seedGeminiModelsIfEmpty(dbRef: Database.Database): void {
  try {
    const countRow = dbRef.prepare('SELECT COUNT(*) as count FROM gemini_models').get() as { count?: number };
    const currentCount = Number(countRow?.count ?? 0);
    if (currentCount > 0) {
      return;
    }

    const now = Date.now();
    const insert = dbRef.prepare(`
      INSERT INTO gemini_models (
        model_id,
        name,
        label,
        description,
        enabled,
        source,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertSettings = dbRef.prepare(`
      INSERT OR REPLACE INTO gemini_model_settings (
        id,
        default_model_id,
        last_synced_at,
        updated_at
      ) VALUES (1, ?, NULL, ?)
    `);

    const tx = dbRef.transaction(() => {
      GEMINI_MODEL_LIST.forEach((model, index) => {
        insert.run(
          model.id,
          model.name || model.id,
          model.label || model.id,
          model.description || '',
          1,
          'seed',
          index + 1,
          now,
          now,
        );
      });

      const firstModel = GEMINI_MODEL_LIST[0]?.id || null;
      upsertSettings.run(firstModel, now);
    });

    tx();
    console.log(`[Database] Seeded gemini_models with ${GEMINI_MODEL_LIST.length} model(s)`);
  } catch (error) {
    console.error('[Database] Seed gemini_models failed:', error);
  }
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

function migrateLegacyGeminiTables(dbRef: Database.Database): void {
  try {
    const hasOldKeys = (dbRef.pragma(`table_info(gemini_api_keys)`) as any[]).length > 0;
    const hasOldState = (dbRef.pragma(`table_info(gemini_api_state)`) as any[]).length > 0;
    if (!hasOldKeys && !hasOldState) {
      return;
    }

    const now = Date.now();

    if (hasOldKeys) {
      const rows = dbRef.prepare(`SELECT id, encrypted_data FROM gemini_api_keys`).all() as any[];
      for (const row of rows) {
        try {
          const { decrypt } = require('../services/gemini/keyStorage');
          const json = decrypt(row.encrypted_data);
          const accounts = JSON.parse(json);
          if (!Array.isArray(accounts)) continue;

          const insertAccount = dbRef.prepare(
            `INSERT OR REPLACE INTO gemini_accounts (account_id, email, account_status, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          );
          const insertProject = dbRef.prepare(
            `INSERT OR REPLACE INTO gemini_projects
              (account_id, project_index, project_name, api_key, status, total_requests_today, success_count, error_count, last_success_timestamp, last_error_message, last_used_timestamp, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );

          accounts.forEach((acc: any, i: number) => {
            const accountId = `acc_${String(i + 1).padStart(2, '0')}`;
            insertAccount.run(accountId, acc.email || accountId, 'active', i, now, now);
            (acc.projects || []).forEach((proj: any, j: number) => {
              insertProject.run(
                accountId,
                j,
                proj.projectName || `Project-${j + 1}`,
                proj.apiKey || '',
                'available',
                0,
                0,
                0,
                null,
                null,
                null,
                now,
                now,
              );
            });
          });
        } catch (err) {
          console.error('[Database] migrateLegacyGeminiTables keys failed:', err);
        }
      }

      try {
        dbRef.exec(`DROP TABLE IF EXISTS gemini_api_keys`);
        console.log('[Database] Dropped legacy table gemini_api_keys');
      } catch (e) {
        console.error('[Database] Drop legacy gemini_api_keys failed:', e);
      }
    }

    if (hasOldState) {
      const stateRow = dbRef.prepare(`SELECT id, state_json FROM gemini_api_state WHERE id = 1`).get() as any;
      if (stateRow?.state_json) {
        try {
          const state = JSON.parse(stateRow.state_json);
          const settingsJson = JSON.stringify(state?.settings || {});
          const rotationJson = JSON.stringify(state?.rotationState || {});
          dbRef.prepare(
            `INSERT OR REPLACE INTO gemini_state (id, settings_json, rotation_state_json, updated_at) VALUES (1, ?, ?, ?)`
          ).run(settingsJson, rotationJson, now);

          if (state?.accounts) {
            const updateAccountStatus = dbRef.prepare(
              `UPDATE gemini_accounts SET account_status = ? WHERE account_id = ?`
            );
            const updateProjectStatus = dbRef.prepare(
              `UPDATE gemini_projects SET status = ?, success_count = ?, error_count = ?, last_used_timestamp = ?, updated_at = ? WHERE account_id = ? AND project_index = ?`
            );
            state.accounts.forEach((acc: any) => {
              updateAccountStatus.run(acc.accountStatus || 'active', acc.accountId);
              (acc.projects || []).forEach((proj: any, idx: number) => {
                updateProjectStatus.run(
                  proj.status || 'available',
                  proj.stats?.successCount || 0,
                  proj.stats?.errorCount || 0,
                  proj.limitTracking?.lastUsedTimestamp || null,
                  now,
                  acc.accountId,
                  idx,
                );
              });
            });
          }
        } catch (err) {
          console.error('[Database] migrateLegacyGeminiTables state failed:', err);
        }
      }

      try {
        dbRef.exec(`DROP TABLE IF EXISTS gemini_api_state`);
        console.log('[Database] Dropped legacy table gemini_api_state');
      } catch (e) {
        console.error('[Database] Drop legacy gemini_api_state failed:', e);
      }
    }
  } catch (err) {
    console.error('[Database] migrateLegacyGeminiTables failed:', err);
  }
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

  // Create gemini_models table - lưu catalog model Gemini động
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_models (
      model_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('seed', 'manual', 'google_sync')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Create gemini_model_settings table - lưu default model và metadata sync
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_model_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      default_model_id TEXT,
      last_synced_at INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(default_model_id) REFERENCES gemini_models(model_id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gemini_models_enabled_sort
    ON gemini_models(enabled, sort_order);
  `);

  seedGeminiModelsIfEmpty(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      project_index INTEGER NOT NULL DEFAULT 0,
      project_name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      total_requests_today INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_success_timestamp TEXT,
      last_error_message TEXT,
      last_used_timestamp TEXT,
      minute_request_count INTEGER NOT NULL DEFAULT 0,
      rate_limit_reset_at TEXT,
      daily_limit_reset_at TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(account_id, project_index),
      FOREIGN KEY (account_id) REFERENCES gemini_accounts(account_id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings_json TEXT NOT NULL,
      rotation_state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  migrateLegacyGeminiTables(db);

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
  // Create capcut_tts_shared_config table - singleton chứa appKey/wsUrl/userAgent/xSsDp/extraHeaders dùng chung
  db.exec(`
    CREATE TABLE IF NOT EXISTS capcut_tts_shared_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      app_key TEXT,
      ws_url TEXT NOT NULL DEFAULT 'wss://wss-global.zijieapi.com/ws',
      user_agent TEXT NOT NULL DEFAULT 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      x_ss_dp TEXT,
      extra_headers TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  // Create capcut_tts_tokens table - per-version token/label/isActive
  db.exec(`
    CREATE TABLE IF NOT EXISTS capcut_tts_tokens (
      version TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      token TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migration: từ capcut_tts_configs (cũ) hoặc capcut_tts_secrets (cũ hơn) sang 2 bảng mới
  const migrateToNewSchema = (): void => {
    const targetEmpty = !db.prepare('SELECT version FROM capcut_tts_tokens LIMIT 1').get();
    if (!targetEmpty) return;

    const now = Date.now();

    // Helper: upsert shared config singleton
    const upsertSharedConfig = (row: { app_key?: string | null; ws_url?: string | null; user_agent?: string | null; x_ss_dp?: string | null; extra_headers?: string | null }): void => {
      const existing = db.prepare('SELECT id FROM capcut_tts_shared_config WHERE id = 1').get();
      if (existing) {
        db.prepare(`
          UPDATE capcut_tts_shared_config
          SET app_key = COALESCE(?, app_key),
              ws_url = COALESCE(?, ws_url),
              user_agent = COALESCE(?, user_agent),
              x_ss_dp = COALESCE(?, x_ss_dp),
              extra_headers = COALESCE(?, extra_headers),
              updated_at = ?
          WHERE id = 1
        `).run(
          row.app_key ?? null, row.ws_url ?? null, row.user_agent ?? null,
          row.x_ss_dp ?? null, row.extra_headers ?? null, now
        );
      } else {
        db.prepare(`
          INSERT INTO capcut_tts_shared_config (id, app_key, ws_url, user_agent, x_ss_dp, extra_headers, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?)
        `).run(
          row.app_key ?? null, row.ws_url || 'wss://wss-global.zijieapi.com/ws',
          row.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          row.x_ss_dp ?? null, row.extra_headers ?? null, now
        );
      }
    };

    try {
      // Case 1: migrate từ capcut_tts_configs (multi-row)
      const configsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='capcut_tts_configs'").get() as any;
      if (configsTable) {
        const rows = db.prepare('SELECT * FROM capcut_tts_configs ORDER BY is_active DESC, created_at ASC').all() as any[];
        if (rows.length > 0) {
          // Shared config: lấy từ active row, fallback row đầu tiên
          const activeRow = rows.find((r: any) => r.is_active === 1) || rows[0];
          upsertSharedConfig({
            app_key: activeRow.app_key,
            ws_url: activeRow.ws_url,
            user_agent: activeRow.user_agent,
            x_ss_dp: activeRow.x_ss_dp,
            extra_headers: activeRow.extra_headers,
          });

          // Per-version tokens
          for (const row of rows) {
            const existing = db.prepare('SELECT version FROM capcut_tts_tokens WHERE version = ?').get(row.version);
            if (!existing) {
              db.prepare(`
                INSERT INTO capcut_tts_tokens (version, label, token, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(row.version, row.label, row.token, row.is_active, row.created_at || now, row.updated_at || now);
            }
          }

          console.log('[Database] Migration: migrated ' + rows.length + ' configs from capcut_tts_configs');
        }

        // Drop old table
        try { db.exec('DROP TABLE IF EXISTS capcut_tts_configs'); console.log('[Database] Dropped legacy table capcut_tts_configs'); } catch (e) { console.error('[Database] Drop capcut_tts_configs failed:', e); }
        return;
      }

      // Case 2: migrate từ capcut_tts_secrets cũ (single-row, pre-capcut_tts_configs era)
      const secretsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='capcut_tts_secrets'").get() as any;
      if (secretsTable) {
        const oldRow = db.prepare('SELECT * FROM capcut_tts_secrets WHERE id = 1').get() as any;
        if (oldRow && (oldRow.app_key || oldRow.token)) {
          upsertSharedConfig({
            app_key: oldRow.app_key,
            ws_url: oldRow.ws_url,
            user_agent: oldRow.user_agent,
            x_ss_dp: oldRow.x_ss_dp,
            extra_headers: oldRow.extra_headers,
          });

          db.prepare(`
            INSERT INTO capcut_tts_tokens (version, label, token, is_active, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
          `).run('1.5.0', 'Mặc định', oldRow.token, now, now);

          console.log('[Database] Migration: migrated from capcut_tts_secrets');
        }

        try { db.exec('DROP TABLE IF EXISTS capcut_tts_secrets'); console.log('[Database] Dropped legacy table capcut_tts_secrets'); } catch (e) { console.error('[Database] Drop capcut_tts_secrets failed:', e); }
      }
    } catch (e) {
      console.error('[Database] Migration to new schema failed:', e);
    }
  };

  migrateToNewSchema();

  // Ensure shared config singleton exists (with defaults) if still empty
  try {
    const sharedExists = db.prepare('SELECT id FROM capcut_tts_shared_config WHERE id = 1').get();
    if (!sharedExists) {
      db.prepare(`
        INSERT INTO capcut_tts_shared_config (id, app_key, ws_url, user_agent, x_ss_dp, extra_headers, updated_at)
        VALUES (1, NULL, 'wss://wss-global.zijieapi.com/ws', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', NULL, NULL, ?)
      `).run(Date.now());
      console.log('[Database] Created default capcut_tts_shared_config');
    }
  } catch (e) {
    console.error('[Database] Ensure shared config failed:', e);
  }

  console.log('[Database] Schema initialized (prompts, gemini_chat_config, gemini_chat_context, gemini_cookie, proxies, caption_gemini_web_conversation, downloader_cookies, capcut_tts_shared_config, capcut_tts_tokens)');
}
