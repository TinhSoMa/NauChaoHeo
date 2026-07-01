/**
 * Gemini Database - Lưu trữ API keys và state trong SQLite có cấu trúc cột rõ ràng
 * Bảng: gemini_accounts, gemini_projects, gemini_state
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getDatabase, initDatabase } from '../../database/schema';
import type {
  ApiState,
  ApiConfig,
  ApiSettings,
  RotationState,
  Account,
  AccountState,
  Project,
  ProjectState,
  ProjectStats,
  LimitTracking,
  EmbeddedAccount,
  EmbeddedProject,
  AccountStatus,
} from '../../../shared/types/gemini';

const LEGACY_KEYS_FILE_NAME = 'api-keys.encrypted';
const LEGACY_STATE_FILE_NAME = 'api_state.json';

function getLegacyKeysFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, LEGACY_KEYS_FILE_NAME);
}

function getLegacyStateFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, LEGACY_STATE_FILE_NAME);
}

function encrypt(data: string): string {
  const machineSpecific = app.getPath('userData');
  const ENCRYPTION_SECRET = 'NauChaoHeo-Gemini-Keys-v1';
  const combined = ENCRYPTION_SECRET + machineSpecific;
  const key = crypto.createHash('sha256').update(combined).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

function decrypt(encryptedData: string): string {
  const machineSpecific = app.getPath('userData');
  const ENCRYPTION_SECRET = 'NauChaoHeo-Gemini-Keys-v1';
  const combined = ENCRYPTION_SECRET + machineSpecific;
  const key = crypto.createHash('sha256').update(combined).digest();
  const parts = encryptedData.split(':');
  if (parts.length !== 2) {
    throw new Error('Định dạng dữ liệu không hợp lệ');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function ensureDbInitialized(): void {
  try {
    initDatabase();
  } catch {
    const db = getDatabase();
  }
}

function ensureMigrated(): void {
  ensureDbInitialized();
  const db = getDatabase();
  const hasAccounts = (db.pragma('table_info(gemini_accounts)') as any[]).length > 0;
  if (!hasAccounts) {
    migrateLegacyKeys(db);
  }
  const hasState = (db.pragma('table_info(gemini_state)') as any[]).length > 0;
  if (!hasState) {
    migrateLegacyState(db);
  }
}

function migrateLegacyKeys(dbRef: any): void {
  try {
    const legacyPath = getLegacyKeysFilePath();
    if (fs.existsSync(legacyPath)) {
      const encryptedData = fs.readFileSync(legacyPath, 'utf-8');
      const json = decrypt(encryptedData);
      const accounts = JSON.parse(json);
      upsertAccountsToDb(dbRef, accounts);
      console.log('[GeminiDatabase] Đã migrate file api-keys.encrypted sang bảng có cột');
      return;
    }

    const hasOldKeysTable = (dbRef.pragma('table_info(gemini_api_keys)') as any[]).length > 0;
    if (!hasOldKeysTable) {
      return;
    }

    const rows = dbRef.prepare(`SELECT encrypted_data FROM gemini_api_keys`).all() as { encrypted_data?: string }[];
    for (const row of rows) {
      if (!row.encrypted_data) continue;
      try {
        const json = decrypt(row.encrypted_data);
        const accounts = JSON.parse(json);
        if (Array.isArray(accounts)) {
          upsertAccountsToDb(dbRef, accounts);
        }
      } catch (err) {
        console.error('[GeminiDatabase] Lỗi decrypt legacy keys:', err);
      }
    }

    try {
      dbRef.exec(`DROP TABLE IF EXISTS gemini_api_keys`);
      console.log('[GeminiDatabase] Đã xóa bảng legacy gemini_api_keys');
    } catch (e) {
      console.error('[GeminiDatabase] Không thể drop bảng legacy gemini_api_keys:', e);
    }
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi migrateLegacyKeys:', error);
  }
}

function migrateLegacyState(dbRef: any): void {
  try {
    const legacyPath = getLegacyStateFilePath();
    let stateJson: string | null = null;
    if (fs.existsSync(legacyPath)) {
      stateJson = fs.readFileSync(legacyPath, 'utf-8');
    } else {
      const hasOldStateTable = (dbRef.pragma('table_info(gemini_api_state)') as any[]).length > 0;
      if (hasOldStateTable) {
        const row = dbRef.prepare(`SELECT state_json FROM gemini_api_state WHERE id = 1`).get() as { state_json?: string } | undefined;
        stateJson = row?.state_json || null;
        try {
          dbRef.exec(`DROP TABLE IF EXISTS gemini_api_state`);
          console.log('[GeminiDatabase] Đã xóa bảng legacy gemini_api_state');
        } catch (e) {
          console.error('[GeminiDatabase] Không thể drop bảng legacy gemini_api_state:', e);
        }
      }
    }

    if (stateJson) {
      try {
        const state = JSON.parse(stateJson) as ApiState;
        const settingsJson = JSON.stringify(state?.settings || {});
        const rotationJson = JSON.stringify(state?.rotationState || {});
        const now = Date.now();
        dbRef.prepare(
          `INSERT OR REPLACE INTO gemini_state (id, settings_json, rotation_state_json, updated_at) VALUES (1, ?, ?, ?)`
        ).run(settingsJson, rotationJson, now);
        console.log('[GeminiDatabase] Đã migrate legacy state sang bảng gemini_state');
      } catch (err) {
        console.error('[GeminiDatabase] Lỗi parse legacy state:', err);
      }
    }
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi migrateLegacyState:', error);
  }
}

function upsertAccountsToDb(dbRef: any, accounts: EmbeddedAccount[]): void {
  const now = Date.now();
  const tx = dbRef.transaction(() => {
    const insertAccount = dbRef.prepare(
      `INSERT OR REPLACE INTO gemini_accounts (account_id, email, account_status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertProject = dbRef.prepare(
      `INSERT OR REPLACE INTO gemini_projects
        (account_id, project_index, project_name, api_key, status, total_requests_today, success_count, error_count, last_used_timestamp, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    accounts.forEach((acc, i) => {
      const accountId = acc.accountId || `acc_${String(i + 1).padStart(2, '0')}`;
      insertAccount.run(accountId, acc.email || accountId, 'active', i, now, now);
      (acc.projects || []).forEach((proj, j) => {
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
          now,
          now,
        );
      });
    });
  });
  tx();
}

export function loadApiKeysFromDb(): EmbeddedAccount[] {
  try {
    ensureMigrated();
    const db = getDatabase();
    const accounts = db.prepare(
      `SELECT account_id, email, account_status FROM gemini_accounts ORDER BY sort_order ASC`
    ).all() as any[];

    const result: EmbeddedAccount[] = accounts.map((acc) => {
      const projects = db.prepare(
        `SELECT project_index, project_name, api_key, notes FROM gemini_projects WHERE account_id = ? ORDER BY project_index ASC`
      ).all(acc.account_id) as any[];

      return {
        email: acc.email,
        accountId: acc.account_id,
        accountStatus: acc.account_status,
        projects: projects.map((p) => ({
          projectName: p.project_name,
          apiKey: p.api_key,
          notes: p.notes,
          id: `proj_${acc.account_id}_${p.project_index}`,
        })),
      };
    });

    return result;
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi đọc keys từ SQLite:', error);
    return [];
  }
}

export function saveApiKeysToDb(accounts: EmbeddedAccount[]): void {
  try {
    ensureDbInitialized();
    const db = getDatabase();
    const now = Date.now();
    const tx = db.transaction(() => {
      const deleteProjects = db.prepare(`DELETE FROM gemini_projects`);
      const deleteAccounts = db.prepare(`DELETE FROM gemini_accounts`);
      deleteProjects.run();
      deleteAccounts.run();

      const insertAccount = db.prepare(
        `INSERT INTO gemini_accounts (account_id, email, account_status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const insertProject = db.prepare(
        `INSERT INTO gemini_projects
          (account_id, project_index, project_name, api_key, notes, status, total_requests_today, success_count, error_count, last_used_timestamp, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      accounts.forEach((acc, i) => {
        const accountId = acc.accountId || `acc_${String(i + 1).padStart(2, '0')}`;
        insertAccount.run(accountId, acc.email || accountId, 'active', i, now, now);
        (acc.projects || []).forEach((proj, j) => {
          insertProject.run(
            accountId,
            j,
            proj.projectName || `Project-${j + 1}`,
            proj.apiKey || '',
            proj.notes || null,
            'available',
            0,
            0,
            0,
            null,
            now,
            now,
          );
        });
      });
    });
    tx();
    console.log(`[GeminiDatabase] Đã lưu ${accounts.length} accounts vào SQLite`);
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi lưu keys vào SQLite:', error);
    throw error;
  }
}

export function addAccountToDb(email: string, projects: EmbeddedProject[]): EmbeddedAccount {
  const accounts = loadApiKeysFromDb();
  const existingIndex = accounts.findIndex((acc) => acc.email === email);
  if (existingIndex >= 0) {
    accounts[existingIndex].projects = [...accounts[existingIndex].projects, ...projects];
  } else {
    const newAccount: EmbeddedAccount = { email, projects };
    accounts.push(newAccount);
  }
  saveApiKeysToDb(accounts);
  return accounts[existingIndex >= 0 ? existingIndex : accounts.length - 1];
}

export function removeAccountFromDb(accountId: string): boolean {
  ensureDbInitialized();
  const db = getDatabase();
  const now = Date.now();
  const tx = db.transaction(() => {
    const deleteProjects = db.prepare(`DELETE FROM gemini_projects WHERE account_id = ?`);
    const deleteAccount = db.prepare(`DELETE FROM gemini_accounts WHERE account_id = ?`);
    deleteProjects.run(accountId);
    const info = deleteAccount.run(accountId);
    return info.changes > 0;
  });
  const removed = tx();
  if (removed) {
    console.log(`[GeminiDatabase] Đã xóa account: ${accountId}`);
  }
  return removed;
}

export function removeProjectFromDb(accountId: string, projectIndex: number): boolean {
  ensureDbInitialized();
  const db = getDatabase();
  const info = db
    .prepare(`DELETE FROM gemini_projects WHERE account_id = ? AND project_index = ?`)
    .run(accountId, projectIndex);
  const removed = (info as any).changes > 0;
  if (removed) {
    console.log(`[GeminiDatabase] Đã xóa project index=${projectIndex} từ account ${accountId}`);
  }
  return removed;
}

export function updateProjectInDb(
  accountId: string,
  projectIndex: number,
  patch: { projectName?: string; notes?: string }
): EmbeddedAccount | null {
  ensureDbInitialized();
  const db = getDatabase();
  const now = Date.now();

  const sets: string[] = [`updated_at = ?`];
  const params: any[] = [now];
  if (patch.projectName !== undefined && String(patch.projectName).length > 0) {
    sets.push(`project_name = ?`);
    params.push(patch.projectName);
  }
  if (patch.notes !== undefined) {
    sets.push(`notes = ?`);
    params.push(patch.notes);
  }
  params.push(accountId, projectIndex);

  db.prepare(`UPDATE gemini_projects SET ${sets.join(', ')} WHERE account_id = ? AND project_index = ?`).run(...params);

  const account = db.prepare(`SELECT account_id, email, account_status FROM gemini_accounts WHERE account_id = ?`).get(accountId) as any;
  if (!account) return null;
  const projects = db.prepare(`SELECT project_index, project_name, api_key, notes FROM gemini_projects WHERE account_id = ? ORDER BY project_index ASC`).all(accountId) as any[];
  return {
    email: account.email,
    accountId: account.account_id,
    accountStatus: account.account_status,
    projects: projects.map((p) => ({
      projectName: p.project_name,
      apiKey: p.api_key,
      notes: p.notes,
      id: `proj_${accountId}_${p.project_index}`,
    })),
  };
}

export function addProjectToDb(
  accountId: string,
  project: { projectName: string; apiKey: string; notes?: string }
): EmbeddedAccount | null {
  ensureDbInitialized();
  const db = getDatabase();
  const now = Date.now();
  const maxRow = db.prepare(`SELECT MAX(project_index) as max_idx FROM gemini_projects WHERE account_id = ?`).get(accountId) as any;
  const nextIndex = (maxRow?.max_idx ?? -1) + 1;

  db.prepare(
    `INSERT INTO gemini_projects (account_id, project_index, project_name, api_key, notes, status, total_requests_today, success_count, error_count, last_used_timestamp, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'available', 0, 0, 0, NULL, ?, ?)`
  ).run(accountId, nextIndex, project.projectName, project.apiKey, project.notes || null, now, now);

  const account = db.prepare(`SELECT account_id, email, account_status FROM gemini_accounts WHERE account_id = ?`).get(accountId) as any;
  if (!account) return null;
  const projects = db.prepare(`SELECT project_index, project_name, api_key, notes FROM gemini_projects WHERE account_id = ? ORDER BY project_index ASC`).all(accountId) as any[];
  return {
    email: account.email,
    accountId: account.account_id,
    accountStatus: account.account_status,
    projects: projects.map((p) => ({
      projectName: p.project_name,
      apiKey: p.api_key,
      notes: p.notes,
      id: `proj_${accountId}_${p.project_index}`,
    })),
  };
}

/**
 * Parse text format: email header lines (containing '@') followed by API keys.
 * Lines starting with '#' or empty are ignored.
 * Example:
 *   email1@gmail.com
 *   AIzaSy...key1
 *   AIzaSy...key2
 *
 *   email2@gmail.com
 *   AIzaSy...key3
 */
