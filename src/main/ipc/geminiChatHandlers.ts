/**
 * GeminiChatHandlers - IPC handlers cho Gemini Chat config
 */

import { ipcMain } from 'electron';
import { GeminiChatService, CreateGeminiChatConfigDTO, UpdateGeminiChatConfigDTO } from '../services/geminiChatService';

// IPC Channel names
const CHANNELS = {
  GET_ALL: 'geminiChat:getAll',
  GET_ACTIVE: 'geminiChat:getActive',
  GET_BY_ID: 'geminiChat:getById',
  CREATE: 'geminiChat:create',
  UPDATE: 'geminiChat:update',
  DELETE: 'geminiChat:delete',
  SEND_MESSAGE: 'geminiChat:sendMessage',
};

export function registerGeminiChatHandlers(): void {
  console.log('[GeminiChatHandlers] Dang ky handlers...');

  // Lay tat ca cau hinh
  ipcMain.handle(CHANNELS.GET_ALL, async () => {
    try {
      const configs = GeminiChatService.getAll();
      return { success: true, data: configs };
    } catch (error) {
      console.error('[GeminiChatHandlers] Loi getAll:', error);
      return { success: false, error: String(error) };
    }
  });

  // Lay cau hinh dang active
  ipcMain.handle(CHANNELS.GET_ACTIVE, async () => {
    try {
      const config = GeminiChatService.getActive();
      return { success: true, data: config };
    } catch (error) {
      console.error('[GeminiChatHandlers] Loi getActive:', error);
      return { success: false, error: String(error) };
    }
  });

  // Lay cau hinh theo ID
  ipcMain.handle(CHANNELS.GET_BY_ID, async (_, id: string) => {
    try {
      const config = GeminiChatService.getById(id);
      return { success: true, data: config };
    } catch (error) {
      console.error('[GeminiChatHandlers] Loi getById:', error);
      return { success: false, error: String(error) };
    }
  });

  // Tao moi cau hinh
  ipcMain.handle(CHANNELS.CREATE, async (_, data: CreateGeminiChatConfigDTO) => {
    try {
      const config = GeminiChatService.create(data);
      return { success: true, data: config };
    } catch (error) {
      console.error('[GeminiChatHandlers] Loi create:', error);
      return { success: false, error: String(error) };
    }
  });

  // Cap nhat cau hinh
  ipcMain.handle(CHANNELS.UPDATE, async (_, id: string, data: UpdateGeminiChatConfigDTO) => {
    try {
      const config = GeminiChatService.update(id, data);
      return { success: true, data: config };
    } catch (error) {
      console.error('[GeminiChatHandlers] Loi update:', error);
      return { success: false, error: String(error) };
    }
  });

  // Xoa cau hinh
  ipcMain.handle(CHANNELS.DELETE, async (_, id: string) => {
    try {
      const result = GeminiChatService.delete(id);
      return { success: true, data: result };
    } catch (error) {
      console.error('[GeminiChatHandlers] Loi delete:', error);
      return { success: false, error: String(error) };
    }
  });

  // Gui tin nhan den Gemini Web API
  ipcMain.handle(CHANNELS.SEND_MESSAGE, async (_, message: string, configId: string, context?: { conversationId: string; responseId: string; choiceId: string }) => {
    try {
      console.log('[GeminiChatHandlers] sendMessage, configId:', configId, 'context:', context);
      const result = await GeminiChatService.sendMessage(message, configId, context);
      return result;
    } catch (error) {
      console.error('[GeminiChatHandlers] Loi sendMessage:', error);
      return { success: false, error: String(error) };
    }
  });

  console.log('[GeminiChatHandlers] Da dang ky handlers thanh cong');
}
