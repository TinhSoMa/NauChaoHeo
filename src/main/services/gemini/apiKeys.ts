/**
 * API Keys Manager - Quản lý API keys
 *
 * File này là wrapper để lấy API keys từ sqliteStorage
 * API keys được lưu an toàn trong SQLite với mã hóa AES-256, unique cho mỗi máy
 *
 * Cách sử dụng:
 * 1. Import keys bằng hàm importFromJson() hoặc UI
 * 2. Keys sẽ được lưu vào %APPDATA%/NauChaoHeo/nauchaoheo.db (bảng gemini_api_keys)
 * 3. Keys được mã hóa AES-256, unique cho mỗi máy
 */

import { EmbeddedAccount } from '../../../shared/types/gemini';
import {
  loadApiKeys,
  saveApiKeys,
  addAccount,
  removeAccount,
  removeProject,
  importFromJson,
  exportToJson,
  hasKeys,
  getKeysFileLocation,
  countTotalKeys,
  countAccounts,
  EMBEDDED_API_KEYS,
  getEmbeddedKeys,
  tryImportDevKeys,
  updateProject,
  addProject,
} from './sqliteStorage';

// Re-export tất cả từ sqliteStorage để backward compatible
export {
  loadApiKeys,
  saveApiKeys,
  addAccount,
  removeAccount,
  removeProject,
  importFromJson,
  exportToJson,
  hasKeys,
  getKeysFileLocation,
  countTotalKeys,
  countAccounts,
  EMBEDDED_API_KEYS,
  getEmbeddedKeys,
  tryImportDevKeys,
  updateProject,
  addProject,
};
