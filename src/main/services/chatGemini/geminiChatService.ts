/**
 * GeminiChatService - Quan ly cau hinh Gemini Chat (Web)
 * Luu tru trong SQLite database
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../database/schema';
import { getConfigurationService } from '../gemini/configurationService';
import { getSessionContextManager } from '../gemini/sessionContextManager';
import { getProxyManager } from '../proxy/proxyManager';
import { AppSettingsService } from '../appSettings';
import { ProxyConfig } from '../../../shared/types/proxy';
import { Impit } from 'impit';

// --- CONFIGURATION ---
// IMPORTANT: All values are now loaded from database (gemini_chat_config table)
// Use GeminiChatSettings UI to configure these values
// These fallback constants are DEPRECATED and will cause errors if database is empty

// HL_LANG (Host Language): Ngôn ngữ giao diện
// HL_LANG (Host Language): Ngôn ngữ giao diện
const HL_LANG = "vi";

// BROWSER PROFILES
// User-Agent + Platform + Sec-CH-UA presets to ensure consistency
const BROWSER_PROFILES = [
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        platform: "Windows",
        secChUa: `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
        secChUaPlatform: `"Windows"`
    },
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
        platform: "Windows",
        secChUa: `"Not_A Brand";v="8", "Chromium";v="121", "Microsoft Edge";v="121"`,
        secChUaPlatform: `"Windows"`
    },
    {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        platform: "macOS",
        secChUa: `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
        secChUaPlatform: `"macOS"`
    },
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
        platform: "Windows",
        secChUa: "", // Firefox often empty or different
        secChUaPlatform: `"Windows"`
    }
];

function getRandomBrowserProfile() {
    return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}


// Interface cho cau hinh Gemini Chat
export interface GeminiChatConfig {
  id: string;
  name: string;
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
    proxyId?: string;
  convId: string;
  respId: string;
  candId: string;
  reqId?: string;
  userAgent?: string;
  acceptLanguage?: string;
  platform?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// Interface de tao moi cau hinh
export interface CreateGeminiChatConfigDTO {
  name?: string;
  cookie: string;
  blLabel?: string;
  fSid?: string;
  atToken?: string;
    proxyId?: string;
  convId?: string;
  respId?: string;
  candId?: string;
  reqId?: string;
  userAgent?: string;
  acceptLanguage?: string;
  platform?: string;
}

// Interface de cap nhat cau hinh
export interface UpdateGeminiChatConfigDTO extends Partial<CreateGeminiChatConfigDTO> {
  isActive?: boolean;
}

// Interface cho cookie config (bảng riêng, chỉ 1 dòng) - DEPRECATED
export interface GeminiCookieConfig {
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  reqId?: string;
  updatedAt: number;
}

class GeminiChatServiceClass {
    private proxyAssignments = new Map<string, string>();
    private proxyInUse = new Set<string>();
    private proxyRotationIndex = 0;
    private readonly proxyMaxFailedCount = 2;
    private firstSendByTokenKey = new Set<string>();
    private tokenLocks = new Map<string, Promise<void>>();

    private async withTokenLock<T>(tokenKey: string, task: () => Promise<T>): Promise<T> {
        const previous = this.tokenLocks.get(tokenKey) || Promise.resolve();
        let release: () => void = () => {};
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        this.tokenLocks.set(tokenKey, previous.then(() => current));
        await previous;
        try {
            return await task();
        } finally {
            release();
            if (this.tokenLocks.get(tokenKey) === current) {
                this.tokenLocks.delete(tokenKey);
            }
        }
    }

    private buildTokenKey(_cookie: string, atToken: string): string {
        // User update: Do not compare cookie column because Google stores multiple accounts in one cookie.
        // Use atToken as the unique identifier.
        return (atToken || '').trim();
    }

    private getTokenKey(config: GeminiChatConfig): string {
        return this.buildTokenKey(config.cookie || '', config.atToken || '') || config.id;
    }

    checkDuplicateToken(cookie: string, atToken: string, excludeId?: string): { isDuplicate: boolean; duplicate?: GeminiChatConfig } {
        const tokenKey = this.buildTokenKey(cookie || '', atToken || '');
        // console.log(`[DEBUG] Check Duplicate - Input Key: '${tokenKey}', Exclude: ${excludeId}`);

        if (!tokenKey) {
            return { isDuplicate: false };
        }

        const configs = this.getAll();
        for (const config of configs) {
            if (excludeId && config.id === excludeId) continue;
            // Use same logic to build key for comparison
            const configKey = this.buildTokenKey(config.cookie || '', config.atToken || '');
            
            // console.log(`[DEBUG] Comparing with '${config.name}': '${configKey}'`);

            // Check for match
            if (configKey && configKey === tokenKey) {
                console.log(`[DEBUG] FOUND DUPLICATE: Input '${tokenKey}' == Config '${configKey}' (Name: ${config.name})`);
                return { isDuplicate: true, duplicate: config };
            }
        }

        return { isDuplicate: false };
    }

    private getAssignedProxyId(configId: string): string | null {
        if (!configId || configId === 'legacy') return null;
        try {
            const db = getDatabase();
            const row = db.prepare('SELECT proxy_id FROM gemini_chat_config WHERE id = ?').get(configId) as any;
            return row?.proxy_id || null;
        } catch (error) {
            console.warn('[GeminiChatService] Không thể đọc proxy_id từ DB:', error);
            return null;
        }
    }

    private setAssignedProxyId(configId: string, proxyId: string | null): void {
        if (!configId || configId === 'legacy') return;
        try {
            const db = getDatabase();
            db.prepare('UPDATE gemini_chat_config SET proxy_id = ?, updated_at = ? WHERE id = ?')
              .run(proxyId || null, Date.now(), configId);
        } catch (error) {
            console.warn('[GeminiChatService] Không thể lưu proxy_id vào DB:', error);
        }
    }

    private getAssignedProxyIds(excludeConfigId?: string): Set<string> {
        const assigned = new Set<string>();
        try {
            const db = getDatabase();
            const rows = db.prepare(`
                SELECT id, proxy_id FROM gemini_chat_config
                WHERE is_active = 1 AND proxy_id IS NOT NULL AND proxy_id != ''
            `).all() as any[];
            for (const row of rows) {
                if (excludeConfigId && row.id === excludeConfigId) continue;
                assigned.add(row.proxy_id);
            }
        } catch (error) {
            console.warn('[GeminiChatService] Không thể tải danh sách proxy_id đã gán:', error);
        }
        return assigned;
    }

    private getUseProxySetting(): boolean {
        try {
            const settings = AppSettingsService.getAll();
            return settings.useProxy;
        } catch (error) {
            console.warn('[GeminiChatService] Không tải được cài đặt proxy, dùng mặc định (bật)');
            return true;
        }
    }

    private async createProxyAgent(proxy: ProxyConfig | null, timeoutMs: number): Promise<any | undefined> {
        if (!proxy) return undefined;

        const { HttpsProxyAgent } = await import('https-proxy-agent');
        const { SocksProxyAgent } = await import('socks-proxy-agent');

        const proxyScheme = proxy.type === 'socks5' ? 'socks5h' : proxy.type;
        const proxyUrl = proxy.username
            ? `${proxyScheme}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
            : `${proxyScheme}://${proxy.host}:${proxy.port}`;

        if (proxy.type === 'socks5') {
            return new SocksProxyAgent(proxyUrl, { timeout: timeoutMs });
        }

        return new HttpsProxyAgent(proxyUrl, {
            timeout: timeoutMs,
            rejectUnauthorized: false,
            keepAlive: false,
        });
    }

    private async fetchWithProxy(
        url: string,
        fetchOptions: any,
        timeoutMs: number,
        accountKey: string,
        useProxyOverride?: boolean
    ): Promise<{ response: any; usedProxy: ProxyConfig | null }> {
        const setting = this.getUseProxySetting();
        const useProxy = typeof useProxyOverride === 'boolean' ? useProxyOverride : setting;
        
        console.log(`[GeminiChatService] fetchWithProxy - Override: ${useProxyOverride}, Setting: ${setting}, Final: ${useProxy}`);

        const proxyManager = getProxyManager();
        let currentProxy: ProxyConfig | null = null;

        if (useProxy) {
            currentProxy = this.getOrAssignProxy(accountKey);
            if (!currentProxy) {
                throw new Error('Không còn proxy khả dụng');
            }
        }

        const { default: fetch } = await import('node-fetch');

        try {
            const agent = await this.createProxyAgent(currentProxy, timeoutMs);
            const response = await fetch(url, { ...fetchOptions, ...(agent ? { agent } : {}) });

            if (response.ok) {
                if (currentProxy) {
                    proxyManager.markProxySuccess(currentProxy.id);
                    if (accountKey && accountKey !== 'legacy') {
                        this.setAssignedProxyId(accountKey, currentProxy.id);
                    }
                }
                return { response, usedProxy: currentProxy };
            }

            if (currentProxy) {
                proxyManager.markProxyFailed(currentProxy.id, `HTTP ${response.status}`);
                if (accountKey && accountKey !== 'legacy') {
                    this.setAssignedProxyId(accountKey, null);
                }
                this.releaseProxy(accountKey, currentProxy.id);
            }

            return { response, usedProxy: currentProxy };
        } catch (error: any) {
            if (currentProxy) {
                proxyManager.markProxyFailed(currentProxy.id, error?.message || String(error));
                if (accountKey && accountKey !== 'legacy') {
                    this.setAssignedProxyId(accountKey, null);
                }
                this.releaseProxy(accountKey, currentProxy.id);
            }

            throw error;
        }
    }

    private getOrAssignProxy(accountKey: string): ProxyConfig | null {
        const assignedIdInMemory = this.proxyAssignments.get(accountKey);

        if (assignedIdInMemory) {
            const assigned = this.getAvailableProxies().find(p => p.id === assignedIdInMemory);
            if (assigned) {
                return assigned;
            }
            this.releaseProxy(accountKey, assignedIdInMemory);
        }

        if (accountKey && accountKey !== 'legacy') {
            const assignedId = this.getAssignedProxyId(accountKey);
            if (assignedId) {
                const assignedIds = this.getAssignedProxyIds(accountKey);
                if (assignedIds.has(assignedId)) {
                    console.warn('[GeminiChatService] Proxy đã gán bị trùng với cấu hình khác, sẽ gán lại');
                    this.setAssignedProxyId(accountKey, null);
                } else {
                const assignedProxy = this.getAvailableProxies().find(p => p.id === assignedId);
                if (assignedProxy) {
                    if (!this.proxyInUse.has(assignedProxy.id)) {
                        this.proxyAssignments.set(accountKey, assignedProxy.id);
                        this.proxyInUse.add(assignedProxy.id);
                        return assignedProxy;
                    }
                    console.warn(`[GeminiChatService] Proxy đã gán đang được dùng bởi tài khoản khác: ${assignedProxy.host}:${assignedProxy.port}`);
                } else {
                    this.setAssignedProxyId(accountKey, null);
                }
                }
            }
        }

        const assignedIds = this.getAssignedProxyIds(accountKey);
        let available = this.getAvailableProxies().filter(p => !this.proxyInUse.has(p.id) && !assignedIds.has(p.id));
        if (available.length === 0) {
            console.warn('[GeminiChatService] Không còn proxy trống chưa gán, fallback sang proxy khả dụng khác');
            available = this.getAvailableProxies().filter(p => !this.proxyInUse.has(p.id));
        }

        if (available.length === 0) {
            console.warn(`[GeminiChatService] Không còn proxy trống cho tài khoản ${accountKey}`);
            return null;
        }

        const proxy = available[this.proxyRotationIndex % available.length];
        this.proxyRotationIndex = (this.proxyRotationIndex + 1) % available.length;

        this.proxyAssignments.set(accountKey, proxy.id);
        this.proxyInUse.add(proxy.id);
        if (accountKey && accountKey !== 'legacy') {
            this.setAssignedProxyId(accountKey, proxy.id);
        }
        return proxy;
    }

    private releaseProxy(accountKey: string, proxyId: string): void {
        const assignedId = this.proxyAssignments.get(accountKey);
        if (assignedId === proxyId) {
            this.proxyAssignments.delete(accountKey);
        }
        this.proxyInUse.delete(proxyId);
    }

    private getAvailableProxies(): ProxyConfig[] {
        const proxyManager = getProxyManager();
        const allProxies = proxyManager.getAllProxies();
        return allProxies.filter(p => p.enabled && (p.failedCount || 0) < this.proxyMaxFailedCount);
    }

    private getStoredTokenContext(tokenKey: string, configId?: string): { conversationId: string; responseId: string; choiceId: string } | null {
        if (!tokenKey) return null;
        try {
            const db = getDatabase();
            const row = db.prepare('SELECT conversation_id, response_id, choice_id FROM gemini_chat_context_token WHERE token_key = ?').get(tokenKey) as any;
            if (row) {
                return {
                    conversationId: row.conversation_id || '',
                    responseId: row.response_id || '',
                    choiceId: row.choice_id || ''
                };
            }
        } catch (error) {
            console.warn('[GeminiChatService] Không thể tải ngữ cảnh token từ DB:', error);
        }

        if (!configId || configId === 'legacy') return null;
        try {
            const db = getDatabase();
            const row = db.prepare('SELECT conversation_id, response_id, choice_id FROM gemini_chat_context WHERE config_id = ?').get(configId) as any;
            if (!row) return null;
            return {
                conversationId: row.conversation_id || '',
                responseId: row.response_id || '',
                choiceId: row.choice_id || ''
            };
        } catch (error) {
            console.warn('[GeminiChatService] Không thể tải ngữ cảnh cấu hình từ DB:', error);
            return null;
        }
    }

    private getStoredConfigContext(configId?: string): { conversationId: string; responseId: string; choiceId: string } | null {
        if (!configId || configId === 'legacy') return null;
        try {
            const db = getDatabase();
            const row = db.prepare('SELECT conversation_id, response_id, choice_id FROM gemini_chat_context WHERE config_id = ?').get(configId) as any;
            if (!row) return null;
            return {
                conversationId: row.conversation_id || '',
                responseId: row.response_id || '',
                choiceId: row.choice_id || ''
            };
        } catch (error) {
            console.warn('[GeminiChatService] Không thể tải ngữ cảnh cấu hình từ DB:', error);
            return null;
        }
    }

    private saveStoredTokenContext(
        tokenKey: string,
        context: { conversationId: string; responseId: string; choiceId: string },
        configId?: string
    ): void {
        if (!tokenKey) return;
        try {
            const db = getDatabase();
            db.prepare(`
                INSERT OR REPLACE INTO gemini_chat_context_token (token_key, conversation_id, response_id, choice_id, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                tokenKey,
                context.conversationId || '',
                context.responseId || '',
                context.choiceId || '',
                Date.now()
            );
        } catch (error) {
            console.warn('[GeminiChatService] Không thể lưu ngữ cảnh token vào DB:', error);
        }

        if (!configId || configId === 'legacy') return;
        try {
            const db = getDatabase();
            db.prepare(`
                INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                configId,
                context.conversationId || '',
                context.responseId || '',
                context.choiceId || '',
                Date.now()
            );
        } catch (error) {
            console.warn('[GeminiChatService] Không thể lưu ngữ cảnh cấu hình vào DB:', error);
        }
    }
  // Helper: Generate initial REQ_ID (Random Prefix + Fixed 4-digit Suffix logic)
  // Format matches log: e.g. 4180921 (7 digits)
  // We want range approx 3000000 - 5000000 initially, with random 4 digits at end.
  private generateInitialReqId(): string {
       const prefix = Math.floor(Math.random() * (45 - 30) + 30); // 30-45
       const suffix = Math.floor(Math.random() * 9000 + 1000); // 1000-9999
       // Formula: prefix * 100000 + suffix. 
       // Note: This logic places suffix at the end, but the increment of 100,000 adds to the higher digits, preserving the suffix.
       // Example: 30 * 100000 + 1234 = 3001234. Next: 3101234. Suffix 1234 preserved.
       return String(prefix * 100000 + suffix);
  }

    private buildRequestPayload(
        message: string,
        contextArray: [string, string, string],
        createChatOnWeb: boolean
    ): string {
        if (!createChatOnWeb) {
            const innerPayload = [
                [message],
                null,
                contextArray
            ];

            return JSON.stringify([null, JSON.stringify(innerPayload)]);
        }

        const reqUuid = uuidv4().toUpperCase();
        const reqStruct = [
            [message, 0, null, null, null, null, 0],
            ["vi"],
            [contextArray[0], contextArray[1], contextArray[2], null, null, null, null, null, null, ""],
            "!BwSlBFzNAAZeabWMfmlCAOK4lSpy-nY7ADQBEArZ1HXWr3pDagC9VZ5CWddxxlroONpL-a5eGEHXpYjZYEboidltqN627255ouWfutqSAgAAAEtSAAAAAmgBB34AQf7Z0X4QHk8aehxZTrwdWe2_4ynoojTI3Dop9DkAR1EzMlT4nLjH65NoKYTZj-WO50CGSm_ENmZpEvP--1D_FnyJmQOvlsPu3GfxD62pT5siALsF-4-Jm1LJY4I7jLertSMjtvs1_R710Z6lSHhM4PuGaaOUrRMj8-UOBqCgscsTETggz3x_ju7ACGPssxINDSYvXK5XenYexuBblk9vytrqyB1E7Ntp2kHlZanL2GAf_WCWa_Zaev2j2C23Oip1rZNMfLeSnBCAy_P5w2UR5lwYfVuKIXGhG8LWt-00k1K49MV6DiTItqYyH3OC5qOmokpnUyLMrnobu3z5H9FUxZMxNjbGsl0DmDiINJQnrO7vjppHyuMrLYECDdkptAlDsQRYOcJRuazOowdqTlUwz283lg7hNoX_D4QUUG5zt2TAsrXsbFWlacIN5SeNjqlHha9tXvXB77DbcR_CzwZbF8gju5SA8ruxleoUzapriHFEXs5Ipz1c2UvB5ph1_C3PYi4ER-Dl7ykEgBZooOJPEL_4QPq4gd20gvvYiwLVeM1BiwisfZT13sJ1vhbB1XIeakQKA1Ikalf7PoCZ5tjwxn9Zsz1rRJtSSX_wfvb-lrat3XPCyjA_a-JKE-DLhIHChbouYIlTlvMT25nmWE5jemyvCj_KdHRWg0XE3wQt8jD2zmrgl8JNRygbJy9Llmfv_FAAy4TRmddSQGjpNnnTvTioiO4ydPNXFfq_M78_DxeGl56mdVf15JBZ-tqReaDDr4ltrkO09MX_CUY1cZvIqt3_QrgakGGnjc3tVZzRl2gYZ5vJBQa_pHObKly8kEQLMAYnOzB943fHjijMkw1jW1Hg7gYDEIuBPiN8mLIkl73oDPeMJSwsn4PwNm5K6V6blTxQVNylGLGlp5E5mmV92Az-bY-LqLCqTIEs0Ajd-CimLvQPTEXuMsFliaCxXsLbxrdSdrPkYIPSVUQDj7bdCs9CXo2MjPIwjHVPCmI5Cb8WPs6hu1fbYHTxLthzRejxEFdmZ0RakYqKOZFetMpzA8QN0HJ7ZIR9eA8VM4r6CB0YO0FKZcQmAHNjBPHyAqXnNZNgrZDwknPWttn9QiZH51MIBe5Hk3-zzQUvJ5fPlJlkWkd4VPzCroOIBtk6aduceg2-YQt4N701ghkxfFZ-k-blbUeFvZGIgMfbWWeJRRdrRWrrWgdT0FXT_jhJV1XA5bwZcy1X-ykmlE2CAvb1BQMUdY9YE_mJMvowLakNeo0r7Q4FOoVyu-cVhrQl7iHDmHEspUGbpa91q-7KKL0AUYxLahYd8giy5o_45o-rD1y0asaFRBhh3R0j__zg2sa1i1AA2A",
            "7f64e8c4aa4819e0a1a684fd7e6f5f9b",
            null,
            [1],
            1,
            null,
            null,
            1,
            0,
            null,
            null,
            null,
            null,
            null,
            [[0]],
            0,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            1,
            null,
            null,
            [4],
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            [1],
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            0,
            null,
            null,
            null,
            null,
            null,
            reqUuid,
            null,
            [],
            null,
            null,
            null,
            null,
            [1769584568, 497000000],
            null,
            2
        ];

        return JSON.stringify([null, JSON.stringify(reqStruct)]);
    }

  // Round-robin rotation index for cycling through active configs
  private rotationIndex = 0;

  // =======================================================
  // COOKIE CONFIG (Bảng riêng, chỉ 1 dòng)
  // =======================================================
  
  getCookieConfig(): GeminiCookieConfig | null {
    const db = getDatabase();
    const configService = getConfigurationService(db);
    return configService.getActiveConfig();
  }

  saveCookieConfig(config: { cookie: string; blLabel: string; fSid: string; atToken: string; reqId?: string }): boolean {
    const db = getDatabase();
    const configService = getConfigurationService(db);
    const result = configService.saveConfig(config);
    return result.success;
  }

  updateReqId(reqId: string): boolean {
    const db = getDatabase();
    const configService = getConfigurationService(db);
    const result = configService.updateReqId(reqId);
    return result.success;
  }

  // =======================================================
  // ROUND-ROBIN ROTATION (similar to geminiService.ts)
  // =======================================================
  
  /**
   * Get next active config in round-robin order
   * Returns null if no active configs available
   */
  getNextActiveConfig(): GeminiChatConfig | null {
    const activeConfigs = this.getAll().filter(c => c.isActive);
    
    if (activeConfigs.length === 0) {
      console.warn('[GeminiChatService] No active configs available for rotation');
      return null;
    }
    
    // Get next config using round-robin
    const config = activeConfigs[this.rotationIndex % activeConfigs.length];
    this.rotationIndex = (this.rotationIndex + 1) % activeConfigs.length;
    
    console.log(`[GeminiChatService] Đã chọn cấu hình luân phiên: ${config.name} (${this.rotationIndex}/${activeConfigs.length})`);
    return config;
  }

  // =======================================================
  // OLD CONFIG METHODS (gemini_chat_config table)
  // =======================================================

  // Lay tat ca cau hinh
  getAll(): GeminiChatConfig[] {
    const db = getDatabase();
    // Wrap in try-catch to be safe, though not strictly necessary if schema exists
    try {
        const rows = db.prepare('SELECT * FROM gemini_chat_config ORDER BY updated_at DESC').all();
        return rows.map(this.mapRow);
    } catch (e) {
        console.error("Error get all", e);
        return [];
    }
  }

  // Lay cau hinh dang active
  getActive(): GeminiChatConfig | null {
    const db = getDatabase();
    try {
        const row = db.prepare('SELECT * FROM gemini_chat_config WHERE is_active = 1 LIMIT 1').get();
        return row ? this.mapRow(row) : null;
    } catch (e) {
        return null;
    }
  }

  // Lay cau hinh theo ID
  getById(id: string): GeminiChatConfig | null {
    const db = getDatabase();
    try {
        const row = db.prepare('SELECT * FROM gemini_chat_config WHERE id = ?').get(id);
        return row ? this.mapRow(row) : null;
    } catch (e) {
        return null;
    }
  }

  // Tao moi cau hinh
  create(data: CreateGeminiChatConfigDTO): GeminiChatConfig {
    const db = getDatabase();
    const now = Date.now();
    const id = uuidv4();

    // Deactivate cau hinh cu neu dang tao cau hinh moi
    try {
        
        // Auto-assign random browser profile if not provided
        const profile = getRandomBrowserProfile();
        console.log('[GeminiChatService] Creating config with profile:', data.userAgent ? 'Custom' : profile.platform);

        db.prepare(`
        INSERT INTO gemini_chat_config (
            id, name, cookie, bl_label, f_sid, at_token, proxy_id,
            conv_id, resp_id, cand_id, req_id, 
            user_agent, accept_language, platform,
            is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
        id,
        data.name || 'default',
        data.cookie,
        data.blLabel || '',
        data.fSid || '',
        data.atToken || '',
        data.proxyId || null,
        data.convId || '',
        data.respId || '',
        data.candId || '',
        data.reqId || this.generateInitialReqId(),
        data.userAgent || profile.userAgent,
        data.acceptLanguage || null,
        data.platform || profile.platform,
        now,
        now
        );
    } catch (e) {
        console.error("Error creating", e);
        throw e;
    }

    console.log('[GeminiChatService] Da tao cau hinh moi:', id);
    return this.getById(id)!;
  }

  // Cap nhat cau hinh
  // Cap nhat cau hinh
  update(id: string, data: UpdateGeminiChatConfigDTO): GeminiChatConfig | null {
    const db = getDatabase();
    const existing = this.getById(id);
    if (!existing) {
      console.error('[GeminiChatService] Khong tim thay cau hinh:', id);
      return null;
    }

    const now = Date.now();
    const updates: string[] = ['updated_at = @updated_at'];
    const params: any = { updated_at: now, id: id };

    if (data.name !== undefined) { updates.push('name = @name'); params.name = data.name; }
    
    if (data.cookie !== undefined) { updates.push('cookie = @cookie'); params.cookie = data.cookie; }
    if (data.blLabel !== undefined) { updates.push('bl_label = @blLabel'); params.blLabel = data.blLabel; }
    if (data.fSid !== undefined) { updates.push('f_sid = @fSid'); params.fSid = data.fSid; }
    if (data.atToken !== undefined) { updates.push('at_token = @atToken'); params.atToken = data.atToken; }
    if (data.proxyId !== undefined) { updates.push('proxy_id = @proxyId'); params.proxyId = data.proxyId; }
    if (data.convId !== undefined) { updates.push('conv_id = @convId'); params.convId = data.convId; }
    if (data.respId !== undefined) { updates.push('resp_id = @respId'); params.respId = data.respId; }
    if (data.convId !== undefined) { updates.push('conv_id = @convId'); params.convId = data.convId; }
    if (data.respId !== undefined) { updates.push('resp_id = @respId'); params.respId = data.respId; }
    if (data.candId !== undefined) { updates.push('cand_id = @candId'); params.candId = data.candId; }
    if (data.reqId !== undefined) { updates.push('req_id = @reqId'); params.reqId = data.reqId; }
    
    if (data.isActive !== undefined) {
      // NOTE: Allow multiple active configs for rotation
      // if (data.isActive) {
      //   db.prepare('UPDATE gemini_chat_config SET is_active = 0').run();
      // }
      updates.push('is_active = @isActive');
      params.isActive = data.isActive ? 1 : 0;
    }

    if (data.userAgent !== undefined) { updates.push('user_agent = @userAgent'); params.userAgent = data.userAgent; }
    if (data.acceptLanguage !== undefined) { updates.push('accept_language = @acceptLanguage'); params.acceptLanguage = data.acceptLanguage; }
    if (data.platform !== undefined) { updates.push('platform = @platform'); params.platform = data.platform; }

    const sql = `UPDATE gemini_chat_config SET ${updates.join(', ')} WHERE id = @id`;
    
    // Debug logging
    // console.log('[GeminiChatService] Updating config:', id);
    // console.log('[GeminiChatService] SQL:', sql);
    // console.log('[GeminiChatService] Params:', params);

    try {
        db.prepare(sql).run(params);
    } catch (e) {
        console.error('[GeminiChatService] Update Failed:', e);
        throw e;
    }

    return this.getById(id);
  }

  // Xoa cau hinh
  delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM gemini_chat_config WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Map row tu database sang object
  private mapRow(row: any): GeminiChatConfig {
    return {
      id: row.id,
      name: row.name,
      cookie: row.cookie,
      blLabel: row.bl_label,
      fSid: row.f_sid,
      atToken: row.at_token,
    proxyId: row.proxy_id || undefined,
      convId: row.conv_id,
      respId: row.resp_id,
      candId: row.cand_id,
      reqId: row.req_id,
      userAgent: row.user_agent,
      acceptLanguage: row.accept_language,
      platform: row.platform,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // =======================================================
  // GUI TIN NHAN DEN GEMINI WEB API - STRICT PYTHON PORT
  // =======================================================

  async sendMessage(message: string, configId: string, context?: { conversationId: string; responseId: string; choiceId: string }, useProxyOverride?: boolean): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string; configId?: string }> {
        const MAX_RETRIES = 3;
        const MIN_DELAY_MS = 2000;
        const MAX_DELAY_MS = 10000;

        // CONFIG SELECTION LOGIC
        let config: GeminiChatConfig | null = null;

        if (configId) {
                // Case 1: Use specific config
                config = this.getById(configId);
                if (!config) {
                        console.error(`[GeminiChatService] Không tìm thấy cấu hình ID ${configId}.`);
                         return { success: false, error: `Không tìm thấy cấu hình ID ${configId}` };
                }
                if (!config.isActive) {
                    console.warn(`[GeminiChatService] Cấu hình ID ${configId} đang tắt, bỏ qua.`);
                    return { success: false, error: 'Cấu hình đang tắt, không được sử dụng' };
                }
        } else {
                // Case 2: Round-robin rotation (getNextActiveConfig)
                config = this.getNextActiveConfig();
                if (!config) {
                         // Fallback to legacy cookie config (mapped to GeminiChatConfig structure)
                         const cookieConfig = this.getCookieConfig();
                         if (cookieConfig) {
                                 // Map legacy to new structure just for runtime use
                                 config = {
                                         id: 'legacy',
                                         name: 'Legacy Cookie',
                                         ...cookieConfig,
                                         isActive: true,
                                         createdAt: Date.now(),
                                         updatedAt: Date.now()
                                 } as GeminiChatConfig;
                         } else {
                                 return { success: false, error: 'Không có cấu hình web đang hoạt động.' };
                         }
                }
        }

        const tokenKey = this.getTokenKey(config);
        console.log(`[GeminiChatService] Gửi yêu cầu bằng cấu hình: ${config.name} (ID: ${config.id}, TokenKey: ${tokenKey.slice(0, 16)}...)`);

        return await this.withTokenLock(tokenKey, async () => {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                console.log(`[GeminiChatService] Đang gửi tin nhắn (Lần ${attempt}/${MAX_RETRIES})...`);

                const result = await this._sendMessageInternal(message, config!, context, useProxyOverride);

                if (result.success) {
                    return { ...result, configId: config!.id };
                }

                if (result.error && result.error.includes('Không còn proxy khả dụng')) {
                    console.error('[GeminiChatService] Dừng retry do hết proxy khả dụng');
                    return { ...result, configId: config!.id };
                }

                // If failed, check if we should retry
                if (attempt < MAX_RETRIES) {
                    const retryDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
                    console.log(`[GeminiChatService] Yêu cầu thất bại, thử lại sau ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    console.error(`[GeminiChatService] Tất cả ${MAX_RETRIES} lần thử đều thất bại.`);
                    return { ...result, configId: config!.id }; // Return last error
                }
            }

            return { success: false, error: 'Unexpected error in retry loop' };
        });
    }

    private async _sendMessageInternal(message: string, config: GeminiChatConfig, context?: { conversationId: string; responseId: string; choiceId: string }, useProxyOverride?: boolean): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string }> {
    const { cookie, blLabel, fSid, atToken } = config;
    
    // Validate required fields
    if (!cookie || !blLabel || !fSid || !atToken) {
        const missing = [];
        if (!cookie) missing.push('cookie');
        if (!blLabel) missing.push('blLabel');
        if (!fSid) missing.push('fSid');
        if (!atToken) missing.push('atToken');
        return { success: false, error: `Missing required config fields: ${missing.join(', ')}` };
    }

    // CHECK & PERSIST BROWSER PROFILE (Important: 1 token = 1 persistent browser)
    if (!config.userAgent || !config.platform) {
        console.warn(`[GeminiChatService] Cấu hình ${config.id} thiếu hồ sơ trình duyệt. Đang gán hồ sơ cố định...`);
        const profile = getRandomBrowserProfile();
        
        // Update local object
        config.userAgent = profile.userAgent;
        config.platform = profile.platform;
        
        // Update DB immediately
        if (config.id !== 'legacy') {
            try {
                const db = getDatabase();
                db.prepare('UPDATE gemini_chat_config SET user_agent = ?, platform = ? WHERE id = ?')
                  .run(profile.userAgent, profile.platform, config.id);
            } catch (e) {
                console.error('[GeminiChatService] Không thể lưu hồ sơ trình duyệt', e);
            }
        }
    }

    const hl = config.acceptLanguage ? config.acceptLanguage.split(',')[0] : HL_LANG;
    // Find matching profile for headers (fallback if custom)
    const matchingProfile = BROWSER_PROFILES.find(p => p.userAgent === config.userAgent) || BROWSER_PROFILES[0];
    const secChUa = matchingProfile.secChUa;
    const secChUaPlatform = config.platform ? `"${(config.platform || '').trim().replace(/[\r\n]+/g, '')}"` : matchingProfile.secChUaPlatform;
    const safeCookie = (cookie || '').replace(/[\r\n]+/g, '');
    
    // REQ_ID Logic: Load from config (if saved) else generate
    let currentReqIdStr = config.reqId;
    
    // If missing, generate new
    if (!currentReqIdStr) {
        currentReqIdStr = this.generateInitialReqId();
    }

    // Increment by 100,000 (Preserves last 4-5 digits)
    const nextReqIdNum = parseInt(currentReqIdStr) + 100000;
    const reqId = String(nextReqIdNum);

    // Save back to DB (if it's a real stored config)
    if (config.id !== 'legacy') {
        try {
            const db = getDatabase();
            db.prepare('UPDATE gemini_chat_config SET req_id = ? WHERE id = ?').run(reqId, config.id);
            // Update local object too
            config.reqId = reqId; 
        } catch (e) {
            console.warn('[GeminiChatService] Không thể cập nhật req_id trong DB', e);
        }
    }
    // console.log(`[GeminiChatService] Updated REQ_ID: ${currentReqIdStr} -> ${reqId}`);

    // Flash Model setup removed

    // Payload logic from python: [ [message], null, ["conversation_id", "response_id", "choice_id"] ]
    const tokenKey = this.getTokenKey(config);
    const appSettings = AppSettingsService.getAll();
    const allowStoredContextOnFirstSend = !!appSettings.useStoredContextOnFirstSend;
    const isFirstSendForToken = !this.firstSendByTokenKey.has(tokenKey);
    const canUseStoredContext = !isFirstSendForToken || allowStoredContextOnFirstSend;
    const shouldIgnoreIncomingContext = isFirstSendForToken && !allowStoredContextOnFirstSend;
    const incomingContext = shouldIgnoreIncomingContext ? undefined : context;
    const configContext = this.getStoredConfigContext(config.id);
    const tokenContext = this.getStoredTokenContext(tokenKey, config.id);
    let storedContext: { conversationId: string; responseId: string; choiceId: string } | null = null;
    if (!incomingContext && canUseStoredContext) {
        if (isFirstSendForToken && allowStoredContextOnFirstSend) {
            storedContext = configContext;
        } else if (!isFirstSendForToken) {
            storedContext = tokenContext || configContext;
        }
    }
    const effectiveContext = incomingContext || storedContext || undefined;

    let contextArray: [string, string, string] = ["", "", ""];
    if (effectiveContext) {
        contextArray = [effectiveContext.conversationId, effectiveContext.responseId, effectiveContext.choiceId];
        const contextInfo = {
            conversationId: effectiveContext.conversationId ? `${String(effectiveContext.conversationId).slice(0, 24)}...` : '',
            responseId: effectiveContext.responseId ? `${String(effectiveContext.responseId).slice(0, 24)}...` : '',
            choiceId: effectiveContext.choiceId ? `${String(effectiveContext.choiceId).slice(0, 24)}...` : ''
        };
        console.log('[GeminiChatService] Dùng ngữ cảnh (tóm tắt):', contextInfo);
    } else if (isFirstSendForToken && !incomingContext) {
        if (allowStoredContextOnFirstSend) {
            if (configContext) {
                console.log('[GeminiChatService] Lần đầu gửi cho token, dùng ngữ cảnh cũ của cấu hình');
            } else {
                console.log('[GeminiChatService] Lần đầu gửi cho token, cấu hình chưa có ngữ cảnh -> dùng ngữ cảnh rỗng');
            }
        } else {
            console.log('[GeminiChatService] Lần đầu gửi cho token, dùng ngữ cảnh rỗng');
        }
    }

    const createChatOnWeb = !!appSettings.createChatOnWeb;
    const fReq = this.buildRequestPayload(message, contextArray, createChatOnWeb);

    const baseUrl = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
    
    const params = new URLSearchParams({
        "bl": blLabel,
        "_reqid": reqId,
        "rt": "c",
        "f.sid": fSid,
        "hl": hl
    });

    const url = `${baseUrl}?${params.toString()}`;

    const body = new URLSearchParams(
        createChatOnWeb
            ? {
                "f.req": fReq,
                "at": atToken
            }
            : {
                "f.req": fReq,
                "at": atToken,
                "": "" // Empty param như trong HAR
            }
    );

    try {
        console.log('[GeminiChatService] Đang gửi request:', url);
        // console.log('[GeminiChatService] >>> fetch START');
        
        let headers: Record<string, string> = {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "cookie": safeCookie,
            "user-agent": (config.userAgent || matchingProfile.userAgent || '').trim().replace(/[\r\n]+/g, '')
        };

        if (!createChatOnWeb) {
            headers = {
                ...headers,
                "accept": "*/*",
                "accept-encoding": "gzip, deflate, br, zstd",
                "accept-language": config.acceptLanguage || "vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6,zh-CN;q=0.5,zh;q=0.4",
                "cache-control": "no-cache",
                "origin": "https://gemini.google.com",
                "pragma": "no-cache",
                "referer": "https://gemini.google.com/",
                "sec-ch-ua-arch": "\"x86\"",
                "sec-ch-ua-bitness": "\"64\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": secChUaPlatform,
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "x-goog-ext-525001261-jspb": "[1,null,null,null,\"fbb127bbb056c959\",null,null,0,[4],null,null,1]",
                "x-goog-ext-525005358-jspb": "[\"6F392C2C-0CA3-4CF5-B504-2BE013DD0723\",1]",
                "x-goog-ext-73010989-jspb": "[0]",
                "x-same-domain": "1"
            };

            if (secChUa) {
                headers["sec-ch-ua"] = secChUa;
            }
        }

                const MAX_CONTROL_RETRIES = 2;
                for (let controlAttempt = 1; controlAttempt <= MAX_CONTROL_RETRIES; controlAttempt++) {
                    const { response, usedProxy } = await this.fetchWithProxy(
                        url,
                        {
                            method: 'POST',
                            headers,
                            body: body.toString()
                        },
                        15000,
                        config.id,
                        useProxyOverride
                    );

                    console.log('[GeminiChatService] >>> Kết thúc fetch, trạng thái:', response.status);

                    if (!response.ok) {
                        const txt = await response.text();
                        console.error("[GeminiChatService] Lỗi Gemini:", response.status, txt.substring(0, 200));
                        return { success: false, error: `HTTP ${response.status}` };
                    }

                    console.log('[GeminiChatService] >>> Đang tải toàn bộ nội dung phản hồi (Waiting for response)...');
                    
                    // --- STREAMING PROCESSING (NEW) ---
                    let foundText = '';
                    let hasWrbFr = false;
                    let hasContentPayload = false;
                    
                    // Variables for streaming
                    let buffer = '';
                    let totalBytesRead = 0;
                    const sessionManager = getSessionContextManager();
                    let newContext = { conversationId: '', responseId: '', choiceId: '' };

                    try {
                        // @ts-ignore: node-fetch body as async iterator
                        for await (const chunk of response.body) {
                            const chunkString = chunk.toString();
                            buffer += chunkString;
                            totalBytesRead += chunkString.length;
                            
                            // Log tiến độ (tùy chọn)
                            // if (totalBytesRead % 500000 === 0) console.log(`[GeminiChatService] Đã nhận ${totalBytesRead} bytes...`);

                            let newlineIndex;
                            while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
                                const line = buffer.slice(0, newlineIndex).trim();
                                buffer = buffer.slice(newlineIndex + 1);

                                if (!line) continue;
                                if (line.startsWith(")]}'")) continue;
                                if (/^\d+$/.test(line)) continue;

                                try {
                                    const dataObj = JSON.parse(line);
                                    if (!Array.isArray(dataObj) || dataObj.length === 0) continue;

                                    for (const payloadItem of dataObj) {
                                        if (!Array.isArray(payloadItem) || payloadItem.length < 3) continue;
                                        if (payloadItem[0] !== 'wrb.fr') continue;
                                        hasWrbFr = true;
                                        if (typeof payloadItem[2] !== 'string') continue;

                                        const innerData = JSON.parse(payloadItem[2]);
                                        if (!Array.isArray(innerData) || innerData.length < 5) continue;

                                        const candidates = innerData[4];
                                        if (Array.isArray(candidates) && candidates.length > 0) {
                                            const candidate = candidates[0];
                                            if (candidate && candidate.length > 1) {
                                                const textSource = candidate[1];
                                                const txt = Array.isArray(textSource) ? textSource[0] : textSource;
                                                if (typeof txt === 'string' && txt) {
                                                    // QUAN TRỌNG: Google gửi text tích lũy (snapshot)
                                                    if (txt.length > foundText.length) {
                                                        foundText = txt; 
                                                        hasContentPayload = true;
                                                    }
                                                }
                                            }
                                        }
                                        
                                        // Update context on the fly
                                        const parsedCtx = sessionManager.parseFromFetchResponse(line);
                                        if (parsedCtx.conversationId) newContext.conversationId = parsedCtx.conversationId;
                                        if (parsedCtx.responseId) newContext.responseId = parsedCtx.responseId;
                                        if (parsedCtx.choiceId) newContext.choiceId = parsedCtx.choiceId;
                                    }
                                } catch (e) { }
                            }
                        }
                        console.log(`[GeminiChatService] >>> Streaming hoàn tất. Tổng cộng: ${totalBytesRead} bytes.`);
                    } catch (streamError) {
                         console.error('[GeminiChatService] Lỗi khi streaming:', streamError);
                    }
                    
                    // --- OLD BLOCK (COMMENTED OUT FOR PERFORMANCE CHECK) ---
                    /*
                    const responseText = await response.text();
                    console.log(`[GeminiChatService] >>> Tải xong. Độ dài: ${responseText.length} bytes. Đang xử lý...`);
                    
                    // DEBUG: Dump response to file for inspection
                    try {
                        const fs = require('fs');
                        const path = require('path');
                        const os = require('os');
                        const dumpPath = path.join(os.homedir(), 'gemini_response_dump.txt');
                        fs.writeFileSync(dumpPath, responseText);
                        console.log(`[GeminiChatService] Đã lưu log phản hồi vào: ${dumpPath}`);
                    } catch (e) {
                        console.error('[GeminiChatService] Không thể lưu log phản hồi:', e);
                    }
                    // let foundText = '';
                    // let hasWrbFr = false;
                    // let hasContentPayload = false;

                    for (const line of responseText.split('\n')) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        if (trimmed.startsWith(")]}'")) continue;
                        if (/^\d+$/.test(trimmed)) continue;
    
                        try {
                            const dataObj = JSON.parse(trimmed);
                            if (!Array.isArray(dataObj) || dataObj.length === 0) continue;
    
                            for (const payloadItem of dataObj) {
                                if (!Array.isArray(payloadItem) || payloadItem.length < 3) continue;
                                if (payloadItem[0] !== 'wrb.fr') continue;
                                hasWrbFr = true;
                                if (typeof payloadItem[2] !== 'string') continue;
    
                                const innerData = JSON.parse(payloadItem[2]);
                                if (!Array.isArray(innerData) || innerData.length < 5) continue;
    
                                const candidates = innerData[4];
                                if (Array.isArray(candidates) && candidates.length > 0) {
                                    const candidate = candidates[0];
                                    if (candidate && candidate.length > 1) {
                                        const textSource = candidate[1];
                                        const txt = Array.isArray(textSource) ? textSource[0] : textSource;
                                        if (typeof txt === 'string' && txt) {
                                            foundText = txt;
                                            hasContentPayload = true;
                                        }
                                    }
                                }
                            }
                        } catch {
                            // ignore parse errors
                        }
                    }
    
                    console.log('[GeminiChatService] >>> Độ dài phản hồi:', responseText.length);
    
                    if (responseText.length < 500) {
                        console.warn('[GeminiChatService] >>> Phản hồi ngắn (có thể lỗi):', responseText);
                    }
    
                    const sessionManager = getSessionContextManager();
                    const newContext = sessionManager.parseFromFetchResponse(responseText);
                    */
                    // -----------------------------------------------------

            if (foundText) {
                if (!newContext.conversationId && effectiveContext) newContext.conversationId = effectiveContext.conversationId;
                if (!newContext.responseId && effectiveContext) newContext.responseId = effectiveContext.responseId;
                if (!newContext.choiceId && effectiveContext) newContext.choiceId = effectiveContext.choiceId;

                console.log(`[GeminiChatService] Nhận phản hồi thành công (${foundText.length} ký tự)`);
                const contextSummary = {
                    conversationId: newContext.conversationId ? `${String(newContext.conversationId).slice(0, 24)}...` : '',
                    responseIdLength: newContext.responseId ? String(newContext.responseId).length : 0,
                    choiceId: newContext.choiceId ? `${String(newContext.choiceId).slice(0, 24)}...` : ''
                };
                console.log('[GeminiChatService] Ngữ cảnh (tóm tắt):', contextSummary);

                this.saveStoredTokenContext(tokenKey, newContext, config.id);
                this.firstSendByTokenKey.add(tokenKey);

                return {
                    success: true,
                    data: {
                        text: foundText,
                        context: newContext
                    }
                };
            }

            if (hasWrbFr && !hasContentPayload && controlAttempt < MAX_CONTROL_RETRIES) {
                console.warn('[GeminiChatService] Phản hồi điều khiển, đang gửi lại nhanh...');
                await new Promise(resolve => setTimeout(resolve, 600));
                continue;
            }

            if (hasWrbFr && !hasContentPayload) {
                console.warn('[GeminiChatService] Phản hồi điều khiển (chưa có nội dung), sẽ retry ở vòng ngoài...');
                throw new Error('Phản hồi điều khiển (chưa có nội dung)');
            }

            console.error('[GeminiChatService] Không tìm thấy nội dung trong phản hồi!');
            if (usedProxy) {
                const proxyManager = getProxyManager();
                proxyManager.markProxyFailed(usedProxy.id, 'Empty response');
                this.releaseProxy(config.id, usedProxy.id);
            }
            throw new Error('Không tìm thấy nội dung trong phản hồi');
        }

        return { success: false, error: 'Không nhận được phản hồi hợp lệ từ máy chủ' };

    } catch (error) {
        console.error("[GeminiChatService] Lỗi fetch:", error);
        return { success: false, error: String(error) };
    }
  }

  // =======================================================
  // SEND MESSAGE IMPIT
  // =======================================================
  
  async sendMessageImpit(
      message: string, 
      configId: string, 
      context?: { conversationId: string; responseId: string; choiceId: string }, 
      useProxyOverride?: boolean
  ): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string; configId?: string }> {
      
        // 1. Resolve Config
        let config: GeminiChatConfig | null = null;
        if (configId) {
            config = this.getById(configId);
            if (!config) return { success: false, error: `Config ID ${configId} not found` };
            if (!config.isActive) return { success: false, error: 'Config is inactive' };
        } else {
            config = this.getNextActiveConfig();
            if (!config) return { success: false, error: 'No active config found' };
        }

        const tokenKey = this.getTokenKey(config);
        console.log(`[GeminiChatService] Sending message via IMPIT using config: ${config.name}`);

        return await this.withTokenLock(tokenKey, async () => {
            try {
                // 2. Prepare Context & Payload (Similar to sendMessage)
                const { cookie, blLabel, fSid, atToken } = config!;
                if (!cookie || !blLabel || !fSid || !atToken) {
                    return { success: false, error: 'Missing config fields', configId: config!.id };
                }

                // REQ_ID Logic
                let currentReqIdStr = config!.reqId || this.generateInitialReqId();
                const reqId = String(parseInt(currentReqIdStr) + 100000);
                
                // Update ReqID in DB
                if (config!.id !== 'legacy') {
                    try {
                        getDatabase().prepare('UPDATE gemini_chat_config SET req_id = ? WHERE id = ?').run(reqId, config!.id);
                        config!.reqId = reqId; 
                    } catch (e) { }
                }

                // Context Logic
                const appSettings = AppSettingsService.getAll();
                const allowStoredContextOnFirstSend = !!appSettings.useStoredContextOnFirstSend;
                const isFirstSendForToken = !this.firstSendByTokenKey.has(tokenKey);
                const canUseStoredContext = !isFirstSendForToken || allowStoredContextOnFirstSend;
                const shouldIgnoreIncomingContext = isFirstSendForToken && !allowStoredContextOnFirstSend;
                
                const incomingContext = shouldIgnoreIncomingContext ? undefined : context;
                const configContext = this.getStoredConfigContext(config!.id);
                const tokenContext = this.getStoredTokenContext(tokenKey, config!.id);
                
                let storedContext: { conversationId: string; responseId: string; choiceId: string } | null = null;
                if (!incomingContext && canUseStoredContext) {
                    if (isFirstSendForToken && allowStoredContextOnFirstSend) {
                        storedContext = configContext;
                    } else if (!isFirstSendForToken) {
                        storedContext = tokenContext || configContext;
                    }
                }
                const effectiveContext = incomingContext || storedContext || undefined;
                
                const contextArray: [string, string, string] = effectiveContext 
                    ? [effectiveContext.conversationId, effectiveContext.responseId, effectiveContext.choiceId] 
                    : ["", "", ""];

                const createChatOnWeb = !!appSettings.createChatOnWeb;
                const fReq = this.buildRequestPayload(message, contextArray, createChatOnWeb);

                // 3. Prepare Impit Client
                const settingProxy = this.getUseProxySetting();
                const useProxy = typeof useProxyOverride === 'boolean' ? useProxyOverride : settingProxy;
                
                let proxyUrl: string | undefined = undefined;
                let usedProxy: ProxyConfig | null = null;

                if (useProxy) {
                    usedProxy = this.getOrAssignProxy(config!.id);
                    if (usedProxy) {
                        const scheme = usedProxy.type === 'socks5' ? 'socks5' : 'http'; // Impit might support socks? Docs say "proxyUrl"
                        // Assuming standard proxy URL format.
                        // Impit docs: proxyUrl: "http://localhost:8080"
                        if (usedProxy.username) {
                            proxyUrl = `${scheme}://${usedProxy.username}:${usedProxy.password}@${usedProxy.host}:${usedProxy.port}`;
                        } else {
                            proxyUrl = `${scheme}://${usedProxy.host}:${usedProxy.port}`;
                        }
                    }
                }

                const impit = new Impit({
                    browser: "chrome", // Default to chrome for now, could map from config.userAgent
                    proxyUrl: proxyUrl,
                    ignoreTlsErrors: true
                });

                // 4. Construct URL & Body
                const hl = config!.acceptLanguage ? config!.acceptLanguage.split(',')[0] : "vi";
                const baseUrl = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
                const params = new URLSearchParams({
                    "bl": blLabel,
                    "_reqid": reqId,
                    "rt": "c",
                    "f.sid": fSid,
                    "hl": hl
                });
                const url = `${baseUrl}?${params.toString()}`;

                const body = new URLSearchParams(
                    createChatOnWeb
                        ? { "f.req": fReq, "at": atToken }
                        : { "f.req": fReq, "at": atToken, "": "" }
                );

                // Headers
                // Impit handles User-Agent and Sec-CH-UA internally based on 'browser' option?
                // But we should probably pass our specific cookie.
                // Impit sets headers automatically? check usage:
                // "fetch" method...
                
                const headers: Record<string, string> = {
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "cookie": (cookie || '').replace(/[\r\n]+/g, ''),
                };
                
                // Add Origin/Referer if needed? Impit might do it.
                 headers["origin"] = "https://gemini.google.com";
                 headers["referer"] = "https://gemini.google.com/";

                const contextSummary = {
                    conversationId: contextArray[0] ? `${String(contextArray[0]).slice(0, 24)}...` : '',
                    responseId: contextArray[1] ? `${String(contextArray[1]).slice(0, 24)}...` : '',
                    choiceId: contextArray[2] ? `${String(contextArray[2]).slice(0, 24)}...` : ''
                };
                
                console.log('[GeminiChatService] Sending message via IMPIT');
                console.log('[GeminiChatService] Request Headers:', headers);
                console.log('[GeminiChatService] Context Summary:', contextSummary);
                console.log('[GeminiChatService] Sending Impit request to:', url);

                const response = await impit.fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: body.toString(),
                    timeout: 300000 // 5 minutes (default usually shorter in reqwest)
                });

                console.log('[GeminiChatService] Impit response status:', response.status);
                // Log response headers
                console.log('[GeminiChatService] Impit response headers:', response.headers);

                if (response.status !== 200) {
                     if (usedProxy) {
                        const proxyManager = getProxyManager();
                        proxyManager.markProxyFailed(usedProxy.id, `HTTP ${response.status}`);
                        this.releaseProxy(config!.id, usedProxy.id);
                    }
                    return { success: false, error: `Impit HTTP ${response.status}`, configId: config!.id };
                }
                
                if (usedProxy) {
                    const proxyManager = getProxyManager();
                    proxyManager.markProxySuccess(usedProxy.id);
                }

                const responseText = await response.text();
                
                // 5. Parse Response (Reuse logic?)
                // Since _sendMessageInternal's parsing is inside it, duplicate minimal logic here or extract it.
                // I will duplicate the simple parsing logic for now to avoid refactoring heavy code.

                let foundText = '';
                const sessionManager = getSessionContextManager();
                let newContext = { conversationId: '', responseId: '', choiceId: '' };

                for (const line of responseText.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith(")]}'") || /^\d+$/.test(trimmed)) continue;

                    try {
                        const parsedCtx = sessionManager.parseFromFetchResponse(line);
                        if (parsedCtx.conversationId) newContext.conversationId = parsedCtx.conversationId;
                        if (parsedCtx.responseId) newContext.responseId = parsedCtx.responseId;
                        if (parsedCtx.choiceId) newContext.choiceId = parsedCtx.choiceId;

                        const dataObj = JSON.parse(trimmed);
                        if (!Array.isArray(dataObj)) continue;
                         for (const payloadItem of dataObj) {
                            if (Array.isArray(payloadItem) && payloadItem.length >= 3 && payloadItem[0] === 'wrb.fr') {
                                const innerData = JSON.parse(payloadItem[2]);
                                const candidates = innerData[4];
                                if (Array.isArray(candidates) && candidates[0]) {
                                    const txt = candidates[0][1][0];
                                    if (txt && txt.length > foundText.length) foundText = txt;
                                }
                            }
                        }
                    } catch (e) { }
                }

                if (foundText) {
                    if (!newContext.conversationId && effectiveContext) newContext.conversationId = effectiveContext.conversationId;
                    if (!newContext.responseId && effectiveContext) newContext.responseId = effectiveContext.responseId;
                    if (!newContext.choiceId && effectiveContext) newContext.choiceId = effectiveContext.choiceId;
                    
                    this.saveStoredTokenContext(tokenKey, newContext, config!.id);
                    this.firstSendByTokenKey.add(tokenKey);

                    return {
                        success: true,
                        data: {
                            text: foundText,
                            context: newContext
                        },
                        configId: config!.id
                    };
                }

                return { success: false, error: 'No text found in Impit response', configId: config!.id };

            } catch (error) {
                console.error('[GeminiChatService] Impit Error:', error);
                return { success: false, error: String(error), configId: config?.id };
            }
        });
  }
// ... (existing code)

}

// Singleton instance
export const GeminiChatService = new GeminiChatServiceClass();
