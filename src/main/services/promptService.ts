/**
 * Prompt Service - Quản lý prompt templates
 * Sử dụng SQLite database
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database/schema';
import {
  CreatePromptDTO,
  CreatePromptGroupDTO,
  MovePromptFamilyDTO,
  PromptFamilySummary,
  PromptGroup,
  PromptHierarchySnapshot,
  PromptLanguageBucketSummary,
  PromptType,
  RenamePromptGroupDTO,
  TranslationPrompt,
} from '../../shared/types/prompt';

function toLanguageBucket(sourceLang: string, targetLang: string): string {
  const src = (sourceLang || '').trim().toLowerCase() || 'unknown';
  const dst = (targetLang || '').trim().toLowerCase() || 'unknown';
  return `${src}->${dst}`;
}

function normalizePromptType(raw: unknown, name: string): PromptType {
  if (raw === 'translation' || raw === 'summary' || raw === 'caption') {
    return raw;
  }
  const lowered = (name || '').toLowerCase();
  if (lowered.includes('summary') || lowered.includes('[summary]') || lowered.includes('tóm tắt')) {
    return 'summary';
  }
  if (lowered.includes('caption') || lowered.includes('subtitle') || lowered.includes('phụ đề')) {
    return 'caption';
  }
  return 'translation';
}

function normalizeGroupName(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ').slice(0, 64) || 'General';
}

function normalizeGroupKey(name: string): string {
  return normalizeGroupName(name).toLowerCase();
}

function parseLanguageBucket(bucket: string): { sourceLang: string; targetLang: string } {
  const [source, target] = (bucket || '').split('->');
  return {
    sourceLang: (source || 'unknown').trim().toLowerCase(),
    targetLang: (target || 'unknown').trim().toLowerCase(),
  };
}

export class PromptService {
  static getAll(): TranslationPrompt[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT p.*, g.name AS group_name
      FROM prompts p
      LEFT JOIN prompt_groups g ON g.id = p.group_id
      ORDER BY p.created_at DESC
    `).all();
    return rows.map(this.mapRow);
  }

  static getById(id: string): TranslationPrompt | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT p.*, g.name AS group_name
      FROM prompts p
      LEFT JOIN prompt_groups g ON g.id = p.group_id
      WHERE p.id = ?
    `).get(id);
    if (!row) return null;
    return this.mapRow(row);
  }

  static resolveLatestByFamily(familyId: string): TranslationPrompt | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT p.*, g.name AS group_name
      FROM prompts p
      LEFT JOIN prompt_groups g ON g.id = p.group_id
      WHERE p.family_id = ? AND p.is_latest = 1
      LIMIT 1
    `).get(familyId);
    if (!row) {
      return null;
    }
    return this.mapRow(row);
  }

  static create(data: CreatePromptDTO): TranslationPrompt {
    const db = getDatabase();
    const now = Date.now();
    const promptType = normalizePromptType(data.promptType, data.name);
    const languageBucket = toLanguageBucket(data.sourceLang, data.targetLang);
    const groupId = data.groupId ?? this.ensureDefaultGroup(languageBucket).id;
    const familyId = (data.familyId && data.familyId.trim()) ? data.familyId.trim() : randomUUID();
    const versionNo = this.getNextVersionNo(familyId);
    const prompt: TranslationPrompt = {
      id: randomUUID(),
      ...data,
      isDefault: data.isDefault || false,
      promptType,
      languageBucket,
      groupId,
      familyId,
      version: versionNo,
      isLatest: true,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    const transaction = db.transaction(() => {
        // If this is set as default, unset others with same lang pair
        if (prompt.isDefault) {
            db.prepare(`
                UPDATE prompts 
                SET is_default = 0 
                WHERE source_lang = ? AND target_lang = ?
            `).run(prompt.sourceLang, prompt.targetLang);
        }

        db.prepare('UPDATE prompts SET is_latest = 0 WHERE family_id = ?').run(prompt.familyId);

        db.prepare(`
          INSERT INTO prompts (
            id, name, description, source_lang, target_lang, content, is_default,
            prompt_type, language_bucket, group_id, family_id, version_no, is_latest, archived,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          prompt.id, 
          prompt.name, 
          prompt.description || null, 
          prompt.sourceLang, 
          prompt.targetLang, 
          prompt.content, 
          prompt.isDefault ? 1 : 0, 
          prompt.promptType,
          prompt.languageBucket,
          prompt.groupId,
          prompt.familyId,
          prompt.version,
          1,
          0,
          prompt.createdAt, 
          prompt.updatedAt
        );
    });

    transaction();
    return prompt;
  }

  static update(id: string, data: Partial<CreatePromptDTO>): TranslationPrompt {
      const existing = this.getById(id);
      if (!existing) throw new Error(`Prompt with id ${id} not found`);

      return this.create({
        name: data.name ?? existing.name,
        description: data.description ?? existing.description,
        sourceLang: data.sourceLang ?? existing.sourceLang,
        targetLang: data.targetLang ?? existing.targetLang,
        content: data.content ?? existing.content,
        isDefault: typeof data.isDefault === 'boolean' ? data.isDefault : existing.isDefault,
        promptType: data.promptType ?? existing.promptType,
        groupId: Object.prototype.hasOwnProperty.call(data, 'groupId')
          ? (data.groupId ?? null)
          : existing.groupId,
        familyId: existing.familyId,
      });
  }

  static delete(id: string): boolean {
    const db = getDatabase();
    const existing = this.getById(id);
    const result = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
    if (existing && result.changes > 0 && existing.isLatest) {
      db.prepare('UPDATE prompts SET is_latest = 0 WHERE family_id = ?').run(existing.familyId);
      db.prepare(`
        UPDATE prompts
        SET is_latest = 1
        WHERE id = (
          SELECT id FROM prompts
          WHERE family_id = ?
          ORDER BY version_no DESC, updated_at DESC
          LIMIT 1
        )
      `).run(existing.familyId);
    }
    return result.changes > 0;
  }

  static setDefault(id: string): boolean {
      const prompt = this.getById(id);
      if (!prompt) return false;

      const db = getDatabase();
      const transaction = db.transaction(() => {
          db.prepare(`
              UPDATE prompts 
              SET is_default = 0 
              WHERE source_lang = ? AND target_lang = ?
          `).run(prompt.sourceLang, prompt.targetLang);

          db.prepare('UPDATE prompts SET is_default = 1 WHERE id = ?').run(id);
      });

      transaction();
      return true;
  }

  static getGroups(languageBucket?: string): PromptGroup[] {
    const db = getDatabase();
    if (languageBucket) {
      const rows = db.prepare('SELECT * FROM prompt_groups WHERE language_bucket = ? ORDER BY name COLLATE NOCASE ASC').all(languageBucket);
      return rows.map(this.mapGroupRow);
    }
    const rows = db.prepare('SELECT * FROM prompt_groups ORDER BY language_bucket ASC, name COLLATE NOCASE ASC').all();
    return rows.map(this.mapGroupRow);
  }

  static createGroup(payload: CreatePromptGroupDTO): PromptGroup {
    const db = getDatabase();
    const languageBucket = (payload.languageBucket || '').trim().toLowerCase();
    if (!languageBucket) {
      throw new Error('languageBucket is required');
    }
    const name = normalizeGroupName(payload.name);
    const normalizedName = normalizeGroupKey(name);
    const existing = db.prepare('SELECT * FROM prompt_groups WHERE language_bucket = ? AND normalized_name = ? LIMIT 1')
      .get(languageBucket, normalizedName);
    if (existing) {
      return this.mapGroupRow(existing);
    }
    const now = Date.now();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO prompt_groups (id, language_bucket, name, normalized_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, languageBucket, name, normalizedName, now, now);
    return {
      id,
      languageBucket,
      name,
      normalizedName,
      createdAt: now,
      updatedAt: now,
    };
  }

  static renameGroup(payload: RenamePromptGroupDTO): PromptGroup {
    const db = getDatabase();
    const current = db.prepare('SELECT * FROM prompt_groups WHERE id = ? LIMIT 1').get(payload.groupId);
    if (!current) {
      throw new Error('Group not found');
    }
    const name = normalizeGroupName(payload.name);
    const normalizedName = normalizeGroupKey(name);
    const languageBucket = String((current as any).language_bucket || '');
    const conflict = db.prepare('SELECT id FROM prompt_groups WHERE language_bucket = ? AND normalized_name = ? AND id != ? LIMIT 1')
      .get(languageBucket, normalizedName, payload.groupId);
    if (conflict) {
      throw new Error('Group name already exists in this language bucket');
    }
    const now = Date.now();
    db.prepare('UPDATE prompt_groups SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?')
      .run(name, normalizedName, now, payload.groupId);
    const updated = db.prepare('SELECT * FROM prompt_groups WHERE id = ? LIMIT 1').get(payload.groupId);
    return this.mapGroupRow(updated);
  }

  static deleteGroup(groupId: string): boolean {
    const db = getDatabase();
    const current = db.prepare('SELECT * FROM prompt_groups WHERE id = ? LIMIT 1').get(groupId) as any;
    if (!current) {
      return false;
    }
    const defaultGroup = this.ensureDefaultGroup(String(current.language_bucket));
    db.prepare('UPDATE prompts SET group_id = ? WHERE group_id = ?').run(defaultGroup.id, groupId);
    const result = db.prepare('DELETE FROM prompt_groups WHERE id = ?').run(groupId);
    return result.changes > 0;
  }

  static getFamilies(params: { languageBucket?: string; groupId?: string; promptType?: PromptType } = {}): PromptFamilySummary[] {
    const db = getDatabase();
    let query = `
      SELECT
        p.family_id,
        p.prompt_type,
        p.language_bucket,
        p.source_lang,
        p.target_lang,
        p.group_id,
        g.name AS group_name,
        p.id AS latest_prompt_id,
        p.name AS latest_name,
        p.version_no AS latest_version,
        p.updated_at AS latest_updated_at
      FROM prompts p
      LEFT JOIN prompt_groups g ON g.id = p.group_id
      WHERE p.is_latest = 1
    `;
    const args: unknown[] = [];
    if (params.languageBucket) {
      query += ' AND p.language_bucket = ?';
      args.push(params.languageBucket);
    }
    if (params.groupId) {
      query += ' AND p.group_id = ?';
      args.push(params.groupId);
    }
    if (params.promptType) {
      query += ' AND p.prompt_type = ?';
      args.push(params.promptType);
    }
    query += ' ORDER BY p.language_bucket ASC, g.name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC';
    const rows = db.prepare(query).all(...args);
    return rows.map((row: any) => ({
      familyId: row.family_id,
      promptType: normalizePromptType(row.prompt_type, row.latest_name),
      languageBucket: row.language_bucket,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      groupId: row.group_id ?? null,
      groupName: row.group_name || undefined,
      latestPromptId: row.latest_prompt_id,
      latestName: row.latest_name,
      latestVersion: Number(row.latest_version || 1),
      latestUpdatedAt: Number(row.latest_updated_at || 0),
    }));
  }

  static getVersions(familyId: string): TranslationPrompt[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT p.*, g.name AS group_name
      FROM prompts p
      LEFT JOIN prompt_groups g ON g.id = p.group_id
      WHERE p.family_id = ?
      ORDER BY p.version_no DESC, p.updated_at DESC
    `).all(familyId);
    return rows.map(this.mapRow);
  }

  static moveFamily(payload: MovePromptFamilyDTO): boolean {
    const db = getDatabase();
    const targetGroup = db.prepare('SELECT id, language_bucket FROM prompt_groups WHERE id = ? LIMIT 1').get(payload.targetGroupId) as any;
    if (!targetGroup) {
      throw new Error('Target group not found');
    }
    const result = db.prepare('UPDATE prompts SET group_id = ?, language_bucket = ? WHERE family_id = ?')
      .run(payload.targetGroupId, targetGroup.language_bucket, payload.familyId);
    return result.changes > 0;
  }

  static getHierarchy(): PromptHierarchySnapshot {
    const db = getDatabase();
    const languageRows = db.prepare(`
      SELECT
        language_bucket,
        MIN(source_lang) AS source_lang,
        MIN(target_lang) AS target_lang,
        COUNT(DISTINCT family_id) AS total_families,
        COUNT(*) AS total_prompts
      FROM prompts
      GROUP BY language_bucket
      ORDER BY language_bucket ASC
    `).all() as any[];

    const languages: PromptLanguageBucketSummary[] = languageRows.map((row) => ({
      languageBucket: row.language_bucket,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      totalFamilies: Number(row.total_families || 0),
      totalPrompts: Number(row.total_prompts || 0),
    }));

    return {
      languages,
      groups: this.getGroups(),
      families: this.getFamilies(),
    };
  }

  static resolveLatestByFunction(params: { promptType: PromptType; sourceLang?: string; targetLang?: string; familyId?: string | null }): TranslationPrompt | null {
    if (params.familyId) {
      const fromFamily = this.resolveLatestByFamily(params.familyId);
      if (fromFamily) {
        return fromFamily;
      }
    }

    const db = getDatabase();
    const sourceLang = (params.sourceLang || '').trim().toLowerCase();
    const targetLang = (params.targetLang || '').trim().toLowerCase();
    if (sourceLang && targetLang) {
      const row = db.prepare(`
        SELECT p.*, g.name AS group_name
        FROM prompts p
        LEFT JOIN prompt_groups g ON g.id = p.group_id
        WHERE p.prompt_type = ? AND p.source_lang = ? AND p.target_lang = ? AND p.is_latest = 1
        ORDER BY p.updated_at DESC
        LIMIT 1
      `).get(params.promptType, sourceLang, targetLang);
      if (row) {
        return this.mapRow(row);
      }
    }

    const fallback = db.prepare(`
      SELECT p.*, g.name AS group_name
      FROM prompts p
      LEFT JOIN prompt_groups g ON g.id = p.group_id
      WHERE p.prompt_type = ? AND p.is_latest = 1
      ORDER BY p.updated_at DESC
      LIMIT 1
    `).get(params.promptType);
    return fallback ? this.mapRow(fallback) : null;
  }

  private static ensureDefaultGroup(languageBucket: string): PromptGroup {
    const db = getDatabase();
    const normalizedName = normalizeGroupKey('General');
    const existing = db.prepare('SELECT * FROM prompt_groups WHERE language_bucket = ? AND normalized_name = ? LIMIT 1')
      .get(languageBucket, normalizedName);
    if (existing) {
      return this.mapGroupRow(existing);
    }
    const now = Date.now();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO prompt_groups (id, language_bucket, name, normalized_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, languageBucket, 'General', normalizedName, now, now);
    return {
      id,
      languageBucket,
      name: 'General',
      normalizedName,
      createdAt: now,
      updatedAt: now,
    };
  }

  private static getNextVersionNo(familyId: string): number {
    const db = getDatabase();
    const row = db.prepare('SELECT MAX(version_no) AS max_version FROM prompts WHERE family_id = ?').get(familyId) as { max_version?: number | null } | undefined;
    return Number((row?.max_version || 0)) + 1;
  }

  private static mapGroupRow(row: any): PromptGroup {
    return {
      id: row.id,
      languageBucket: row.language_bucket,
      name: row.name,
      normalizedName: row.normalized_name,
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
  }

  private static mapRow(row: any): TranslationPrompt {
    const languageBucket = row.language_bucket || toLanguageBucket(row.source_lang, row.target_lang);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      content: row.content,
      isDefault: Boolean(row.is_default),
      promptType: normalizePromptType(row.prompt_type, row.name),
      languageBucket,
      groupId: row.group_id ?? null,
      groupName: row.group_name || undefined,
      familyId: row.family_id || row.id,
      version: Number(row.version_no || 1),
      isLatest: Boolean(row.is_latest),
      archived: Boolean(row.archived),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
