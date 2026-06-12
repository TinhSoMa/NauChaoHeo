/**
 * SQLite Storage - Lưu trữ Gemini API keys và state trong SQLite có cấu trúc cột rõ ràng
 * Thay thế keyStorage.ts (JSON encrypted file) và apiConfig.ts (JSON state file)
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadApiKeysFromDb,
  saveApiKeysToDb,
  addAccountToDb,
  removeAccountFromDb,
  removeProjectFromDb,
  updateProjectInDb,
  addProjectToDb,
  importFromJsonToDb,
  importFromTextToDb,
  exportToJsonFromDb,
  hasKeysInDb,
  countTotalKeysInDb,
  countAccountsInDb,
  loadApiStateFromDb,
  saveApiStateToDb,
  saveProjectStatesFromConfig,
} from './geminiDatabase';
import { initDatabase, getDatabase } from '../../database/schema';
import type {
  ApiConfig,
  ApiState,
  ApiSettings,
  RotationState,
  Account,
  AccountState,
  AccountStatus,
  Project,
  ProjectState,
  ProjectStats,
  ProjectStatus,
  LimitTracking,
  EmbeddedAccount,
  EmbeddedProject,
} from '../../../shared/types/gemini';

// In-memory config cache với TTL
let cachedConfig: ApiConfig | null = null;
let cachedConfigTimestamp = 0;
const CONFIG_CACHE_TTL_MS = 2000; // 2s

function invalidateConfigCache(): void {
  cachedConfig = null;
  cachedConfigTimestamp = 0;
}

const DEFAULT_SETTINGS: ApiSettings = {
  globalCooldownSeconds: 65,
  defaultRpmLimit: 15,
  maxRpdLimit: 1500,
  rotationStrategy: 'horizontal_sweep',
  retryExhaustedAfterHours: 24,
  delayBetweenRequestsMs: 1000,
};

const DEFAULT_ROTATION_STATE: RotationState = {
  currentProjectIndex: 0,
  currentAccountIndex: 0,
  totalRequestsSent: 0,
  rotationRound: 1,
  lastDailyReset: null,
};

export function getAppDataDir(): string {
  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  return userDataPath;
}

export function getStateFilePath(): string {
  return path.join(getAppDataDir(), 'api_state.json');
}

export function getKeysFilePath(): string {
  return path.join(getAppDataDir(), 'api-keys.encrypted');
}

function createDefaultProjectStats(): ProjectStats {
  return {
    totalRequestsToday: 0,
    successCount: 0,
    errorCount: 0,
    lastSuccessTimestamp: null,
    lastErrorMessage: null,
  };
}

function createDefaultLimitTracking(): LimitTracking {
  return {
    lastUsedTimestamp: null,
    minuteRequestCount: 0,
    rateLimitResetAt: null,
    dailyLimitResetAt: null,
  };
}

function createDefaultProjectState(projectIndex: number): ProjectState {
  return {
    projectIndex,
    status: 'available',
    stats: createDefaultProjectStats(),
    limitTracking: createDefaultLimitTracking(),
  };
}

function createDefaultAccountState(accountId: string, numProjects: number): AccountState {
  return {
    accountId,
    accountStatus: 'active',
    projects: Array.from({ length: numProjects }, (_, i) => createDefaultProjectState(i)),
  };
}

export function loadApiState(): ApiState | null {
  let state = loadApiStateFromDb();
  if (!state) {
    state = createFreshState();
    saveApiState(state);
  }
  return state;
}

export function saveApiState(state: ApiState): boolean {
  return saveApiStateToDb(state);
}

export function createFreshState(): ApiState {
  const embeddedKeys = getEmbeddedKeys();
  const accountsState: AccountState[] = embeddedKeys.map((acc, i) => {
    const accountId = acc.accountId || `acc_${String(i + 1).padStart(2, '0')}`;
    return createDefaultAccountState(accountId, acc.projects.length);
  });
  return {
    settings: { ...DEFAULT_SETTINGS },
    rotationState: { ...DEFAULT_ROTATION_STATE },
    accounts: accountsState,
  };
}

export function getMergedConfig(): ApiConfig {
  const now = Date.now();
  if (cachedConfig && (now - cachedConfigTimestamp) < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }
  const embeddedKeys = getEmbeddedKeys();
  const state = loadApiState();
  const mergedAccounts: Account[] = embeddedKeys.map((embeddedAcc, i) => {
    const accountId = embeddedAcc.accountId || `acc_${String(i + 1).padStart(2, '0')}`;
    const accState = state?.accounts.find((s) => s.accountId === accountId);
    const numProjects = embeddedAcc.projects.length;

    if (!accState) {
      return {
        accountId,
        email: embeddedAcc.email || '',
        accountStatus: 'active' as AccountStatus,
        projects: embeddedAcc.projects.map((embeddedProj, j) => ({
          projectIndex: j,
          projectName: embeddedProj.projectName || `Project-${j + 1}`,
          apiKey: embeddedProj.apiKey || '',
          status: 'available' as ProjectStatus,
          stats: createDefaultProjectStats(),
          limitTracking: createDefaultLimitTracking(),
        })),
      };
    }

    const mergedProjects: Project[] = embeddedAcc.projects.map((embeddedProj, j) => {
      let projState = accState.projects.find((ps) => ps.projectIndex === j);
      if (!projState) {
        projState = createDefaultProjectState(j);
      }
      const apiStatus = projState.status || 'available';
      const projectStatus = (['available', 'rate_limited', 'exhausted', 'error', 'disabled'] as const).includes(apiStatus as any)
        ? (apiStatus as 'available' | 'rate_limited' | 'exhausted' | 'error' | 'disabled')
        : 'available';

      return {
        projectIndex: j,
        projectName: embeddedProj.projectName || `Project-${j + 1}`,
        apiKey: embeddedProj.apiKey || '',
        status: projectStatus,
        stats: projState.stats || createDefaultProjectStats(),
        limitTracking: projState.limitTracking || createDefaultLimitTracking(),
      };
    });

    return {
      accountId,
      email: embeddedAcc.email || '',
      accountStatus: accState.accountStatus || 'active',
      projects: mergedProjects,
    };
  });

  const merged: ApiConfig = {
    settings: state?.settings || { ...DEFAULT_SETTINGS },
    rotationState: state?.rotationState || { ...DEFAULT_ROTATION_STATE },
    accounts: mergedAccounts,
  };
  cachedConfig = merged;
  cachedConfigTimestamp = now;
  return merged;
}

export function saveStateFromConfig(config: ApiConfig): boolean {
  const state: ApiState = {
    settings: config.settings,
    rotationState: config.rotationState,
    accounts: config.accounts.map((acc) => ({
      accountId: acc.accountId,
      accountStatus: acc.accountStatus,
      projects: acc.projects.map((proj, j) => ({
        projectIndex: j,
        status: proj.status,
        stats: proj.stats,
        limitTracking: proj.limitTracking,
      })),
    })),
  };
  const ok = saveApiState(state);
  if (ok) {
    saveProjectStatesFromConfig(config);
  }
  invalidateConfigCache();
  return ok;
}

export function getEmbeddedKeys(): EmbeddedAccount[] {
  return loadApiKeysFromDb();
}

export function countTotalKeys(): number {
  return countTotalKeysInDb();
}

export function countAccounts(): number {
  return countAccountsInDb();
}

export const EMBEDDED_API_KEYS: EmbeddedAccount[] = [];

export function tryImportDevKeys(): void {
  if (countTotalKeys() > 0) {
    console.log('[SQLiteStorage] Đã có keys trong DB, bỏ qua auto-import');
    return;
  }
  const devKeysPath = 'd:\\NauChaoHeo\\gemini_keys.json';
  if (fs.existsSync(devKeysPath)) {
    console.log(`[SQLiteStorage] Tìm thấy file keys dev tại: ${devKeysPath}`);
    try {
      const content = fs.readFileSync(devKeysPath, 'utf-8');
      const result = importFromJsonToDb(content);
      if (result.success) {
        console.log(`[SQLiteStorage] Auto-import thành công: ${result.count} keys`);
      } else {
        console.error(`[SQLiteStorage] Auto-import thất bại: ${result.error}`);
      }
    } catch (error) {
      console.error('[SQLiteStorage] Loi doc file dev keys:', error);
    }
  } else {
    console.log('[SQLiteStorage] Không tìm thấy file gemini_keys.json');
  }
}

export function loadApiKeys(): EmbeddedAccount[] {
  return loadApiKeysFromDb();
}

export function saveApiKeys(accounts: EmbeddedAccount[]): void {
  saveApiKeysToDb(accounts);
  invalidateConfigCache();
}

export function addAccount(email: string, projects: EmbeddedProject[]): EmbeddedAccount {
  const result = addAccountToDb(email, projects);
  invalidateConfigCache();
  return result;
}

export function removeAccount(accountId: string): boolean {
  const result = removeAccountFromDb(accountId);
  invalidateConfigCache();
  return result;
}

export function removeProject(accountId: string, projectName: string): boolean {
  const db = getDatabase();
  const project = db.prepare(`SELECT project_index FROM gemini_projects WHERE account_id = ? AND project_name = ?`).get(accountId, projectName) as any;
  if (!project) return false;
  const result = removeProjectFromDb(accountId, project.project_index);
  invalidateConfigCache();
  return result;
}

export function importFromJson(jsonString: string): { success: boolean; count: number; error?: string } {
  const result = importFromJsonToDb(jsonString);
  invalidateConfigCache();
  return result;
}

export function importFromText(text: string): { success: boolean; count: number; error?: string } {
  const result = importFromTextToDb(text);
  invalidateConfigCache();
  return result;
}

export function exportToJson(): string {
  return exportToJsonFromDb();
}

export function hasKeys(): boolean {
  return hasKeysInDb();
}

export function getKeysFileLocation(): string {
  return getKeysFilePath();
}

export function updateProject(
  accountId: string,
  projectIndex: number,
  patch: { projectName?: string; notes?: string }
): EmbeddedAccount | null {
  const result = updateProjectInDb(accountId, projectIndex, patch);
  invalidateConfigCache();
  return result;
}

export function addProject(
  accountId: string,
  project: { projectName: string; apiKey: string; notes?: string }
): EmbeddedAccount | null {
  const result = addProjectToDb(accountId, project);
  invalidateConfigCache();
  return result;
}
