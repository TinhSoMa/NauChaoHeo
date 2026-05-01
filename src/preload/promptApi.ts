import { ipcRenderer } from 'electron';
import {
  PROMPT_IPC_CHANNELS,
  CreatePromptDTO,
  CreatePromptGroupDTO,
  MovePromptFamilyDTO,
  PromptFamilySummary,
  PromptGroup,
  PromptHierarchySnapshot,
  RenamePromptGroupDTO,
  TranslationPrompt,
} from '../shared/types/prompt';

export interface PromptAPI {
  getAll: () => Promise<TranslationPrompt[]>;
  getById: (id: string) => Promise<TranslationPrompt | null>;
  create: (data: CreatePromptDTO) => Promise<TranslationPrompt>;
  update: (id: string, data: Partial<CreatePromptDTO>) => Promise<TranslationPrompt>;
  delete: (id: string) => Promise<boolean>;
  setDefault: (id: string) => Promise<boolean>;
  getGroups: (languageBucket?: string) => Promise<PromptGroup[]>;
  createGroup: (payload: CreatePromptGroupDTO) => Promise<PromptGroup>;
  renameGroup: (payload: RenamePromptGroupDTO) => Promise<PromptGroup>;
  deleteGroup: (groupId: string) => Promise<boolean>;
  getFamilies: (payload?: { languageBucket?: string; groupId?: string; promptType?: 'translation' | 'summary' | 'caption' }) => Promise<PromptFamilySummary[]>;
  getVersions: (familyId: string) => Promise<TranslationPrompt[]>;
  moveFamily: (payload: MovePromptFamilyDTO) => Promise<boolean>;
  getHierarchy: () => Promise<PromptHierarchySnapshot>;
  resolveLatestByFamily: (familyId: string) => Promise<TranslationPrompt | null>;
}

export const promptApi: PromptAPI = {
  getAll: () => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.GET_ALL),
  getById: (id: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.GET_BY_ID, id),
  create: (data: CreatePromptDTO) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.CREATE, data),
  update: (id: string, data: Partial<CreatePromptDTO>) => 
    ipcRenderer.invoke(PROMPT_IPC_CHANNELS.UPDATE, { id, ...data }),
  delete: (id: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.DELETE, id),
  setDefault: (id: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.SET_DEFAULT, id),
  getGroups: (languageBucket?: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.GET_GROUPS, { languageBucket }),
  createGroup: (payload: CreatePromptGroupDTO) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.CREATE_GROUP, payload),
  renameGroup: (payload: RenamePromptGroupDTO) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.RENAME_GROUP, payload),
  deleteGroup: (groupId: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.DELETE_GROUP, groupId),
  getFamilies: (payload?: { languageBucket?: string; groupId?: string; promptType?: 'translation' | 'summary' | 'caption' }) =>
    ipcRenderer.invoke(PROMPT_IPC_CHANNELS.GET_FAMILIES, payload || {}),
  getVersions: (familyId: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.GET_VERSIONS, familyId),
  moveFamily: (payload: MovePromptFamilyDTO) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.MOVE_FAMILY, payload),
  getHierarchy: () => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.GET_HIERARCHY),
  resolveLatestByFamily: (familyId: string) => ipcRenderer.invoke(PROMPT_IPC_CHANNELS.RESOLVE_LATEST_BY_FAMILY, familyId),
};
