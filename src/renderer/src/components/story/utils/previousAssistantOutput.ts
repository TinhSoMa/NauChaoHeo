import type { Chapter } from '@shared/types';

const TRANSLATION_LINE_RATIO = 0.6;

function normalizeLines(content: string): string[] {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function pickEvenlyDistributedLines(lines: string[], ratio = TRANSLATION_LINE_RATIO): string[] {
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

export function resolvePreviousAssistantOutput(params: {
  chapters: Chapter[];
  chapterIndex: number;
  summaries: Map<string, string>;
  translatedChapters: Map<string, string>;
}): string {
  const { chapters, chapterIndex, summaries, translatedChapters } = params;
  if (chapterIndex <= 0 || chapterIndex >= chapters.length) {
    return '';
  }

  const buildChapterOutput = (chapterId: string): string => {
    const summary = String(summaries.get(chapterId) || '').trim();
    if (summary) {
      return summary;
    }

    const translated = String(translatedChapters.get(chapterId) || '').trim();
    if (!translated) {
      return '';
    }

    const lines = normalizeLines(translated);
    const picked = pickEvenlyDistributedLines(lines, TRANSLATION_LINE_RATIO);
    return picked.join('\n');
  };

  const directPreviousChapter = chapters[chapterIndex - 1];
  if (directPreviousChapter) {
    const directOutput = buildChapterOutput(directPreviousChapter.id);
    if (directOutput) {
      return directOutput;
    }
  }

  for (let index = chapterIndex - 2; index >= 0; index -= 1) {
    const candidate = chapters[index];
    if (!candidate) {
      continue;
    }
    const candidateOutput = buildChapterOutput(candidate.id);
    if (candidateOutput) {
      return candidateOutput;
    }
  }

  return '';
}
