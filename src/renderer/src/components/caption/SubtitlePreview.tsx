/**
 * SubtitlePreview - Canvas preview hiển thị frame video + subtitle có thể kéo thả
 * Hỗ trợ 2 chế độ:
 *  - subtitle: kéo để đặt vị trí subtitle
 *  - blackout: landscape = tô đen đáy, portrait = blur đáy foreground
 */

import { useEffect } from 'react';
import { ASSStyleConfig, CoverQuad, SubtitleEntry } from '@shared/types/caption';
import { useSubtitlePreview } from './hooks/useSubtitlePreview';
import { Crosshair, RotateCcw, Square, Trash2, Image, ZoomIn, ZoomOut } from 'lucide-react';
import styles from './SubtitlePreview.module.css';

interface SubtitlePreviewProps {
  videoPath: string | null;
  style: ASSStyleConfig;
  entries?: SubtitleEntry[];
  subtitlePosition?: { x: number; y: number } | null;
  blackoutTop?: number | null;
  coverMode?: 'blackout_bottom' | 'copy_from_above';
  coverQuad?: CoverQuad;
  renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  portraitForegroundCropPercent?: number;
  onPositionChange: (pos: { x: number; y: number } | null) => void;
  onBlackoutChange?: (value: number | null) => void;
  onCoverModeChange?: (value: 'blackout_bottom' | 'copy_from_above') => void;
  onCoverQuadChange?: (value: CoverQuad) => void;
  onRenderResolutionChange?: (value: 'original' | '1080p' | '720p' | '540p' | '360p') => void;
  previewLayoutValue?: 'landscape' | 'portrait';
  onPreviewLayoutChange?: (value: 'landscape' | 'portrait') => void;
  onLogoPositionChange?: (pos: { x: number; y: number } | null) => void;
  onLogoScaleChange?: (scale: number) => void;
  onSelectLogo?: () => void;
  onRemoveLogo?: () => void;
  renderSnapshotMode?: boolean;
  interactiveDisabledReason?: string;
}

