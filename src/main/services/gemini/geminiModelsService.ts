/**
 * Gemini Models Service
 * Quan ly catalog model dong (CRUD + sync Google) va default runtime model.
 */

import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_LIST,
  type GeminiCatalogModel,
  type GeminiCatalogModelInput,
  type GeminiCatalogModelUpdate,
  type GeminiSyncModelsResult,
} from '../../../shared/types/gemini';
import { GeminiModelsDatabase } from '../../database/geminiModelsDatabase';
import { getEmbeddedKeys } from './apiKeys';

function normalizeModelId(raw: string | null | undefined): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('models/')) {
    return trimmed.slice('models/'.length).trim();
  }
  const modelsSlashIndex = trimmed.indexOf('/models/');
  if (modelsSlashIndex >= 0) {
    return trimmed.slice(modelsSlashIndex + '/models/'.length).trim();
  }
  return trimmed;
}

function isLikelyTextGenerationModel(
  modelId: string,
  model: { supportedActions?: unknown },
): boolean {
  const cleanId = normalizeModelId(modelId).toLowerCase();
  if (!cleanId.startsWith('gemini-')) {
    return false;
  }

  if (cleanId.includes('embedding')) {
    return false;
  }

  const actions = Array.isArray(model.supportedActions)
    ? model.supportedActions.map((value) => String(value).toLowerCase())
    : [];

  if (actions.length === 0) {
    return true;
  }

  return actions.some((action) => action.includes('generatecontent'));
}

function pickFirstApiKeyForSync(): string | null {
  const embedded = getEmbeddedKeys();
  for (const account of embedded) {
    for (const project of account.projects || []) {
      const apiKey = typeof project.apiKey === 'string' ? project.apiKey.trim() : '';
      if (apiKey) {
        return apiKey;
      }
    }
  }
  return null;
}

export class GeminiModelsService {
  getModels(includeDisabled = true): GeminiCatalogModel[] {
    return includeDisabled
      ? GeminiModelsDatabase.getAllModels()
      : GeminiModelsDatabase.getEnabledModels();
  }

  getDefaultModelId(): string | null {
    return GeminiModelsDatabase.getDefaultModelId();
  }

  setDefaultModelId(modelId: string): { success: boolean; error?: string; defaultModelId?: string } {
    const cleanId = normalizeModelId(modelId);
    if (!cleanId) {
      return { success: false, error: 'MODEL_ID_EMPTY' };
    }

    const model = GeminiModelsDatabase.getModelById(cleanId);
    if (!model) {
      return { success: false, error: 'MODEL_NOT_FOUND' };
    }
    if (!model.enabled) {
      return { success: false, error: 'MODEL_DISABLED' };
    }

    GeminiModelsDatabase.setDefaultModelId(cleanId);
    return { success: true, defaultModelId: cleanId };
  }

  resolveModelId(requestedModelId?: string | null): string {
    const requested = normalizeModelId(requestedModelId || '');
    if (requested) {
      const requestedModel = GeminiModelsDatabase.getModelById(requested);
      if (requestedModel?.enabled) {
        return requestedModel.modelId;
      }
    }

    const storedDefault = GeminiModelsDatabase.getDefaultModelId();
    if (storedDefault) {
      const defaultModel = GeminiModelsDatabase.getModelById(storedDefault);
      if (defaultModel?.enabled) {
        return defaultModel.modelId;
      }
    }

    const enabledModels = GeminiModelsDatabase.getEnabledModels();
    if (enabledModels.length > 0) {
      return enabledModels[0].modelId;
    }

    return DEFAULT_GEMINI_MODEL;
  }

  createManualModel(input: GeminiCatalogModelInput): { success: boolean; data?: GeminiCatalogModel; error?: string } {
    const modelId = normalizeModelId(input.modelId);
    const name = (input.name || '').trim();
    const label = (input.label || '').trim();

    if (!modelId) {
      return { success: false, error: 'MODEL_ID_EMPTY' };
    }
    if (!name) {
      return { success: false, error: 'MODEL_NAME_EMPTY' };
    }
    if (!label) {
      return { success: false, error: 'MODEL_LABEL_EMPTY' };
    }

    const existing = GeminiModelsDatabase.getModelById(modelId);
    if (existing) {
      return { success: false, error: 'MODEL_ALREADY_EXISTS' };
    }

    const created = GeminiModelsDatabase.createModel(
      {
        modelId,
        name,
        label,
        description: input.description || '',
      },
      'manual',
    );

    this.ensureDefaultModelValid();
    return { success: true, data: created };
  }

