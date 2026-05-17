import type {
  MemoryContextAddRequest,
  MemoryContextAddResult,
  MemoryContextClearNamespaceRequest,
  MemoryContextClearNamespaceResult,
  MemoryContextHealthResult,
  MemoryContextSearchRequest,
  MemoryContextSearchResult,
  MemoryContextStatsRequest,
  MemoryContextStatsResult
} from '../../../shared/types';
import { MemoryContextPythonBridge } from './pythonBridge';

export class MemoryContextService {
  private readonly bridge = new MemoryContextPythonBridge();

  async getHealth(): Promise<MemoryContextHealthResult> {
    try {
      const response = await this.bridge.request<MemoryContextHealthResult>('health', {}, 10000);
      if (!response.success || !response.data) {
        return this.buildUnavailableHealth(response.error || 'Memory context health failed');
      }
      const runtimeInfo = this.bridge.getRuntimeInfo();
      return {
        ...response.data,
        success: true,
        details: {
          ...response.data.details,
          pythonPath: runtimeInfo?.runtime?.pythonPath,
          runtimeMode: runtimeInfo?.runtime?.mode,
          storePath: this.bridge.getStorePath()
        }
      };
    } catch (error) {
      return this.buildUnavailableHealth(String(error));
    }
  }

  async searchContext(request: MemoryContextSearchRequest): Promise<MemoryContextSearchResult> {
    try {
      const response = await this.bridge.request<Omit<MemoryContextSearchResult, 'success'>>(
        'search_context',
        request as unknown as Record<string, unknown>,
        30000
      );
      if (!response.success || !response.data) {
        return {
          success: false,
          memories: [],
          promptContext: '',
          debug: [],
          namespace: request.namespace,
          error: response.error || 'Memory context search failed'
        };
      }
      return {
        success: true,
        memories: response.data.memories || [],
        promptContext: response.data.promptContext || '',
        debug: response.data.debug || [],
        namespace: response.data.namespace || request.namespace,
        warning: response.data.warning
      };
    } catch (error) {
      return {
        success: false,
        memories: [],
        promptContext: '',
        debug: [],
        namespace: request.namespace,
        error: String(error)
      };
    }
  }

  async addMemory(request: MemoryContextAddRequest): Promise<MemoryContextAddResult> {
    try {
      const response = await this.bridge.request<Omit<MemoryContextAddResult, 'success'>>(
        'add_translation_memory',
        request as unknown as Record<string, unknown>,
        30000
      );
      if (!response.success || !response.data) {
        return {
          success: false,
          storedCount: 0,
          entities: [],
          namespace: request.namespace,
          error: response.error || 'Memory context add failed'
        };
      }
      return {
        success: true,
        storedCount: response.data.storedCount || 0,
        entities: response.data.entities || [],
        namespace: response.data.namespace || request.namespace,
        warning: response.data.warning
      };
    } catch (error) {
      return {
        success: false,
        storedCount: 0,
        entities: [],
        namespace: request.namespace,
        error: String(error)
      };
    }
  }

  async clearNamespace(request: MemoryContextClearNamespaceRequest): Promise<MemoryContextClearNamespaceResult> {
    try {
      const response = await this.bridge.request<Omit<MemoryContextClearNamespaceResult, 'success'>>(
        'clear_namespace',
        request as unknown as Record<string, unknown>,
        15000
      );
      if (!response.success || !response.data) {
        return {
          success: false,
          namespace: request.namespace,
          clearedCount: 0,
          error: response.error || 'Memory context clear failed'
        };
      }
      return {
        success: true,
        namespace: response.data.namespace || request.namespace,
        clearedCount: response.data.clearedCount || 0
      };
    } catch (error) {
      return {
        success: false,
        namespace: request.namespace,
        clearedCount: 0,
        error: String(error)
      };
    }
  }

  async getStats(request: MemoryContextStatsRequest): Promise<MemoryContextStatsResult> {
    try {
      const response = await this.bridge.request<Omit<MemoryContextStatsResult, 'success'>>(
        'stats',
        request as unknown as Record<string, unknown>,
        15000
      );
      if (!response.success || !response.data) {
        return {
          success: false,
          namespace: request.namespace,
          totalMemories: 0,
          recentEntities: [],
          error: response.error || 'Memory context stats failed'
        };
      }
      return {
        success: true,
        namespace: response.data.namespace || request.namespace,
        totalMemories: response.data.totalMemories || 0,
        totalNamespaces: response.data.totalNamespaces,
        recentEntities: response.data.recentEntities || []
      };
    } catch (error) {
      return {
        success: false,
        namespace: request.namespace,
        totalMemories: 0,
        recentEntities: [],
        error: String(error)
      };
    }
  }

  async shutdown(): Promise<void> {
    await this.bridge.shutdown();
  }

  private buildUnavailableHealth(error: string): MemoryContextHealthResult {
    return {
      success: false,
      pythonOk: false,
      mem0Ok: false,
      spacyOk: false,
      spacyModelOk: false,
      providerConfigured: false,
      backend: 'unavailable',
      error,
      warning: 'Cài dependency: pip install mem0ai[nlp] && python -m spacy download xx_ent_wiki_sm',
      details: {
        spacyModelName: 'xx_ent_wiki_sm',
        storePath: this.bridge.getStorePath()
      }
    };
  }
}

let instance: MemoryContextService | null = null;

export function getMemoryContextService(): MemoryContextService {
  if (!instance) {
    instance = new MemoryContextService();
  }
  return instance;
}
