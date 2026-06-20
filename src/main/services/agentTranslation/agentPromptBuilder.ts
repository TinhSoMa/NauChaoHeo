import type { Chapter } from '../../../shared/types/story'

export interface BatchChapter {
  id: string
  title: string
  content: string
}

export function buildBatchPrompt(
  batchChapters: BatchChapter[],
  sourceLang: string,
  targetLang: string,
  batchNumber: number,
  totalBatches: number,
  memory?: { glossary?: string; continuity?: string } | null
): string {
  const sections: string[] = [
    `You are a professional literary translator. Translate from ${sourceLang} to ${targetLang}.`,
    '',
    `This is batch ${batchNumber}/${totalBatches}.`,
    '',
    'Rules:',
    '- Maintain character name consistency throughout',
    '- Preserve the original meaning, tone, and style',
    '- Output natural, fluent text',
    '- Keep chapter titles translated naturally',
    '',
    'IMPORTANT: DO NOT use any tools. Just output the translated JSON in your response.',
    '',
    'Output format (valid JSON array):',
    '[',
    '  {"chapterId": "1", "title": "Translated Title", "translation": "translated text..."},',
    '  {"chapterId": "2", "title": "...", "translation": "..."}',
    ']',
    '',
    '--- CHAPTERS TO TRANSLATE ---',
  ]

  for (const ch of batchChapters) {
    sections.push('', `[${ch.id}] ${ch.title}`, ch.content)
  }

  if (memory?.glossary) {
    sections.push('', '--- GLOSSARY ---', memory.glossary)
  }

  if (memory?.continuity) {
    sections.push('', '--- CONTINUITY CONTEXT ---', memory.continuity)
  }

  return sections.join('\n')
}
