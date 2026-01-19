/**
 * IPC Module - Export và đăng ký tất cả IPC handlers
 */

import { registerGeminiHandlers } from './geminiHandlers';
import { registerCaptionHandlers } from './captionHandlers';
import { registerTTSHandlers } from './ttsHandlers';
import { registerStoryHandlers } from './storyHandlers';
import { registerPromptHandlers } from './promptHandlers';

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

  console.log('[IPC] Đã đăng ký xong tất cả handlers');
}

// Export individual handlers
export { registerGeminiHandlers } from './geminiHandlers';
export { registerCaptionHandlers } from './captionHandlers';
export { registerTTSHandlers } from './ttsHandlers';
export { registerStoryHandlers } from './storyHandlers';
export { registerPromptHandlers } from './promptHandlers';