export function importFromTextToDb(text: string): { success: boolean; count: number; error?: string } {
  try {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (lines.length === 0) {
      return { success: false, count: 0, error: 'Không có dữ liệu' };
    }

    const accounts: EmbeddedAccount[] = [];
    let currentEmail = '';
    let currentProjects: EmbeddedProject[] = [];
    let keyCounter = 0;

    for (const line of lines) {
      if (line.includes('@') && !line.startsWith('AIza') && !line.startsWith('sk-')) {
        // Flush previous account
        if (currentEmail && currentProjects.length > 0) {
          accounts.push({ email: currentEmail, projects: [...currentProjects] });
        } else if (currentEmail) {
          // Email header with no keys yet — will be handled below
        }
        currentEmail = line;
        currentProjects = [];
        keyCounter = 0;
      } else {
        // This is an API key line
        if (!currentEmail) {
          currentEmail = 'default@account';
        }
        keyCounter++;
        currentProjects.push({
          projectName: `Key-${keyCounter}`,
          apiKey: line,
          notes: undefined,
        });
      }
    }

    // Flush last account
    if (currentEmail && currentProjects.length > 0) {
      accounts.push({ email: currentEmail, projects: [...currentProjects] });
    }

    if (accounts.length === 0) {
      return { success: false, count: 0, error: 'Không tìm thấy API keys hợp lệ trong dữ liệu' };
    }

    saveApiKeysToDb(accounts);
    const totalKeys = accounts.reduce((sum, acc) => sum + acc.projects.length, 0);
    return { success: true, count: totalKeys };
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi import text:', error);
    return { success: false, count: 0, error: String(error) };
  }
}

