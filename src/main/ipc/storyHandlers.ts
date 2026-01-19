import { ipcMain, IpcMainInvokeEvent, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as StoryService from '../services/story';
import { STORY_IPC_CHANNELS } from '../../shared/types';

export function registerStoryHandlers(): void {
  console.log('[StoryHandlers] Đăng ký handlers...');

  ipcMain.handle(
    STORY_IPC_CHANNELS.PARSE,
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      console.log(`[StoryHandlers] Parse story: ${filePath}`);
      return await StoryService.parseStoryFile(filePath);
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.PREPARE_PROMPT,
    async (_event: IpcMainInvokeEvent, { chapterContent, sourceLang, targetLang }) => {
       console.log(`[StoryHandlers] Prepare prompt logic: ${sourceLang} -> ${targetLang}`);
       return await StoryService.StoryService.prepareTranslationPrompt(chapterContent, sourceLang, targetLang);
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.SAVE_PROMPT,
    async (_event: IpcMainInvokeEvent, content: string) => {
      console.log('[StoryHandlers] Save prompt to file...');
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Lưu Prompt',
        defaultPath: 'prompt.txt',
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      });

      if (canceled || !filePath) {
        return { success: false, error: 'User canceled' };
      }

      try {
        await fs.writeFile(filePath, content, 'utf-8');
        return { success: true, filePath };
      } catch (error) {
        console.error('Error saving file:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.TRANSLATE_CHAPTER,
    async (_event: IpcMainInvokeEvent, prompt: any) => {
      console.log('[StoryHandlers] Translate chapter...');
      return await StoryService.StoryService.translateChapter(prompt);
    }
  );

  console.log('[StoryHandlers] Đã đăng ký handlers thành công');
}
