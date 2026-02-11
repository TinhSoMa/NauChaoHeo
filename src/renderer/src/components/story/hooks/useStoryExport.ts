import { useState } from 'react';
import { Chapter } from '@shared/types';
import { exportToEbook, promptExportMode } from '../services/ebookExporter';

interface UseStoryExportParams {
  translatedChapters: Map<string, string>;
  translatedTitles: Map<string, string>;
  chapters: Chapter[];
  sourceLang: string;
  targetLang: string;
  projectId: string | null;
}

/**
 * Custom hook to handle story export to EPUB format
 * Manages export status and handles the complete export workflow
 */
export function useStoryExport(params: UseStoryExportParams) {
  const {
    translatedChapters,
    translatedTitles,
    chapters,
    sourceLang,
    targetLang,
    projectId
  } = params;

  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting'>('idle');

  const handleExportEbook = async () => {
    if (translatedChapters.size === 0) {
      alert('Chưa có chương nào được dịch để export!');
      return;
    }

    // Ask user for export mode
    const exportMode = await promptExportMode();
    if (!exportMode) return;

    setExportStatus('exporting');

    try {
      console.log('[useStoryExport] Bắt đầu export ebook...', { exportMode });
      
      // Load summary data if needed
      let summaries = new Map<string, string>();
      let summaryTitles = new Map<string, string>();
      
      if (exportMode === 'summary' || exportMode === 'combined') {
        if (!projectId) {
          alert('⚠️ Cần mở project để export tóm tắt!');
          setExportStatus('idle');
          return;
        }
        
        try {
          const summaryRes = await window.electronAPI.project.readFeatureFile({
            projectId,
            feature: 'story',
            fileName: 'story-summary.json'
          });
          
          if (summaryRes?.success && summaryRes.data) {
            const summaryData = JSON.parse(summaryRes.data) as {
              summaries?: Array<[string, string]>;
              summaryTitles?: Array<[string, string]>;
            };
            
            if (summaryData.summaries) summaries = new Map(summaryData.summaries);
            if (summaryData.summaryTitles) summaryTitles = new Map(summaryData.summaryTitles);
            
            console.log(`[useStoryExport] Đã load ${summaries.size} tóm tắt`);
          }
        } catch (err) {
          console.error('[useStoryExport] Lỗi load summary data:', err);
        }
        
        if (summaries.size === 0) {
          alert('⚠️ Chưa có tóm tắt nào! Vui lòng tóm tắt truyện trước.');
          setExportStatus('idle');
          return;
        }
      }

      // Export using service
      const result = await exportToEbook({
        exportMode,
        sourceLang,
        targetLang,
        chapters,
        translatedChapters,
        translatedTitles,
        summaries,
        summaryTitles
      });

      if (result.success && result.filePath) {
        alert(`✅ Đã export thành công!\n\nFile: ${result.filePath}\n\nSố chương: ${result.chapterCount}`);
      } else if (result.error) {
        throw new Error(result.error);
      }

    } catch (error) {
      console.error('[useStoryExport] Lỗi export ebook:', error);
      alert(`❌ Lỗi export ebook: ${error}`);
    } finally {
      setExportStatus('idle');
    }
  };

  return {
    exportStatus,
    handleExportEbook,
    isExporting: exportStatus === 'exporting'
  };
}