export function importFromJsonToDb(jsonString: string): { success: boolean; count: number; error?: string } {
  try {
    const data = JSON.parse(jsonString);
    if (!Array.isArray(data)) {
      return { success: false, count: 0, error: 'Dữ liệu phải là mảng accounts' };
    }
    for (const account of data) {
      if (!account.email || !Array.isArray(account.projects)) {
        return { success: false, count: 0, error: 'Format account không hợp lệ' };
      }
      for (const project of account.projects) {
        if (!project.projectName || !project.apiKey) {
          return { success: false, count: 0, error: 'Format project không hợp lệ' };
        }
      }
    }
    saveApiKeysToDb(data);
    const totalKeys = data.reduce((sum: number, acc: EmbeddedAccount) => sum + acc.projects.length, 0);
    return { success: true, count: totalKeys };
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi import:', error);
    return { success: false, count: 0, error: String(error) };
  }
}

export function exportToJsonFromDb(): string {
  const accounts = loadApiKeysFromDb();
  return JSON.stringify(accounts, null, 2);
}

export function hasKeysInDb(): boolean {
  ensureMigrated();
  const db = getDatabase();
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM gemini_projects`).get() as { cnt: number };
  return row.cnt > 0;
}

export function countTotalKeysInDb(): number {
  ensureMigrated();
  const db = getDatabase();
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM gemini_projects`).get() as { cnt: number };
  return row.cnt;
}

