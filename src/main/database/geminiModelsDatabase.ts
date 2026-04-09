/**
 * Gemini Models Database Service
 * Luu catalog model Gemini dong va default model trong SQLite.
 */

import { getDatabase } from './schema';
import type {
  GeminiCatalogModel,
  GeminiCatalogModelInput,
  GeminiCatalogModelUpdate,
  GeminiModelSource,
} from '../../shared/types/gemini';

type GeminiModelRow = {
  model_id: string;
  name: string;
  label: string;
  description: string | null;
  enabled: number;
  source: GeminiModelSource;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function mapRow(row: GeminiModelRow): GeminiCatalogModel {
  return {
    modelId: row.model_id,
    name: row.name,
    label: row.label,
    description: row.description || '',
    enabled: row.enabled === 1,
    source: row.source,
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

export class GeminiModelsDatabase {
  static getAllModels(): GeminiCatalogModel[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT model_id, name, label, description, enabled, source, sort_order, created_at, updated_at
      FROM gemini_models
      ORDER BY sort_order ASC, created_at ASC
    `).all() as GeminiModelRow[];
    return rows.map(mapRow);
  }

  static getEnabledModels(): GeminiCatalogModel[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT model_id, name, label, description, enabled, source, sort_order, created_at, updated_at
      FROM gemini_models
      WHERE enabled = 1
      ORDER BY sort_order ASC, created_at ASC
    `).all() as GeminiModelRow[];
    return rows.map(mapRow);
  }

  static getModelById(modelId: string): GeminiCatalogModel | null {
    const cleanId = normalizeText(modelId);
    if (!cleanId) {
      return null;
    }
    const db = getDatabase();
    const row = db.prepare(`
      SELECT model_id, name, label, description, enabled, source, sort_order, created_at, updated_at
      FROM gemini_models
      WHERE model_id = ?
      LIMIT 1
    `).get(cleanId) as GeminiModelRow | undefined;
    return row ? mapRow(row) : null;
  }

  static getNextSortOrder(): number {
    const db = getDatabase();
    const row = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) as max_order FROM gemini_models`).get() as {
      max_order?: number | null;
    };
    return Math.max(0, Number(row?.max_order || 0)) + 1;
  }

  static createModel(input: GeminiCatalogModelInput, source: GeminiModelSource = 'manual'): GeminiCatalogModel {
    const db = getDatabase();
    const now = Date.now();
    const cleanModelId = normalizeText(input.modelId);
    const cleanName = normalizeText(input.name) || cleanModelId;
    const cleanLabel = normalizeText(input.label) || cleanName;
    const cleanDescription = normalizeText(input.description);
    const sortOrder = this.getNextSortOrder();

    db.prepare(`
      INSERT INTO gemini_models (
        model_id,
        name,
        label,
        description,
        enabled,
        source,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      cleanModelId,
      cleanName,
      cleanLabel,
      cleanDescription,
      source,
      sortOrder,
      now,
      now,
    );

    const created = this.getModelById(cleanModelId);
    if (!created) {
      throw new Error('CREATE_MODEL_FAILED');
    }
    return created;
  }

  static upsertModel(input: GeminiCatalogModelInput, source: GeminiModelSource): GeminiCatalogModel {
    const db = getDatabase();
    const now = Date.now();
    const cleanModelId = normalizeText(input.modelId);
    const cleanName = normalizeText(input.name) || cleanModelId;
    const cleanLabel = normalizeText(input.label) || cleanName;
    const cleanDescription = normalizeText(input.description);

    const existing = this.getModelById(cleanModelId);
    const sortOrder = existing ? existing.sortOrder : this.getNextSortOrder();
    const createdAt = existing ? existing.createdAt : now;

    db.prepare(`
      INSERT INTO gemini_models (
        model_id,
        name,
        label,
        description,
        enabled,
        source,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, COALESCE((SELECT enabled FROM gemini_models WHERE model_id = ?), 1), ?, ?, ?, ?)
      ON CONFLICT(model_id) DO UPDATE SET
        name = excluded.name,
        label = excluded.label,
        description = excluded.description,
        source = excluded.source,
        updated_at = excluded.updated_at
    `).run(
      cleanModelId,
      cleanName,
      cleanLabel,
      cleanDescription,
      cleanModelId,
      source,
      sortOrder,
      createdAt,
      now,
    );

    const saved = this.getModelById(cleanModelId);
    if (!saved) {
      throw new Error('UPSERT_MODEL_FAILED');
    }
    return saved;
  }

  static updateModel(modelId: string, patch: GeminiCatalogModelUpdate): GeminiCatalogModel | null {
    const current = this.getModelById(modelId);
    if (!current) {
      return null;
    }

    const nextName = normalizeText(patch.name) || current.name;
    const nextLabel = normalizeText(patch.label) || current.label;
    const nextDescription = Object.prototype.hasOwnProperty.call(patch, 'description')
      ? normalizeText(patch.description)
      : current.description;
    const nextSortOrder = Number.isFinite(Number(patch.sortOrder))
      ? Math.max(0, Math.floor(Number(patch.sortOrder)))
      : current.sortOrder;

    const db = getDatabase();
    db.prepare(`
      UPDATE gemini_models
      SET name = ?, label = ?, description = ?, sort_order = ?, updated_at = ?
      WHERE model_id = ?
    `).run(nextName, nextLabel, nextDescription, nextSortOrder, Date.now(), current.modelId);

    return this.getModelById(current.modelId);
  }

  static setModelEnabled(modelId: string, enabled: boolean): boolean {
    const cleanId = normalizeText(modelId);
    if (!cleanId) {
      return false;
    }
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE gemini_models
      SET enabled = ?, updated_at = ?
      WHERE model_id = ?
    `).run(enabled ? 1 : 0, Date.now(), cleanId);
    return result.changes > 0;
  }

  static deleteModel(modelId: string): boolean {
    const cleanId = normalizeText(modelId);
    if (!cleanId) {
      return false;
    }
    const db = getDatabase();
    const result = db.prepare(`DELETE FROM gemini_models WHERE model_id = ?`).run(cleanId);
    return result.changes > 0;
  }

  static getDefaultModelId(): string | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT default_model_id
      FROM gemini_model_settings
      WHERE id = 1
      LIMIT 1
    `).get() as { default_model_id?: string | null } | undefined;
    const value = normalizeText(row?.default_model_id || '');
    return value || null;
  }

  static setDefaultModelId(modelId: string | null): void {
    const db = getDatabase();
    const cleanId = normalizeText(modelId || '');
    const nextValue = cleanId || null;
    const now = Date.now();

    db.prepare(`
      INSERT OR REPLACE INTO gemini_model_settings (id, default_model_id, last_synced_at, updated_at)
      VALUES (
        1,
        ?,
        COALESCE((SELECT last_synced_at FROM gemini_model_settings WHERE id = 1), NULL),
        ?
      )
    `).run(nextValue, now);
  }

  static setLastSyncedAt(timestamp: number): void {
    const db = getDatabase();
    const safeTimestamp = Number.isFinite(timestamp) ? Math.floor(timestamp) : Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO gemini_model_settings (id, default_model_id, last_synced_at, updated_at)
      VALUES (
        1,
        COALESCE((SELECT default_model_id FROM gemini_model_settings WHERE id = 1), NULL),
        ?,
        ?
      )
    `).run(safeTimestamp, Date.now());
  }

  static getLastSyncedAt(): number | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT last_synced_at
      FROM gemini_model_settings
      WHERE id = 1
      LIMIT 1
    `).get() as { last_synced_at?: number | null } | undefined;
    const value = Number(row?.last_synced_at);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
}
