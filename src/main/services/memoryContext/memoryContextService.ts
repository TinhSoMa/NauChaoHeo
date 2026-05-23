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
      const diagnostics = this.bridge.getDiagnostics();
      return {
        ...response.data,
        success: true,
        details: {
          ...response.data.details,
          pythonPath: runtimeInfo?.runtime?.pythonPath,
          runtimeMode: runtimeInfo?.runtime?.mode,
          storePath: this.bridge.getStorePath(),
          workerPath: diagnostics.workerPath,
          dependencyCheck: diagnostics.dependencyCheck,
          buildStamp: diagnostics.buildStamp ?? undefined,
          errorCode: diagnostics.errorCode
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
          facts: [],
          glossary: [],
          entities: [],
          nouns: [],
          debug: [],
          namespace: request.namespace,
          error: response.error || 'Memory context search failed'
        };
      }
      const data = response.data as any;
      return {
        success: true,
        memories: data.memories || [],
        promptContext: data.promptContext || '',
        facts: Array.isArray(data.facts) ? data.facts : [],
        glossary: Array.isArray(data.glossary) ? data.glossary : [],
        entities: Array.isArray(data.entities) ? data.entities : [],
        nouns: Array.isArray(data.nouns) ? data.nouns : [],
        nounSyncDebug: data.nounSyncDebug,
        debug: data.debug || [],
        namespace: data.namespace || request.namespace,
        runtimeMode: data.runtimeMode,
        providerStatus: data.providerStatus,
        warning: data.warning
      };
    } catch (error) {
      return {
        success: false,
        memories: [],
        promptContext: '',
        facts: [],
        glossary: [],
        entities: [],
        nouns: [],
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
          storedFacts: 0,
          storedEntities: 0,
          entities: [],
          facts: [],
          glossary: [],
          nouns: [],
          namespace: request.namespace,
          error: response.error || 'Memory context add failed'
        };
      }
      const data = response.data as any;
      return {
        success: true,
        storedCount: data.storedCount || 0,
        storedFacts: data.storedFacts || 0,
        storedEntities: data.storedEntities || 0,
        entities: data.entities || [],
        facts: Array.isArray(data.facts) ? data.facts : [],
        glossary: Array.isArray(data.glossary) ? data.glossary : [],
        nouns: Array.isArray(data.nouns) ? data.nouns : [],
        nounSyncDebug: data.nounSyncDebug,
        namespace: data.namespace || request.namespace,
        runtimeMode: data.runtimeMode,
        providerStatus: data.providerStatus,
        warning: data.warning
      };
    } catch (error) {
      return {
        success: false,
        storedCount: 0,
        storedFacts: 0,
        storedEntities: 0,
        entities: [],
        facts: [],
        glossary: [],
        nouns: [],
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
          recentNouns: [],
          newNounsLastIngest: 0,
          error: response.error || 'Memory context stats failed'
        };
      }
      return {
        success: true,
        namespace: response.data.namespace || request.namespace,
        totalMemories: response.data.totalMemories || 0,
        totalFacts: (response.data as any).totalFacts || 0,
        totalEntities: (response.data as any).totalEntities || 0,
        totalNouns: (response.data as any).totalNouns || 0,
        newNounsLastIngest: (response.data as any).newNounsLastIngest || 0,
        totalNamespaces: response.data.totalNamespaces,
        recentEntities: response.data.recentEntities || [],
        recentNouns: (response.data as any).recentNouns || [],
        runtimeMode: (response.data as any).runtimeMode
      };
    } catch (error) {
      return {
        success: false,
        namespace: request.namespace,
        totalMemories: 0,
        recentEntities: [],
        recentNouns: [],
        newNounsLastIngest: 0,
        error: String(error)
      };
    }
  }

  async shutdown(): Promise<void> {
    await this.bridge.shutdown();
  }

  private buildUnavailableHealth(error: string): MemoryContextHealthResult {
    const diagnostics = this.bridge.getDiagnostics();
    const errorCode = this.parseErrorCode(error) || diagnostics.errorCode;
    const packagedRuntimeFailure = Boolean(
      errorCode && errorCode.startsWith('EMBEDDED_')
    );
    return {
      success: false,
      pythonOk: false,
      mem0Ok: false,
      spacyOk: false,
      spacyModelOk: false,
      undertheseaOk: false,
      providerConfigured: false,
      backend: 'unavailable',
      error,
      warning: packagedRuntimeFailure
        ? 'Runtime memory đóng gói bị thiếu hoặc hỏng. Vui lòng cài lại app hoặc build lại installer.'
        : 'Cài dependency: pip install mem0ai[nlp] underthesea && python -m spacy download xx_ent_wiki_sm',
      providerStatus: {
        configured: false,
        active: false,
        reason: 'runtime_unavailable'
      },
      details: {
        pythonPath: diagnostics.runtime?.pythonPath,
        workerPath: diagnostics.workerPath,
        runtimeMode: diagnostics.runtime?.mode,
        spacyModelName: 'xx_ent_wiki_sm',
        storePath: this.bridge.getStorePath(),
        dependencyCheck: diagnostics.dependencyCheck,
        buildStamp: diagnostics.buildStamp ?? undefined,
        errorCode
      }
    };
  }

  private parseErrorCode(errorText: string): string | undefined {
    const match = String(errorText || '').match(/^([A-Z_]+):/);
    return match?.[1];
  }
}

let instance: MemoryContextService | null = null;

export function getMemoryContextService(): MemoryContextService {
  if (!instance) {
    instance = new MemoryContextService();
  }
  return instance;
}
