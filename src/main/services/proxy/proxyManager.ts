import { ProxyConfig, ProxyStats } from '../../../shared/types/proxy';
import { ProxyDatabase } from '../../database/proxyDatabase';

/**
 * ProxyManager - Quản lý pool proxy với rotation logic
 * Sử dụng SQLite database để persist data
 */
export class ProxyManager {
  private currentIndex: number = 0;
  private maxFailedCount: number = 2; // Tự động disable proxy sau 2 lỗi liên tiếp
  private settings: {
    maxRetries: number;
    timeout: number;
    maxFailedCount: number;
    enableRotation: boolean;
    fallbackToDirect: boolean;
  };

  constructor() {
    // Default settings
    this.settings = {
      maxRetries: 3,
      timeout: 10000,
      maxFailedCount: 2,
      enableRotation: true,
      fallbackToDirect: true,
    };
    
    console.log('[ProxyManager] Initialized with database storage');
  }

  /**
   * Lấy proxy tiếp theo theo round-robin
   * @returns Proxy config hoặc null nếu không có proxy khả dụng
   */
  getNextProxy(): ProxyConfig | null {
    if (!this.settings.enableRotation) {
      return null;
    }

    // Lọc các proxy được enable và chưa bị disable do lỗi quá nhiều
    const allProxies = ProxyDatabase.getAll();
    const availableProxies = allProxies.filter(p => 
      p.enabled && (p.failedCount || 0) < this.maxFailedCount
    );

    if (availableProxies.length === 0) {
      console.warn('[ProxyManager] Không có proxy khả dụng');
      return null;
    }

    // Round-robin rotation
    const proxy = availableProxies[this.currentIndex % availableProxies.length];
    this.currentIndex = (this.currentIndex + 1) % availableProxies.length;

    console.log(`[ProxyManager] Sử dụng proxy: ${proxy.host}:${proxy.port} (${proxy.type})`);
    return proxy;
  }

  /**
   * Đánh dấu proxy thành công
   */
  markProxySuccess(proxyId: string): void {
    try {
      ProxyDatabase.incrementSuccess(proxyId);
      const proxy = ProxyDatabase.getById(proxyId);
      
      if (proxy) {
        console.log(`[ProxyManager] ✅ Proxy ${proxy.host}:${proxy.port} thành công (${proxy.successCount} success)`);
      }
    } catch (error) {
      console.error('[ProxyManager] Lỗi markProxySuccess:', error);
    }
  }

  /**
   * Đánh dấu proxy thất bại
   */
  markProxyFailed(proxyId: string, error?: string): void {
    try {
      ProxyDatabase.incrementFailed(proxyId);
      const proxy = ProxyDatabase.getById(proxyId);
      
      if (proxy) {
        console.warn(`[ProxyManager] ❌ Proxy ${proxy.host}:${proxy.port} thất bại (${proxy.failedCount || 0}/${this.maxFailedCount})`, error);
        
        // Tự động disable nếu lỗi quá nhiều
        if ((proxy.failedCount || 0) >= this.maxFailedCount) {
          ProxyDatabase.update(proxyId, { enabled: false });
          console.error(`[ProxyManager] 🚫 Đã disable proxy ${proxy.host}:${proxy.port} do lỗi quá nhiều lần`);
        }
      }
    } catch (error) {
      console.error('[ProxyManager] Lỗi markProxyFailed:', error);
    }
  }