export function SubtitlePreview({ videoPath, style, entries, subtitlePosition, blackoutTop, coverMode, coverQuad, renderMode, renderResolution, previewLayoutValue, onPreviewLayoutChange, logoPath, logoPosition, logoScale, portraitForegroundCropPercent, onPositionChange, onBlackoutChange, onCoverModeChange, onCoverQuadChange, onRenderResolutionChange, onLogoPositionChange, onLogoScaleChange, onSelectLogo, onRemoveLogo, renderSnapshotMode, interactiveDisabledReason }: SubtitlePreviewProps) {
  const isPortraitMode = renderMode === 'hardsub_portrait_9_16';
  const isInteractionDisabled = Boolean(interactiveDisabledReason);
  const preview = useSubtitlePreview({
    style,
    entries,
    subtitlePosition,
    blackoutTop,
    coverMode,
    coverQuad,
    renderMode,
    renderResolution,
    logoPath,
    logoPosition,
    logoScale,
    portraitForegroundCropPercent,
    onPositionChange: (pos) => onPositionChange(pos),
    onBlackoutChange,
    onCoverModeChange,
    onCoverQuadChange,
    onLogoPositionChange,
    onLogoScaleChange,
    renderSnapshotMode,
  });

  // Load preview when video path changes
  useEffect(() => {
    if (videoPath) {
      preview.loadPreview(videoPath);
    }
  }, [videoPath]);

  useEffect(() => {
    if (!videoPath || preview.videoDuration <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      preview.loadFrameAt(preview.frameTimeSec);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [videoPath, preview.videoDuration, preview.frameTimeSec, preview.loadFrameAt]);

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
  const mainInfo = preview.mode === 'subtitle'
    ? `Rel ${preview.subtitlePositionRel.x.toFixed(3)}, ${preview.subtitlePositionRel.y.toFixed(3)}`
    : (preview.mode === 'logo'
      ? `Pos ${preview.logoPosition ? `${preview.logoPosition.x}, ${preview.logoPosition.y}` : 'Auto'} · Scale ${Math.round(preview.logoScale * 100)}%`
      : (preview.coverMode === 'copy_from_above'
        ? `Copy mode · offset ${preview.copyOffsetPx}px · ${preview.coverQuadValid ? 'Quad OK' : 'Quad lỗi'}`
        : `${isPortraitMode ? 'Blur' : 'Mask'} ${blackoutPct}%`));
  const resolutionInfo = `${preview.videoSize.width}×${preview.videoSize.height} · ${isPortraitMode ? '9:16' : '16:9'} ${displayRenderResolution}`;

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
          title={
            preview.coverMode === 'copy_from_above'
              ? 'Kéo cạnh trái/phải/top/bottom hoặc kéo cả vùng để copy vùng phía trên che nội dung'
              : (isPortraitMode ? 'Kéo để đặt vùng blur đáy video chính' : 'Kéo để đặt vùng tô đen phía dưới video')
          }
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
        className={`${styles.canvasContainer} ${renderMode === 'hardsub_portrait_9_16' ? styles.canvasContainerPortrait : ''} ${preview.isDragging ? styles.dragging : ''} ${preview.isPanning ? styles.panning : ''} ${preview.mode === 'blackout' ? (preview.coverMode === 'copy_from_above' ? styles.coverCopyMode : styles.blackoutMode) : ''}`}
      >
        <canvas
          ref={preview.canvasRef}
          className={styles.canvas}
          onMouseDown={isInteractionDisabled ? undefined : (event) => {
            event.currentTarget.focus();
            preview.handleMouseDown(event);
          }}
          onMouseMove={isInteractionDisabled ? undefined : preview.handleMouseMove}
          onMouseUp={isInteractionDisabled ? undefined : preview.handleMouseUp}
          onMouseLeave={isInteractionDisabled ? undefined : preview.handleMouseUp}
          onWheel={isInteractionDisabled ? undefined : preview.handleWheel}
          onKeyDown={isInteractionDisabled ? undefined : preview.handleKeyDown}
          tabIndex={isInteractionDisabled ? -1 : 0}
          style={{ cursor: isInteractionDisabled ? 'not-allowed' : preview.canvasCursor }}
        />
        {preview.isLoading && (
          <div className={styles.loadingOverlay}>Đang tải preview...</div>
        )}
        {isInteractionDisabled && (
          <div className={styles.disabledOverlay}>{interactiveDisabledReason}</div>
        )}
      </div>

      {!renderSnapshotMode && videoPath && preview.videoDuration > 0 && (
        <div className={styles.scrubberRow}>
          <span className={styles.scrubberLabel}>Frame</span>
          <input
            className={styles.scrubber}
            type="range"
            min={0}
            max={preview.videoDuration}
            step={Math.max(0.01, preview.videoDuration / 500)}
            value={Math.min(preview.frameTimeSec, preview.videoDuration)}
            onChange={(e) => preview.setFrameTimeSec(Number(e.target.value) || 0)}
            disabled={isInteractionDisabled || preview.isLoading}
          />
          <span className={styles.scrubberHint}>
            {preview.frameTimeSec.toFixed(2)}s / {preview.videoDuration.toFixed(2)}s
          </span>
        </div>
      )}

      {!renderSnapshotMode && (
        <div className={styles.zoomRow}>
          <button
            className={styles.zoomBtn}
            onClick={preview.zoomOut}
            disabled={isInteractionDisabled}
            title="Thu nhỏ preview"
          >
            <ZoomOut size={12} />
          </button>
          <input
            className={styles.zoomSlider}
            type="range"
            min={100}
            max={400}
            step={5}
            value={Math.round(preview.zoom * 100)}
            onChange={(e) => preview.setZoom((Number(e.target.value) || 100) / 100)}
            disabled={isInteractionDisabled}
          />
          <button
            className={styles.zoomBtn}
            onClick={preview.zoomIn}
            disabled={isInteractionDisabled}
            title="Phóng to preview"
          >
            <ZoomIn size={12} />
          </button>
          <button
            className={styles.resetBtn}
            onClick={preview.resetViewTransform}
            disabled={isInteractionDisabled}
            title="Reset zoom/pan"
          >
            <RotateCcw size={12} /> Zoom {Math.round(preview.zoom * 100)}%
          </button>
        </div>
      )}

      <div className={styles.infoBar}>
        <div className={styles.infoPills}>
          <span className={`${styles.positionInfo} ${styles.positionInfoPrimary}`}>{mainInfo}</span>
          <span className={styles.positionInfo}>{resolutionInfo}</span>
        </div>
        <div className={styles.actionRow}>
          {preview.mode === 'subtitle' && (
            <>
              <button className={styles.resetBtn} onClick={preview.resetToCenter}>
                <RotateCcw size={12} /> Căn giữa
              </button>
            </>
          )}

          {onPreviewLayoutChange && (
            <select
              className={styles.resolutionSelect}
              value={previewLayoutValue || (isPortraitMode ? 'portrait' : 'landscape')}
              onChange={(e) => onPreviewLayoutChange(e.target.value as 'landscape' | 'portrait')}
              title="Tỷ lệ khung preview"
              disabled={isInteractionDisabled}
            >
              <option value="landscape">16:9</option>
              <option value="portrait">9:16</option>
            </select>
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

          {preview.mode === 'subtitle' && (
            <button
              className={styles.resetBtn}
              onClick={() => onPositionChange(null)}
              title="Xóa position, dùng alignment mặc định"
              disabled={isInteractionDisabled}
            >
              Vị trí auto
            </button>
          )}

          {preview.mode === 'blackout' && (
            <select
              className={styles.resolutionSelect}
              value={preview.coverMode}
              onChange={(e) => preview.setCoverMode(e.target.value as 'blackout_bottom' | 'copy_from_above')}
              disabled={isInteractionDisabled || renderMode === 'black_bg'}
              title="Chọn kiểu che video"
            >
              <option value="blackout_bottom">Che đen đáy</option>
              <option value="copy_from_above">Copy vùng trên (hình chữ nhật)</option>
            </select>
          )}
          
          {preview.mode === 'blackout' && preview.coverMode === 'blackout_bottom' && preview.blackoutTop !== null && (
            <button
              className={`${styles.resetBtn} ${styles.dangerBtn}`}
              onClick={preview.clearBlackout}
              title={isPortraitMode ? 'Xóa vùng blur đáy' : 'Xóa vùng tô đen'}
              disabled={isInteractionDisabled}
            >
              <Trash2 size={12} /> Xóa
            </button>
          )}
          {preview.mode === 'blackout' && preview.coverMode === 'copy_from_above' && (
            <button
              className={styles.resetBtn}
              onClick={preview.resetCoverQuad}
              title="Đưa vùng chữ nhật về mặc định"
              disabled={isInteractionDisabled || renderMode === 'black_bg'}
            >
              <RotateCcw size={12} /> Reset Quad
            </button>
          )}
        </div>
      </div>

      {!videoPath && (
        <div className={styles.hint}>
          Chọn thư mục CapCut có video để xem preview
        </div>
      )}
    </div>
  );
}
