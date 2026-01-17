/**
 * Gemini IPC Handlers - Xử lý các IPC request liên quan đến Gemini API
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { GEMINI_IPC_CHANNELS, KeyInfo, ApiStats, GeminiResponse, EmbeddedAccount, EmbeddedProject } from '../../shared/types/gemini';
import * as Gemini from '../services/gemini';


// Import ApiResponse type từ shared nếu cần
interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Đăng ký tất cả IPC handlers cho Gemini
 */
export function registerGeminiHandlers(): void {
  console.log('[IPC] Đang đăng ký Gemini handlers...');

  // Lấy API key tiếp theo
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.GET_NEXT_API_KEY,
    async (): Promise<IpcApiResponse<{ apiKey: string | null; keyInfo: KeyInfo | null }>> => {
      try {
        const manager = Gemini.getApiManager();
        const { apiKey, keyInfo } = manager.getNextApiKey();
        return { success: true, data: { apiKey, keyInfo } };
      } catch (error) {
        console.error('[IPC] Lỗi getNextApiKey:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Lấy tất cả keys available
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.GET_ALL_AVAILABLE_KEYS,
    async (): Promise<IpcApiResponse<KeyInfo[]>> => {
      try {
        const manager = Gemini.getApiManager();
        const keys = manager.getAllAvailableKeys();
        return { success: true, data: keys };
      } catch (error) {
        console.error('[IPC] Lỗi getAllAvailableKeys:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Lấy thống kê
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.GET_STATS,
    async (): Promise<IpcApiResponse<ApiStats>> => {
      try {
        const manager = Gemini.getApiManager();
        const stats = manager.getStats();
        return { success: true, data: stats };
      } catch (error) {
        console.error('[IPC] Lỗi getStats:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Ghi nhận thành công
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.RECORD_SUCCESS,
    async (_event: IpcMainInvokeEvent, apiKey: string): Promise<IpcApiResponse<boolean>> => {
      try {
        const manager = Gemini.getApiManager();
        manager.recordSuccess(apiKey);
        return { success: true, data: true };
      } catch (error) {
        console.error('[IPC] Lỗi recordSuccess:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Ghi nhận rate limit
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.RECORD_RATE_LIMIT,
    async (_event: IpcMainInvokeEvent, apiKey: string): Promise<IpcApiResponse<boolean>> => {
      try {
        const manager = Gemini.getApiManager();
        manager.recordRateLimitError(apiKey);
        return { success: true, data: true };
      } catch (error) {
        console.error('[IPC] Lỗi recordRateLimit:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Ghi nhận quota exhausted
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.RECORD_EXHAUSTED,
    async (_event: IpcMainInvokeEvent, apiKey: string): Promise<IpcApiResponse<boolean>> => {
      try {
        const manager = Gemini.getApiManager();
        manager.recordQuotaExhausted(apiKey);
        return { success: true, data: true };
      } catch (error) {
        console.error('[IPC] Lỗi recordExhausted:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Ghi nhận lỗi khác
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.RECORD_ERROR,
    async (_event: IpcMainInvokeEvent, apiKey: string, errorMessage: string): Promise<IpcApiResponse<boolean>> => {
      try {
        const manager = Gemini.getApiManager();
        manager.recordError(apiKey, errorMessage);
        return { success: true, data: true };
      } catch (error) {
        console.error('[IPC] Lỗi recordError:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Reset tất cả status
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.RESET_ALL_STATUS,
    async (): Promise<IpcApiResponse<boolean>> => {
      try {
        const manager = Gemini.getApiManager();
        manager.resetAllStatusExceptDisabled();
        return { success: true, data: true };
      } catch (error) {
        console.error('[IPC] Lỗi resetAllStatus:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Reload config
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.RELOAD_CONFIG,
    async (): Promise<IpcApiResponse<boolean>> => {
      try {
        const manager = Gemini.getApiManager();
        manager.reload();
        return { success: true, data: true };
      } catch (error) {
        console.error('[IPC] Lỗi reloadConfig:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Gọi Gemini API
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.CALL_GEMINI,
    async (
      _event: IpcMainInvokeEvent,
      prompt: string | object,
      model?: Gemini.GeminiModel
    ): Promise<IpcApiResponse<GeminiResponse>> => {
      try {
        const result = await Gemini.callGeminiWithRotation(prompt, model || Gemini.GEMINI_MODELS.FLASH_2_5);
        return { success: true, data: result };
      } catch (error) {
        console.error('[IPC] Lỗi callGemini:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Dịch text
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.TRANSLATE_TEXT,
    async (
      _event: IpcMainInvokeEvent,
      text: string,
      targetLanguage?: string,
      model?: Gemini.GeminiModel
    ): Promise<IpcApiResponse<GeminiResponse>> => {
      try {
        const result = await Gemini.translateText(
          text,
          targetLanguage || 'Vietnamese',
          model || Gemini.GEMINI_MODELS.FLASH_2_5
        );
        return { success: true, data: result };
      } catch (error) {
        console.error('[IPC] Lỗi Gemini.translateText:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ==========================================
  // KEY STORAGE MANAGEMENT HANDLERS
  // ==========================================

  // Import keys từ JSON
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_IMPORT,
    async (_event: IpcMainInvokeEvent, jsonString: string): Promise<IpcApiResponse<{ count: number }>> => {
      try {
        console.log('[IPC] Đang import API keys...');
        const result = Gemini.importFromJson(jsonString);
        if (result.success) {
          // Reload API manager sau khi import
          const manager = Gemini.getApiManager();
          manager.reload();
          console.log(`[IPC] Import thành công ${result.count} keys`);
          return { success: true, data: { count: result.count } };
        } else {
          return { success: false, error: result.error };
        }
      } catch (error) {
        console.error('[IPC] Lỗi import keys:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Export keys ra JSON
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_EXPORT,
    async (): Promise<IpcApiResponse<string>> => {
      try {
        const json = Gemini.exportToJson();
        console.log('[IPC] Đã export API keys');
        return { success: true, data: json };
      } catch (error) {
        console.error('[IPC] Lỗi export keys:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Thêm account mới
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_ADD_ACCOUNT,
    async (
      _event: IpcMainInvokeEvent,
      email: string,
      projects: EmbeddedProject[]
    ): Promise<IpcApiResponse<EmbeddedAccount>> => {
      try {
        console.log(`[IPC] Thêm account: ${email} với ${projects.length} projects`);
        const account = Gemini.addAccount(email, projects);
        // Reload API manager
        const manager = Gemini.getApiManager();
        manager.reload();
        return { success: true, data: account };
      } catch (error) {
        console.error('[IPC] Lỗi thêm account:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Xóa account
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_REMOVE_ACCOUNT,
    async (_event: IpcMainInvokeEvent, email: string): Promise<IpcApiResponse<boolean>> => {
      try {
        console.log(`[IPC] Xóa account: ${email}`);
        const removed = Gemini.removeAccount(email);
        if (removed) {
          // Reload API manager
          const manager = Gemini.getApiManager();
          manager.reload();
        }
        return { success: true, data: removed };
      } catch (error) {
        console.error('[IPC] Lỗi xóa account:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Xóa project
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_REMOVE_PROJECT,
    async (
      _event: IpcMainInvokeEvent,
      email: string,
      projectName: string
    ): Promise<IpcApiResponse<boolean>> => {
      try {
        console.log(`[IPC] Xóa project ${projectName} từ account ${email}`);
        const removed = Gemini.removeProject(email, projectName);
        if (removed) {
          // Reload API manager
          const manager = Gemini.getApiManager();
          manager.reload();
        }
        return { success: true, data: removed };
      } catch (error) {
        console.error('[IPC] Lỗi xóa project:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Kiểm tra có keys không
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_HAS_KEYS,
    async (): Promise<IpcApiResponse<boolean>> => {
      try {
        const has = Gemini.hasKeys();
        return { success: true, data: has };
      } catch (error) {
        console.error('[IPC] Lỗi kiểm tra keys:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Lấy đường dẫn file keys
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_GET_LOCATION,
    async (): Promise<IpcApiResponse<string>> => {
      try {
        const location = Gemini.getKeysFileLocation();
        return { success: true, data: location };
      } catch (error) {
        console.error('[IPC] Lỗi lấy đường dẫn keys:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Lấy tất cả accounts (để hiển thị trên UI)
  ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_GET_ALL,
    async (): Promise<IpcApiResponse<EmbeddedAccount[]>> => {
      try {
        const accounts = Gemini.loadApiKeys();
        // Ẩn API key, chỉ hiển thị 8 ký tự đầu
        const maskedAccounts = accounts.map(acc => ({
          ...acc,
          projects: acc.projects.map(p => ({
            ...p,
            apiKey: p.apiKey.substring(0, 8) + '...' + p.apiKey.substring(p.apiKey.length - 4),
          })),
        }));
        return { success: true, data: maskedAccounts };
      } catch (error) {
        console.error('[IPC] Lỗi lấy danh sách accounts:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[IPC] Đã đăng ký xong Gemini handlers');
}
