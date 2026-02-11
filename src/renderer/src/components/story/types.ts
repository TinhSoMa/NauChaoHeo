export interface GeminiChatConfigLite {
  id: string;
  cookie: string;
  atToken: string;
  isActive: boolean;
  isError?: boolean;
  email?: string;
}

export type TokenContext = { 
  conversationId: string; 
  responseId: string; 
  choiceId: string;
};
