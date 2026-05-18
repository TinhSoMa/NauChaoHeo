import type { Chapter } from '@shared/types';
import type { StoryChapterMethod } from '../types';

function extractMemoryContext(prepareResult: unknown): unknown {
  if (!prepareResult || typeof prepareResult !== 'object' || !('memoryContext' in prepareResult)) {
    return null;
  }
  return (prepareResult as { memoryContext?: unknown }).memoryContext ?? null;
}

function sanitizeFileSegment(value: string): string {
  return (value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'chapter';
}

function formatTimestamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function getActualPromptSentToModel(preparedPrompt: unknown, method: StoryChapterMethod | 'api_gemini_webapi_queue'): string {
  if (method === 'api') {
    return typeof preparedPrompt === 'string'
      ? preparedPrompt
      : JSON.stringify(preparedPrompt);
  }

  if (typeof preparedPrompt === 'string') {
    return preparedPrompt;
  }

  if (Array.isArray(preparedPrompt)) {
    const lastUserMsg = [...preparedPrompt]
      .reverse()
      .find((msg) => msg && typeof msg === 'object' && 'role' in msg && 'content' in msg && (msg as { role?: string }).role === 'user');

    if (lastUserMsg && typeof (lastUserMsg as { content?: unknown }).content === 'string') {
      return (lastUserMsg as { content: string }).content;
    }
  }

  return typeof preparedPrompt === 'string'
    ? preparedPrompt
    : JSON.stringify(preparedPrompt);
}

export async function saveTranslationPromptArtifact(params: {
  projectId: string | null;
  chapter: Chapter;
  chapterIndex: number;
  method: StoryChapterMethod | 'api_gemini_webapi_queue';
  model: string;
  preparedPrompt: unknown;
  prepareResult?: unknown;
  storyFilePath: string;
}): Promise<void> {
  const {
    projectId,
    chapter,
    chapterIndex,
    method,
    model,
    preparedPrompt,
    prepareResult,
    storyFilePath
  } = params;

  if (!projectId) {
    return;
  }

  const timestamp = formatTimestamp();
  const chapterLabel = String(chapterIndex).padStart(4, '0');
  const titleSegment = sanitizeFileSegment(chapter.title || chapter.id);
  const methodSegment = sanitizeFileSegment(method);
  const baseName = `${timestamp}__ch-${chapterLabel}__${methodSegment}__${titleSegment}`;
  const rawPromptFileName = `prompts/translation/${baseName}.prompt.txt`;
  const metaFileName = `prompts/translation/${baseName}.meta.json`;
  const actualSentPrompt = getActualPromptSentToModel(preparedPrompt, method);

  const rawWriteResult = await window.electronAPI.project.writeFeatureFile({
    projectId,
    feature: 'story',
    fileName: rawPromptFileName,
    content: actualSentPrompt
  });

  if (!rawWriteResult.success) {
    throw new Error(rawWriteResult.error || 'Không thể lưu raw prompt');
  }

  const artifact = {
    type: 'story-translation-sent-prompt',
    createdAt: new Date().toISOString(),
    projectId,
    storyFilePath,
    chapterId: chapter.id,
    chapterIndex,
    chapterTitle: chapter.title,
    method,
    model,
    rawPromptFileName,
    actualSentPayload: preparedPrompt,
    memoryContext: extractMemoryContext(prepareResult)
  };

  const result = await window.electronAPI.project.writeFeatureFile({
    projectId,
    feature: 'story',
    fileName: metaFileName,
    content: artifact
  });

  if (!result.success) {
    throw new Error(result.error || 'Không thể lưu prompt artifact');
  }
}
