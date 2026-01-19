import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    if (app) {
        // App is ready or running
         const userDataPath = app.getPath('userData');
         const dbPath = path.join(userDataPath, 'nauchaoheo.db');
         console.log('[Database] Path:', dbPath);
         db = new Database(dbPath);
    } else {
        // Fallback or error if called too early (should not happen if init called in app.whenReady)
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

  // Create prompts table
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
  
  console.log('[Database] Schema initialized');
}
