import { getDatabase } from './schema';
import type { ThumbnailHistoryEntry } from '../../shared/types/thumbnailGenerator';

interface DbRow {
  id: string
  type: string
  original_prompt: string
  final_prompt: string | null
  enhanced_prompt: number
  category: string | null
  mood: string | null
  theme: string | null
  primary_color: string | null
  include_text: number
  text_style: string | null
  thumbnail_style: string | null
  custom_prompt: string | null
  input_image_path: string | null
  input_image_info: string | null
  images_generated: number
  image_paths: string
  created_at: number
}

function rowToEntry(row: DbRow): ThumbnailHistoryEntry {
  return {
    id: row.id,
    type: row.type as 'text-to-image' | 'image-to-image',
    originalPrompt: row.original_prompt,
    finalPrompt: row.final_prompt ?? '',
    enhancedPrompt: row.enhanced_prompt === 1,
    category: row.category ?? undefined,
    mood: row.mood ?? undefined,
    theme: row.theme ?? undefined,
    primaryColor: row.primary_color ?? undefined,
    includeText: row.include_text === 1,
    textStyle: row.text_style ?? undefined,
    thumbnailStyle: row.thumbnail_style ?? undefined,
    customPrompt: row.custom_prompt ?? undefined,
    inputImagePath: row.input_image_path ?? undefined,
    inputImageInfo: row.input_image_info ? JSON.parse(row.input_image_info) : undefined,
    imagesGenerated: row.images_generated,
    imagePaths: JSON.parse(row.image_paths),
    createdAt: row.created_at,
  };
}

export class ThumbnailGeneratorDatabase {
  static insert(entry: ThumbnailHistoryEntry): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO thumbnail_generation_history (
        id, type, original_prompt, final_prompt, enhanced_prompt,
        category, mood, theme, primary_color, include_text,
        text_style, thumbnail_style, custom_prompt, input_image_path,
        input_image_info, images_generated, image_paths, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.type,
      entry.originalPrompt,
      entry.finalPrompt || null,
      entry.enhancedPrompt ? 1 : 0,
      entry.category || null,
      entry.mood || null,
      entry.theme || null,
      entry.primaryColor || null,
      entry.includeText ? 1 : 0,
      entry.textStyle || null,
      entry.thumbnailStyle || null,
      entry.customPrompt || null,
      entry.inputImagePath || null,
      entry.inputImageInfo ? JSON.stringify(entry.inputImageInfo) : null,
      entry.imagesGenerated,
      JSON.stringify(entry.imagePaths),
      entry.createdAt,
    );
  }

  static getAll(limit = 20, offset = 0): { entries: ThumbnailHistoryEntry[]; total: number; hasMore: boolean } {
    const db = getDatabase();
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM thumbnail_generation_history').get() as { count: number };
    const total = totalRow.count;
    const rows = db.prepare(
      'SELECT * FROM thumbnail_generation_history ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as DbRow[];
    return {
      entries: rows.map(rowToEntry),
      total,
      hasMore: offset + limit < total,
    };
  }

  static getById(id: string): ThumbnailHistoryEntry | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM thumbnail_generation_history WHERE id = ?').get(id) as DbRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  static deleteById(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM thumbnail_generation_history WHERE id = ?').run(id);
    return result.changes > 0;
  }

  static deleteAll(): void {
    const db = getDatabase();
    db.prepare('DELETE FROM thumbnail_generation_history').run();
  }
}