  updateModel(modelId: string, patch: GeminiCatalogModelUpdate): { success: boolean; data?: GeminiCatalogModel; error?: string } {
    const cleanId = normalizeModelId(modelId);
    if (!cleanId) {
      return { success: false, error: 'MODEL_ID_EMPTY' };
    }

    const updated = GeminiModelsDatabase.updateModel(cleanId, patch);
    if (!updated) {
      return { success: false, error: 'MODEL_NOT_FOUND' };
    }

    return { success: true, data: updated };
  }

  deleteModel(modelId: string): { success: boolean; error?: string } {
    const cleanId = normalizeModelId(modelId);
    if (!cleanId) {
      return { success: false, error: 'MODEL_ID_EMPTY' };
    }

    const ok = GeminiModelsDatabase.deleteModel(cleanId);
    if (!ok) {
      return { success: false, error: 'MODEL_NOT_FOUND' };
    }

    this.ensureDefaultModelValid();
    return { success: true };
  }

  setModelEnabled(modelId: string, enabled: boolean): { success: boolean; error?: string } {
    const cleanId = normalizeModelId(modelId);
    if (!cleanId) {
      return { success: false, error: 'MODEL_ID_EMPTY' };
    }

    const ok = GeminiModelsDatabase.setModelEnabled(cleanId, enabled);
    if (!ok) {
      return { success: false, error: 'MODEL_NOT_FOUND' };
    }

    this.ensureDefaultModelValid();
    return { success: true };
  }

  getLastSyncedAt(): number | null {
    return GeminiModelsDatabase.getLastSyncedAt();
  }

  async syncFromGoogle(): Promise<{ success: boolean; data?: GeminiSyncModelsResult; error?: string }> {
    const apiKey = pickFirstApiKeyForSync();
    if (!apiKey) {
      return { success: false, error: 'NO_API_KEY_FOR_MODEL_SYNC' };
    }

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const pager = await ai.models.list();

    let syncedCount = 0;
    let skippedCount = 0;

    for await (const model of pager) {
      const modelId = normalizeModelId(model?.name);
      if (!modelId) {
        skippedCount += 1;
        continue;
      }
      if (!isLikelyTextGenerationModel(modelId, model)) {
        skippedCount += 1;
        continue;
      }

      const existing = GeminiModelsDatabase.getModelById(modelId);
      if (existing?.source === 'manual') {
        skippedCount += 1;
        continue;
      }

      GeminiModelsDatabase.upsertModel(
        {
          modelId,
          name: (model.displayName || modelId).trim(),
          label: (model.displayName || modelId).trim(),
          description: (model.description || '').trim(),
        },
        'google_sync',
      );
      syncedCount += 1;
    }

    const now = Date.now();
    GeminiModelsDatabase.setLastSyncedAt(now);
    this.ensureDefaultModelValid();

    return {
      success: true,
      data: {
        syncedCount,
        skippedCount,
        defaultModelId: GeminiModelsDatabase.getDefaultModelId(),
        syncedAt: now,
      },
    };
  }

  private ensureDefaultModelValid(): void {
    const currentDefault = GeminiModelsDatabase.getDefaultModelId();
    if (currentDefault) {
      const model = GeminiModelsDatabase.getModelById(currentDefault);
      if (model?.enabled) {
        return;
      }
    }

    const enabledModels = GeminiModelsDatabase.getEnabledModels();
    if (enabledModels.length > 0) {
      GeminiModelsDatabase.setDefaultModelId(enabledModels[0].modelId);
      return;
    }

    const fallbackSeed = GEMINI_MODEL_LIST[0]?.id || DEFAULT_GEMINI_MODEL;
    GeminiModelsDatabase.setDefaultModelId(fallbackSeed);
  }
}

let instance: GeminiModelsService | null = null;

export function getGeminiModelsService(): GeminiModelsService {
  if (!instance) {
    instance = new GeminiModelsService();
  }
  return instance;
}
