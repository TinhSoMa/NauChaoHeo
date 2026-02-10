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
import { 
    GeminiChatConfig, 
    CreateGeminiChatConfigDTO, 
    UpdateGeminiChatConfigDTO, 
    GeminiCookieConfig 
} from '../../../shared/types/geminiChat';
import { 
HL_LANG, 
    BROWSER_PROFILES,
    getRandomBrowserProfile,
    generateInitialReqId,
    buildRequestPayload,
    IMPIT_BROWSERS,
    ImpitBrowser
} from './geminiChatUtils';

// --- CONFIGURATION ---
// IMPORTANT: All values are now loaded from database (gemini_chat_config table)
// Use GeminiChatSettings UI to configure these values
// These fallback constants are DEPRECATED and will cause errors if database is empty

export class GeminiChatServiceClass {
    private static instance: GeminiChatServiceClass;

    // Proxy Management
    private proxyAssignments: Map<string, string> = new Map();
    private proxyInUse: Set<string> = new Set();
    private proxyRotationIndex: number = 0;
    private proxyMaxFailedCount: number = 3;

    // Concurrency Control
    private tokenLocks: Map<string, Promise<void>> = new Map();
    private firstSendByTokenKey: Set<string> = new Set();
    private lastCompletionTimeByTokenKey: Map<string, number> = new Map();

    // Impit Browser Assignment: mỗi tài khoản 1 trình duyệt duy nhất
    private impitBrowserAssignments: Map<string, ImpitBrowser> = new Map();
    private impitBrowsersInUse: Set<ImpitBrowser> = new Set();
    
    // Track the time when the thread for a token will be free next
    private nextAvailableTimeByTokenKey: Map<string, number> = new Map();

    public static getInstance(): GeminiChatServiceClass {
        if (!GeminiChatServiceClass.instance) {
            GeminiChatServiceClass.instance = new GeminiChatServiceClass();
        }
        return GeminiChatServiceClass.instance;
    }

