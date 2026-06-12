
export type PromptType = 'translation' | 'summary' | 'caption';

export interface TranslationPrompt {
  id: string;
  name: string;        // Tên prompt (ví dụ: "Dịch truyện Tiên Hiệp")
  description?: string; // Mô tả
  sourceLang: string;  // Ngôn ngữ nguồn (en, zh, etc.)
  targetLang: string;  // Ngôn ngữ đích
  content: string;     // JSON string content của prompt
  isDefault?: boolean; // Có phải prompt mặc định không
  promptType: PromptType;
  languageBucket: string;
  groupId: string | null;
  groupName?: string;
  familyId: string;
  version: number;
  isLatest: boolean;
  archived: boolean;
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
  promptType?: PromptType;
  groupId?: string | null;
  familyId?: string;
}

export interface PromptGroup {
  id: string;
  languageBucket: string;
  name: string;
  normalizedName: string;
  createdAt: number;
  updatedAt: number;
}

export interface PromptLanguageBucketSummary {
  languageBucket: string;
  sourceLang: string;
  targetLang: string;
  totalFamilies: number;
  totalPrompts: number;
}

export interface PromptFamilySummary {
  familyId: string;
  promptType: PromptType;
  languageBucket: string;
  sourceLang: string;
  targetLang: string;
  groupId: string | null;
  groupName?: string;
  latestPromptId: string;
  latestName: string;
  latestVersion: number;
  latestUpdatedAt: number;
}

export interface CreatePromptGroupDTO {
  languageBucket: string;
  name: string;
}

export interface RenamePromptGroupDTO {
  groupId: string;
  name: string;
}

export interface MovePromptFamilyDTO {
  familyId: string;
  targetGroupId: string;
}

export interface PromptHierarchySnapshot {
  languages: PromptLanguageBucketSummary[];
  groups: PromptGroup[];
  families: PromptFamilySummary[];
}

export const PROMPT_IPC_CHANNELS = {
  GET_ALL: 'prompt:getAll',
  GET_BY_ID: 'prompt:getById',
  CREATE: 'prompt:create',
  UPDATE: 'prompt:update',
  DELETE: 'prompt:delete',
  SET_DEFAULT: 'prompt:setDefault',
  GET_GROUPS: 'prompt:getGroups',
  CREATE_GROUP: 'prompt:createGroup',
  RENAME_GROUP: 'prompt:renameGroup',
  DELETE_GROUP: 'prompt:deleteGroup',
  GET_FAMILIES: 'prompt:getFamilies',
  GET_VERSIONS: 'prompt:getVersions',
  MOVE_FAMILY: 'prompt:moveFamily',
  GET_HIERARCHY: 'prompt:getHierarchy',
  RESOLVE_LATEST_BY_FAMILY: 'prompt:resolveLatestByFamily',
} as const;
