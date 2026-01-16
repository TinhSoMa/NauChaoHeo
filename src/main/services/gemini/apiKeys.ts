/**
 * API Keys Manager - Quản lý API keys
 * 
 * File này là wrapper để lấy API keys từ keyStorage
 * API keys được lưu an toàn trong file encrypted, không hardcode trong source code
 * 
 * Cách sử dụng:
 * 1. Import keys bằng hàm importFromJson() hoặc UI
 * 2. Keys sẽ được lưu vào %APPDATA%/NauChaoHeo/api-keys.encrypted
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
  countTotalKeys as storageCountTotalKeys,
  countAccounts as storageCountAccounts,
  getKeysFileLocation,
} from './keyStorage';

// Re-export các hàm từ keyStorage để backward compatible
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
};

/**
 * Lấy danh sách API keys (thay thế cho EMBEDDED_API_KEYS)
 * Đọc từ file encrypted thay vì hardcode
 */
export function getEmbeddedKeys(): EmbeddedAccount[] {
  return loadApiKeys();
}

/**
 * Đếm tổng số API keys
 */
export function countTotalKeys(): number {
  return storageCountTotalKeys();
}

/**
 * Đếm số accounts
 */
export function countAccounts(): number {
  return storageCountAccounts();
}

/**
 * DEPRECATED: Không nên dùng hardcoded keys
 * Để backward compatible, trả về mảng rỗng
 * Sử dụng getEmbeddedKeys() để lấy keys từ storage
 */
export const EMBEDDED_API_KEYS: EmbeddedAccount[] = [];
