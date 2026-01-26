/**
 * GeminiChatService - Quan ly cau hinh Gemini Chat (Web)
 * Luu tru trong SQLite database
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/schema';
import { getConfigurationService } from './gemini/configurationService';
import { getSessionContextManager, SessionContext } from './gemini/sessionContextManager';

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

  // Tracking configured sessions in memory to avoid sending setFlashModel every time
  private configuredSessions = new Set<string>();
  
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
    
    console.log(`[GeminiChatService] Selected config for rotation: ${config.name} (${this.rotationIndex}/${activeConfigs.length})`);
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
  // HELPER: SET FLASH MODEL (ONE TIME PER SESSION)
  // =======================================================
  async setFlashModel(config: GeminiChatConfig): Promise<void> {
      try {
          // Payload magic string extracted from HAR (96 elements, 95 nulls + ID)
          const MODEL_ID = "56fdd199312815e2"; // Gemini Flash ID
          const innerReq = JSON.stringify([
              [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null, MODEL_ID],
              [["last_selected_mode_id_on_web"]]
          ]);
          
          const fReq = JSON.stringify([
              [["L5adhe", innerReq, null, "generic"]]
          ]);

          if (!config.blLabel || !config.fSid || !config.atToken) {
              console.error('[GeminiChatService] Missing required config fields for Flash Model');
              return;
          }

          const qs = new URLSearchParams({
              rpcids: "L5adhe",
              "source-path": "/app",
              bl: config.blLabel,
              "f.sid": config.fSid,
              hl: HL_LANG,
              pageId: "none",
              _reqid: config.reqId || "0",
              rt: "c"
          });

          const body = new URLSearchParams();
          body.append("f.req", fReq);
          body.append("at", config.atToken);
          body.append("", ""); // Empty param

          console.log(`[GeminiChatService] Setting Flash Model preference...`);
          
          const response = await fetch(`https://gemini.google.com/_/BardChatUi/data/batchexecute?${qs.toString()}`, {
              method: "POST",
              headers: {
                  "accept": "*/*",
                  "accept-encoding": "gzip, deflate, br, zstd",
                  "accept-language": config.acceptLanguage || "vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6,zh-CN;q=0.5,zh;q=0.4",
                  "cache-control": "no-cache",
                  "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                  "origin": "https://gemini.google.com",
                  "pragma": "no-cache",
                  "referer": "https://gemini.google.com/",
                  "sec-ch-ua": config.userAgent ? `"Not(A:Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"` : "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"",
                  "sec-ch-ua-arch": "\"x86\"",
                  "sec-ch-ua-bitness": "\"64\"",
                  "sec-ch-ua-mobile": "?0",
                  "sec-ch-ua-platform": config.platform ? `"${config.platform}"` : "\"Windows\"",
                  "sec-fetch-dest": "empty",
                  "sec-fetch-mode": "cors",
                  "sec-fetch-site": "same-origin",
                  "user-agent": config.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
                  "x-goog-ext-525001261-jspb": "[1,null,null,null,\"fbb127bbb056c959\",null,null,0,[4],null,null,1]",
                  "x-goog-ext-525005358-jspb": "[\"6F392C2C-0CA3-4CF5-B504-2BE013DD0723\",1]",
                  "x-goog-ext-73010989-jspb": "[0]",
                  "x-same-domain": "1",
                  "Cookie": config.cookie
              },
              body: body
          });

          if (response.ok) {
              console.log(`[GeminiChatService] Set Flash Model SUCCESS`);
          } else {
              console.warn(`[GeminiChatService] Set Flash Model FAILED: ${response.status}`);
          }
      } catch (e) {
          console.error(`[GeminiChatService] Error setting Flash Model:`, e);
      }
  }

  // =======================================================
  // GUI TIN NHAN DEN GEMINI WEB API - STRICT PYTHON PORT
  // =======================================================

  async sendMessage(message: string, configId: string, context?: { conversationId: string; responseId: string; choiceId: string }): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string }> {
    const MAX_RETRIES = 3;
    const MIN_DELAY_MS = 2000;
    const MAX_DELAY_MS = 10000;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[GeminiChatService] Sending message (Attempt ${attempt}/${MAX_RETRIES})...`);
      
      // CONFIG SELECTION LOGIC
      let config: GeminiChatConfig | null = null;
      
      if (configId) {
          // Case 1: Use specific config
          config = this.getById(configId);
          if (!config) {
              console.error(`[GeminiChatService] Config ID ${configId} not found.`);
               return { success: false, error: `Config ID ${configId} not found` };
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
                   return { success: false, error: 'No active web configurations found.' };
               }
          }
      }

      console.log(`[GeminiChatService] Request using config: ${config.name} (ID: ${config.id})`);

      const result = await this._sendMessageInternal(message, config, context);
      
      if (result.success) {
        return result;
      }
      
      // If failed, check if we should retry
      if (attempt < MAX_RETRIES) {
        // If we are ROTATING (no specific configId), should we get a NEW config for retry?
        // User request: "Concurrent requests ... not switch failure on account".
        // But for reliable delivery, sticking to same or switching?
        // Let's stick to the current logic: Retry loop is for TRANSIENT errors.
        // If config is bad (Auth error), maybe we should fail fast?
        // For now, simple retry with same or next config?
        // If we are in rotation mode (no ID), getting next active config for retry makes sense.
        // But the loop is here.
        
        const retryDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
        console.log(`[GeminiChatService] Request failed, retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error(`[GeminiChatService] All ${MAX_RETRIES} attempts failed.`);
        return result; // Return last error
      }
    }
    
    return { success: false, error: 'Unexpected error in retry loop' };
  }

  private async _sendMessageInternal(message: string, config: GeminiChatConfig, context?: { conversationId: string; responseId: string; choiceId: string }): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string }> {
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
        console.warn(`[GeminiChatService] Config ${config.id} missing browser profile. Assigning persistent profile...`);
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
                console.error('[GeminiChatService] Failed to persist browser profile', e);
            }
        }
    }

    const hl = config.acceptLanguage ? config.acceptLanguage.split(',')[0] : HL_LANG;
    // Find matching profile for headers (fallback if custom)
    const matchingProfile = BROWSER_PROFILES.find(p => p.userAgent === config.userAgent) || BROWSER_PROFILES[0];
    const secChUa = matchingProfile.secChUa;
    const secChUaPlatform = config.platform ? `"${config.platform}"` : matchingProfile.secChUaPlatform;
    
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
            console.warn('[GeminiChatService] Failed to update req_id in DB', e);
        }
    }
    // console.log(`[GeminiChatService] Updated REQ_ID: ${currentReqIdStr} -> ${reqId}`);

    // Ensure Flash Model is configured for this session (Run once per session/config)
    const sessionKey = `config_${config.id}`; 
    
    if (!this.configuredSessions.has(sessionKey)) {
        // Pass the FULL config object which now matches GeminiChatConfig interface (or close enough)
        await this.setFlashModel(config);
        this.configuredSessions.add(sessionKey);
    }

    // Payload logic from python: [ [message], null, ["conversation_id", "response_id", "choice_id"] ]
    let contextArray = ["", "", ""];
    if (context) {
        contextArray = [context.conversationId, context.responseId, context.choiceId];
        console.log('[GeminiChatService] Using context:', contextArray);
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
        console.log('[GeminiChatService] Fetching:', url);
        // console.log('[GeminiChatService] >>> fetch START');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                "accept": "*/*",
                "accept-encoding": "gzip, deflate, br, zstd",
                "accept-language": config.acceptLanguage || "vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6,zh-CN;q=0.5,zh;q=0.4",
                "cache-control": "no-cache",
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "origin": "https://gemini.google.com",
                "pragma": "no-cache",
                "referer": "https://gemini.google.com/",
                "sec-ch-ua": secChUa,
                "sec-ch-ua-arch": "\"x86\"",
                "sec-ch-ua-bitness": "\"64\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": secChUaPlatform,
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "user-agent": config.userAgent!,
                "x-goog-ext-525001261-jspb": "[1,null,null,null,\"fbb127bbb056c959\",null,null,0,[4],null,null,1]",
                "x-goog-ext-525005358-jspb": "[\"6F392C2C-0CA3-4CF5-B504-2BE013DD0723\",1]",
                "x-goog-ext-73010989-jspb": "[0]",
                "x-same-domain": "1",
                "Cookie": cookie
            },
            body: body.toString()
        });

        console.log('[GeminiChatService] >>> fetch END, status:', response.status);

        if (!response.ok) {
             const txt = await response.text();
             console.error("[GeminiChatService] Gemini Error:", response.status, txt.substring(0, 200));
             return { success: false, error: `HTTP ${response.status}` };
        }

        console.log('[GeminiChatService] >>> Reading response text...');
        const responseText = await response.text();
        console.log('[GeminiChatService] >>> Response text length:', responseText.length);
        
        // If response is suspiciously small, log its content for debugging
        if (responseText.length < 500) {
            console.warn('[GeminiChatService] >>> Small response (possible error):', responseText);
        }
        
        // Parse response with SessionContextManager
        const sessionManager = getSessionContextManager();
        const newContext = sessionManager.parseFromFetchResponse(responseText);
        
        let foundText = '';
        const lines = responseText.split('\n').filter(line => line.trim());

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            try {
                let jsonPart = trimmed;
                if (/^\d+$/.test(jsonPart)) continue;

                const dataObj = JSON.parse(jsonPart);
                
                if (Array.isArray(dataObj) && dataObj.length > 0) {
                    const payloadItem = dataObj[0];
                    if (Array.isArray(payloadItem) && payloadItem.length > 2 && payloadItem[2]) {
                        if (typeof payloadItem[2] === 'string') {
                            const innerData = JSON.parse(payloadItem[2]);
                             if (Array.isArray(innerData) && innerData.length >= 5) {
                                 const candidates = innerData[4]; 
                                 if (Array.isArray(candidates) && candidates.length > 0) {
                                     const candidate = candidates[0];
                                     if (candidate && candidate.length > 1 && candidate[1] && candidate[1].length > 0) {
                                         const txt = candidate[1][0];
                                         if (txt) {
                                             foundText = txt;
                                         }
                                     }
                                 }
                             }
                        }
                    }
                }

            } catch (e) {
                // Ignore parse errors
            }
        }

        if (foundText) {
            if (!newContext.conversationId && context) newContext.conversationId = context.conversationId;
            if (!newContext.responseId && context) newContext.responseId = context.responseId;
            if (!newContext.choiceId && context) newContext.choiceId = context.choiceId;

            console.log(`[GeminiChatService] Received response (${foundText.length} chars)`);
            console.log('[GeminiChatService] Parsed context:', newContext);

            // NOTE: Context IDs (convId, respId, candId) are NOT saved to DB anymore
            // They should be managed by the UI layer (StoryTranslatorWeb component)

            return { 
                success: true, 
                data: {
                    text: foundText,
                    context: newContext
                }
            };
        } else {
             console.error('[GeminiChatService] No text found in response! Resetting session...');
             this.configuredSessions.delete('cookie_config'); // Force re-flash on next retry
             throw new Error("No text found in response - Session reset");
        }

    } catch (error) {
        console.error("[GeminiChatService] Fetch Error:", error);
        return { success: false, error: String(error) };
    }
  }
