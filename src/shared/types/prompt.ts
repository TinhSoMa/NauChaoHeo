
export interface TranslationPrompt {
  id: string;
  name: string;        // Tên prompt (ví dụ: "Dịch truyện Tiên Hiệp")
  description?: string; // Mô tả
  sourceLang: string;  // Ngôn ngữ nguồn (en, zh, etc.)
  targetLang: string;  // Ngôn ngữ đích
  content: string;     // JSON string content của prompt
  isDefault?: boolean; // Có phải prompt mặc định không
  createdAt: number;
  updatedAt: number;
}

export interface CreatePromptDTO {
  name: string;
  description?: string;
  sourceLang: string;
  targetLang: string;
  content: string;
  isDefault?: boolean;
}

export const PROMPT_IPC_CHANNELS = {
  GET_ALL: 'prompt:getAll',
  GET_BY_ID: 'prompt:getById',
  CREATE: 'prompt:create',
  UPDATE: 'prompt:update',
  DELETE: 'prompt:delete',
  SET_DEFAULT: 'prompt:setDefault'
} as const;
