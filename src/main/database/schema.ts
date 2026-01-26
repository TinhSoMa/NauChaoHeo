/**
 * Database Schema - Chỉ dùng cho bảng prompts
 * Projects được lưu trong JSON files trong project folders
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

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
  db.pragma('journal_mode = WAL');

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

  // Create gemini_chat_config table - luu cau hinh Gemini Chat (Web)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_chat_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'default',
      cookie TEXT NOT NULL,
      bl_label TEXT,
      f_sid TEXT,
      at_token TEXT,
      conv_id TEXT,
      resp_id TEXT,
      cand_id TEXT,
      req_id TEXT,
      user_agent TEXT,
      accept_language TEXT,
      platform TEXT,
      is_active INTEGER DEFAULT 1,
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
      UNIQUE(host, port)
    );
  `);

  console.log('[Database] Schema initialized (prompts, gemini_chat_config, gemini_cookie, proxies)');
}
