export interface MemoryContextDebugItem {
  memory: string;
  score: number;
  factId?: string;
  kind?: string;
  entities?: string[];
  chapterId?: string;
  chapterIndex?: number;
  matchedSignals?: string[];
  adapterMode?: string;
}

export interface MemoryFact {
  factId: string;
  kind: string;
  canonicalValue: string;
  text: string;
  aliases?: string[];
  entityId?: string;
  entityType?: string;
  sourceRefs?: string[];
  chapterId?: string;
  chapterIndex?: number;
  score?: number;
}

export interface MemoryGlossaryEntry {
  entryId: string;
  category: string;
  sourceTerm: string;
  targetTerm: string;
  aliases?: string[];
  chapterId?: string;
  chapterIndex?: number;
  confidence?: number;
}

export interface MemoryEntity {
  entityId: string;
  entityType: string;
  canonicalValue: string;
  aliases: string[];
  chapterId?: string;
  chapterIndex?: number;
  confidence?: number;
}

export interface MemoryNounEntry {
  value: string;
  normalizedValue?: string;
  count?: number;
  aliases?: string[];
  source?: 'project_dictionary' | 'chapter_artifact';
  provenance?: string;
  mappedFrom?: string;
  chapterId?: string;
  chapterIndex?: number;
  confidence?: number;
}

export interface MemoryNounSyncDebug {
  rawCandidates: string[];
  normalizedCandidates: string[];
  mappedCanonical: Array<{
    input: string;
    normalized: string;
    canonical: string;
    reason: 'exact' | 'fuzzy' | 'new';
  }>;
  rejectedCandidates: string[];
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
  facts?: MemoryFact[];
  glossary?: MemoryGlossaryEntry[];
  entities?: MemoryEntity[];
  nouns?: MemoryNounEntry[];
  nounSyncDebug?: MemoryNounSyncDebug;
  debug: MemoryContextDebugItem[];
  namespace?: string;
  runtimeMode?: 'mem0_provider' | 'local_fallback' | 'unavailable';
  providerStatus?: {
    configured: boolean;
    active: boolean;
    providerName?: string;
    reason?: string;
  };
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
  storedFacts?: number;
  storedEntities?: number;
  facts?: MemoryFact[];
  glossary?: MemoryGlossaryEntry[];
  nouns?: MemoryNounEntry[];
  nounSyncDebug?: MemoryNounSyncDebug;
  namespace?: string;
  runtimeMode?: 'mem0_provider' | 'local_fallback' | 'unavailable';
  providerStatus?: {
    configured: boolean;
    active: boolean;
    providerName?: string;
    reason?: string;
  };
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
  totalFacts?: number;
  totalEntities?: number;
  totalNouns?: number;
  newNounsLastIngest?: number;
  totalNamespaces?: number;
  recentEntities: string[];
  recentNouns?: string[];
  runtimeMode?: 'mem0_provider' | 'local_fallback' | 'unavailable';
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
  undertheseaOk?: boolean;
  providerConfigured: boolean;
  backend: 'mem0' | 'mem0_provider' | 'local_fallback' | 'unavailable';
  warning?: string;
  error?: string;
  providerStatus?: {
    configured: boolean;
    active: boolean;
    providerName?: string;
    reason?: string;
  };
  details?: {
    pythonPath?: string;
    pythonVersion?: string;
    workerPath?: string;
    storePath?: string;
    runtimeMode?: 'embedded' | 'system';
    spacyModelName?: string;
    spacyLoadedModel?: string;
    modules?: Record<string, boolean>;
    dependencyCheck?: {
      sqlite3: boolean;
      mem0: boolean;
      spacy: boolean;
      spacyModel: boolean;
      underthesea?: boolean;
    };
    buildStamp?: {
      generatedAt?: string;
      pythonVersion?: string;
      mem0Version?: string;
      spacyVersion?: string;
      spacyModelName?: string;
      undertheseaVersion?: string;
      runtimeDir?: string;
    };
    errorCode?: string;
    providerConfigured?: boolean;
    backend?: 'mem0' | 'mem0_provider' | 'local_fallback' | 'unavailable';
    providerName?: string;
  };
}

export const MEMORY_CONTEXT_IPC_CHANNELS = {
  GET_HEALTH: 'memoryContext:getHealth',
  SEARCH: 'memoryContext:search',
  ADD: 'memoryContext:add',
  CLEAR_NAMESPACE: 'memoryContext:clearNamespace',
  GET_STATS: 'memoryContext:getStats'
} as const;
