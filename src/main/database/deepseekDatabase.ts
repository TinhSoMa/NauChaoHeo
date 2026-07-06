/**
 * DeepSeek Config Database Service
 * Lưu 1 API key + default model duy nhất (id = 1)
 */

import { getDatabase } from './schema';

export interface DeepSeekDbRow {
  apiKey: string | null;
  defaultModel: string;
  systemPrompt: string;
}

const DEFAULT_SYSTEM_PROMPT = `# Subtitle Translation Prompt

## Task
Dịch các dòng subtitle sau. Output là JSON thuần, KHÔNG markdown, KHÔNG code block.

## Success Response Schema
{
  "status": "success",
  "data": {
    "translations": [
      { "index": 1, "translated": "..." }
    ],
    "summary": {
      "total_sentences": <số_lượng>,
      "input_count": <số_lượng>,
      "output_count": <số_lượng>,
      "match": true,
      "language_style": "casual"
    }
  }
}

## Error Response Schema
{
  "status": "error",
  "error": {
    "code": "ERROR_PROCESSING_FAILED",
    "message": "..."
  }
}

## Critical Rules
1. Mỗi câu input = 1 object output. Index phải khớp chính xác (bắt đầu từ 1).
2. KHÔNG gộp câu — mỗi câu input tương ứng đúng 1 câu translated.
3. KHÔNG có markdown hay text thừa — CHỈ trả về JSON thuần.

## Terminology
- Tên nhân vật: Giữ nguyên, không dịch.
- Địa danh: Dịch âm Hán Việt nếu có.
- Đại từ: Phù hợp văn hóa Việt.`;

export class DeepSeekDatabase {
  static get(): DeepSeekDbRow | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT api_key, default_model, system_prompt FROM deepseek_config WHERE id = 1`).get() as any;
    if (!row) return null;
    return {
      apiKey: row.api_key ?? null,
      defaultModel: row.default_model || 'deepseek-v4-flash',
      systemPrompt: row.system_prompt || DEFAULT_SYSTEM_PROMPT,
    };
  }

  static upsert(apiKey: string | null, defaultModel: string, systemPrompt?: string): void {
    const db = getDatabase();
    const updatedAt = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO deepseek_config (id, api_key, default_model, system_prompt, updated_at)
      VALUES (1, ?, ?, ?, ?)
    `).run(apiKey, defaultModel, systemPrompt ?? DEFAULT_SYSTEM_PROMPT, updatedAt);
  }

  static getDefaultSystemPrompt(): string {
    return DEFAULT_SYSTEM_PROMPT;
  }
}
