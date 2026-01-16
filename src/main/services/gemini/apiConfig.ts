/**
 * API Configuration - Quản lý state của API keys
 * - API Keys: Hardcoded trong apiKeys.ts (bundle vào EXE)
 * - State (status, stats): Lưu trong AppData/NauChaoHeo/api_state.json
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  ApiConfig,
  ApiState,
  ApiSettings,
  RotationState,
  Account,
  AccountState,
  Project,
  ProjectState,
  ProjectStats,
  LimitTracking,
} from '../../../shared/types/gemini';
import { getEmbeddedKeys } from './apiKeys';

// Tên ứng dụng
const APP_NAME = 'NauChaoHeo';

// Cài đặt mặc định
const DEFAULT_SETTINGS: ApiSettings = {
  globalCooldownSeconds: 65,
  defaultRpmLimit: 15,
  maxRpdLimit: 1500,
  rotationStrategy: 'horizontal_sweep',
  retryExhaustedAfterHours: 24,
  delayBetweenRequestsMs: 1000,
};

// Trạng thái rotation mặc định
const DEFAULT_ROTATION_STATE: RotationState = {
  currentProjectIndex: 0,
  currentAccountIndex: 0,
  totalRequestsSent: 0,
  rotationRound: 1,
  lastDailyReset: null,
};

/**
 * Lấy thư mục AppData cho ứng dụng
 */
export function getAppDataDir(): string {
  const userDataPath = app.getPath('userData');
  // userData đã bao gồm tên app, nhưng ta tạo thêm thư mục con nếu cần
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  return userDataPath;
}

/**
 * Lấy đường dẫn file state
 */
export function getStateFilePath(): string {
  return path.join(getAppDataDir(), 'api_state.json');
}

/**
 * Tạo stats mặc định cho project
 */
function createDefaultProjectStats(): ProjectStats {
  return {
    totalRequestsToday: 0,
    successCount: 0,
    errorCount: 0,
    lastSuccessTimestamp: null,
    lastErrorMessage: null,
  };
}

/**
 * Tạo limit tracking mặc định cho project
 */
function createDefaultLimitTracking(): LimitTracking {
  return {
    lastUsedTimestamp: null,
    minuteRequestCount: 0,
    rateLimitResetAt: null,
    dailyLimitResetAt: null,
  };
}

/**
 * Tạo state mặc định cho project
 */
function createDefaultProjectState(projectIndex: number): ProjectState {
  return {
    projectIndex,
    status: 'available',
    stats: createDefaultProjectStats(),
    limitTracking: createDefaultLimitTracking(),
  };
}

/**
 * Tạo state mặc định cho account
 */
function createDefaultAccountState(accountId: string, numProjects: number): AccountState {
  return {
    accountId,
    accountStatus: 'active',
    projects: Array.from({ length: numProjects }, (_, i) => createDefaultProjectState(i)),
  };
}

/**
 * Load state từ file AppData
 * Nếu file không tồn tại, trả về null
 */
export function loadApiState(): ApiState | null {
  const statePath = getStateFilePath();

  if (fs.existsSync(statePath)) {
    try {
      const data = fs.readFileSync(statePath, 'utf-8');
      return JSON.parse(data) as ApiState;
    } catch (error) {
      console.error('[ApiConfig] Lỗi đọc api_state.json:', error);
    }
  }

  return null;
}

/**
 * Tạo state mới từ embedded keys
 */
export function createFreshState(): ApiState {
  const embeddedKeys = getEmbeddedKeys();

  const accountsState: AccountState[] = embeddedKeys.map((acc, i) => {
    const accountId = `acc_${String(i + 1).padStart(2, '0')}`;
    return createDefaultAccountState(accountId, acc.projects.length);
  });

  return {
    settings: { ...DEFAULT_SETTINGS },
    rotationState: { ...DEFAULT_ROTATION_STATE },
    accounts: accountsState,
  };
}

/**
 * Lưu state vào file AppData
 */
export function saveApiState(state: ApiState): boolean {
  const statePath = getStateFilePath();

  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    console.log('[ApiConfig] Đã lưu api_state.json thành công');
    return true;
  } catch (error) {
    console.error('[ApiConfig] Lỗi lưu api_state.json:', error);
    return false;
  }
}

/**
 * Merge embedded keys với state để tạo config hoàn chỉnh
 * Đây là config được ApiManager sử dụng
 */
export function getMergedConfig(): ApiConfig {
  const embeddedKeys = getEmbeddedKeys();
  let state = loadApiState();

  // Nếu chưa có state, tạo mới
  if (!state) {
    state = createFreshState();
    saveApiState(state);
  }

  // Merge accounts
  const mergedAccounts: Account[] = embeddedKeys.map((embeddedAcc, i) => {
    const accountId = `acc_${String(i + 1).padStart(2, '0')}`;

    // Tìm state tương ứng
    let accState = state!.accounts.find((s) => s.accountId === accountId);
    if (!accState) {
      accState = createDefaultAccountState(accountId, embeddedAcc.projects.length);
    }

    // Merge projects
    const mergedProjects: Project[] = embeddedAcc.projects.map((embeddedProj, j) => {
      let projState = accState!.projects.find((ps) => ps.projectIndex === j);
      if (!projState) {
        projState = createDefaultProjectState(j);
      }

      return {
        projectIndex: j,
        projectName: embeddedProj.projectName || `Project-${j + 1}`,
        apiKey: embeddedProj.apiKey || '',
        status: projState.status,
        stats: projState.stats || createDefaultProjectStats(),
        limitTracking: projState.limitTracking || createDefaultLimitTracking(),
      };
    });

    return {
      accountId,
      email: embeddedAcc.email || '',
      accountStatus: accState.accountStatus,
      projects: mergedProjects,
    };
  });

  return {
    settings: state.settings || { ...DEFAULT_SETTINGS },
    rotationState: state.rotationState || { ...DEFAULT_ROTATION_STATE },
    accounts: mergedAccounts,
  };
}

/**
 * Lưu state từ config (chỉ lưu phần state, không lưu keys)
 */
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

  return saveApiState(state);
}
