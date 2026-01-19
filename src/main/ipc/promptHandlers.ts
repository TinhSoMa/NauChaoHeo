import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { PromptService } from '../services/promptService';
import { PROMPT_IPC_CHANNELS } from '../../shared/types/prompt';

export function registerPromptHandlers(): void {
  console.log('[PromptHandlers] Đăng ký handlers...');

  ipcMain.handle(PROMPT_IPC_CHANNELS.GET_ALL, async () => {
    return PromptService.getAll();
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.GET_BY_ID, async (_event, id: string) => {
    return PromptService.getById(id);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.CREATE, async (_event, data) => {
    return PromptService.create(data);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.UPDATE, async (_event, { id, ...data }) => {
    return PromptService.update(id, data);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.DELETE, async (_event, id: string) => {
    return PromptService.delete(id);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.SET_DEFAULT, async (_event, id: string) => {
      return PromptService.setDefault(id);
  });

  console.log('[PromptHandlers] Đã đăng ký handlers thành công');
}
