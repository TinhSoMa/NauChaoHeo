/**
 * GeminiChatService - Quan ly cau hinh Gemini Chat (Web)
 * Luu tru trong SQLite database
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/schema';
import { getConfigurationService } from './gemini/configurationService';
import { getSessionContextManager } from './gemini/sessionContextManager';
import { getProxyManager } from './proxyManager';
import { AppSettingsService } from './appSettings';
import { ProxyConfig } from '../../shared/types/proxy';

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
    private readonly proxyMaxFailedCount = 5;

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
        const useProxy = typeof useProxyOverride === 'boolean' ? useProxyOverride : this.getUseProxySetting();
        const proxyManager = getProxyManager();
        let currentProxy: ProxyConfig | null = null;

        if (useProxy) {
            currentProxy = this.getOrAssignProxy(accountKey);
        }

        const { default: fetch } = await import('node-fetch');

        try {
            const agent = await this.createProxyAgent(currentProxy, timeoutMs);
            const response = await fetch(url, { ...fetchOptions, ...(agent ? { agent } : {}) });

            if (response.ok) {
                if (currentProxy) {
                    proxyManager.markProxySuccess(currentProxy.id);
                }
                return { response, usedProxy: currentProxy };
            }

            if (currentProxy) {
                proxyManager.markProxyFailed(currentProxy.id, `HTTP ${response.status}`);
                this.releaseProxy(accountKey, currentProxy.id);
            }

            if (!currentProxy && useProxy && proxyManager.shouldFallbackToDirect()) {
                const directResponse = await fetch(url, fetchOptions);
                return { response: directResponse, usedProxy: null };
            }

            return { response, usedProxy: currentProxy };
        } catch (error: any) {
            if (currentProxy) {
                proxyManager.markProxyFailed(currentProxy.id, error?.message || String(error));
                this.releaseProxy(accountKey, currentProxy.id);
            }

            if (!currentProxy && useProxy && proxyManager.shouldFallbackToDirect()) {
                const directResponse = await fetch(url, fetchOptions);
                return { response: directResponse, usedProxy: null };
            }

            throw error;
        }
    }

    private getOrAssignProxy(accountKey: string): ProxyConfig | null {
        const proxyManager = getProxyManager();
        const assignedId = this.proxyAssignments.get(accountKey);

        if (assignedId) {
            const assigned = this.getAvailableProxies().find(p => p.id === assignedId);
            if (assigned) {
                return assigned;
            }
            this.releaseProxy(accountKey, assignedId);
        }

        const available = this.getAvailableProxies().filter(p => !this.proxyInUse.has(p.id));
        if (available.length === 0) {
            console.warn(`[GeminiChatService] Không còn proxy trống cho tài khoản ${accountKey}`);
            return null;
        }

        const proxy = available[this.proxyRotationIndex % available.length];
        this.proxyRotationIndex = (this.proxyRotationIndex + 1) % available.length;

        this.proxyAssignments.set(accountKey, proxy.id);
        this.proxyInUse.add(proxy.id);
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
            id, name, cookie, bl_label, f_sid, at_token, 
            conv_id, resp_id, cand_id, req_id, 
            user_agent, accept_language, platform,
            is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
        id,
        data.name || 'default',
        data.cookie,
        data.blLabel || '',
        data.fSid || '',
        data.atToken || '',
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
    
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[GeminiChatService] Đang gửi tin nhắn (Lần ${attempt}/${MAX_RETRIES})...`);
      
            // CONFIG SELECTION LOGIC
            let config: GeminiChatConfig | null = null;
      
            if (configId) {
                    // Case 1: Use specific config
                    config = this.getById(configId);
                    if (!config) {
                            console.error(`[GeminiChatService] Không tìm thấy cấu hình ID ${configId}.`);
                             return { success: false, error: `Không tìm thấy cấu hình ID ${configId}` };
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

        console.log(`[GeminiChatService] Gửi yêu cầu bằng cấu hình: ${config.name} (ID: ${config.id})`);

                        const result = await this._sendMessageInternal(message, config, context, useProxyOverride);
      
            if (result.success) {
                                return { ...result, configId: config.id };
            }
      
            // If failed, check if we should retry
            if (attempt < MAX_RETRIES) {
                const retryDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
                console.log(`[GeminiChatService] Yêu cầu thất bại, thử lại sau ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
                console.error(`[GeminiChatService] Tất cả ${MAX_RETRIES} lần thử đều thất bại.`);
                return { ...result, configId: config.id }; // Return last error
            }
        }
    
        return { success: false, error: 'Unexpected error in retry loop' };
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
    const secChUaPlatform = config.platform ? `"${config.platform}"` : matchingProfile.secChUaPlatform;
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
    let contextArray = ["", "", ""];
    if (context) {
        contextArray = [context.conversationId, context.responseId, context.choiceId];
        const contextInfo = {
            conversationId: context.conversationId ? `${String(context.conversationId).slice(0, 24)}...` : '',
            responseId: context.responseId ? `${String(context.responseId).slice(0, 24)}...` : '',
            choiceId: context.choiceId ? `${String(context.choiceId).slice(0, 24)}...` : ''
        };
        console.log('[GeminiChatService] Dùng ngữ cảnh (tóm tắt):', contextInfo);
    }

    const innerPayload = [
        [message],
        null,
        contextArray 
    ];

    const fReq = JSON.stringify([null, JSON.stringify(innerPayload)]);

    const baseUrl = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
    
    const params = new URLSearchParams({
        "bl": blLabel,
        "_reqid": reqId,
        "rt": "c",
        "f.sid": fSid,
        "hl": hl
    });

    const url = `${baseUrl}?${params.toString()}`;

    const body = new URLSearchParams({
        "f.req": fReq,
        "at": atToken,
        "": "" // Empty param như trong HAR
    });

    try {
        console.log('[GeminiChatService] Đang gửi request:', url);
        // console.log('[GeminiChatService] >>> fetch START');
        
        const headers: Record<string, string> = {
            "accept": "*/*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": config.acceptLanguage || "vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6,zh-CN;q=0.5,zh;q=0.4",
            "cache-control": "no-cache",
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
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
            "user-agent": config.userAgent || matchingProfile.userAgent,
            "x-goog-ext-525001261-jspb": "[1,null,null,null,\"fbb127bbb056c959\",null,null,0,[4],null,null,1]",
            "x-goog-ext-525005358-jspb": "[\"6F392C2C-0CA3-4CF5-B504-2BE013DD0723\",1]",
            "x-goog-ext-73010989-jspb": "[0]",
            "x-same-domain": "1",
            "Cookie": safeCookie
        };

        if (secChUa) {
            headers["sec-ch-ua"] = secChUa;
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

                    console.log('[GeminiChatService] >>> Đang đọc nội dung phản hồi...');

                    const responseText = await response.text();
                    let foundText = '';
                    let hasWrbFr = false;
                    let hasContentPayload = false;

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

            if (foundText) {
                if (!newContext.conversationId && context) newContext.conversationId = context.conversationId;
                if (!newContext.responseId && context) newContext.responseId = context.responseId;
                if (!newContext.choiceId && context) newContext.choiceId = context.choiceId;

                console.log(`[GeminiChatService] Nhận phản hồi thành công (${foundText.length} ký tự)`);
                const contextSummary = {
                    conversationId: newContext.conversationId ? `${String(newContext.conversationId).slice(0, 24)}...` : '',
                    responseIdLength: newContext.responseId ? String(newContext.responseId).length : 0,
                    choiceId: newContext.choiceId ? `${String(newContext.choiceId).slice(0, 24)}...` : ''
                };
                console.log('[GeminiChatService] Ngữ cảnh (tóm tắt):', contextSummary);

                // NOTE: Context IDs (convId, respId, candId) are NOT saved to DB anymore
                // They should be managed by the UI layer (StoryTranslatorWeb component)

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
// ... (existing code)

}

// Singleton instance
export const GeminiChatService = new GeminiChatServiceClass();
