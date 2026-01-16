/**
 * Key Storage - Lưu trữ API keys an toàn
 * 
 * Thay vì hardcode API keys trong source code, file này:
 * - Lưu keys vào file JSON trong userData (ngoài source code)
 * - Mã hóa đơn giản để bảo vệ keys khỏi việc đọc trực tiếp
 * - Cung cấp API để quản lý keys (thêm, xóa, import/export)
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EmbeddedAccount, EmbeddedProject } from '../../../shared/types/gemini';

// Tên file lưu trữ keys
const KEYS_FILE_NAME = 'api-keys.encrypted';

// Secret key để mã hóa (kết hợp với machine ID)
const ENCRYPTION_SECRET = 'NauChaoHeo-Gemini-Keys-v1';

/**
 * Lấy đường dẫn file keys
 */
function getKeysFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, KEYS_FILE_NAME);
}

/**
 * Tạo encryption key từ machine-specific data
 */
function getEncryptionKey(): Buffer {
  // Kết hợp secret với đường dẫn userData để tạo key unique cho mỗi máy
  const machineSpecific = app.getPath('userData');
  const combined = ENCRYPTION_SECRET + machineSpecific;
  return crypto.createHash('sha256').update(combined).digest();
}

/**
 * Mã hóa dữ liệu
 */
function encrypt(data: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // Ghép IV + encrypted data
    return iv.toString('base64') + ':' + encrypted;
  } catch (error) {
    console.error('[KeyStorage] Lỗi mã hóa:', error);
    throw new Error('Không thể mã hóa dữ liệu');
  }
}

/**
 * Giải mã dữ liệu
 */
function decrypt(encryptedData: string): string {
  try {
    const key = getEncryptionKey();
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
  } catch (error) {
    console.error('[KeyStorage] Lỗi giải mã:', error);
    throw new Error('Không thể giải mã dữ liệu');
  }
}

/**
 * Lưu danh sách accounts vào file
 */
export function saveApiKeys(accounts: EmbeddedAccount[]): void {
  try {
    const filePath = getKeysFilePath();
    const jsonData = JSON.stringify(accounts, null, 2);
    const encryptedData = encrypt(jsonData);
    
    // Đảm bảo thư mục tồn tại
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, encryptedData, 'utf8');
    console.log(`[KeyStorage] Đã lưu ${accounts.length} accounts vào ${filePath}`);
  } catch (error) {
    console.error('[KeyStorage] Lỗi lưu keys:', error);
    throw error;
  }
}

/**
 * Đọc danh sách accounts từ file
 */
export function loadApiKeys(): EmbeddedAccount[] {
  try {
    const filePath = getKeysFilePath();
    
    // Kiểm tra file tồn tại
    if (!fs.existsSync(filePath)) {
      console.log('[KeyStorage] Chưa có file keys, trả về danh sách rỗng');
      return [];
    }
    
    const encryptedData = fs.readFileSync(filePath, 'utf8');
    const jsonData = decrypt(encryptedData);
    const accounts: EmbeddedAccount[] = JSON.parse(jsonData);
    
    console.log(`[KeyStorage] Đã load ${accounts.length} accounts từ file`);
    return accounts;
  } catch (error) {
    console.error('[KeyStorage] Lỗi đọc keys:', error);
    // Trả về mảng rỗng nếu có lỗi
    return [];
  }
}

/**
 * Thêm một account mới
 */
export function addAccount(email: string, projects: EmbeddedProject[]): EmbeddedAccount {
  const accounts = loadApiKeys();
  
  // Kiểm tra account đã tồn tại
  const existingIndex = accounts.findIndex(acc => acc.email === email);
  
  if (existingIndex >= 0) {
    // Cập nhật projects cho account đã tồn tại
    accounts[existingIndex].projects = [
      ...accounts[existingIndex].projects,
      ...projects
    ];
    console.log(`[KeyStorage] Đã thêm ${projects.length} projects vào account ${email}`);
  } else {
    // Thêm account mới
    const newAccount: EmbeddedAccount = { email, projects };
    accounts.push(newAccount);
    console.log(`[KeyStorage] Đã thêm account mới: ${email}`);
  }
  
  saveApiKeys(accounts);
  return accounts[existingIndex >= 0 ? existingIndex : accounts.length - 1];
}

/**
 * Xóa một account
 */
export function removeAccount(email: string): boolean {
  const accounts = loadApiKeys();
  const initialLength = accounts.length;
  
  const filteredAccounts = accounts.filter(acc => acc.email !== email);
  
  if (filteredAccounts.length < initialLength) {
    saveApiKeys(filteredAccounts);
    console.log(`[KeyStorage] Đã xóa account: ${email}`);
    return true;
  }
  
  console.log(`[KeyStorage] Không tìm thấy account: ${email}`);
  return false;
}

/**
 * Xóa một project khỏi account
 */
export function removeProject(email: string, projectName: string): boolean {
  const accounts = loadApiKeys();
  const account = accounts.find(acc => acc.email === email);
  
  if (!account) {
    console.log(`[KeyStorage] Không tìm thấy account: ${email}`);
    return false;
  }
  
  const initialLength = account.projects.length;
  account.projects = account.projects.filter(p => p.projectName !== projectName);
  
  if (account.projects.length < initialLength) {
    saveApiKeys(accounts);
    console.log(`[KeyStorage] Đã xóa project ${projectName} khỏi account ${email}`);
    return true;
  }
  
  return false;
}

/**
 * Import keys từ JSON string
 */
export function importFromJson(jsonString: string): { success: boolean; count: number; error?: string } {
  try {
    const data = JSON.parse(jsonString);
    
    // Validate format
    if (!Array.isArray(data)) {
      return { success: false, count: 0, error: 'Dữ liệu phải là mảng accounts' };
    }
    
    // Validate từng account
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
    
    saveApiKeys(data);
    const totalKeys = data.reduce((sum: number, acc: EmbeddedAccount) => sum + acc.projects.length, 0);
    
    console.log(`[KeyStorage] Import thành công: ${data.length} accounts, ${totalKeys} keys`);
    return { success: true, count: totalKeys };
  } catch (error) {
    console.error('[KeyStorage] Lỗi import:', error);
    return { success: false, count: 0, error: String(error) };
  }
}

/**
 * Export keys ra JSON string (không mã hóa - để user backup)
 */
export function exportToJson(): string {
  const accounts = loadApiKeys();
  return JSON.stringify(accounts, null, 2);
}

/**
 * Kiểm tra xem có keys nào không
 */
export function hasKeys(): boolean {
  const accounts = loadApiKeys();
  return accounts.some(acc => acc.projects.length > 0);
}

/**
 * Đếm tổng số keys
 */
export function countTotalKeys(): number {
  const accounts = loadApiKeys();
  return accounts.reduce((sum, acc) => sum + acc.projects.length, 0);
}

/**
 * Đếm số accounts
 */
export function countAccounts(): number {
  return loadApiKeys().length;
}

/**
 * Lấy đường dẫn file keys (để hiển thị cho user)
 */
export function getKeysFileLocation(): string {
  return getKeysFilePath();
}