// ... (existing code)

  // =======================================================
  // STREAM MESSAGE
  // =======================================================
  async streamMessage(
    message: string, 
    configId: string, 
    context: { conversationId: string; responseId: string; choiceId: string } | undefined,
    onData: (data: { text: string; context?: { conversationId: string; responseId: string; choiceId: string } }) => void,
    onError: (error: string) => void,
    onDone: () => void
  ): Promise<void> {
      const MAX_RETRIES = 3;
      const MIN_DELAY_MS = 2000;
      const MAX_DELAY_MS = 10000;
      
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[GeminiChatService] Streaming message (Attempt ${attempt}/${MAX_RETRIES})...`);
        
        // CONFIG SELECTION
        let config: GeminiChatConfig | null = null;
        if (configId) {
            config = this.getById(configId);
            if (!config) throw new Error(`Config ID ${configId} not found`);
        } else {
            config = this.getNextActiveConfig();
            if (!config) {
                 const cookieConfig = this.getCookieConfig();
                 if (cookieConfig) {
                     config = { id: 'legacy', name: 'Legacy Cookie', ...cookieConfig, isActive: true, createdAt: 0, updatedAt: 0 } as GeminiChatConfig;
                 } else {
                     throw new Error('No active web configurations found for streaming');
                 }
            }
        }

        try {
            await this._streamMessageInternal(message, config, context, onData);
            onDone();
            return;
        } catch (error: any) {
            console.error(`[GeminiChatService] Stream failed (Attempt ${attempt}):`, error);
            if (attempt < MAX_RETRIES) {
                const retryDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
                console.log(`[GeminiChatService] Retrying in ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
                onError(String(error));
                return;
            }
        }
      }
  }

  private async _streamMessageInternal(
    message: string, 
    config: GeminiChatConfig, 
    context: { conversationId: string; responseId: string; choiceId: string } | undefined,
    onData: (data: { text: string; context?: { conversationId: string; responseId: string; choiceId: string } }) => void
  ): Promise<void> {

    const { cookie, blLabel, fSid, atToken } = config;
    
    // Validate required fields
    if (!cookie || !blLabel || !fSid || !atToken) {
        throw new Error('Missing required config fields in Stream Mode');
    }

    const hl = config.acceptLanguage ? config.acceptLanguage.split(',')[0] : HL_LANG;

    // CHECK & PERSIST BROWSER PROFILE (Stream Mode)
    if (!config.userAgent || !config.platform) {
        // ... (Same logic as sendMessage, ensured uniqueness)
        const profile = getRandomBrowserProfile();
        config.userAgent = profile.userAgent;
        config.platform = profile.platform;
        if (config.id !== 'legacy') {
             try {
                const db = getDatabase();
                db.prepare('UPDATE gemini_chat_config SET user_agent = ?, platform = ? WHERE id = ?')
                  .run(profile.userAgent, profile.platform, config.id);
            } catch (e) {}
        }
    }
    const matchingProfile = BROWSER_PROFILES.find(p => p.userAgent === config.userAgent) || BROWSER_PROFILES[0];
    const secChUa = matchingProfile.secChUa;
    const secChUaPlatform = config.platform ? `"${config.platform}"` : matchingProfile.secChUaPlatform;
    
    // REQ_ID Logic
    let currentReqIdStr = config.reqId;
    if (!currentReqIdStr) currentReqIdStr = this.generateInitialReqId();
    
    const nextReqIdNum = parseInt(currentReqIdStr) + 100000;
    const reqId = String(nextReqIdNum);

    // Save back to DB (if it's a real stored config)
    if (config.id !== 'legacy') {
        try {
            const db = getDatabase();
            db.prepare('UPDATE gemini_chat_config SET req_id = ? WHERE id = ?').run(reqId, config.id);
            config.reqId = reqId; 
        } catch (e) {
            console.warn('[GeminiChatService] Failed to update req_id in DB', e);
        }
    }

    // Ensure Flash Model is configured
    const sessionKey = `config_${config.id}`; 
    if (!this.configuredSessions.has(sessionKey)) {
        await this.setFlashModel(config);
        this.configuredSessions.add(sessionKey);
    }

    // Payload logic
    let contextArray = ["", "", ""];
    if (context) {
        contextArray = [context.conversationId, context.responseId, context.choiceId];
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
        "": "" 
    });

    console.log('[GeminiChatService] Streaming from:', url);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            "accept": "*/*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": config.acceptLanguage || "vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6,zh-CN;q=0.5,zh;q=0.4",
            "cache-control": "no-cache",
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "origin": "https://gemini.google.com",
            "pragma": "no-cache",
            "referer": "https://gemini.google.com/",
            "sec-ch-ua": secChUa,
            "sec-ch-ua-arch": "\"x86\"",
            "sec-ch-ua-bitness": "\"64\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": secChUaPlatform,
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "user-agent": config.userAgent!,
            "x-goog-ext-525001261-jspb": "[1,null,null,null,\"fbb127bbb056c959\",null,null,0,[4],null,null,1]",
            "x-goog-ext-525005358-jspb": "[\"6F392C2C-0CA3-4CF5-B504-2BE013DD0723\",1]",
            "x-goog-ext-73010989-jspb": "[0]",
            "x-same-domain": "1",
            "Cookie": cookie
        },
        body: body.toString()
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('[GeminiChatService] Stream HTTP Error:', response.status, errText.substring(0, 300));
        throw new Error(`HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('No response body');

    // TRUE STREAMING: Process chunks as they arrive (httpx-inspired implementation)
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    let buffer = '';
    let fullResponse = ''; // Accumulate for context parsing
    let hasReceivedText = false;
    let lastTextLength = 0;
    
    // Use SessionContextManager
    const sessionManager = getSessionContextManager();
    let newContext = context ? { ...context } : { conversationId: "", responseId: "", choiceId: "" };

    let chunkCount = 0;
    let lineCount = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Decode chunk và thêm vào buffer
            const chunkText = decoder.decode(value, { stream: true });
            buffer += chunkText;
            fullResponse += chunkText;

            // Parse từng dòng hoàn chỉnh (kết thúc bằng \n)
            while (buffer.includes('\n')) {
                const lineEnd = buffer.indexOf('\n');
                const line = buffer.substring(0, lineEnd);
                buffer = buffer.substring(lineEnd + 1);

                lineCount++;
                
                if (!line.trim()) continue;
                
                try {
                    // Bỏ qua dòng header
                    if (line.startsWith(")]}'")) continue;
                    
                    // Bỏ qua số (length prefix)
                    if (/^\d+$/.test(line.trim())) continue;

                    const data = JSON.parse(line);
                    
                    // Format từ HAR: [["wrb.fr", null, "inner_json_string", ...]]
                    if (Array.isArray(data) && data[0] && Array.isArray(data[0]) && data[0][2]) {
                        const innerDataStr = data[0][2];
                        const innerData = JSON.parse(innerDataStr);
                        
                        // Cấu trúc innerData: [null, ["conv_id"], null, null, [["resp_id", ["FULL_TEXT"]]]]
                        if (innerData && Array.isArray(innerData)) {
                            // Extract text (index 4 = candidates)
                            if (innerData[4] && Array.isArray(innerData[4]) && innerData[4][0]) {
                                const candidate = innerData[4][0];
                                if (candidate[1] && Array.isArray(candidate[1]) && candidate[1][0]) {
                                    const fullText = candidate[1][0];
                                    hasReceivedText = true;
                                    
                                    // Tính delta (phần text mới so với lần trước)
                                    const currentLength = fullText.length;
                                    if (currentLength > lastTextLength) {
                                        chunkCount++;
                                        const delta = fullText.substring(lastTextLength);
                                        console.log(`[GeminiChatService] Chunk #${chunkCount} | +${delta.length} chars | Total: ${currentLength}`);
                                        
                                        // Gửi chunk NGAY LẬP TỨC (không chờ toàn bộ response)
                                        onData({ text: delta });
                                        lastTextLength = currentLength;
                                    }
                                }
                            }

                            // Parse context using SessionContextManager at the end
                            // We'll update context after the stream completes
                        }
                    }
                } catch (e) {
                    // Skip parse errors
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    console.log(`[GeminiChatService] Stream Stats: ${lineCount} lines, ${chunkCount} chunks, ${lastTextLength} chars total`);
    
    if (!hasReceivedText) {
         console.error('[GeminiChatService] No text found in stream response! Resetting session...');
         this.configuredSessions.delete('cookie_config');
         throw new Error("No text found in response - Session reset");
    }
    
    // Parse context from full response using SessionContextManager
    newContext = sessionManager.parseFromStreamResponse(fullResponse);
    
    // Send Context Update at the end
    onData({ text: "", context: newContext });
  }

}

// Singleton instance
export const GeminiChatService = new GeminiChatServiceClass();
