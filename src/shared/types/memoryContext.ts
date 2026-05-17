export interface MemoryContextDebugItem {
  memory: string;
  score: number;
  entities?: string[];
  chapterId?: string;
  chapterIndex?: number;
}

export interface MemoryContextSearchRequest {
  projectId: string;
  feature: string;
  namespace: string;
  queryText: string;
  topK?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryContextSearchResult {
  success: boolean;
  memories: string[];
  promptContext: string;
  debug: MemoryContextDebugItem[];
  namespace?: string;
  warning?: string;
  error?: string;
}

export interface MemoryContextAddRequest {
  projectId: string;
  feature: string;
  namespace: string;
  sourceText: string;
  translatedText: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryContextAddResult {
  success: boolean;
  storedCount: number;
  entities: string[];
  namespace?: string;
  warning?: string;
  error?: string;
}

export interface MemoryContextStatsRequest {
  projectId: string;
  feature: string;
  namespace: string;
}

export interface MemoryContextStatsResult {
  success: boolean;
  namespace: string;
  totalMemories: number;
  totalNamespaces?: number;
  recentEntities: string[];
  error?: string;
}

export interface MemoryContextClearNamespaceRequest {
  projectId: string;
  feature: string;
  namespace: string;
}

export interface MemoryContextClearNamespaceResult {
  success: boolean;
  namespace: string;
  clearedCount: number;
  error?: string;
}

export interface MemoryContextHealthResult {
  success: boolean;
  pythonOk: boolean;
  mem0Ok: boolean;
  spacyOk: boolean;
  spacyModelOk: boolean;
  providerConfigured: boolean;
  backend: 'mem0' | 'local_fallback' | 'unavailable';
  warning?: string;
  error?: string;
  details?: {
    pythonPath?: string;
    pythonVersion?: string;
    storePath?: string;
    runtimeMode?: 'embedded' | 'system';
    spacyModelName?: string;
    spacyLoadedModel?: string;
    modules?: Record<string, boolean>;
    providerConfigured?: boolean;
    backend?: 'mem0' | 'local_fallback' | 'unavailable';
  };
}

export const MEMORY_CONTEXT_IPC_CHANNELS = {
  GET_HEALTH: 'memoryContext:getHealth',
  SEARCH: 'memoryContext:search',
  ADD: 'memoryContext:add',
  CLEAR_NAMESPACE: 'memoryContext:clearNamespace',
  GET_STATS: 'memoryContext:getStats'
} as const;
