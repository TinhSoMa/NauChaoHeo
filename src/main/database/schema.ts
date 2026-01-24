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
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  console.log('[Database] Schema initialized (prompts, gemini_chat_config)');
}
