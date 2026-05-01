import type { Chapter } from '@shared/types';
import { STORY_IPC_CHANNELS } from '@shared/types';

export interface ExportOptions {
  exportMode: 'translation' | 'summary' | 'combined';
  sourceLang: string;
  targetLang: string;
  chapters: Chapter[];
  translatedChapters: Map<string, string>;
  translatedTitles: Map<string, string>;
  summaries?: Map<string, string>;
  summaryTitles?: Map<string, string>;
  sourceEpubPath?: string;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  chapterCount?: number;
}

/**
 * Export translated chapters to EPUB ebook
 */
export async function exportToEbook(options: ExportOptions): Promise<ExportResult> {
  const {
    exportMode,
    sourceLang,
    targetLang,
    chapters,
    translatedChapters,
    translatedTitles,
    summaries = new Map(),
    summaryTitles = new Map(),
    sourceEpubPath
  } = options;

  try {
    // 1. Ask user for save location
    const defaultName = exportMode === 'translation' 
      ? `translation_${sourceLang}-${targetLang}.epub`
      : exportMode === 'summary'
        ? `summary_${targetLang}.epub`
        : `combined_${sourceLang}-${targetLang}.epub`;
    
    const saveDialogResult = await window.electronAPI.invoke('dialog:showSaveDialog', {
        title: 'Lưu Ebook EPUB',
        defaultPath: defaultName,
        filters: [{ name: 'EPUB Ebook', extensions: ['epub'] }]
    }) as { canceled: boolean; filePath?: string };

    if (saveDialogResult.canceled || !saveDialogResult.filePath) {
        return { success: false };
    }

    // 2. Prepare chapters based on export mode
    const ebookChapters: { title: string; content: string }[] = [];
    const titleMap = new Map(
      chapters.map((c) => [c.id, c.title] as [string, string])
    );
    const orderedTranslatedEntries = chapters.length > 0
      ? chapters
          .filter((c) => translatedChapters.has(c.id))
          .map((c) => [c.id, translatedChapters.get(c.id)!] as [string, string])
      : Array.from(translatedChapters.entries());

    if (exportMode === 'translation') {
      // Translation only
      for (const [chapterId, content] of orderedTranslatedEntries) {
        const title =
          translatedTitles.get(chapterId) ||
          titleMap.get(chapterId) ||
          `Chương ${chapterId}`;
        ebookChapters.push({ title, content });
      }
    } else if (exportMode === 'summary') {
      // Summary only
      for (const [chapterId] of orderedTranslatedEntries) {
        const summaryContent = summaries.get(chapterId);
        if (summaryContent) {
          const title = summaryTitles.get(chapterId) ||
            translatedTitles.get(chapterId) ||
            titleMap.get(chapterId) ||
            `Tóm tắt ${chapterId}`;
          ebookChapters.push({ 
            title: `[Tóm tắt] ${title}`, 
            content: summaryContent 
          });
        }
      }
    } else {
      // Combined: Chapter 1 -> Summary 1 -> Chapter 2 -> Summary 2...
      for (const [chapterId, translationContent] of orderedTranslatedEntries) {
        const chapterTitle =
          translatedTitles.get(chapterId) ||
          titleMap.get(chapterId) ||
          `Chương ${chapterId}`;
        
        // Add translation
        ebookChapters.push({ 
          title: chapterTitle, 
          content: translationContent 
        });
        
        // Add summary if available
        const summaryContent = summaries.get(chapterId);
        if (summaryContent) {
          ebookChapters.push({ 
            title: `📝 Tóm tắt: ${chapterTitle}`, 
            content: summaryContent 
          });
        }
      }
    }

    if (ebookChapters.length === 0) {
      return { success: false, error: 'Không tìm thấy nội dung để đóng gói' };
    }

    console.log(`[EbookExporter] Đóng gói ${ebookChapters.length} chương...`);
    const outputDir = saveDialogResult.filePath.substring(0, saveDialogResult.filePath.lastIndexOf('\\')); 
    const filename = saveDialogResult.filePath.substring(saveDialogResult.filePath.lastIndexOf('\\') + 1).replace('.epub', '');

    // 3. Call backend service to create ebook
    const result = await window.electronAPI.invoke(
      STORY_IPC_CHANNELS.CREATE_EBOOK,
      {
        chapters: ebookChapters,
        title: filename,
        author: 'AI Translator',
        filename: filename,
        outputDir: outputDir,
        sourceEpubPath
      }
    ) as { success: boolean; filePath?: string; error?: string };

    if (result.success && result.filePath) {
      console.log('[EbookExporter] Export thành công:', result.filePath);
      return {
        success: true,
        filePath: result.filePath,
        chapterCount: ebookChapters.length
      };
    } else {
      throw new Error(result.error || 'Export thất bại');
    }

  } catch (error) {
    console.error('[EbookExporter] Lỗi export ebook:', error);
    return {
      success: false,
      error: String(error)
    };
  }
}

/**
 * Prompt user for export mode
 */
export async function promptExportMode(): Promise<'translation' | 'summary' | 'combined' | null> {
  return new Promise((resolve) => {
    const userChoice = window.confirm(
      '📚 Chọn loại nội dung đóng gói:\n\n' +
      '✅ OK = Bản dịch + Tóm tắt (Kết hợp)\n' +
      '❌ Cancel = Chỉ bản dịch\n\n' +
      '(Để chọn "Chỉ tóm tắt", nhấn Cancel rồi chọn lại)'
    );
    
    if (userChoice) {
      resolve('combined');
    } else {
      // Second prompt for translation vs summary
      const summaryOnly = window.confirm(
        '📚 Bạn đã chọn không kết hợp.\n\n' +
        '✅ OK = Chỉ tóm tắt\n' +
        '❌ Cancel = Chỉ bản dịch'
      );
      resolve(summaryOnly ? 'summary' : 'translation');
    }
  });
}
