/**
 * API Configuration - Quản lý state của API keys
 * - API Keys: Lưu trong SQLite (%APPDATA%/NauChaoHeo/nauchaoheo.db)
 * - State (status, stats): Lưu trong SQLite (%APPDATA%/NauChaoHeo/nauchaoheo.db)
 */

import {
  getAppDataDir,
  getStateFilePath,
  loadApiState,
  saveApiState,
  createFreshState,
  getMergedConfig,
  saveStateFromConfig,
  getEmbeddedKeys,
} from './sqliteStorage';

export {
  getAppDataDir,
  getStateFilePath,
  loadApiState,
  saveApiState,
  createFreshState,
  getMergedConfig,
  saveStateFromConfig,
  getEmbeddedKeys,
};
