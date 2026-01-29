import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getProxyManager } from '../services/proxyManager';
import { PROXY_IPC_CHANNELS, ProxyConfig, ProxyStats, ProxyTestResult } from '../../shared/types/proxy';

/**
 * Register IPC handlers cho proxy management
 */
export function registerProxyHandlers(): void {
  console.log('[ProxyHandlers] Đăng ký handlers...');

  const manager = getProxyManager();

  // Lấy tất cả proxies
  ipcMain.handle(
    PROXY_IPC_CHANNELS.GET_ALL,
    async (): Promise<{ success: boolean; data?: ProxyConfig[]; error?: string }> => {
      try {
        const proxies = manager.getAllProxies();
        
        // Mask password cho security
        const maskedProxies = proxies.map(p => ({
          ...p,
          password: p.password ? '***MASKED***' : undefined,
        }));
        
        return { success: true, data: maskedProxies };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi get all proxies:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Thêm proxy mới
  ipcMain.handle(
    PROXY_IPC_CHANNELS.ADD,
    async (_event: IpcMainInvokeEvent, config: Omit<ProxyConfig, 'id' | 'createdAt' | 'successCount' | 'failedCount'>): Promise<{ success: boolean; data?: ProxyConfig; error?: string }> => {
      try {
        console.log(`[ProxyHandlers] Thêm proxy: ${config.host}:${config.port}`);
        const newProxy = manager.addProxy(config);
        
        // Mask password
        const maskedProxy = {
          ...newProxy,
          password: newProxy.password ? '***MASKED***' : undefined,
        };
        
        return { success: true, data: maskedProxy };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi add proxy:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Xóa proxy
  ipcMain.handle(
    PROXY_IPC_CHANNELS.REMOVE,
    async (_event: IpcMainInvokeEvent, proxyId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        console.log(`[ProxyHandlers] Xóa proxy: ${proxyId}`);
        const removed = manager.removeProxy(proxyId);
        
        if (removed) {
          return { success: true };
        } else {
          return { success: false, error: 'Proxy không tồn tại' };
        }
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi remove proxy:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Cập nhật proxy
  ipcMain.handle(
    PROXY_IPC_CHANNELS.UPDATE,
    async (_event: IpcMainInvokeEvent, proxyId: string, updates: Partial<ProxyConfig>): Promise<{ success: boolean; error?: string }> => {
      try {
        console.log(`[ProxyHandlers] Cập nhật proxy: ${proxyId}`);
        const updated = manager.updateProxy(proxyId, updates);
        
        if (updated) {
          return { success: true };
        } else {
          return { success: false, error: 'Proxy không tồn tại' };
        }
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi update proxy:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Test proxy
  ipcMain.handle(
    PROXY_IPC_CHANNELS.TEST,
    async (_event: IpcMainInvokeEvent, proxyId: string): Promise<ProxyTestResult> => {
      try {
        console.log(`[ProxyHandlers] Test proxy: ${proxyId}`);
        const result = await manager.testProxy(proxyId);
        
        return {
          success: result.success,
          latency: result.latency,
          error: result.error,
          testedAt: Date.now(),
        };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi test proxy:', error);
        return {
          success: false,
          error: String(error),
          testedAt: Date.now(),
        };
      }
    }
  );

  // Check all proxies against Gemini endpoint and update DB
  ipcMain.handle(
    PROXY_IPC_CHANNELS.CHECK_ALL,
    async (): Promise<{ success: boolean; checked?: number; passed?: number; failed?: number; error?: string }> => {
      try {
        console.log('[ProxyHandlers] Check all proxies...');
        const result = await manager.checkAllProxies('https://generativelanguage.googleapis.com');
        return { success: true, ...result };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi check all proxies:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Lấy stats
  ipcMain.handle(
    PROXY_IPC_CHANNELS.GET_STATS,
    async (): Promise<{ success: boolean; data?: ProxyStats[]; error?: string }> => {
      try {
        const stats = manager.getStats();
        return { success: true, data: stats };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi get stats:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Import proxies
  ipcMain.handle(
    PROXY_IPC_CHANNELS.IMPORT,
    async (_event: IpcMainInvokeEvent, data: string): Promise<{ success: boolean; added?: number; skipped?: number; error?: string }> => {
      try {
        console.log('[ProxyHandlers] Import proxies...');
        const result = manager.importProxies(data);
        return { success: true, ...result };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi import proxies:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Export proxies
  ipcMain.handle(
    PROXY_IPC_CHANNELS.EXPORT,
    async (): Promise<{ success: boolean; data?: string; error?: string }> => {
      try {
        console.log('[ProxyHandlers] Export proxies...');
        const data = manager.exportProxies();
        return { success: true, data };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi export proxies:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Bulk import Webshare proxies
  ipcMain.handle(
    'proxy:bulkImportWebshare',
    async (_event: IpcMainInvokeEvent, text: string): Promise<{ success: boolean; added?: number; skipped?: number; error?: string }> => {
      try {
        console.log('[ProxyHandlers] Bulk import Webshare proxies...');
        const { parseWebshareProxies } = await import('../utils/webshareParser');
        
        const proxiesToAdd = parseWebshareProxies(text);
        
        if (proxiesToAdd.length === 0) {
          return { success: false, error: 'Không parse được proxy nào từ input' };
        }

        let added = 0;
        let skipped = 0;

        for (const proxyConfig of proxiesToAdd) {
          // Check duplicate
          const allProxies = manager.getAllProxies();
          const exists = allProxies.some(p => p.host === proxyConfig.host && p.port === proxyConfig.port);
          
          if (exists) {
            skipped++;
            continue;
          }

          manager.addProxy(proxyConfig);
          added++;
        }

        console.log(`[ProxyHandlers] Bulk import complete: ${added} added, ${skipped} skipped`);
        return { success: true, added, skipped };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi bulk import Webshare:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Quick add Webshare free proxies (hardcoded 10 proxies)
  ipcMain.handle(
    'proxy:quickAddWebshare',
    async (): Promise<{ success: boolean; added?: number; error?: string }> => {
      try {
        console.log('[ProxyHandlers] Quick add Webshare free proxies...');
        const { getWebshareFreeProxies } = await import('../utils/webshareParser');
        
        const proxiesToAdd = getWebshareFreeProxies();
        
        let added = 0;

        for (const proxyConfig of proxiesToAdd) {
          // Check duplicate
          const allProxies = manager.getAllProxies();
          const exists = allProxies.some(p => p.host === proxyConfig.host && p.port === proxyConfig.port);
          
          if (exists) {
            continue;
          }

          manager.addProxy(proxyConfig);
          added++;
        }

        console.log(`[ProxyHandlers] Quick add complete: ${added} proxies added`);
        return { success: true, added };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi quick add Webshare:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Reset all proxies (re-enable và reset failed counts)
  ipcMain.handle(
    PROXY_IPC_CHANNELS.RESET,
    async (): Promise<{ success: boolean; error?: string }> => {
      try {
        console.log('[ProxyHandlers] Reset all proxies...');
        manager.resetAllFailedCounts();
        return { success: true };
      } catch (error) {
        console.error('[ProxyHandlers] Lỗi reset proxies:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[ProxyHandlers] Đã đăng ký handlers thành công');
}
