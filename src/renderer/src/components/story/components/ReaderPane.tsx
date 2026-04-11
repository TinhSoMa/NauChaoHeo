import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Chapter } from '@shared/types';
import type { StoryReadingTheme, StoryReadingThemePalette } from '../types';
import { ReaderControls } from './ReaderControls';
import { ReaderContentSurface } from './ReaderContentSurface';

interface ReaderPaneProps {
  selectedChapterId: string | null;
  chapters: Chapter[];
  translatedChapters: Map<string, string>;
  summaries: Map<string, string>;
  summaryTitles: Map<string, string>;
  skippedChapters: Set<string>;
  viewMode: 'original' | 'translated' | 'summary';
  onViewModeChange: (mode: 'original' | 'translated' | 'summary') => void;
  isReaderMode: boolean;
  fontSize: number;
  lineHeight: number;
  setFontSize: Dispatch<SetStateAction<number>>;
  setLineHeight: Dispatch<SetStateAction<number>>;
  readingTheme: StoryReadingTheme;
  setReadingTheme: Dispatch<SetStateAction<StoryReadingTheme>>;
  palette: StoryReadingThemePalette;
  contentScrollRef: RefObject<HTMLDivElement | null>;
  onContentScroll: () => void;
  onSavePrompt: () => void;
  onSaveSummaryPrompt: () => void;
}

export function ReaderPane(props: ReaderPaneProps) {
  const {
    selectedChapterId,
    chapters,
    translatedChapters,
    summaries,
    summaryTitles,
    skippedChapters,
    viewMode,
    onViewModeChange,
    isReaderMode,
    fontSize,
    lineHeight,
    setFontSize,
    setLineHeight,
    readingTheme,
    setReadingTheme,
    palette,
    contentScrollRef,
    onContentScroll,
    onSavePrompt,
    onSaveSummaryPrompt
  } = props;

  const selectedChapter = selectedChapterId
    ? chapters.find((chapter) => chapter.id === selectedChapterId)
    : null;

  const isExcluded = selectedChapterId ? skippedChapters.has(selectedChapterId) : false;
  const [isControlsVisible, setIsControlsVisible] = useState<boolean>(() => !isReaderMode);

  const handleSurfaceInteract = useCallback(() => {
    if (!isReaderMode) {
      return;
    }
    // Tap on reading area toggles controls visibility.
    setIsControlsVisible((prev) => !prev);
  }, [isReaderMode]);

  useEffect(() => {
    setIsControlsVisible(!isReaderMode);
  }, [isReaderMode]);

  return (
    <div
      className={`h-full flex flex-col ${isReaderMode ? '' : 'border-l'}`}
      style={{
        backgroundColor: palette.panelBackground,
        color: palette.textPrimary,
        borderColor: palette.borderColor
      }}
    >
      <div
        className={`${
          isReaderMode
            ? `transition-all duration-200 overflow-hidden ${isControlsVisible ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`
            : ''
        }`}
      >
        <ReaderControls
          selectedChapterId={selectedChapterId}
          chapterTitle={selectedChapter?.title || ''}
          borderless={isReaderMode}
          isReaderMode={isReaderMode}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          canViewTranslated={Boolean(selectedChapterId && translatedChapters.has(selectedChapterId))}
          canViewSummary={Boolean(selectedChapterId && summaries.has(selectedChapterId))}
          fontSize={fontSize}
          lineHeight={lineHeight}
          onDecreaseFontSize={() => setFontSize((prev) => Math.max(12, prev - 2))}
          onIncreaseFontSize={() => setFontSize((prev) => Math.min(32, prev + 2))}
          onDecreaseLineHeight={() => setLineHeight((prev) => Math.max(1.2, prev - 0.2))}
          onIncreaseLineHeight={() => setLineHeight((prev) => Math.min(3, prev + 0.2))}
          readingTheme={readingTheme}
          onReadingThemeChange={setReadingTheme}
          isChapterIncluded={!isExcluded}
          palette={palette}
          onSavePrompt={onSavePrompt}
          onSaveSummaryPrompt={onSaveSummaryPrompt}
        />
      </div>

      <ReaderContentSurface
        selectedChapterId={selectedChapterId}
        chapters={chapters}
        translatedChapters={translatedChapters}
        summaries={summaries}
        summaryTitles={summaryTitles}
        viewMode={viewMode}
        isReaderMode={isReaderMode}
        fontSize={fontSize}
        lineHeight={lineHeight}
        contentScrollRef={contentScrollRef}
        onContentScroll={onContentScroll}
        onSurfaceInteract={handleSurfaceInteract}
        palette={palette}
      />
    </div>
  );
}