    private async withTokenLock<T>(tokenKeyRaw: string, fn: () => Promise<T>): Promise<T> {
        // Normalize token key
        const tokenKey = (tokenKeyRaw || '').trim();
        const requestId = Math.random().toString(36).substring(7);
        
        console.log(`[GeminiChatService][${requestId}] Request queued for token: '${tokenKey.substring(0, 10)}...'`);

        // Get the previous task completion promise
        const previousTask = this.tokenLocks.get(tokenKey) || Promise.resolve();
        
        let signalTaskDone!: () => void;
        const myTaskPromise = new Promise<void>((resolve) => { signalTaskDone = resolve; });
        
        // Update the lock map immediately so the next request waits for this one to finish
        this.tokenLocks.set(tokenKey, myTaskPromise);
        
        // Wait for previous task to complete
        try {
            await previousTask;
        } catch (e) {
            // Ignore errors from previous requests
        }

        // --- EXECUTION PHASE (Serialized) ---
        // 1. Check if we need to wait for cooldown (calculated from previous task's completion)
        const now = Date.now();
        const nextAllowedTime = this.nextAvailableTimeByTokenKey.get(tokenKey) || 0;
        const waitTime = Math.ceil(Math.max(0, nextAllowedTime - now));
        
        if (waitTime > 0) {
            console.log(`[GeminiChatService][${requestId}] Cooling down: Waiting ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        console.log(`[GeminiChatService][${requestId}] Executing task NOW.`);
        
        try {
            // 2. Run the actual task
            const result = await fn();
            return result;
        } finally {
            // 3. Scheduling Next: Random delay AFTER completion
            const MIN_DELAY_MS = 10000;
            const MAX_DELAY_MS = 20000;
            const randomDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
            
            const completionTime = Date.now();
            const nextTime = completionTime + randomDelay;
            
            this.nextAvailableTimeByTokenKey.set(tokenKey, nextTime);
            console.log(`[GeminiChatService][${requestId}] Task Complete. Next request allowed at: ${nextTime} (Delay: ${randomDelay}ms)`);
            
            // Signal that this task is done
            if (typeof signalTaskDone === 'function') signalTaskDone();
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
    
    // ... (checkDuplicateToken omitted, unchanged) ...

    /**
     * Smart Account Selection:
     * - Prioritize accounts that are READY (Zero wait time).
     * - If multiple are ready, rotate among them.
     * - If none are ready, pick the one with the SHORTEST wait time.
     */
    getNextActiveConfig(): GeminiChatConfig | null {
        const activeConfigs = this.getAll().filter(c => c.isActive);
        if (activeConfigs.length === 0) {
            console.warn('[GeminiChatService] No active configs available');
            return null;
        }

        const now = Date.now();
        let bestConfig: GeminiChatConfig | null = null;
        let minWaitTime = Infinity;
        
        // Candidates that are ready (wait time <= 0)
        const readyCandidates: GeminiChatConfig[] = [];

        for (const config of activeConfigs) {
            const tokenKey = this.getTokenKey(config);
            const nextTime = this.nextAvailableTimeByTokenKey.get(tokenKey) || 0;
            const waitTime = Math.max(0, nextTime - now);

            if (waitTime <= 0) {
                readyCandidates.push(config);
            }

            if (waitTime < minWaitTime) {
                minWaitTime = waitTime;
                bestConfig = config;
            }
        }

        // 1. If we have ready candidates, pick one using rotation logic
        if (readyCandidates.length > 0) {
            // Sort by created_at for stable rotation
            readyCandidates.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            
            let nextIndex = 0;
            if (this.lastUsedConfigId) {
                // Try to find the *next* ready config after the last used one
                // This helps spread load across ready accounts instead of always picking the first one
                const lastUsedIndex = readyCandidates.findIndex(c => c.id === this.lastUsedConfigId);
                if (lastUsedIndex !== -1) {
                    nextIndex = (lastUsedIndex + 1) % readyCandidates.length;
                }
            }
            
            bestConfig = readyCandidates[nextIndex];
            console.log(`[GeminiChatService] Selected READY config: ${bestConfig.name} (Wait: 0ms)`);
        } else {
            // 2. No ready candidates, pick the one with minimum wait time
            // bestConfig is already set to minWaitTime candidate
            if (bestConfig) {
                console.log(`[GeminiChatService] All busy. Selected BEST config: ${bestConfig.name} (Wait: ${minWaitTime}ms)`);
            }
        }

        if (bestConfig) {
            this.lastUsedConfigId = bestConfig.id;
        }

        return bestConfig;
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

    // =======================================================
    // IMPIT BROWSER ASSIGNMENT - Mỗi tài khoản 1 trình duyệt
    // =======================================================

    /**
     * Gán trình duyệt impit cho một tài khoản.
     * Mỗi tài khoản sẽ được gán 1 trình duyệt duy nhất từ danh sách IMPIT_BROWSERS.
     * Trả về null nếu hết trình duyệt khả dụng.
     */
    assignImpitBrowser(accountKey: string): ImpitBrowser | null {
        // Nếu đã gán rồi thì trả về cái cũ
        const existing = this.impitBrowserAssignments.get(accountKey);
        if (existing) {
            console.log(`[GeminiChatService] Impit browser đã gán cho ${accountKey}: ${existing}`);
            return existing;
        }

        // Tìm trình duyệt chưa được sử dụng
        const available = IMPIT_BROWSERS.filter((b: ImpitBrowser) => !this.impitBrowsersInUse.has(b));
        if (available.length === 0) {
            console.error('[GeminiChatService] Hết trình duyệt impit khả dụng!');
            return null;
        }

        const browser = available[0];
        this.impitBrowserAssignments.set(accountKey, browser);
        this.impitBrowsersInUse.add(browser);
        console.log(`[GeminiChatService] Gán impit browser '${browser}' cho ${accountKey} (còn ${available.length - 1} trình duyệt)`);
        return browser;
    }

    /**
     * Giải phóng trình duyệt impit của 1 tài khoản
     */
    releaseImpitBrowser(accountKey: string): void {
        const browser = this.impitBrowserAssignments.get(accountKey);
        if (browser) {
            this.impitBrowserAssignments.delete(accountKey);
            this.impitBrowsersInUse.delete(browser);
            console.log(`[GeminiChatService] Giải phóng impit browser '${browser}' từ ${accountKey}`);
        }
    }

    /**
     * Giải phóng tất cả trình duyệt impit
     */
    releaseAllImpitBrowsers(): void {
        this.impitBrowserAssignments.clear();
        this.impitBrowsersInUse.clear();
        console.log('[GeminiChatService] Đã giải phóng tất cả trình duyệt impit');
    }

    /**
     * Lấy trình duyệt impit đã gán cho tài khoản (không gán mới)
     */
    getAssignedImpitBrowser(accountKey: string): ImpitBrowser | null {
        return this.impitBrowserAssignments.get(accountKey) || null;
    }

    /**
     * Lấy số lượng trình duyệt impit tối đa có thể sử dụng
     */
    getMaxImpitBrowserCount(): number {
        return IMPIT_BROWSERS.length;
    }

    /**
     * Lấy số lượng trình duyệt impit còn khả dụng
     */
    getAvailableImpitBrowserCount(): number {
        return IMPIT_BROWSERS.length - this.impitBrowsersInUse.size;
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

    private saveContext(
        context: { conversationId: string; responseId: string; choiceId: string },
        configId?: string
    ): void {
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




  // Round-robin tracking
  private lastUsedConfigId: string | null = null;

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
        data.reqId || generateInitialReqId(),
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
  // DEPRECATED WEB method (node-fetch) removed - use API or IMPIT instead
  // Old sendMessage() and _sendMessageInternal() functions deleted to avoid maintenance burden

  // =======================================================
  // Hàm hòa trộn Cookie cũ và Set-Cookie mới
  private mergeCookies(oldCookieStr: string, setCookieHeader: string | string[] | null): string {
      if (!setCookieHeader) return oldCookieStr;
      
      // Chuyển set-cookie (mảng hoặc chuỗi) thành Map để dễ quản lý
      const newCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      const cookieMap = new Map<string, string>();
  
      // Nạp cookie cũ vào Map
      if (oldCookieStr) {
        oldCookieStr.split(';').forEach(c => {
            const parts = c.trim().split('=');
            const key = parts[0];
            const val = parts.slice(1).join('=');
            if (key) cookieMap.set(key, val);
        });
      }
  
      // Ghi đè bằng cookie mới từ Google
      newCookies.forEach(c => {
          const parts = c.split(';')[0].split('=');
          const key = parts[0].trim();
          const value = parts.slice(1).join('=').trim();
          cookieMap.set(key, value);
      });
  
      // Chuyển ngược lại thành chuỗi để lưu DB
      return Array.from(cookieMap.entries())
          .map(([key, val]) => `${key}=${val}`)
          .join('; ');
  }

  // =======================================================
  // SEND MESSAGE IMPIT
  // =======================================================
  
  async sendMessageImpit(
      message: string, 
      configId: string, 
      context?: { conversationId: string; responseId: string; choiceId: string }, 
      useProxyOverride?: boolean,
      metadata?: any
  ): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string; configId?: string; metadata?: any; retryable?: boolean }> {
      
        // 1. Resolve Config
        let config: GeminiChatConfig | null = null;
        if (configId) {
            config = this.getById(configId);
            if (!config) return { success: false, error: `Config ID ${configId} not found`, metadata, retryable: false };
            if (!config.isActive) return { success: false, error: 'Config is inactive', metadata, retryable: false };
        } else {
            config = this.getNextActiveConfig();
            if (!config) return { success: false, error: 'No active config found', metadata, retryable: false };
        }

        const tokenKey = this.getTokenKey(config);
        console.log(`[GeminiChatService] Sending message via IMPIT using config: ${config.name}`);

        return await this.withTokenLock(tokenKey, async () => {
            const MAX_RETRIES = 3;
            const MIN_DELAY_MS = 5000;
            const MAX_DELAY_MS = 30000;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                console.log(`[GeminiChatService] Impit: Đang gửi tin nhắn (Lần ${attempt}/${MAX_RETRIES})...`);
                const result = await this._sendMessageImpitInternal(message, config!, context, useProxyOverride);

                if (result.success) {
                    return { ...result, metadata };
                }

                if (result.error && result.error.includes('Không còn proxy khả dụng')) {
                    console.error('[GeminiChatService] Impit: Dừng retry do hết proxy khả dụng');
                    // Hết proxy → retryable ở tầng worker (có thể thử không proxy hoặc đợi)
                    return { ...result, metadata, retryable: true };
                }

                if (attempt < MAX_RETRIES) {
                    const retryDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
                    console.log(`[GeminiChatService] Impit: Yêu cầu thất bại, thử lại sau ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    console.error(`[GeminiChatService] Impit: Tất cả ${MAX_RETRIES} lần thử đều thất bại.`);
                    // Lỗi HTTP (400, 401, 403...) → retryable ở tầng worker (đổi proxy/token)
                    return { ...result, metadata, retryable: true };
                }
            }

            return { success: false, error: 'Unexpected error in Impit retry loop', metadata, retryable: true };
        });
  }

  private async _sendMessageImpitInternal(
      message: string,
      config: GeminiChatConfig,
      context?: { conversationId: string; responseId: string; choiceId: string },
      useProxyOverride?: boolean
  ): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string; configId?: string }> {
            try {
                // 2. Prepare Context & Payload (Similar to sendMessage)
                const { cookie, blLabel, fSid, atToken } = config;
                if (!cookie || !blLabel || !fSid || !atToken) {
                    return { success: false, error: 'Missing config fields', configId: config.id };
                }

                const tokenKey = this.getTokenKey(config);

                // REQ_ID Logic
                let currentReqIdStr = config.reqId || generateInitialReqId();
                const reqId = String(parseInt(currentReqIdStr) + 100000);
                
                // Update ReqID in DB
                if (config.id !== 'legacy') {
                    try {
                        getDatabase().prepare('UPDATE gemini_chat_config SET req_id = ? WHERE id = ?').run(reqId, config.id);
                        config.reqId = reqId; 
                    } catch (e) { }
                }

                // Context Logic
                const appSettings = AppSettingsService.getAll();
                const allowStoredContextOnFirstSend = !!appSettings.useStoredContextOnFirstSend;
                const isFirstSendForToken = !this.firstSendByTokenKey.has(tokenKey);
                const canUseStoredContext = !isFirstSendForToken || allowStoredContextOnFirstSend;
                const shouldIgnoreIncomingContext = isFirstSendForToken && !allowStoredContextOnFirstSend;
                
                const incomingContext = shouldIgnoreIncomingContext ? undefined : context;
                const configContext = this.getStoredConfigContext(config.id);
                
                let storedContext: { conversationId: string; responseId: string; choiceId: string } | null = null;
                if (!incomingContext && canUseStoredContext) {
                    if (configContext) {
                        storedContext = configContext;
                    }
                }
                const effectiveContext = incomingContext || storedContext || undefined;
                
                const contextArray: [string, string, string] = effectiveContext 
                    ? [effectiveContext.conversationId, effectiveContext.responseId, effectiveContext.choiceId] 
                    : ["", "", ""];

                // TEST: Force simple payload format để debug
                // Force complex payload format to match Python reference and real Web Client
                const createChatOnWeb = true;
                console.log(`[GeminiChatService] Impit: createChatOnWeb = ${createChatOnWeb} (Updated to match Python REQ structure)`);
                const fReq = buildRequestPayload(message, contextArray, createChatOnWeb);

                // 3. Prepare Impit Client
                // Luôn đọc setting proxy mới nhất từ DB (không dùng override từ frontend vì có thể bị stale)
                const useProxy = this.getUseProxySetting();
                console.log(`[GeminiChatService] Proxy setting from DB: ${useProxy}${typeof useProxyOverride === 'boolean' ? `, frontend override: ${useProxyOverride}` : ''}`);
                
                let proxyUrl: string | undefined = undefined;
                let usedProxy: ProxyConfig | null = null;

                if (useProxy) {
                    usedProxy = this.getOrAssignProxy(config.id);
                    if (usedProxy) {
                        // Impit hỗ trợ HTTP, HTTPS, SOCKS4 và SOCKS5 proxy
                        const scheme = usedProxy.type === 'socks5' ? 'socks5' : usedProxy.type === 'https' ? 'https' : 'http';
                        if (usedProxy.username) {
                            proxyUrl = `${scheme}://${usedProxy.username}:${usedProxy.password}@${usedProxy.host}:${usedProxy.port}`;
                        } else {
                            proxyUrl = `${scheme}://${usedProxy.host}:${usedProxy.port}`;
                        }
                    }
                }

                // Gán trình duyệt impit cho tài khoản này
                const assignedBrowser = this.assignImpitBrowser(config.id);
                if (!assignedBrowser) {
                    return { 
                        success: false, 
                        error: `Hết trình duyệt impit khả dụng (tối đa ${IMPIT_BROWSERS.length} tài khoản đồng thời)`, 
                        configId: config.id 
                    };
                }
                console.log(`[GeminiChatService] Impit: Sử dụng trình duyệt '${assignedBrowser}' cho config ${config.name}`);

                // QUAN TRỌNG: Impit KHÔNG hỗ trợ proxy khi http3 bật
                // "Warning: Proxies are not supported when HTTP/3 is enabled."
                // → Nếu có proxy thì phải tắt http3
                const useHttp3 = !proxyUrl;
                if (proxyUrl) {
                    console.log(`[GeminiChatService] Impit: Tắt HTTP/3 vì đang dùng proxy (${proxyUrl.split('@').pop()})`);
                }

                const impit = new Impit({
                    browser: assignedBrowser,
                    proxyUrl: proxyUrl,
                    ignoreTlsErrors: true,
                    timeout: 300000,
                    http3: useHttp3, 
                    followRedirects: true,
                    maxRedirects: 10
                });

                // 4. Construct URL & Body
                const hl = config.acceptLanguage ? config.acceptLanguage.split(',')[0] : "vi";
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
                
                // Debug: Log body keys to verify format
                console.log(`[GeminiChatService] Impit: Request body keys = [${Array.from(body.keys()).join(', ')}]`);

                // Headers
                const headers: Record<string, string> = {
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "cookie": (cookie || '').replace(/[\r\n]+/g, ''),
                };
                
                 headers["origin"] = "https://gemini.google.com";
                 headers["referer"] = "https://gemini.google.com/";
                 
                // Debug: Check critical cookie tokens
                const cookieLength = headers["cookie"].length;
                const hasSecurePSID = headers["cookie"].includes('__Secure-1PSID');
                const hasSecurePSIDTS = headers["cookie"].includes('__Secure-1PSIDTS');
                console.log(`[GeminiChatService] Impit: Cookie length=${cookieLength}, __Secure-1PSID=${hasSecurePSID}, __Secure-1PSIDTS=${hasSecurePSIDTS}`);
                
                if (!hasSecurePSID || !hasSecurePSIDTS) {
                    console.error('[GeminiChatService] ⚠️ CẢNH BÁO: Cookie thiếu __Secure-1PSID hoặc __Secure-1PSIDTS - Có thể gây lỗi 400!');
                }
                
                // Debug: Log auth tokens (masked for security)
                const atTokenPreview = atToken ? `${atToken.substring(0, 20)}...` : 'MISSING';
                const blLabelPreview = blLabel ? blLabel : 'MISSING';
                const fSidPreview = fSid ? fSid : 'MISSING';
                console.log(`[GeminiChatService] Impit: AT Token=${atTokenPreview}, BL=${blLabelPreview}, F.SID=${fSidPreview}`);
                 


                const contextSummary = {
                    conversationId: contextArray[0] ? `${String(contextArray[0]).slice(0, 24)}...` : '',
                    responseId: contextArray[1] ? `${String(contextArray[1]).slice(0, 24)}...` : '',
                    choiceId: contextArray[2] ? `${String(contextArray[2]).slice(0, 24)}...` : ''
                };
                
                // Debug: Warn if using context (có thể gây lỗi nếu context cũ)
                const hasContext = !!(contextArray[0] || contextArray[1] || contextArray[2]);
                if (hasContext) {
                    console.log('[GeminiChatService] Impit: Đang sử dụng context cũ:', contextSummary);
                    console.log('[GeminiChatService] ⚠️ Nếu lỗi 400 liên tục, hãy thử XÓA context (Reset conversation)');
                } else {
                    console.log('[GeminiChatService] Impit: Bắt đầu conversation MỚI (không có context)');
                }
                
                console.log('[GeminiChatService] Sending message via IMPIT');
                // console.log('[GeminiChatService] Request Headers:', headers);
                // console.log('[GeminiChatService] Context Summary:', contextSummary);
                console.log('[GeminiChatService] Sending Impit request to:', url);

                const response = await impit.fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: body.toString()
                });

                console.log('[GeminiChatService] Impit response status:', response.status);
                // Log response headers
                // console.log('[GeminiChatService] Impit response headers:', response.headers);

                if (response.status !== 200) {
                    // Log response body for debugging 400 errors
                    try {
                        const responseText = await response.text();
                        console.error(`[GeminiChatService] Impit HTTP ${response.status} Error Response:`, responseText.substring(0, 500));
                    } catch (e) {
                        console.error('[GeminiChatService] Could not read error response body:', e);
                    }
                    
                     if (usedProxy) {
                        const proxyManager = getProxyManager();
                        proxyManager.markProxyFailed(usedProxy.id, `HTTP ${response.status}`);
                        this.releaseProxy(config.id, usedProxy.id);
                        // Xóa proxy_id trong DB để lần retry tiếp theo gán proxy mới
                        this.setAssignedProxyId(config.id, null);
                    }
                    return { success: false, error: `Impit HTTP ${response.status}`, configId: config.id };
                }
                
                if (usedProxy) {
                    const proxyManager = getProxyManager();
                    proxyManager.markProxySuccess(usedProxy.id);
                }

                // --- Cookie synchronization logic ---
                
                // Get set-cookie header(s) robustly
                let setCookieHeaders: string[] = [];
                
                if (typeof response.headers.getSetCookie === 'function') {
                    // Modern standard (Node 20+, new Fetch API)
                    setCookieHeaders = response.headers.getSetCookie();
                } else if ('raw' in response.headers && typeof (response.headers as any).raw === 'function') {
                    // Node-fetch specific
                    const raw = (response.headers as any).raw();
                    if (raw['set-cookie']) {
                         setCookieHeaders = raw['set-cookie'];
                    }
                } else {
                    // Fallback to standard .get() - might merge headers with comma
                    const headerVal = response.headers.get('set-cookie');
                    if (headerVal) {
                        // Attempt to split if it looks like combined cookies (risky but better than nothing)
                        // Simple split by ", " might break dates. 
                        // But usually with Impit/Node-fetch we have access to raw or getSetCookie.
                        // If we are here, treat as single string or manually split if we had a smart parser.
                        // For now, wrap in array.
                        setCookieHeaders = [headerVal]; 
                    }
                }

                /*
                if (response.status === 200 && setCookieHeaders.length > 0) {
                    // 1. Merge cookies
                    const updatedCookie = this.mergeCookies(config.cookie, setCookieHeaders);
                    
                    // 2. Update Database immediately
                    try {
                        const db = getDatabase();
                        db.prepare('UPDATE gemini_chat_config SET cookie = ? WHERE id = ?')
                            .run(updatedCookie, config.id);
                        
                        // QUAN TRỌNG: Cập nhật lại chính Object đang chạy để lượt sau nó thấy!
                        config.cookie = updatedCookie; 
                        
                        console.log(`[GeminiChatService] Đã đồng bộ Cookie mới vào bộ nhớ cho ${config.name}`);
                    } catch (dbError) {
                        console.error('[GeminiChatService] Lỗi cập nhật Cookie vào DB:', dbError);
                    }
                }
                */

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
                                if (Array.isArray(candidates) && candidates.length > 0) {
                                    const candidate = candidates[0];
                                    if (candidate && candidate.length > 1) {
                                        const textSource = candidate[1];
                                        const txt = Array.isArray(textSource) ? textSource[0] : textSource;
                                        if (typeof txt === 'string' && txt && txt.length > foundText.length) {
                                            foundText = txt;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) { }
                }

                if (foundText) {
                    // Log context changes for debugging re-translation issues
                    const contextWasParsed = !!(newContext.conversationId || newContext.responseId || newContext.choiceId);
                    if (!contextWasParsed && effectiveContext) {
                        console.warn('[GeminiChatService] ⚠️ Impit: Không parse được context mới từ response, dùng context cũ');
                    }
                    if (!newContext.conversationId && effectiveContext) newContext.conversationId = effectiveContext.conversationId;
                    if (!newContext.responseId && effectiveContext) newContext.responseId = effectiveContext.responseId;
                    if (!newContext.choiceId && effectiveContext) newContext.choiceId = effectiveContext.choiceId;

                    console.log(`[GeminiChatService] Impit: Nhận phản hồi thành công (${foundText.length} ký tự)`);
                    const contextSummary = {
                        conversationId: newContext.conversationId ? `${String(newContext.conversationId).slice(0, 24)}...` : '',
                        responseIdLength: newContext.responseId ? String(newContext.responseId).length : 0,
                        choiceId: newContext.choiceId ? `${String(newContext.choiceId).slice(0, 24)}...` : '',
                        parsedFromResponse: contextWasParsed
                    };
                    console.log('[GeminiChatService] Impit: Ngữ cảnh (tóm tắt):', contextSummary);
                    
                    this.saveContext(newContext, config.id);
                    this.firstSendByTokenKey.add(tokenKey);

                    return {
                        success: true,
                        data: {
                            text: foundText,
                            context: newContext
                        },
                        configId: config.id
                    };
                }

                return { success: false, error: 'No text found in Impit response', configId: config.id };

            } catch (error) {
                console.error('[GeminiChatService] Impit Error:', error);
                return { success: false, error: String(error), configId: config?.id };
            }
  }
// ... (existing code)

}

// Singleton instance
// Singleton instance
export const GeminiChatService = GeminiChatServiceClass.getInstance();
export const getGeminiChatService = () => GeminiChatServiceClass.getInstance();
