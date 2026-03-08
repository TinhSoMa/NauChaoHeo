import fs from 'fs/promises';
import path from 'path';
import { Chapter, ParseStoryResult } from '../../../shared/types/story';



/**
 * Parses a story file into chapters.
 * Supports .txt files with specific delimiters (e.g., === 第X章 ===) and .epub files.
 */
export async function parseStoryFile(filePath: string): Promise<ParseStoryResult> {
  try {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.epub') {
       return await parseEpubFile(filePath);
    } else {
       return await parseTxtFile(filePath);
    }

  } catch (error) {
    console.error('Error parsing story file:', error);
    return { success: false, error: String(error) };
  }
}

// Use 'epub' package (node-epub)
const EPub = require('epub');

async function parseEpubFile(filePath: string): Promise<ParseStoryResult> {
    return new Promise((resolve) => {
        const epub = new EPub(filePath);
        
        epub.on('error', (err: any) => {
             resolve({ success: false, error: String(err) });
        });

        epub.on('end', async () => {
             try {
                // epub.flow is the spine/reading order
                // epub.flow.forEach(chapter => ...)
                const chapters: Chapter[] = [];
                
                // Helper to get text from chapter ID
                const getChapterText = (id: string): Promise<string> => {
                    return new Promise((res, rej) => {
                        epub.getChapter(id, (err: any, text: string) => {
                            if (err) rej(err);
                            else res(text);
                        });
                    });
                };

                let pIndex = 1;
                // Iterate over the flow
                for (const chapterRef of epub.flow) {
                     // chapterRef.id, chapterRef.title, chapterRef.href
                     if (!chapterRef.id) continue;
                     
                     try {
                         const html = await getChapterText(chapterRef.id);
                         // Strip HTML tags to get plain text
                         // Simple regex strip. For robust parsing, might need 'cheerio' or similar.
                         // Replacing <br> or <p> with newlines first to preserve paragraph structure.
                         let text = html
                             .replace(/<br\s*\/?>/gi, '\n')
                             .replace(/<\/p>/gi, '\n\n')
                             .replace(/<[^>]*>/g, '') // Strip remaining tags
                             .replace(/&nbsp;/g, ' ')
                             .replace(/&lt;/g, '<')
                             .replace(/&gt;/g, '>')
                             .replace(/&amp;/g, '&');
                             
                         // Decode other entities if needed, but this covers basics.
                         
                         // Clean up excessive newlines
                         text = text.replace(/\n\s*\n/g, '\n\n').trim();
                         
                         // Skip empty chapters
                         if (!text) continue;

                         chapters.push({
                             id: String(pIndex++),
                             title: chapterRef.title || `Chapter ${pIndex}`,
                             content: text
                         });
                     } catch (e) {
                         console.error(`Failed to load chapter ${chapterRef.id}:`, e);
                     }
                }
                
                resolve({ success: true, chapters });

             } catch (e) {
                 resolve({ success: false, error: String(e) });
             }
        });

        epub.parse();
    });
}

/**
 * Existing TXT parser
 */
async function parseTxtFile(filePath: string): Promise<ParseStoryResult> {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const chapters: Chapter[] = [];
    
    // Regex to find chapter headers like "=== 第1章 寒门之子 ==="
    const chapterRegex = /===\s*(.*?)\s*===/g;
    
    let match;
    const matches: { title: string; index: number; length: number }[] = [];
    while ((match = chapterRegex.exec(fileContent)) !== null) {
      matches.push({
        title: match[1].trim(),
        index: match.index,
        length: match[0].length
      });
    }

    if (matches.length === 0) {
      chapters.push({
        id: '1',
        title: 'Toàn bộ nội dung',
        content: fileContent
      });
      return { success: true, chapters };
    }

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
}
