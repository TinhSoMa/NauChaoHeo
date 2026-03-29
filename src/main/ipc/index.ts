/**
 * IPC Module - Export và đăng ký tất cả IPC handlers
 */

import { registerGeminiHandlers } from './geminiHandlers';
import { registerCaptionHandlers } from './captionHandlers';
import { registerCaptionDefaultsHandlers } from './captionDefaultsHandlers';
import { registerTTSHandlers } from './ttsHandlers';
import { registerStoryHandlers } from './storyHandlers';
import { registerPromptHandlers } from './promptHandlers';
import { registerProjectHandlers } from './projectHandlers';
import { registerAppSettingsHandlers } from './appSettingsHandlers';
import { registerGeminiChatHandlers } from './geminiChatHandlers';
import { registerProxyHandlers } from './proxyHandlers'; // Thêm import cho proxy handlers
import { registerCutVideoHandlers } from './cutVideoHandlers';
import { registerRotationQueueHandlers } from './rotationQueueHandlers';
import { registerGeminiWebApiHandlers } from './geminiWebApiHandlers';
import { registerAppLogHandlers } from './appLogHandlers';
import { registerGrokUiHandlers } from './grokUiHandlers';
import { registerDownloaderHandlers } from './downloaderHandlers';
import { registerShutdownHandlers } from './shutdownHandlers';

/**
 * Đăng ký tất cả IPC handlers
 */
export function registerAllHandlers(): void {
  console.log('[IPC] Đang đăng ký tất cả handlers...');

  // Đăng ký Gemini handlers
  registerGeminiHandlers();

  // Đăng ký Caption handlers (dịch phụ đề)
  registerCaptionHandlers();
  registerCaptionDefaultsHandlers();

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

  // Dang ky Gemini WebAPI ops handlers
  registerGeminiWebApiHandlers();

  // Dang ky Grok UI handlers
  registerGrokUiHandlers();

  // Dang ky App Logs handlers
  registerAppLogHandlers();

  // Đăng ký Proxy handlers (quản lý proxy rotation)
  registerProxyHandlers();

  // Đăng ký Cut Video handlers
  registerCutVideoHandlers();

  // Đăng ký Rotation Queue inspector handlers (feature-flagged)
  registerRotationQueueHandlers();

  // Đăng ký Downloader handlers (yt-dlp)
  registerDownloaderHandlers();

  // Đăng ký Shutdown handlers (auto shutdown sau pipeline)
  registerShutdownHandlers();

  console.log('[IPC] Da dang ky xong tat ca handlers');
}

// Export individual handlers
export { registerGeminiHandlers } from './geminiHandlers';
export { registerCaptionHandlers } from './captionHandlers';
export { registerCaptionDefaultsHandlers } from './captionDefaultsHandlers';
export { registerTTSHandlers } from './ttsHandlers';
export { registerStoryHandlers } from './storyHandlers';
export { registerPromptHandlers } from './promptHandlers';
export { registerProjectHandlers } from './projectHandlers';
export { registerAppSettingsHandlers } from './appSettingsHandlers';
export { registerGeminiChatHandlers } from './geminiChatHandlers';
export { registerGeminiWebApiHandlers } from './geminiWebApiHandlers';
export { registerAppLogHandlers } from './appLogHandlers';
export { registerGrokUiHandlers } from './grokUiHandlers';
export { registerProxyHandlers } from './proxyHandlers';
export { registerCutVideoHandlers } from './cutVideoHandlers';
export { registerRotationQueueHandlers } from './rotationQueueHandlers';
export { registerShutdownHandlers } from './shutdownHandlers';

