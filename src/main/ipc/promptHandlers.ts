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

  ipcMain.handle(PROMPT_IPC_CHANNELS.GET_GROUPS, async (_event, payload?: { languageBucket?: string }) => {
    return PromptService.getGroups(payload?.languageBucket);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.CREATE_GROUP, async (_event, payload: { languageBucket: string; name: string }) => {
    return PromptService.createGroup(payload);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.RENAME_GROUP, async (_event, payload: { groupId: string; name: string }) => {
    return PromptService.renameGroup(payload);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.DELETE_GROUP, async (_event, groupId: string) => {
    return PromptService.deleteGroup(groupId);
  });

  ipcMain.handle(
    PROMPT_IPC_CHANNELS.GET_FAMILIES,
    async (_event, payload?: { languageBucket?: string; groupId?: string; promptType?: 'translation' | 'summary' | 'caption' }) => {
      return PromptService.getFamilies(payload || {});
    }
  );

  ipcMain.handle(PROMPT_IPC_CHANNELS.GET_VERSIONS, async (_event, familyId: string) => {
    return PromptService.getVersions(familyId);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.MOVE_FAMILY, async (_event, payload: { familyId: string; targetGroupId: string }) => {
    return PromptService.moveFamily(payload);
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.GET_HIERARCHY, async () => {
    return PromptService.getHierarchy();
  });

  ipcMain.handle(PROMPT_IPC_CHANNELS.RESOLVE_LATEST_BY_FAMILY, async (_event, familyId: string) => {
    return PromptService.resolveLatestByFamily(familyId);
  });

  console.log('[PromptHandlers] Đã đăng ký handlers thành công');
}
