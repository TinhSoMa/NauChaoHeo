import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/schema';
import { TranslationPrompt, CreatePromptDTO } from '../../shared/types/prompt';

export class PromptService {
  static getAll(): TranslationPrompt[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM prompts ORDER BY created_at DESC').all();
    return rows.map(this.mapRow);
  }

  static getById(id: string): TranslationPrompt | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapRow(row);
  }

  static create(data: CreatePromptDTO): TranslationPrompt {
    const db = getDatabase();
    const now = Date.now();
    const prompt: TranslationPrompt = {
      id: uuidv4(),
      ...data,
      isDefault: data.isDefault || false,
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

        db.prepare(`
          INSERT INTO prompts (id, name, description, source_lang, target_lang, content, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          prompt.id, 
          prompt.name, 
          prompt.description || null, 
          prompt.sourceLang, 
          prompt.targetLang, 
          prompt.content, 
          prompt.isDefault ? 1 : 0, 
          prompt.createdAt, 
          prompt.updatedAt
        );
    });

    transaction();
    return prompt;
  }

  static update(id: string, data: Partial<CreatePromptDTO>): TranslationPrompt {
      const db = getDatabase();
      const existing = this.getById(id);
      if (!existing) throw new Error(`Prompt with id ${id} not found`);

      const updated = {
          ...existing,
          ...data,
          updatedAt: Date.now()
      };

      const transaction = db.transaction(() => {
          if (updated.isDefault && !existing.isDefault) {
              db.prepare(`
                  UPDATE prompts 
                  SET is_default = 0 
                  WHERE source_lang = ? AND target_lang = ?
              `).run(updated.sourceLang, updated.targetLang);
          }

          db.prepare(`
            UPDATE prompts 
            SET name = ?, description = ?, source_lang = ?, target_lang = ?, content = ?, is_default = ?, updated_at = ?
            WHERE id = ?
          `).run(
            updated.name,
            updated.description || null,
            updated.sourceLang,
            updated.targetLang,
            updated.content,
            updated.isDefault ? 1 : 0,
            updated.updatedAt,
            id
          );
      });
      
      transaction();
      return updated;
  }

  static delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
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

  private static mapRow(row: any): TranslationPrompt {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      content: row.content,
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
