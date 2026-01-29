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

export interface UpdateGeminiChatConfigDTO extends Partial<CreateGeminiChatConfigDTO> {
  isActive?: boolean;
}

// DEPRECATED: For backward compatibility with legacy single-row config table
export interface GeminiCookieConfig {
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  reqId?: string;
  updatedAt: number;
}