export function countAccountsInDb(): number {
  ensureMigrated();
  const db = getDatabase();
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM gemini_accounts`).get() as { cnt: number };
  return row.cnt;
}

export function getKeysFileLocation(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, LEGACY_KEYS_FILE_NAME);
}

export function loadApiStateFromDb(): ApiState | null {
  try {
    ensureMigrated();
    const db = getDatabase();

    const accountRows = db.prepare(`SELECT account_id, account_status FROM gemini_accounts ORDER BY sort_order, id`).all() as { account_id: string; account_status: string }[];
    const projectRows = db.prepare(`SELECT account_id, project_index, status, success_count, error_count, total_requests_today, last_success_timestamp, last_error_message, last_used_timestamp, minute_request_count, rate_limit_reset_at, daily_limit_reset_at FROM gemini_projects ORDER BY account_id, project_index`).all() as any[];

    const projectMap = new Map<string, any[]>();
    for (const proj of projectRows) {
      const list = projectMap.get(proj.account_id);
      if (list) list.push(proj);
      else projectMap.set(proj.account_id, [proj]);
    }

    const accounts: AccountState[] = accountRows.map((accRow) => {
      const accProjects = projectMap.get(accRow.account_id) || [];
      return {
        accountId: accRow.account_id,
        accountStatus: (accRow.account_status === 'disabled' ? 'disabled' : 'active') as AccountStatus,
        projects: accProjects.map((proj: any) => ({
          projectIndex: proj.project_index,
          status: (['available', 'rate_limited', 'exhausted', 'error', 'disabled'] as const).includes(proj.status)
            ? (proj.status as 'available' | 'rate_limited' | 'exhausted' | 'error' | 'disabled')
            : 'available',
          stats: {
            totalRequestsToday: proj.total_requests_today || 0,
            successCount: proj.success_count || 0,
            errorCount: proj.error_count || 0,
            lastSuccessTimestamp: proj.last_success_timestamp || null,
            lastErrorMessage: proj.last_error_message || null,
          },
          limitTracking: {
            lastUsedTimestamp: proj.last_used_timestamp || null,
            minuteRequestCount: proj.minute_request_count || 0,
            rateLimitResetAt: proj.rate_limit_reset_at || null,
            dailyLimitResetAt: proj.daily_limit_reset_at || null,
          },
        })),
      };
    });

    const row = db.prepare(`SELECT settings_json, rotation_state_json FROM gemini_state WHERE id = 1`).get() as { settings_json?: string; rotation_state_json?: string } | undefined;

    return {
      settings: row?.settings_json ? JSON.parse(row.settings_json) as ApiSettings : {} as ApiSettings,
      rotationState: row?.rotation_state_json ? JSON.parse(row.rotation_state_json) as RotationState : {} as RotationState,
      accounts,
    };
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi đọc state từ SQLite:', error);
    return null;
  }
}

export function saveApiStateToDb(state: ApiState): boolean {
  try {
    ensureDbInitialized();
    const db = getDatabase();
    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO gemini_state (id, settings_json, rotation_state_json, updated_at) VALUES (1, ?, ?, ?)`
    ).run(JSON.stringify(state.settings || {}), JSON.stringify(state.rotationState || {}), now);
    console.log('[GeminiDatabase] Đã lưu state vào SQLite');
    return true;
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi lưu state vào SQLite:', error);
    return false;
  }
}

