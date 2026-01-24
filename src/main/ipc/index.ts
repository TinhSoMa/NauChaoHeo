/**
 * IPC Module - Export và đăng ký tất cả IPC handlers
 */

import { registerGeminiHandlers } from './geminiHandlers';
import { registerCaptionHandlers } from './captionHandlers';
import { registerTTSHandlers } from './ttsHandlers';
import { registerStoryHandlers } from './storyHandlers';
import { registerPromptHandlers } from './promptHandlers';
import { registerProjectHandlers } from './projectHandlers';
import { registerAppSettingsHandlers } from './appSettingsHandlers';
import { registerGeminiChatHandlers } from './geminiChatHandlers';

/**
 * Đăng ký tất cả IPC handlers
 */
export function registerAllHandlers(): void {
  console.log('[IPC] Đang đăng ký tất cả handlers...');

  // Đăng ký Gemini handlers
  registerGeminiHandlers();

  // Đăng ký Caption handlers (dịch phụ đề)
  registerCaptionHandlers();

  // Đăng ký TTS handlers (text-to-speech)
  registerTTSHandlers();

  // Đăng ký Story handlers
  registerStoryHandlers();

  // Đăng ký Prompt handlers
  registerPromptHandlers();

  // Đăng ký Project handlers (quản lý dự án dịch)
  registerProjectHandlers();

  // Dang ky App Settings handlers
  registerAppSettingsHandlers();

  // Dang ky Gemini Chat handlers
  registerGeminiChatHandlers();

  console.log('[IPC] Da dang ky xong tat ca handlers');
}

// Export individual handlers
export { registerGeminiHandlers } from './geminiHandlers';
export { registerCaptionHandlers } from './captionHandlers';
export { registerTTSHandlers } from './ttsHandlers';
export { registerStoryHandlers } from './storyHandlers';
export { registerPromptHandlers } from './promptHandlers';
export { registerProjectHandlers } from './projectHandlers';
export { registerAppSettingsHandlers } from './appSettingsHandlers';
export { registerGeminiChatHandlers } from './geminiChatHandlers';

