/**
 * SubtitlePreview - Canvas preview hiển thị frame video + subtitle có thể kéo thả
 * Hỗ trợ 2 chế độ:
 *  - subtitle: kéo để đặt vị trí subtitle
 *  - blackout: landscape = tô đen đáy, portrait = blur đáy foreground
 */

import { useEffect } from 'react';
import { ASSStyleConfig, SubtitleEntry } from '@shared/types/caption';
import { useSubtitlePreview } from './hooks/useSubtitlePreview';
import { Crosshair, RotateCcw, Square, Trash2, Image } from 'lucide-react';
import styles from './SubtitlePreview.module.css';

interface SubtitlePreviewProps {
  videoPath: string | null;
  style: ASSStyleConfig;
  entries?: SubtitleEntry[];
  subtitlePosition?: { x: number; y: number } | null;
  blackoutTop?: number | null;
  renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  portraitForegroundCropPercent?: number;
  onPositionChange: (pos: { x: number; y: number } | null) => void;
  onBlackoutChange?: (value: number | null) => void;
  onRenderResolutionChange?: (value: 'original' | '1080p' | '720p' | '540p' | '360p') => void;
  onLogoPositionChange?: (pos: { x: number; y: number } | null) => void;
  onLogoScaleChange?: (scale: number) => void;
  onSelectLogo?: () => void;
  onRemoveLogo?: () => void;
  // Thumbnail
  thumbnailText?: string;
  thumbnailFontName?: string;
  onThumbnailTextChange?: (text: string) => void;
  thumbnailTextReadOnly?: boolean;
  thumbnailTextHelper?: string;
  onFrameTimeChange?: (timeSec: number | null) => void;
  selectedFrameTimeSec?: number | null;
  renderSnapshotMode?: boolean;
  interactiveDisabledReason?: string;
}

