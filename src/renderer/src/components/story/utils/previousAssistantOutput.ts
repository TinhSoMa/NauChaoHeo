import type { Chapter } from '@shared/types';
import type { StoryPreviousAssistantOutputMode } from '../types';

const TRANSLATION_LINE_RATIO = 0.6;
const DEFAULT_PREVIOUS_CHAPTER_COUNT = 1;
const MAX_PREVIOUS_CHAPTER_COUNT = 10;
export const CHAPTER_BLOCK_PREFIX = '=== Previous Chapter';

export interface PreviousAssistantOutputDebug {
  requestedChapterCount: number;
  resolvedChapterIds: string[];
  missingChapterIds: string[];
  finalIncludedChapterIds: string[];
}

function normalizeLines(content: string): string[] {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function pickEvenlyDistributedLines(lines: string[], ratio = TRANSLATION_LINE_RATIO): string[] {
  if (lines.length === 0) {
    return [];
  }
  const count = Math.max(1, Math.min(lines.length, Math.round(lines.length * ratio)));
  if (count >= lines.length) {
    return lines;
  }
  const result: string[] = [];
  const used = new Set<number>();
  const maxIndex = lines.length - 1;
  for (let i = 0; i < count; i += 1) {
    const anchor = Math.round((i * maxIndex) / Math.max(1, count - 1));
    let index = anchor;
    while (used.has(index) && index < maxIndex) {
      index += 1;
    }
    while (used.has(index) && index > 0) {
      index -= 1;
    }
    if (!used.has(index)) {
      used.add(index);
      result.push(lines[index]);
    }
  }
  return result;
}

function normalizeChapterOutput(content: string, mode: StoryPreviousAssistantOutputMode): string {
  const lines = normalizeLines(content);
  if (lines.length === 0) {
    return '';
  }
  if (mode === 'full') {
    return lines.join('\n');
  }
  return pickEvenlyDistributedLines(lines, TRANSLATION_LINE_RATIO).join('\n');
}

function normalizeChapterCount(chapterCount?: number): number {
  if (!Number.isFinite(chapterCount)) {
    return DEFAULT_PREVIOUS_CHAPTER_COUNT;
  }
  return Math.max(1, Math.min(MAX_PREVIOUS_CHAPTER_COUNT, Math.floor(chapterCount || DEFAULT_PREVIOUS_CHAPTER_COUNT)));
}

function getPreviousChapterWindow(chapters: Chapter[], chapterIndex: number, chapterCount?: number): Chapter[] {
  if (chapterIndex <= 0 || chapterIndex >= chapters.length) {
    return [];
  }

  const normalizedCount = normalizeChapterCount(chapterCount);
  const startIndex = Math.max(0, chapterIndex - normalizedCount);
  return chapters.slice(startIndex, chapterIndex);
}

function formatChapterBlock(chapterNumber: number, content: string): string {
  const normalizedContent = String(content || '').trim();
  if (!normalizedContent) {
    return '';
  }
  return `${CHAPTER_BLOCK_PREFIX} ${chapterNumber} ===\n${normalizedContent}`;
}

export function splitPreviousChapterBlocks(content: string): string[] {
  const normalized = String(content || '').trim();
  if (!normalized) {
    return [];
  }

  const escapedPrefix = CHAPTER_BLOCK_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(
    `(^${escapedPrefix}\\s+\\d+(?::.*?)?===\\s*$)([\\s\\S]*?)(?=^${escapedPrefix}\\s+\\d+(?::.*?)?===\\s*$|$)`,
    'gm'
  );
  const parts: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = blockRegex.exec(normalized)) !== null) {
    const header = String(match[1] || '').trim();
    const body = String(match[2] || '').trim();
    if (header && body) {
      parts.push(`${header}\n${body}`);
    }
  }
  if (parts.length === 0) {
    return [normalized];
  }
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function extractChapterIdSequence(chapters: Chapter[], chapterIndex: number, chapterCount?: number): {
  requestedChapterCount: number;
  previousChapters: Chapter[];
} {
  const requestedChapterCount = normalizeChapterCount(chapterCount);
  return {
    requestedChapterCount,
    previousChapters: getPreviousChapterWindow(chapters, chapterIndex, requestedChapterCount)
  };
}

