import { ipcMain, IpcMainInvokeEvent, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as StoryService from '../services/story';
import { GeminiChatService } from '../services/geminiChatService';
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
    async (_event: IpcMainInvokeEvent, payload: any) => {
      // console.log('[StoryHandlers] Translate chapter params:', payload);
      // Support legacy call (just prompt) or new call (options object)
      // If payload is the prompt directly (array or object check), treat as legacy API method.
      // But typically we should standardize.
      // Let's assume payload is the Options object if it has 'prompt' key.
      
      let options = payload;
      if (!payload.prompt && (Array.isArray(payload) || payload.role)) {
          // It's just the prompt structure
          options = { prompt: payload, method: 'API' };
      }
      
      return await StoryService.StoryService.translateChapter(options);
    }
  );

  ipcMain.on(
    STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_STREAM,
    async (event, payload: any) => {
        const { prompt, webConfigId, context } = payload;
        // console.log('[StoryHandlers] Streaming request...');
        
        try {
            GeminiChatService.streamMessage(
                prompt,
                webConfigId,
                context,
                (data) => {
                    event.sender.send(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_STREAM_REPLY, {
                        success: true,
                        data: data
                    });
                },
                (error) => {
                    event.sender.send(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_STREAM_REPLY, {
                        success: false,
                        error: error
                    });
                },
                () => {
                    event.sender.send(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_STREAM_REPLY, {
                        success: true,
                        done: true
                    });
                }
            );
        } catch (e) {
            console.error('Stream setup error:', e);
            event.sender.send(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_STREAM_REPLY, {
                 success: false,
                 error: String(e)
            });
        }
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.CREATE_EBOOK,
    async (_event: IpcMainInvokeEvent, options: any) => {
        console.log('[StoryHandlers] Create ebook:', options.title);
        return await StoryService.StoryService.createEbook(options);
    }
  );

  console.log('[StoryHandlers] Đã đăng ký handlers thành công');
}
