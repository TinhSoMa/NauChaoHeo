import crypto from 'crypto';
import path from 'path';
import { getDatabase } from '../../database/schema';

export interface CaptionGeminiConversationScope {
  projectId?: string | null;
  sourcePath?: string | null;
  accountConfigId: string;
}

export type CaptionGeminiConversationMetadata = Record<string, unknown>;

function normalizeProjectId(projectId?: string | null): string {
  const trimmed = (projectId || '').trim();
  return trimmed || '__default_project__';
}

function normalizeSourcePath(sourcePath?: string | null): string {
  const raw = (sourcePath || '').trim();
  if (!raw) {
    return '__unknown_source__';
  }
  try {
    return path.resolve(raw).replace(/\\/g, '/').toLowerCase();
  } catch {
    return raw.replace(/\\/g, '/').toLowerCase();
  }
}

function buildSourcePathHash(normalizedSourcePath: string): string {
  return crypto.createHash('sha256').update(normalizedSourcePath).digest('hex');
}

function buildScope(scope: CaptionGeminiConversationScope): {
  projectId: string;
  sourcePath: string;
  sourcePathHash: string;
  accountConfigId: string;
} {
  const accountConfigId = (scope.accountConfigId || '').trim();
  if (!accountConfigId) {
    throw new Error('accountConfigId is required for caption Gemini conversation scope');
  }

  const projectId = normalizeProjectId(scope.projectId);
  const sourcePath = normalizeSourcePath(scope.sourcePath);
  const sourcePathHash = buildSourcePathHash(sourcePath);
  return { projectId, sourcePath, sourcePathHash, accountConfigId };
}

export function getConversation(
  scope: CaptionGeminiConversationScope
): CaptionGeminiConversationMetadata | null {
  try {
    const normalized = buildScope(scope);
    const db = getDatabase();
    const row = db
      .prepare(
        `
          SELECT conversation_metadata_json
          FROM caption_gemini_web_conversation
          WHERE project_id = ?
            AND source_path_hash = ?
            AND account_config_id = ?
          LIMIT 1
        `
      )
      .get(
        normalized.projectId,
        normalized.sourcePathHash,
        normalized.accountConfigId
      ) as { conversation_metadata_json?: string } | undefined;

    if (!row?.conversation_metadata_json) {
      return null;
    }

    const parsed = JSON.parse(row.conversation_metadata_json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as CaptionGeminiConversationMetadata;
  } catch (error) {
    console.warn('[CaptionGeminiConversationStore] getConversation failed:', String(error));
    return null;
  }
}

export function upsertConversation(
  scope: CaptionGeminiConversationScope,
  metadata: CaptionGeminiConversationMetadata | null | undefined
): void {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return;
  }

  try {
    const normalized = buildScope(scope);
    const db = getDatabase();
    const now = Date.now();
    const metadataJson = JSON.stringify(metadata);

    db.prepare(
      `
        INSERT INTO caption_gemini_web_conversation (
          project_id,
          source_path,
          source_path_hash,
          account_config_id,
          conversation_metadata_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, source_path_hash, account_config_id)
        DO UPDATE SET
          source_path = excluded.source_path,
          conversation_metadata_json = excluded.conversation_metadata_json,
          updated_at = excluded.updated_at
      `
    ).run(
      normalized.projectId,
      normalized.sourcePath,
      normalized.sourcePathHash,
      normalized.accountConfigId,
      metadataJson,
      now,
      now
    );
  } catch (error) {
    console.warn('[CaptionGeminiConversationStore] upsertConversation failed:', String(error));
  }
}

export function clearConversation(
  projectId: string,
  sourcePath: string,
  accountConfigId?: string
): number {
  try {
    const normalizedProjectId = normalizeProjectId(projectId);
    const normalizedSourcePath = normalizeSourcePath(sourcePath);
    const sourcePathHash = buildSourcePathHash(normalizedSourcePath);
    const db = getDatabase();

    if (accountConfigId?.trim()) {
      const result = db
        .prepare(
          `
            DELETE FROM caption_gemini_web_conversation
            WHERE project_id = ?
              AND source_path_hash = ?
              AND account_config_id = ?
          `
        )
        .run(normalizedProjectId, sourcePathHash, accountConfigId.trim());
      return result.changes;
    }

    const result = db
      .prepare(
        `
          DELETE FROM caption_gemini_web_conversation
          WHERE project_id = ?
            AND source_path_hash = ?
        `
      )
      .run(normalizedProjectId, sourcePathHash);
    return result.changes;
  } catch (error) {
    console.warn('[CaptionGeminiConversationStore] clearConversation failed:', String(error));
    return 0;
  }
}

