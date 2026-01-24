/**
 * GeminiChatService - Quan ly cau hinh Gemini Chat (Web)
 * Luu tru trong SQLite database
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/schema';

// --- HARDCODED CONFIG FROM PYTHON SCRIPT ---
const COOKIE_VALUE = "__Secure-BUCKET=CJMB; _gcl_aw=GCL.1763473868.CjwKCAiAz_DIBhBJEiwAVH2XwBsmsaFjkEw_kdo3VDBvowcKLj-6d0GlFeAcSjrO0lplkxJ8Wj11NRoCa8sQAvD_BwE; _gcl_dc=GCL.1763473868.CjwKCAiAz_DIBhBJEiwAVH2XwBsmsaFjkEw_kdo3VDBvowcKLj-6d0GlFeAcSjrO0lplkxJ8Wj11NRoCa8sQAvD_BwE; _gcl_au=1.1.566953289.1763473864.1658570616.1763694351.1763694350; _ga=GA1.1.780603260.1763473864; _ga_WC57KJ50ZZ=deleted; SEARCH_SAMESITE=CgQI-Z8B; AEC=AaJma5tJt9rByI1m-o5BibVClAGRRSpGNagLO5n8gkEjRzV1QCMnxZF7ng; SID=g.a0006Ah_SYFPGmAcxCIBva0cxKJ2TTnXQhKelZEOHyF_v1YoS-xwz0q5dXRwpv5b51wjQZ5XmQACgYKAewSARQSFQHGX2MihZQdb3U7HTbxfoPbD_VZnhoVAUF8yKruatwmOGmB-15jNQpWZQiR0076; __Secure-1PSID=g.a0006Ah_SYFPGmAcxCIBva0cxKJ2TTnXQhKelZEOHyF_v1YoS-xwkdUxcu--2AN21cWX0TmUOgACgYKAWcSARQSFQHGX2MiukxI_qPfUk5XVClWRRghABoVAUF8yKogjhGfzp-SGuE3l5MeryOw0076; __Secure-3PSID=g.a0006Ah_SYFPGmAcxCIBva0cxKJ2TTnXQhKelZEOHyF_v1YoS-xw_BVkAkwhge8iouoRo918JAACgYKAWkSARQSFQHGX2Mi-nTt9Xsv8a6-ufYm5lW8TBoVAUF8yKpkRUbHKUeMroiEL5O7wuin0076; HSID=AR2s7preyG1DuCu77; SSID=AnsE1IH8O-DDFN4SJ; APISID=zQvuDpXKCcnYzd5c/AYrvv5DpkaX_AfaWB; SAPISID=4x4qcQpkKXmwZgxN/Ax4ezeVLu_dUj0V4S; __Secure-1PAPISID=4x4qcQpkKXmwZgxN/Ax4ezeVLu_dUj0V4S; __Secure-3PAPISID=4x4qcQpkKXmwZgxN/Ax4ezeVLu_dUj0V4S; NID=528=Hk1mMcU14AS2b-OhRqpkIlRPAFyKMENyorKlzuC7XTIcie7E6M1D3p9Z_-zNFd2xCYRpUY5_PPX3UgDxq_citu1P_g4ZrZKnO3TbleQn_BCD4lXfIMr1rBnFPYqiyB4dCxDuBe8k__H0oappKrElnbxXwe-S2bcGRRsVjPxSMV-6J73bU-DSjtBH7kXfRW2mcEhtH08N3vB_tasREGGx2hwrhRGcJdkhhnAFRKtX-Ic0ZfWRr9bP-ZQ6IzGCSKPy8FGoIYEh3LSfIu6HEds9EXpTOYyDysUIHdMaGFqrtSZDzRtllKHlHIb_HKcut-6N23xpw0ydjjI37zvLMvuohJ5ZYrX9yYAW3fFvSkb6U-XeGqfJZqrDxwc3JZdvh36K5tScgS05fIaaGPmNitcJl1jN9DS4s3ZchLJzyr2yjjXrdN5zCNTJfmRkPMe-MWGyF9S2of4h-j61c929ji_NEElnFKpF5_TswXkh4Ir-u2xbW13Y2cVDwqdCKePhjvsKM3JS9k9U86zhzewK1rv4lgLACUHAVBWBvUk9zLcqYioeUin0gIgv0LrZThDtTSa6rugMwZMYHUdHrAeXrXzUIw-VawHKXY7LEFwdhAJyw3pEhbg2hTDsl3cN6I9AmMpCvdCf0nYdBpx7KSsVq_nOgQGoLjoZXBH07rq9wXDp8Egs2ObGz6qSfYONa6zqZS1WgdQJ1ARMiGjETU04VXr7LSr3y_SsFe9-TGKh9CwgGX_RSf4H7ZJHKR7fhDtyx2OhTNpQy1LXBfkc5WPO44OM5dRh8YU82hEd6FSqgvEt9puSIoUx2GUpd7y5FreQwpXW2bMcDRiWvkz-dv_e3Jz9Os8wPhMPUHxJrCkydGIYTUmJUWYjHQC81W3s9gr51s_QG7hxEDN895zdfpzVyCPkyAq0xw4u5ZStwvsUypq4D-kQS5LsD6Qn19GEeY7tNV3QchPWQRIC9sWuON9lkHmyzgegWuKJltaQOVAYyZ3WXmgq6Z9D0tNOty8Y1RGn9ZdQx95nV9iR0f9jVEYsPQMsH9GvSHnrBWaueZ2uKq2Dcmz-ltIySlJU2KJFzmtevmbHymZ1l5AX7kQcyZng7-MFba8B5MhLXtrZ0ueVh5Qm0ZVOVTFvxIXQfjXs20OnWp5PzWbs7GhaGOKvZbR91I_MAT-Cm-MwC7vhD0dVDYcVXj351ADDbKrLE3mSsH6YhbtF2zFKzfOlsbF2NulkUg5rMBnX7Lhjnj7EUEDEs7q59rbTDztz9aO-KrmA3dgMJkdLLL3cb2nopcyHSzOnrdlKf_SuMiTrIHjmxtDN73_bPxeURJJWXWzKLT__84rNTYV4YcPWJostWge7Wi68twKLLoezXiosPEUBaTUF7ONUXHL8xUalqnO4CJ4xsif-LHmNAIiYLmRquA1fdNCC5XzbM-dK2fCIweYaLZ-7CJcyNv-6iUQxxtAz0PzxEUhCpohCZ76tRjpmOeDTsCdBhlMPAMfKE6-1-DjqfQ5yvxqpMukgzQ3RNt-kp8JyttmWhaKZmWjM2ZvyU2qkhBal4xbknZK9KyyXpnFaStVKcvq1kZ3f6SQazXF6J-sBC9TOmSOxVUBxHAKZa-Z3j5womg0f_lgf7rdhW0MCuyqRou22tmR_ReuaDgJasomq6hgjR21C4QMgkWSrdt5LyDV3F4gTaYWQY1ueUW1I3f8o76eNvQJUaCA_fdHvNy-hP-gDBdDeNhHy1UeAfddXUSHy7U6eBevePzdBxAewdJMrRIDRUlD3jQVYTJ0Y_5YuAAFTxs_F6KwwzQqWUGdgjrRkwfam1MrHhBTsTsp_8Ipl-A_tCrT8EmiFWFbcKcwQxG8NUSLiOOjhvqW5rR3k7hPFGJ4_xG6FfNR9VMzn95OkE4Mosk7f-UuZFyCpSXNUnNvhfIjshC01_NUxpWuLIfRWDlfsBNUPBDJIA_Rrro6Y1tQjjWk2JgCcDwltGKKMVR8fOnN4mq_arlspB19H8iG6RNMBgs9dhIKdq6woEmdFbOhhOdAsiuoG8mo6prh3Rm4sIix4NQ-EjO-ZEvhiFJ7MZDLQLoRBYBxIOfiAUPjD2yZj8pEi7l2V9YJDVdHEbPfpoSBckkanMojT4X7vSekZjng49ER8cTRaOQtdHXtvBT-I1RjXUTGSDwluJRyQE0UtZg18_ELfhQptNIjrY52Wnw2T-YghdMN6MPZjHIK05mid1Xoz8W84qE_hkjU-i-xBQM6Af-UjGEDdlAzKcGkZZ5ipzxa0Hs7Pe9Jt-PUD2EcHIUKBVZ7ylKPznTFIzRwnSYxFjBQ6uD9hM8VdRKc-jZT-atpf_5tTezGJn3NKgoUOuV4b_J_yPncF9XdgWKhAMeYqbPDnNFoswwchwbrnEnmIOZRWHvNblMEYySOr_oqK6GK5j5EtHCZKAl5_jAXfSKFfE3pzqoeo-ift3CF9wJj1nO-hApRTH0vCs7e29z0M9YzcV1vFPKrurMhR1zaoRKvHn1cr9Ac1_ZWtMmWMFr5QUy1ff5cLoDmwOnlqGnuSMRp-wZOhs7vz_krmuok2XC8IAPq8_xT2jF_1ivBYvq11-qVriX4P_gYfFbEBF7bbmwFm_Gg6--3uT0mOPolYIIbnZUd8aib38Zw-CpJsdCO-Zszy2zcrJh_IZydxJoKoOLEFo0ffEYHnnt3TnWqHxWIGHCeNcydCCvjfn_w21Fg4n2T3RAXmNGhZEPhTTvnRK5G9laQsZB3YC8Oqa6cqAN6zYMH-24-9uREo3sCourXP5B3oMbdi-rTjd1iDxLKbBZ7nttIpimkqGZCp3s0SqTGO-JST07cJDVhxCGSJDC4HlH5kLv9hoOCizzema1Ibym2TT-wRrsaagzN9E_tQXtUu09SG0wWHt7hxlHJZ-0lyuM0Rh-RxlrCp4N2CJkbmYqJS1h5cBviJL2Qd8Lws11nJY_oSJ2iNo3oVUsgQx6BM8OoXsCL3y_z7jrkp-29emihi87wSDadKq_tbXvbOpjFBacIsVYawfZ5csmdfqHWPE3g2P0qTia8E0R_TIwWcZimv2R_xvZyO6-vkR6ipS2BQ0-S7mMFHFeROfoBRY8tljTaX-QcSpUO74Ie4_R16JEBmb6sYP99558qSxwceEKfksfJ2qXFY5_5KV62XJHHyaRzs4OQUKe8l12qowo1tGTT4DYNF7AoibCQjcswcATFLa9jCw1vTSRB5IRYY2-t3U0u11t_njbK2xlKF4ZvLV6OVqaz02Q; COMPASS=gemini-pd=CjwACWuJV93jFYb_b6k1ZbZc5AVi75OXfwVJx6huPFdJgLZgT-iphNSBtyIyTho-2Gurv4U86El7hPmdVFUQnZfSywYaXwAJa4lXuELTyQR94IuqMXm3Prh8Lu7SWLl7s_aqNrzJWeJ2MDgkC0W5bEEUhwuS4e0YG8G9X4eN2adwOW_if5UsVXzV4yAK_3QuREZuX3c6-0KTr4R-KCZwvRbHkQC3IAEwAQ:gemini-hl=CkkACWuJV4Jq7gXnYGXm-CCWRGf1MNczIJ0yMsen8R98zb0fdd_v1HDcw_-Y0Gxw7WZu_GGVl89NUAGecp6EG6tM_DjudIlkdiK-EPuw08sGGmwACWuJV2t4I2SGnafummLvI3daW16iBTVhhTv1Mh33zklIBSDSuc98xMZ7OxmpF1UNg5qxDfgX8TDD6WJBrsKQqpX99vhXIZFPjnxFuUNr6QAwqoC8_7S54lbV_N4PZao92zgNYl-lC-GzLXwgATAB; _ga_BF8Q35BMLM=GS2.1.s1769178348$o382$g1$t1769181568$j10$l0$h0; __Secure-1PSIDTS=sidts-CjYB7I_69CYnVFYRIqDuE04k5s8y9BzjBgZxdG0dHak_33DK0v5zFi2D5fI20l1pqzmusBAshH0QAA; __Secure-1PSIDRTS=sidts-CjYB7I_69CYnVFYRIqDuE04k5s8y9BzjBgZxdG0dHak_33DK0v5zFi2D5fI20l1pqzmusBAshH0QAA; __Secure-3PSIDTS=sidts-CjYB7I_69CYnVFYRIqDuE04k5s8y9BzjBgZxdG0dHak_33DK0v5zFi2D5fI20l1pqzmusBAshH0QAA; __Secure-3PSIDRTS=sidts-CjYB7I_69CYnVFYRIqDuE04k5s8y9BzjBgZxdG0dHak_33DK0v5zFi2D5fI20l1pqzmusBAshH0QAA; _ga_WC57KJ50ZZ=GS2.1.s1769178346$o53$g1$t1769181769$j60$l0$h0; SIDCC=AKEyXzXEAS7DA8EPw2QTUSAhApuhwQnFDPdPp6YOnHYxI9YwvmumhN_dI50eN4dx0gBa72EKUHs; __Secure-1PSIDCC=AKEyXzWAUDpOs3PEp0h8lMnYQOXejSOhwPbSVd7-vrXZ9KPHbxVm3eNyzRTNZWmlgeZntrkO7npc; __Secure-3PSIDCC=AKEyXzW3868apQO6w_xUStDiqCP9v3RxH1n-jkB0DQwf5S3BsDnZ8ErEUhar6OROLQkRKnAd-zMV";

const F_SID = "7493167831294892309";
const BL_LABEL = "boq_assistant-bard-web-server_20260121.00_p1";
const HL_LANG = "vi";
const REQ_ID = "21477148";
const AT_TOKEN = "AEHmXlGF3OgfeZ2C6fRUpB-9hrC9:1769178327391";

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
}

// Interface de cap nhat cau hinh
export interface UpdateGeminiChatConfigDTO extends Partial<CreateGeminiChatConfigDTO> {
  isActive?: boolean;
}

class GeminiChatServiceClass {
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
        db.prepare('UPDATE gemini_chat_config SET is_active = 0').run();
        
        db.prepare(`
        INSERT INTO gemini_chat_config (
            id, name, cookie, bl_label, f_sid, at_token, 
            conv_id, resp_id, cand_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
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
    if (data.candId !== undefined) { updates.push('cand_id = @candId'); params.candId = data.candId; }
    
    if (data.isActive !== undefined) {
      if (data.isActive) {
        db.prepare('UPDATE gemini_chat_config SET is_active = 0').run();
      }
      updates.push('is_active = @isActive');
      params.isActive = data.isActive ? 1 : 0;
    }

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
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // =======================================================
  // GUI TIN NHAN DEN GEMINI WEB API - STRICT PYTHON PORT
  // =======================================================

  // Static counter for request ID
  private static reqIdCounter = 21477148;

  async sendMessage(message: string, configId: string, context?: { conversationId: string; responseId: string; choiceId: string }): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string }> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[GeminiChatService] Sending message (Attempt ${attempt}/${MAX_RETRIES})...`);
      
      const result = await this._sendMessageInternal(message, configId, context);
      
      if (result.success) {
        return result;
      }
      
      // If failed, check if we should retry
      if (attempt < MAX_RETRIES) {
        console.log(`[GeminiChatService] Request failed, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error(`[GeminiChatService] All ${MAX_RETRIES} attempts failed.`);
        return result; // Return last error
      }
    }
    
    return { success: false, error: 'Unexpected error in retry loop' };
  }

  private async _sendMessageInternal(message: string, configId: string, context?: { conversationId: string; responseId: string; choiceId: string }): Promise<{ success: boolean; data?: { text: string; context: { conversationId: string; responseId: string; choiceId: string } }; error?: string }> {
    // 1. Get Config from DB
    const config = this.getById(configId);
    if (!config) {
        return { success: false, error: `Config not found: ${configId}` };
    }

    const { cookie, blLabel: configBlLabel, fSid: configFSid, atToken } = config;
    
    // Use config values if available, otherwise fallback to hardcoded defaults
    const blLabel = configBlLabel || BL_LABEL;
    const fSid = configFSid || F_SID;
    
    // Log if using fallback
    if (!configBlLabel || !configFSid) {
        console.log('[GeminiChatService] Using fallback values for blLabel/fSid');
    }

    const hl = HL_LANG;
    // Increment req_id for each request
    GeminiChatServiceClass.reqIdCounter += 100;
    const reqId = String(GeminiChatServiceClass.reqIdCounter);

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
        "at": atToken
    });

    try {
        console.log('[GeminiChatService] Fetching:', url);
        console.log('[GeminiChatService] >>> fetch START');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                "Host": "gemini.google.com",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Origin": "https://gemini.google.com",
                "Referer": "https://gemini.google.com/",
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
        
        const lines = responseText.split('\n');
        let foundText = '';
        let newContext = { conversationId: "", responseId: "", choiceId: "" };

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            try {
                let jsonPart = trimmed;
                if (/^\d+$/.test(jsonPart)) continue;

                const dataObj = JSON.parse(jsonPart);
                
                if (Array.isArray(dataObj) && dataObj.length > 0) {
                    const payloadItem = dataObj[0]; // [ "wrb.fr", ..., string_json, ... ]
                    if (Array.isArray(payloadItem) && payloadItem.length > 2 && payloadItem[2]) {
                        if (typeof payloadItem[2] === 'string') {
                            const innerData = JSON.parse(payloadItem[2]);
                             if (Array.isArray(innerData) && innerData.length >= 5) {
                                 // Parse conversationId - might be combined like "c_xxx,r_yyy"
                                 if (innerData[1]) {
                                     const idString = String(innerData[1]);
                                     if (idString.includes(',')) {
                                         // Split combined ID
                                         const parts = idString.split(',');
                                         newContext.conversationId = parts[0] || '';
                                         newContext.responseId = parts[1] || '';
                                     } else {
                                         newContext.conversationId = idString;
                                     }
                                 }
                                 
                                 // Try to get responseId from index 11 if not already set
                                 if (!newContext.responseId && innerData[11]) {
                                     newContext.responseId = String(innerData[11]);
                                 }
                                 
                                 // Also try index 3 as alternative location
                                 if (!newContext.responseId && innerData[3]) {
                                     newContext.responseId = String(innerData[3]);
                                 }
                                 
                                 const candidates = innerData[4]; 
                                 if (Array.isArray(candidates) && candidates.length > 0) {
                                     const candidate = candidates[0];
                                     if (candidate && candidate.length > 1 && candidate[1] && candidate[1].length > 0) {
                                         const txt = candidate[1][0];
                                         if (txt) {
                                             foundText = txt;
                                         }
                                         if (candidate[0]) newContext.choiceId = String(candidate[0]);
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

            return { 
                success: true, 
                data: {
                    text: foundText,
                    context: newContext
                }
            };
        } else {
             console.error('[GeminiChatService] No text found in response!');
             return { success: false, error: "No text found in response" };
        }

    } catch (error) {
        console.error("[GeminiChatService] Fetch Error:", error);
        return { success: false, error: String(error) };
    }
  }
}

// Singleton instance
export const GeminiChatService = new GeminiChatServiceClass();