export function resolvePreviousTranslatedOutputDebug(params: {
  chapters: Chapter[];
  chapterIndex: number;
  translatedChapters: Map<string, string>;
  mode?: StoryPreviousAssistantOutputMode;
  chapterCount?: number;
  explicitChapterIds?: string[] | null;
}): { content: string; debug: PreviousAssistantOutputDebug } {
  const { chapters, chapterIndex, translatedChapters, mode = 'sampled', chapterCount = DEFAULT_PREVIOUS_CHAPTER_COUNT, explicitChapterIds } = params;

  let previousChapters: Chapter[];
  let requestedChapterCount: number;

  if (explicitChapterIds && explicitChapterIds.length > 0) {
    const idSet = new Set(explicitChapterIds);
    previousChapters = chapters.filter((c) => idSet.has(c.id) && c.id !== chapters[chapterIndex]?.id);
    requestedChapterCount = explicitChapterIds.length;
  } else {
    const seq = extractChapterIdSequence(chapters, chapterIndex, chapterCount);
    requestedChapterCount = seq.requestedChapterCount;
    previousChapters = seq.previousChapters;
  }
  const resolvedChapterIds: string[] = [];
  const missingChapterIds: string[] = [];
  const finalIncludedChapterIds: string[] = [];

  if (chapterIndex <= 0 || chapterIndex >= chapters.length || previousChapters.length === 0) {
    return {
      content: '',
      debug: {
        requestedChapterCount,
        resolvedChapterIds,
        missingChapterIds,
        finalIncludedChapterIds
      }
    };
  }

  if (previousChapters.length === 1 && requestedChapterCount <= 1) {
    const chapter = previousChapters[0];
    const rawContent = String(translatedChapters.get(chapter.id) || '');
    if (!rawContent.trim()) {
      missingChapterIds.push(chapter.id);
      return {
        content: '',
        debug: {
          requestedChapterCount,
          resolvedChapterIds,
          missingChapterIds,
          finalIncludedChapterIds
        }
      };
    }
    resolvedChapterIds.push(chapter.id);
    finalIncludedChapterIds.push(chapter.id);
    return {
      content: normalizeChapterOutput(rawContent, mode),
      debug: {
        requestedChapterCount,
        resolvedChapterIds,
        missingChapterIds,
        finalIncludedChapterIds
      }
    };
  }

  const blocks = previousChapters
    .map((chapter) => {
      const rawContent = String(translatedChapters.get(chapter.id) || '');
      if (!rawContent.trim()) {
        missingChapterIds.push(chapter.id);
        return '';
      }
      resolvedChapterIds.push(chapter.id);
      finalIncludedChapterIds.push(chapter.id);
      const chapterOutput = normalizeChapterOutput(rawContent, mode);
      const chapterNumber = chapters.findIndex((entry) => entry.id === chapter.id) + 1;
      return formatChapterBlock(chapterNumber, chapterOutput);
    })
    .filter((block) => block.length > 0);

  return {
    content: blocks.join('\n\n'),
    debug: {
      requestedChapterCount,
      resolvedChapterIds,
      missingChapterIds,
      finalIncludedChapterIds
    }
  };
}

export function resolvePreviousSummaryOutput(params: {
  chapters: Chapter[];
  chapterIndex: number;
  summaries: Map<string, string>;
  mode?: StoryPreviousAssistantOutputMode;
}): string {
  const { chapters, chapterIndex, summaries, mode = 'sampled' } = params;
  if (chapterIndex <= 0 || chapterIndex >= chapters.length) {
    return '';
  }

  const buildChapterOutput = (chapterId: string): string => {
    return normalizeChapterOutput(String(summaries.get(chapterId) || ''), mode);
  };

  const directPreviousChapter = chapters[chapterIndex - 1];
  if (directPreviousChapter) {
    return buildChapterOutput(directPreviousChapter.id);
  }

  return '';
}

export function resolvePreviousTranslatedOutput(params: {
  chapters: Chapter[];
  chapterIndex: number;
  translatedChapters: Map<string, string>;
  mode?: StoryPreviousAssistantOutputMode;
  chapterCount?: number;
}): string {
  return resolvePreviousTranslatedOutputDebug(params).content;
}

export function resolvePreviousAssistantOutputDebug(params: {
  chapters: Chapter[];
  chapterIndex: number;
  summaries: Map<string, string>;
  translatedChapters: Map<string, string>;
  mode?: StoryPreviousAssistantOutputMode;
  chapterCount?: number;
  explicitChapterIds?: string[] | null;
}): { content: string; debug: PreviousAssistantOutputDebug } {
  const mode = params.mode || 'sampled';

  if (params.explicitChapterIds && params.explicitChapterIds.length > 0) {
    return resolvePreviousTranslatedOutputDebug({
      chapters: params.chapters,
      chapterIndex: params.chapterIndex,
      translatedChapters: params.translatedChapters,
      mode,
      chapterCount: params.chapterCount,
      explicitChapterIds: params.explicitChapterIds
    });
  }

  const chapterCount = normalizeChapterCount(params.chapterCount);
  if (chapterCount > 1) {
    return resolvePreviousTranslatedOutputDebug({
      chapters: params.chapters,
      chapterIndex: params.chapterIndex,
      translatedChapters: params.translatedChapters,
      mode,
      chapterCount
    });
  }

  const summaryOutput = resolvePreviousSummaryOutput({
    chapters: params.chapters,
    chapterIndex: params.chapterIndex,
    summaries: params.summaries,
    mode
  });
  if (summaryOutput) {
    const directPreviousChapter = params.chapters[params.chapterIndex - 1];
    const resolvedId = directPreviousChapter ? [directPreviousChapter.id] : [];
    return {
      content: summaryOutput,
      debug: {
        requestedChapterCount: chapterCount,
        resolvedChapterIds: resolvedId,
        missingChapterIds: [],
        finalIncludedChapterIds: resolvedId
      }
    };
  }

  return resolvePreviousTranslatedOutputDebug({
    chapters: params.chapters,
    chapterIndex: params.chapterIndex,
    translatedChapters: params.translatedChapters,
    mode,
    chapterCount
  });
}

export function resolvePreviousAssistantOutput(params: {
  chapters: Chapter[];
  chapterIndex: number;
  summaries: Map<string, string>;
  translatedChapters: Map<string, string>;
  mode?: StoryPreviousAssistantOutputMode;
  chapterCount?: number;
}): string {
  return resolvePreviousAssistantOutputDebug(params).content;
}
