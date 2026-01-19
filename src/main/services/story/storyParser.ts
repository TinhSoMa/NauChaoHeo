import fs from 'fs/promises';
import { Chapter, ParseStoryResult } from '../../../shared/types/story';

/**
 * Parses a story file into chapters.
 * Supports .txt files with specific delimiters (e.g., === 第X章 ===).
 */
export async function parseStoryFile(filePath: string): Promise<ParseStoryResult> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const chapters: Chapter[] = [];
    
    // Regex to find chapter headers like "=== 第1章 寒门之子 ==="
    // We captured the title inside the === ... ===
    const chapterRegex = /===\s*(.*?)\s*===/g;
    
    let match;
    
    // Find all matches
    const matches: { title: string; index: number; length: number }[] = [];
    while ((match = chapterRegex.exec(fileContent)) !== null) {
      matches.push({
        title: match[1].trim(), // "第1章 寒门之子"
        index: match.index,
        length: match[0].length
      });
    }

    if (matches.length === 0) {
      // Fallback: If no "=== ... ===" delimiters found, treat whole file as one chapter
      chapters.push({
        id: '1',
        title: 'Toàn bộ nội dung',
        content: fileContent
      });
      return { success: true, chapters };
    }

    // Slice content based on matches
    for (let i = 0; i < matches.length; i++) {
        const currentMatch = matches[i];
        const nextMatch = matches[i + 1];
        
        const contentStart = currentMatch.index + currentMatch.length;
        const contentEnd = nextMatch ? nextMatch.index : fileContent.length;
        
        const content = fileContent.slice(contentStart, contentEnd).trim();
        
        chapters.push({
            id: String(i + 1),
            title: currentMatch.title,
            content: content
        });
    }

    return { success: true, chapters };

  } catch (error) {
    console.error('Error parsing story file:', error);
    return { success: false, error: String(error) };
  }
}
