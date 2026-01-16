/**
 * IPC Module - Export và đăng ký tất cả IPC handlers
 */

import { registerGeminiHandlers } from './geminiHandlers';

/**
 * Đăng ký tất cả IPC handlers
 */
export function registerAllHandlers(): void {
  console.log('[IPC] Đang đăng ký tất cả handlers...');

  // Đăng ký Gemini handlers
  registerGeminiHandlers();

  // Thêm các handlers khác ở đây...

  console.log('[IPC] Đã đăng ký xong tất cả handlers');
}

// Export individual handlers
export { registerGeminiHandlers } from './geminiHandlers';