  /**
   * Thêm proxy mới
   */
  addProxy(config: Omit<ProxyConfig, 'id' | 'createdAt' | 'successCount' | 'failedCount'>): ProxyConfig {
    const newProxy: ProxyConfig = {
      ...config,
      id: `proxy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      successCount: 0,
      failedCount: 0,
    };

    const created = ProxyDatabase.create(newProxy);
    console.log(`[ProxyManager] ➕ Đã thêm proxy: ${created.host}:${created.port}`);
    return created;
  }

  /**
   * Xóa proxy
   */
  removeProxy(proxyId: string): boolean {
    const proxy = ProxyDatabase.getById(proxyId);
    if (proxy) {
      const deleted = ProxyDatabase.delete(proxyId);
      if (deleted) {
        console.log(`[ProxyManager] ➖ Đã xóa proxy: ${proxy.host}:${proxy.port}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Cập nhật proxy
   */
  updateProxy(proxyId: string, updates: Partial<ProxyConfig>): boolean {
    const updated = ProxyDatabase.update(proxyId, updates);
    if (updated) {
      const proxy = ProxyDatabase.getById(proxyId);
      if (proxy) {
        console.log(`[ProxyManager] 🔄 Đã cập nhật proxy: ${proxy.host}:${proxy.port}`);
      }
      return true;
    }
    return false;
  }

  /**
   * Lấy tất cả proxies
   */
  getAllProxies(): ProxyConfig[] {
    return ProxyDatabase.getAll();
  }

  /**
   * Lấy thống kê của tất cả proxies
   */
  getStats(): ProxyStats[] {
    const proxies = ProxyDatabase.getAll();
    return proxies.map(proxy => {
      const total = (proxy.successCount || 0) + (proxy.failedCount || 0);
      const successRate = total > 0 ? (proxy.successCount || 0) / total : 0;
      
      return {
        id: proxy.id,
        host: proxy.host,
        port: proxy.port,
        successCount: proxy.successCount || 0,
        failedCount: proxy.failedCount || 0,
        successRate: Math.round(successRate * 100),
        lastUsedAt: proxy.lastUsedAt,
        isHealthy: proxy.enabled && (proxy.failedCount || 0) < this.maxFailedCount,
      };
    });
  }

  /**
   * Test proxy hoạt động không
   */
  async testProxy(proxyId: string): Promise<{ success: boolean; latency?: number; error?: string }> {
    const proxy = ProxyDatabase.getById(proxyId);
    if (!proxy) {
      return { success: false, error: 'Proxy không tồn tại' };
    }

    try {
      const startTime = Date.now();
      
      // Test bằng cách gọi API đơn giản (httpbin.org)
      const { default: fetch } = await import('node-fetch');
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      
      const proxyUrl = proxy.username 
        ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
        : `${proxy.type}://${proxy.host}:${proxy.port}`;
      
      const agent = new HttpsProxyAgent(proxyUrl);
      
      const response = await fetch('https://httpbin.org/ip', {
        method: 'GET',
        agent: agent as any,
        timeout: this.settings.timeout,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const latency = Date.now() - startTime;
      const data = await response.json() as { origin: string };
      
      console.log(`[ProxyManager] ✅ Test proxy thành công: ${proxy.host}:${proxy.port} (${latency}ms) - IP: ${data.origin}`);
      
      return { success: true, latency };
    } catch (error) {
      console.error(`[ProxyManager] ❌ Test proxy thất bại: ${proxy.host}:${proxy.port}`, error);
      return { success: false, error: String(error) };
    }
  }

  private async createProxyAgent(proxy: ProxyConfig): Promise<any> {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    const { SocksProxyAgent } = await import('socks-proxy-agent');

    const proxyScheme = proxy.type === 'socks5' ? 'socks5h' : proxy.type;
    const proxyUrl = proxy.username
      ? `${proxyScheme}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
      : `${proxyScheme}://${proxy.host}:${proxy.port}`;

    if (proxy.type === 'socks5') {
      return new SocksProxyAgent(proxyUrl, { timeout: this.settings.timeout });
    }

    return new HttpsProxyAgent(proxyUrl, { timeout: this.settings.timeout });
  }

  async checkProxyConnectivity(proxyId: string, url: string = 'https://generativelanguage.googleapis.com'): Promise<{ success: boolean; latency?: number; status?: number; error?: string }> {
    const proxy = ProxyDatabase.getById(proxyId);
    if (!proxy) {
      return { success: false, error: 'Proxy không tồn tại' };
    }

    try {
      const startTime = Date.now();
      const { default: fetch } = await import('node-fetch');
      const agent = await this.createProxyAgent(proxy);

      const response = await fetch(url, {
        method: 'HEAD',
        agent: agent as any,
        timeout: this.settings.timeout,
      });

      const latency = Date.now() - startTime;
      const status = response.status;
      const success = status >= 200 && status < 500 && status !== 407;

      if (success) {
        ProxyDatabase.update(proxyId, { enabled: true });
        ProxyDatabase.incrementSuccessNoReset(proxyId);
        console.log(`[ProxyManager] ✅ Proxy ${proxy.host}:${proxy.port} check OK (${status})`);
      } else {
        ProxyDatabase.update(proxyId, { enabled: false });
        ProxyDatabase.incrementFailed(proxyId);
        console.warn(`[ProxyManager] ❌ Proxy ${proxy.host}:${proxy.port} check FAIL (${status})`);
      }

      return { success, latency, status };
    } catch (error) {
      ProxyDatabase.update(proxyId, { enabled: false });
      ProxyDatabase.incrementFailed(proxyId);
      console.warn(`[ProxyManager] ❌ Proxy ${proxy.host}:${proxy.port} check error`, error);
      return { success: false, error: String(error) };
    }
  }

  async checkAllProxies(url: string = 'https://generativelanguage.googleapis.com'): Promise<{ checked: number; passed: number; failed: number }> {
    const proxies = ProxyDatabase.getAll();
    let passed = 0;
    let failed = 0;

    for (const proxy of proxies) {
      const result = await this.checkProxyConnectivity(proxy.id, url);
      if (result.success) {
        passed += 1;
      } else {
        failed += 1;
      }
    }

    return { checked: proxies.length, passed, failed };
  }

  /**
   * Import proxies từ JSON string hoặc array
   */
  importProxies(data: ProxyConfig[] | string): { added: number; skipped: number } {
    let proxiesToImport: ProxyConfig[] = [];
    
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        // Check if it's wrapped in {proxies: [...]} format
        proxiesToImport = Array.isArray(parsed) ? parsed : (parsed.proxies || []);
      } catch (e) {
        console.error('[ProxyManager] Lỗi parse JSON:', e);
        return { added: 0, skipped: 0 };
      }
    } else {
      proxiesToImport = data;
    }

    let added = 0;
    let skipped = 0;

    for (const proxy of proxiesToImport) {
      // Check duplicate
      const exists = ProxyDatabase.exists(proxy.host, proxy.port);
      if (exists) {
        skipped++;
        continue;
      }

      this.addProxy(proxy);
      added++;
    }

    console.log(`[ProxyManager] Import hoàn thành: ${added} added, ${skipped} skipped`);
    return { added, skipped };
  }

  /**
   * Export proxies
   */
  exportProxies(): string {
    const proxies = ProxyDatabase.getAll();
    return JSON.stringify({
      proxies: proxies,
      settings: this.settings,
    }, null, 2);
  }

  /**
   * Kiểm tra có nên fallback về direct connection không
   */
  shouldFallbackToDirect(): boolean {
    return this.settings.fallbackToDirect;
  }

  /**
   * Reset failed count của tất cả proxies
   */
  resetAllFailedCounts(): void {
    const proxies = ProxyDatabase.getAll();
    proxies.forEach(proxy => {
      ProxyDatabase.update(proxy.id, { failedCount: 0, enabled: true });
    });
    console.log('[ProxyManager] 🔄 Đã reset failed count của tất cả proxies');
  }
}

// Singleton instance
let instance: ProxyManager | null = null;

export function getProxyManager(): ProxyManager {
  if (!instance) {
    instance = new ProxyManager();
  }
  return instance;
}
