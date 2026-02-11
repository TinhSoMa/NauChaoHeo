import { useState } from 'react';
import type { Chapter } from '@shared/types';

export function useChapterSelection(chapters: Chapter[]) {
  const [excludedChapterIds, setExcludedChapterIds] = useState<Set<string>>(new Set());
  const [lastClickedChapterId, setLastClickedChapterId] = useState<string | null>(null);

  // Check if a chapter is included for translation
  const isChapterIncluded = (chapterId: string): boolean => {
    return !excludedChapterIds.has(chapterId);
  };

  // Toggle chapter exclusion (with Shift+Click range selection support)
  const toggleChapterExclusion = (chapterId: string, shiftKey?: boolean) => {
    if (shiftKey && lastClickedChapterId && lastClickedChapterId !== chapterId) {
      // Range selection with Shift
      const lastIndex = chapters.findIndex(c => c.id === lastClickedChapterId);
      const currentIndex = chapters.findIndex(c => c.id === chapterId);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeChapters = chapters.slice(start, end + 1);
        
        // Determine action: if current chapter is excluded, include range; otherwise exclude range
        const shouldInclude = excludedChapterIds.has(chapterId);
        
        setExcludedChapterIds(prev => {
          const next = new Set(prev);
          rangeChapters.forEach(c => {
            if (shouldInclude) {
              next.delete(c.id);
            } else {
              next.add(c.id);
            }
          });
          return next;
        });
      }
    } else {
      // Normal click: Toggle single chapter
      setExcludedChapterIds(prev => {
        const next = new Set(prev);
        if (next.has(chapterId)) {
          next.delete(chapterId);
        } else {
          next.add(chapterId);
        }
        return next;
      });
    }
    
    // Update last clicked chapter
    setLastClickedChapterId(chapterId);
  };

  // Select all chapters for translation
  const selectAllChapters = () => {
    setExcludedChapterIds(new Set());
  };

  // Deselect all chapters
  const deselectAllChapters = () => {
    setExcludedChapterIds(new Set(chapters.map(c => c.id)));
  };

  // Count selected chapters
  const selectedChapterCount = chapters.length - excludedChapterIds.size;

  return {
    excludedChapterIds,
    setExcludedChapterIds,
    isChapterIncluded,
    toggleChapterExclusion,
    selectAllChapters,
    deselectAllChapters,
    selectedChapterCount
  };
}
