import type { RefObject } from 'react';
import { FileText, BookOpen, AlertTriangle } from 'lucide-react';
import type { Chapter } from '@shared/types';
import type { StoryReadingThemePalette } from '../types';

interface ReaderContentSurfaceProps {
  selectedChapterId: string | null;
  chapters: Chapter[];
  translatedChapters: Map<string, string>;
  summaries: Map<string, string>;
  summaryTitles: Map<string, string>;
  viewMode: 'original' | 'translated' | 'summary';
  isReaderMode: boolean;
  fontSize: number;
  lineHeight: number;
  contentScrollRef: RefObject<HTMLDivElement | null>;
  onContentScroll: () => void;
  onSurfaceInteract?: () => void;
  palette: StoryReadingThemePalette;
  streamingContent?: ReadonlyMap<string, string>;
  streamingErrors?: ReadonlyMap<string, string>;
}

export function ReaderContentSurface(props: ReaderContentSurfaceProps) {
  const {
    selectedChapterId,
    chapters,
    translatedChapters,
    summaries,
    summaryTitles,
    viewMode,
    isReaderMode,
    fontSize,
    lineHeight,
    contentScrollRef,
    onContentScroll,
    onSurfaceInteract,
    palette,
    streamingContent,
    streamingErrors
  } = props;

  const selectedChapter = selectedChapterId
    ? chapters.find((chapter) => chapter.id === selectedChapterId)
    : null;

  return (
    <div
      ref={contentScrollRef}
      onScroll={onContentScroll}
      onPointerDown={onSurfaceInteract}
      className={`flex-1 overflow-y-auto ${isReaderMode ? 'px-5 py-3' : 'px-10 py-6'}`}
      style={{
        backgroundColor: palette.contentBackground,
        color: palette.textPrimary,
        fontSize: `${fontSize}px`,
        lineHeight,
        fontFamily: "'Noto Sans', 'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif",
        letterSpacing: '0.01em',
        wordSpacing: '0.05em'
      }}
    >
      <div className={`${isReaderMode ? 'w-full max-w-none' : 'mx-auto max-w-4xl'}`}>
        {selectedChapterId ? (
          viewMode === 'original' ? (
            <div className="whitespace-pre-wrap wrap-break-word">{selectedChapter?.content}</div>
          ) : viewMode === 'translated' ? (
            (() => {
              const hasTranslated = translatedChapters.has(selectedChapterId);
              const hasStreaming = streamingContent?.has(selectedChapterId);
              const content = hasTranslated
                ? translatedChapters.get(selectedChapterId) || ''
                : hasStreaming
                  ? streamingContent!.get(selectedChapterId) || ''
                  : null;
              const errorMessage = selectedChapterId ? streamingErrors?.get(selectedChapterId) : undefined;
              return (
                <>
                  {errorMessage && (
                    <div className="flex items-center gap-2 px-4 py-2 mb-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}
                  {content !== null ? (
                    <div className="whitespace-pre-wrap wrap-break-word">{content}</div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center opacity-70" style={{ color: palette.textSecondary }}>
                      {errorMessage ? (
                        <>
                          <AlertTriangle size={48} className="mb-4" />
                          <p className="text-base">Dịch thất bại do lỗi server.</p>
                        </>
                      ) : (
                        <>
                          <BookOpen size={48} className="mb-4" />
                          <p className="text-base">Chưa có bản dịch. Nhấn "Dịch 1" hoặc "Dịch All" để bắt đầu.</p>
                        </>
                      )}
                    </div>
                  )}
                </>
              );
            })()
          ) : summaries.get(selectedChapterId) ? (
            <div className="whitespace-pre-wrap wrap-break-word">
              {summaryTitles.get(selectedChapterId) && (
                <h3 className="text-lg font-bold mb-4 text-primary">{summaryTitles.get(selectedChapterId) || ''}</h3>
              )}
              {summaries.get(selectedChapterId) || ''}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-70" style={{ color: palette.textSecondary }}>
              <FileText size={48} className="mb-4" />
              <p className="text-base">Chưa có tóm tắt cho chương này.</p>
            </div>
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center opacity-70" style={{ color: palette.textSecondary }}>
            <BookOpen size={48} className="mb-4" />
            <p className="text-base">Chọn một chương để xem nội dung</p>
          </div>
        )}
      </div>
    </div>
  );
}
