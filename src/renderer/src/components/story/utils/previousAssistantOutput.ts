import type { Chapter } from '@shared/types';
import type { StoryPreviousAssistantOutputMode } from '../types';

const TRANSLATION_LINE_RATIO = 0.6;

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
}): string {
  const { chapters, chapterIndex, translatedChapters, mode = 'sampled' } = params;
  if (chapterIndex <= 0 || chapterIndex >= chapters.length) {
    return '';
  }

  const buildChapterOutput = (chapterId: string): string => {
    return normalizeChapterOutput(String(translatedChapters.get(chapterId) || ''), mode);
  };

  const directPreviousChapter = chapters[chapterIndex - 1];
  if (directPreviousChapter) {
    return buildChapterOutput(directPreviousChapter.id);
  }

  return '';
}

export function resolvePreviousAssistantOutput(params: {
  chapters: Chapter[];
  chapterIndex: number;
  summaries: Map<string, string>;
  translatedChapters: Map<string, string>;
  mode?: StoryPreviousAssistantOutputMode;
}): string {
  const mode = params.mode || 'sampled';
  const summaryOutput = resolvePreviousSummaryOutput({
    chapters: params.chapters,
    chapterIndex: params.chapterIndex,
    summaries: params.summaries,
    mode
  });
  if (summaryOutput) {
    return summaryOutput;
  }

  return resolvePreviousTranslatedOutput({
    chapters: params.chapters,
    chapterIndex: params.chapterIndex,
    translatedChapters: params.translatedChapters,
    mode
  });
}
