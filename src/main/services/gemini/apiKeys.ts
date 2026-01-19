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

/**
 * Thử import keys từ file gemini_keys.json ở thư mục gốc (cho môi trường dev)
 * Chỉ chạy nếu chưa có keys trong storage
 */
import * as fs from 'fs';
import * as path from 'path';

export function tryImportDevKeys(): void {
  // Kiểm tra nếu đã có keys thì thôi
  if (countTotalKeys() > 0) {
    console.log('[ApiKeys] Đã có keys trong storage, bỏ qua auto-import');
    return;
  }

  // Đường dẫn cố định cho dev environment (theo yêu cầu user)
  // Hoặc tìm ở root project
  const devKeysPath = 'd:\\NauChaoHeo\\gemini_keys.json';
  
  if (fs.existsSync(devKeysPath)) {
    console.log(`[ApiKeys] Tìm thấy file keys dev tại: ${devKeysPath}`);
    try {
      const content = fs.readFileSync(devKeysPath, 'utf-8');
      const result = importFromJson(content);
      if (result.success) {
        console.log(`[ApiKeys] Auto-import thành công: ${result.count} keys`);
      } else {
        console.error(`[ApiKeys] Auto-import thất bại: ${result.error}`);
      }
    } catch (error) {
       console.error('[ApiKeys] Lỗi đọc file dev keys:', error);
    }
  } else {
    console.log('[ApiKeys] Không tìm thấy file gemini_keys.json');
  }
}

