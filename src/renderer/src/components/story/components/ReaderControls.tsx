import { Button } from '../../common/Button';
import type { StoryReadingTheme, StoryReadingThemePalette } from '../types';
import { STORY_READING_THEME_OPTIONS } from '../styles/readerThemes';

interface ReaderControlsProps {
  selectedChapterId: string | null;
  chapterTitle: string;
  borderless?: boolean;
  isReaderMode?: boolean;
  viewMode: 'original' | 'translated' | 'summary';
  onViewModeChange: (mode: 'original' | 'translated' | 'summary') => void;
  canViewTranslated: boolean;
  canViewSummary: boolean;
  fontSize: number;
  lineHeight: number;
  onDecreaseFontSize: () => void;
  onIncreaseFontSize: () => void;
  onDecreaseLineHeight: () => void;
  onIncreaseLineHeight: () => void;
  readingTheme: StoryReadingTheme;
  onReadingThemeChange: (theme: StoryReadingTheme) => void;
  isChapterIncluded: boolean;
  onSavePrompt: () => void;
  onSaveSummaryPrompt: () => void;
  palette: StoryReadingThemePalette;
}

export function ReaderControls(props: ReaderControlsProps) {
  const {
    selectedChapterId,
    chapterTitle,
    borderless = false,
    isReaderMode = false,
    viewMode,
    onViewModeChange,
    canViewTranslated,
    canViewSummary,
    fontSize,
    lineHeight,
    onDecreaseFontSize,
    onIncreaseFontSize,
    onDecreaseLineHeight,
    onIncreaseLineHeight,
    readingTheme,
    onReadingThemeChange,
    isChapterIncluded,
    onSavePrompt,
    onSaveSummaryPrompt,
    palette
  } = props;

  const sharedControlStyle = {
    backgroundColor: palette.controlBackground,
    color: palette.controlText,
    borderColor: palette.controlBorder
  };

  return (
    <div
      className={`p-3 font-semibold flex flex-wrap justify-between items-start gap-2 ${borderless ? '' : 'border-b'}`}
      style={{
        backgroundColor: palette.panelBackground,
        borderColor: borderless ? 'transparent' : palette.borderColor,
        color: palette.textPrimary
      }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-wrap">
        <span>Nội dung</span>
        {selectedChapterId && (
          <div className="flex gap-1 rounded p-1" style={sharedControlStyle}>
            <button
              onClick={() => onViewModeChange('original')}
              className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'original' ? 'bg-primary text-white shadow' : ''}`}
              style={viewMode === 'original' ? undefined : { color: palette.textSecondary }}
            >
              Gốc
            </button>
            <button
              onClick={() => onViewModeChange('translated')}
              disabled={!canViewTranslated}
              className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'translated' ? 'bg-primary text-white shadow' : 'disabled:opacity-50'}`}
              style={viewMode === 'translated' ? undefined : { color: palette.textSecondary }}
            >
              Bản dịch
            </button>
            <button
              onClick={() => onViewModeChange('summary')}
              disabled={!canViewSummary}
              className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'summary' ? 'bg-primary text-white shadow' : 'disabled:opacity-50'}`}
              style={viewMode === 'summary' ? undefined : { color: palette.textSecondary }}
            >
              Tóm tắt
            </button>
          </div>
        )}

        {selectedChapterId && (
          <div className="flex items-center gap-3 ml-2 pl-3 border-l flex-wrap" style={{ borderColor: palette.borderColor }}>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: palette.textSecondary }}>Cỡ chữ:</span>
              <button
                onClick={onDecreaseFontSize}
                className="w-6 h-6 rounded border text-sm flex items-center justify-center"
                style={sharedControlStyle}
              >
                -
              </button>
              <span className="text-xs min-w-8 text-center" style={{ color: palette.textSecondary }}>{fontSize}px</span>
              <button
                onClick={onIncreaseFontSize}
                className="w-6 h-6 rounded border text-sm flex items-center justify-center"
                style={sharedControlStyle}
              >
                +
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: palette.textSecondary }}>Giãn dòng:</span>
              <button
                onClick={onDecreaseLineHeight}
                className="w-6 h-6 rounded border text-sm flex items-center justify-center"
                style={sharedControlStyle}
              >
                -
              </button>
              <span className="text-xs min-w-8 text-center" style={{ color: palette.textSecondary }}>
                {lineHeight.toFixed(1)}
              </span>
              <button
                onClick={onIncreaseLineHeight}
                className="w-6 h-6 rounded border text-sm flex items-center justify-center"
                style={sharedControlStyle}
              >
                +
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: palette.textSecondary }}>Theme:</span>
              <div className="flex items-center gap-1 rounded p-1" style={sharedControlStyle}>
                {STORY_READING_THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onReadingThemeChange(option.value)}
                    className={`px-2 py-1 text-xs rounded transition-all ${
                      readingTheme === option.value ? 'bg-primary text-white shadow' : ''
                    }`}
                    style={readingTheme === option.value ? undefined : { color: palette.textSecondary }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedChapterId && (
        <div className="flex gap-2 items-center flex-wrap justify-end min-w-0">
          {!isReaderMode && !isChapterIncluded && (
            <span className="text-xs px-2 py-1 rounded" style={{ color: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.12)' }}>
              Đã loại trừ
            </span>
          )}
          {!isReaderMode && (
            <Button onClick={onSavePrompt} variant="secondary" className="text-xs h-8 px-2">
              Lưu Prompt Dịch
            </Button>
          )}
          {!isReaderMode && (
            <Button onClick={onSaveSummaryPrompt} variant="secondary" className="text-xs h-8 px-2">
              Lưu Prompt Tóm Tắt
            </Button>
          )}
          <span
            className="text-xs px-2 py-1 rounded border max-w-[320px] truncate"
            style={{
              color: palette.textSecondary,
              backgroundColor: palette.controlBackground,
              borderColor: palette.controlBorder
            }}
          >
            {chapterTitle}
          </span>
        </div>
      )}
    </div>
  );
}