export function SubtitlePreview({ videoPath, style, entries, subtitlePosition, blackoutTop, renderMode, renderResolution, logoPath, logoPosition, logoScale, portraitForegroundCropPercent, onPositionChange, onBlackoutChange, onRenderResolutionChange, onLogoPositionChange, onLogoScaleChange, onSelectLogo, onRemoveLogo, thumbnailText, thumbnailFontName, onThumbnailTextChange, thumbnailTextReadOnly, thumbnailTextHelper, onFrameTimeChange, selectedFrameTimeSec, renderSnapshotMode, interactiveDisabledReason }: SubtitlePreviewProps) {
  const isPortraitMode = renderMode === 'hardsub_portrait_9_16';
  const isInteractionDisabled = Boolean(interactiveDisabledReason);
  const preview = useSubtitlePreview({
    style,
    entries,
    subtitlePosition,
    blackoutTop,
    renderMode,
    renderResolution,
    logoPath,
    logoPosition,
    logoScale,
    portraitForegroundCropPercent,
    onPositionChange: (pos) => onPositionChange(pos),
    onBlackoutChange,
    onLogoPositionChange,
    onLogoScaleChange,
    thumbnailText,
    thumbnailFontName,
    selectedFrameTimeSec,
    renderSnapshotMode,
  });

  // Load preview when video path changes — khi video load xong, kích hoạt thumbnail ở frame 0
  useEffect(() => {
    if (videoPath) {
      preview.loadPreview(videoPath, selectedFrameTimeSec ?? 0);
    } else {
      onFrameTimeChange?.(null);
    }
  }, [videoPath]);

  useEffect(() => {
    if (!videoPath || selectedFrameTimeSec === null || selectedFrameTimeSec === undefined) {
      return;
    }
    if (Math.abs(preview.frameTimeSec - selectedFrameTimeSec) < 0.05) {
      return;
    }
    preview.setFrameTimeSec(selectedFrameTimeSec);
    preview.loadFrameAt(selectedFrameTimeSec);
  }, [selectedFrameTimeSec, videoPath]);

  const resolutionOptions = isPortraitMode
    ? [
        { value: '1080p', label: '1080p' },
        { value: '720p', label: '720p' },
        { value: '540p', label: '540p' },
        { value: '360p', label: '360p' },
      ]
    : [
        { value: 'original', label: 'Gốc' },
        { value: '1080p', label: '1080p' },
        { value: '720p', label: '720p' },
        { value: '540p', label: '540p' },
        { value: '360p', label: '360p' },
      ];
  const displayRenderResolution = isPortraitMode && (renderResolution === 'original' || !renderResolution)
    ? '1080p'
    : (renderResolution || 'original');

  const blackoutPct = preview.blackoutTop !== null
    ? Math.round((1 - preview.blackoutTop) * 100)
    : 0;

  return (
    <div className={styles.previewSection}>
      {/* Mode toggle */}
      <div className={styles.modeBar}>
        {renderSnapshotMode && (
          <span className={styles.snapshotBadge}>Render Snapshot</span>
        )}
        <button
          className={`${styles.modeBtn} ${preview.mode === 'subtitle' ? styles.modeBtnActive : ''}`}
          onClick={() => preview.setMode('subtitle')}
          title="Kéo để đặt vị trí subtitle"
          disabled={isInteractionDisabled}
        >
          <Crosshair size={13} />
          Sub
        </button>
        <button
          className={`${styles.modeBtn} ${preview.mode === 'blackout' ? styles.modeBtnActive : ''}`}
          onClick={() => preview.setMode('blackout')}
          title={isPortraitMode ? 'Kéo để đặt vùng blur đáy video chính' : 'Kéo để đặt vùng tô đen phía dưới video'}
          disabled={isInteractionDisabled}
        >
          <Square size={13} />
          {isPortraitMode ? 'Blur' : 'Mask'}
        </button>
        {logoPath ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`${styles.modeBtn} ${preview.mode === 'logo' ? styles.modeBtnActive : ''}`}
              onClick={() => preview.setMode('logo')}
              title="Kéo để đặt vị trí Logo Watermark"
              disabled={isInteractionDisabled}
            >
              <Image size={13} />
              Logo
            </button>
            <button
              className={styles.modeBtn}
              onClick={onRemoveLogo}
              title="Xóa Logo"
              style={{ padding: '5px 8px', color: '#ef4444' }}
              disabled={isInteractionDisabled}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ) : (
          <button
            className={styles.modeBtn}
            onClick={onSelectLogo}
            title="Thêm Logo (Watermark)"
            disabled={isInteractionDisabled}
          >
            <Image size={13} />
            Logo
          </button>
        )}
      </div>

      <div
        ref={preview.containerRef}
        className={`${styles.canvasContainer} ${renderMode === 'hardsub_portrait_9_16' ? styles.canvasContainerPortrait : ''} ${preview.isDragging ? styles.dragging : ''} ${preview.mode === 'blackout' ? styles.blackoutMode : ''}`}
      >
        <canvas
          ref={preview.canvasRef}
          className={styles.canvas}
          onMouseDown={isInteractionDisabled ? undefined : preview.handleMouseDown}
          onMouseMove={isInteractionDisabled ? undefined : preview.handleMouseMove}
          onMouseUp={isInteractionDisabled ? undefined : preview.handleMouseUp}
          onMouseLeave={isInteractionDisabled ? undefined : preview.handleMouseUp}
          style={{ cursor: isInteractionDisabled ? 'not-allowed' : preview.canvasCursor }}
        />
        {preview.isLoading && (
          <div className={styles.loadingOverlay}>Đang tải preview...</div>
        )}
        {isInteractionDisabled && (
          <div className={styles.disabledOverlay}>{interactiveDisabledReason}</div>
        )}
      </div>

      <div className={styles.infoBar}>
        <span className={styles.positionInfo}>
          {preview.mode === 'subtitle' ? (
            <>
              pos({preview.subtitlePosition.x}, {preview.subtitlePosition.y})
              {' | '}
              {preview.videoSize.width}×{preview.videoSize.height}
              {' | '}
              {isPortraitMode ? '9:16' : '16:9'} {displayRenderResolution}
            </>
          ) : preview.mode === 'logo' ? (
            <>
              pos({preview.subtitlePosition.x}, {preview.subtitlePosition.y})
              {' | '}
              scale {Math.round(preview.logoScale * 100)}%
              {' | '}
              kéo góc để resize
              {' | '}
              {isPortraitMode ? '9:16' : '16:9'} {displayRenderResolution}
            </>
          ) : (
            <>
              {preview.blackoutTop !== null
                ? (isPortraitMode ? `Blur ${blackoutPct}% đáy video chính` : `Che ${blackoutPct}% dưới video`)
                : (isPortraitMode ? 'Kéo để đặt vùng blur đáy' : 'Kéo để đặt vùng tô đen')}
              {' | '}
              {preview.videoSize.width}×{preview.videoSize.height}
              {' | '}
              {isPortraitMode ? '9:16' : '16:9'} {displayRenderResolution}
              {isPortraitMode && (
                <> {' | '}crop ngang {Math.round(portraitForegroundCropPercent ?? 0)}%</>
              )}
            </>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {preview.mode === 'subtitle' && (
            <>
              <button className={styles.resetBtn} onClick={preview.resetToCenter}>
                <RotateCcw size={12} /> Căn giữa
              </button>
              <button
                className={styles.resetBtn}
                onClick={() => onPositionChange(null)}
                title="Xóa position, dùng alignment mặc định"
                disabled={isInteractionDisabled}
              >
                Tự động
              </button>
            </>
          )}
          
          <select
             className={styles.resolutionSelect}
             value={displayRenderResolution}
             onChange={e => onRenderResolutionChange?.(e.target.value as any)}
          title={renderSnapshotMode ? 'Snapshot dùng đúng độ phân giải video render' : (isPortraitMode ? 'Độ phân giải render 9:16' : 'Độ phân giải render 16:9')}
          disabled={isInteractionDisabled}
          >
             {resolutionOptions.map((item) => (
               <option key={item.value} value={item.value}>
                 {item.label}
               </option>
             ))}
          </select>
          
          {preview.mode === 'blackout' && preview.blackoutTop !== null && (
            <button
              className={`${styles.resetBtn} ${styles.dangerBtn}`}
              onClick={preview.clearBlackout}
              title={isPortraitMode ? 'Xóa vùng blur đáy' : 'Xóa vùng tô đen'}
              disabled={isInteractionDisabled}
            >
              <Trash2 size={12} /> Xóa
            </button>
          )}
        </div>
      </div>

      {preview.frameData && (
        <>
          <div className={styles.scrubberRow}>
            <span className={styles.scrubberLabel}>{preview.frameTimeSec.toFixed(1)}s</span>
            <input
              type="range"
              className={styles.scrubber}
              min={0}
              max={preview.videoDuration > 0 ? preview.videoDuration : 5}
              step={0.1}
              value={preview.frameTimeSec}
              onChange={e => preview.setFrameTimeSec(parseFloat(e.target.value))}
              onMouseUp={isInteractionDisabled ? undefined : (e => {
                const t = parseFloat((e.target as HTMLInputElement).value);
                preview.loadFrameAt(t);
                onFrameTimeChange?.(t);
              })}
              onTouchEnd={isInteractionDisabled ? undefined : (e => {
                const t = parseFloat((e.target as HTMLInputElement).value);
                preview.loadFrameAt(t);
                onFrameTimeChange?.(t);
              })}
              title="Chọn frame xem trước theo toàn bộ timeline video — frame được chọn sẽ dùng làm thumbnail"
              disabled={isInteractionDisabled}
            />
            <span className={styles.scrubberHint}>
              {preview.videoDuration > 0 ? `${preview.videoDuration.toFixed(1)}s` : 'timeline'}
            </span>
          </div>
          <div className={styles.thumbnailTextRow}>
            <span className={styles.thumbnailTextLabel}>Thumbnail:</span>
            <input
              type="text"
              className={styles.thumbnailTextInput}
              placeholder={thumbnailTextReadOnly ? 'Multi-folder: chỉnh text ở danh sách phía trên' : 'Tiêu đề video... (bỏ trống = không có chữ)'}
              value={thumbnailText || ''}
              onChange={e => onThumbnailTextChange?.(e.target.value)}
              readOnly={!!thumbnailTextReadOnly || isInteractionDisabled}
              title={thumbnailTextReadOnly
                ? 'Đang ở chế độ multi-folder: text này chỉ để preview, hãy chỉnh trong danh sách theo folder'
                : 'Văn bản hiển thị ở trung tâm thumbnail ở đầu video'}
            />
          </div>
          {thumbnailTextHelper && (
            <div className={styles.scrubberHint} style={{ marginTop: 4 }}>
              {thumbnailTextHelper}
            </div>
          )}
        </>
      )}

      {!videoPath && (
        <div className={styles.hint}>
          Chọn thư mục CapCut có video để xem preview
        </div>
      )}
    </div>
  );
}