export function saveProjectStatesFromConfig(config: ApiConfig): void {
  try {
    ensureDbInitialized();
    const db = getDatabase();
    const now = Date.now();
    const tx = db.transaction(() => {
      const updateAccount = db.prepare(
        `UPDATE gemini_accounts SET account_status = ?, updated_at = ? WHERE account_id = ?`
      );
      const updateProject = db.prepare(
        `UPDATE gemini_projects
         SET status = ?, success_count = ?, error_count = ?, total_requests_today = ?, last_error_message = ?, last_success_timestamp = ?, last_used_timestamp = ?, updated_at = ?
         WHERE account_id = ? AND project_index = ?`
      );

      config.accounts.forEach((acc) => {
        updateAccount.run(acc.accountStatus || 'active', now, acc.accountId);
        acc.projects.forEach((proj, idx) => {
          updateProject.run(
            proj.status,
            proj.stats?.successCount || 0,
            proj.stats?.errorCount || 0,
            proj.stats?.totalRequestsToday || 0,
            proj.stats?.lastErrorMessage || null,
            proj.stats?.lastSuccessTimestamp || null,
            proj.limitTracking?.lastUsedTimestamp || null,
            now,
            acc.accountId,
            idx,
          );
        });
      });
    });
    tx();
  } catch (error) {
    console.error('[GeminiDatabase] Lỗi saveProjectStatesFromConfig:', error);
  }
}
