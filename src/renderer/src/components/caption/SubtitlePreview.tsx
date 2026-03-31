/**
 * SubtitlePreview - Canvas preview hiển thị frame video + subtitle có thể kéo thả
 * Hỗ trợ 2 chế độ:
 *  - subtitle: kéo để đặt vị trí subtitle
 *  - blackout: landscape = tô đen đáy, portrait = blur đáy foreground
 */

import { useEffect, useRef } from 'react';
import { ASSStyleConfig, CoverQuad, RenderVideoOptions, SubtitleEntry } from '@shared/types/caption';
import { useSubtitlePreview } from './hooks/useSubtitlePreview';
import { useSubtitleRenderPreviewState } from './hooks/useSubtitleRenderPreviewState';
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
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
  renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  hardwareAcceleration?: RenderVideoOptions['hardwareAcceleration'];
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  portraitForegroundCropPercent?: number;
  thumbnailText?: string;
  thumbnailTextSecondary?: string;
  hardsubPortraitTextPrimary?: string;
  hardsubPortraitTextSecondary?: string;
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  hardsubPortraitTextPrimaryFontName?: string;
  hardsubPortraitTextPrimaryFontSize?: number;
  hardsubPortraitTextPrimaryColor?: string;
  hardsubPortraitTextSecondaryFontName?: string;
  hardsubPortraitTextSecondaryFontSize?: number;
  hardsubPortraitTextSecondaryColor?: string;
  hardsubTextPrimaryPosition?: { x: number; y: number };
  hardsubTextSecondaryPosition?: { x: number; y: number };
  hardsubPortraitTextPrimaryPosition?: { x: number; y: number };
  hardsubPortraitTextSecondaryPosition?: { x: number; y: number };
  portraitTextPrimaryFontName?: string;
  portraitTextPrimaryFontSize?: number;
  portraitTextPrimaryColor?: string;
  portraitTextSecondaryFontName?: string;
  portraitTextSecondaryFontSize?: number;
  portraitTextSecondaryColor?: string;
  thumbnailLineHeightRatio?: number;
  portraitTextPrimaryPosition?: { x: number; y: number };
  portraitTextSecondaryPosition?: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number } | null) => void;
  onBlackoutChange?: (value: number | null) => void;
  onCoverModeChange?: (value: 'blackout_bottom' | 'copy_from_above') => void;
  onCoverQuadChange?: (value: CoverQuad) => void;
  onRenderResolutionChange?: (value: 'original' | '1080p' | '720p' | '540p' | '360p') => void;
  previewLayoutValue?: 'landscape' | 'portrait';
  onPreviewLayoutChange?: (value: 'landscape' | 'portrait') => void;
  onLogoPositionChange?: (pos: { x: number; y: number } | null) => void;
  onLogoScaleChange?: (scale: number) => void;
  onHardsubTextPrimaryPositionChange?: (pos: { x: number; y: number }) => void;
  onHardsubTextSecondaryPositionChange?: (pos: { x: number; y: number }) => void;
  onPortraitTextPrimaryPositionChange?: (pos: { x: number; y: number }) => void;
  onPortraitTextSecondaryPositionChange?: (pos: { x: number; y: number }) => void;
  onSelectLogo?: () => void;
  onRemoveLogo?: () => void;
  renderSnapshotMode?: boolean;
  interactiveDisabledReason?: string;
  realPreviewDisabledReason?: string;
  hydrationSeq?: number;
  onFirstFrameReady?: (videoPath: string) => void;
}

function formatPreviewTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  const secsLabel = secs.toFixed(2).padStart(5, '0');

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secsLabel}`;
  }

  return `${String(minutes).padStart(2, '0')}:${secsLabel}`;
}

export function SubtitlePreview({ videoPath, style, entries, subtitlePosition, blackoutTop, coverMode, coverQuad, coverFeatherPx, coverFeatherHorizontalPx, coverFeatherVerticalPx, coverFeatherHorizontalPercent, coverFeatherVerticalPercent, renderMode, renderResolution, hardwareAcceleration, previewLayoutValue, onPreviewLayoutChange, logoPath, logoPosition, logoScale, portraitForegroundCropPercent, thumbnailText, thumbnailTextSecondary, hardsubPortraitTextPrimary, hardsubPortraitTextSecondary, thumbnailFontName, thumbnailFontSize, hardsubPortraitTextPrimaryFontName, hardsubPortraitTextPrimaryFontSize, hardsubPortraitTextPrimaryColor, hardsubPortraitTextSecondaryFontName, hardsubPortraitTextSecondaryFontSize, hardsubPortraitTextSecondaryColor, hardsubTextPrimaryPosition, hardsubTextSecondaryPosition, portraitTextPrimaryFontName, portraitTextPrimaryFontSize, portraitTextPrimaryColor, portraitTextSecondaryFontName, portraitTextSecondaryFontSize, portraitTextSecondaryColor, thumbnailLineHeightRatio, hardsubPortraitTextPrimaryPosition, hardsubPortraitTextSecondaryPosition, portraitTextPrimaryPosition, portraitTextSecondaryPosition, onPositionChange, onBlackoutChange, onCoverModeChange, onCoverQuadChange, onRenderResolutionChange, onLogoPositionChange, onLogoScaleChange, onHardsubTextPrimaryPositionChange, onHardsubTextSecondaryPositionChange, onPortraitTextPrimaryPositionChange, onPortraitTextSecondaryPositionChange, onSelectLogo, onRemoveLogo, renderSnapshotMode, interactiveDisabledReason, realPreviewDisabledReason, hydrationSeq, onFirstFrameReady }: SubtitlePreviewProps) {
  const notifiedFramePathRef = useRef('');
  const isPortraitMode = renderMode === 'hardsub_portrait_9_16';
  const isInteractionDisabled = Boolean(interactiveDisabledReason);
  const preview = useSubtitlePreview({
    style,
    entries,
    subtitlePosition,
    blackoutTop,
    coverMode,
    coverQuad,
    coverFeatherPx,
    coverFeatherHorizontalPx,
    coverFeatherVerticalPx,
    coverFeatherHorizontalPercent,
    coverFeatherVerticalPercent,
    renderMode,
    renderResolution,
    logoPath,
    logoPosition,
    logoScale,
    portraitForegroundCropPercent,
    thumbnailText,
    thumbnailTextSecondary,
    hardsubPortraitTextPrimary,
    hardsubPortraitTextSecondary,
    hardsubPortraitTextPrimaryFontName,
    hardsubPortraitTextPrimaryFontSize,
    hardsubPortraitTextPrimaryColor,
    hardsubPortraitTextSecondaryFontName,
    hardsubPortraitTextSecondaryFontSize,
    hardsubPortraitTextSecondaryColor,
    hardsubTextPrimaryPosition,
    hardsubTextSecondaryPosition,
    hardsubPortraitTextPrimaryPosition,
    hardsubPortraitTextSecondaryPosition,
    portraitTextPrimaryFontName,
    portraitTextPrimaryFontSize,
    portraitTextPrimaryColor,
    portraitTextSecondaryFontName,
    portraitTextSecondaryFontSize,
    portraitTextSecondaryColor,
    thumbnailLineHeightRatio,
    portraitTextPrimaryPosition,
    portraitTextSecondaryPosition,
    onPositionChange: (pos) => onPositionChange(pos),
    onBlackoutChange,
    onCoverModeChange,
    onCoverQuadChange,
    onLogoPositionChange,
    onLogoScaleChange,
    onHardsubTextPrimaryPositionChange,
    onHardsubTextSecondaryPositionChange,
    onPortraitTextPrimaryPositionChange,
    onPortraitTextSecondaryPositionChange,
    renderSnapshotMode,
  });
  const realPreview = useSubtitleRenderPreviewState({
    videoPath,
    entries,
    previewTimeSec: preview.frameTimeSec,
    style,
    renderMode,
    renderResolution,
    subtitlePosition,
    blackoutTop,
    coverMode,
    coverQuad,
    coverFeatherPx,
    coverFeatherHorizontalPx,
    coverFeatherVerticalPx,
    coverFeatherHorizontalPercent,
    coverFeatherVerticalPercent,
    logoPath,
    logoPosition,
    logoScale,
    hardwareAcceleration,
    portraitForegroundCropPercent,
    thumbnailText,
    thumbnailTextSecondary,
    hardsubPortraitTextPrimary,
    hardsubPortraitTextSecondary,
    thumbnailFontName,
    thumbnailFontSize,
    hardsubPortraitTextPrimaryFontName,
    hardsubPortraitTextPrimaryFontSize,
    hardsubPortraitTextPrimaryColor,
    hardsubPortraitTextSecondaryFontName,
    hardsubPortraitTextSecondaryFontSize,
    hardsubPortraitTextSecondaryColor,
    hardsubPortraitTextPrimaryPosition,
    hardsubPortraitTextSecondaryPosition,
    portraitTextPrimaryFontName,
    portraitTextPrimaryFontSize,
    portraitTextPrimaryColor,
    portraitTextSecondaryFontName,
    portraitTextSecondaryFontSize,
    portraitTextSecondaryColor,
    thumbnailLineHeightRatio,
    portraitTextPrimaryPosition,
    portraitTextSecondaryPosition,
    hydrationSeq,
    disabled: Boolean(realPreviewDisabledReason),
    disabledReason: realPreviewDisabledReason,
  });
  const isRealPreviewMode = realPreview.mode === 'real';
  const canUseRealPreview = !renderSnapshotMode;

  // Load preview when video path changes
  useEffect(() => {
    if (videoPath) {
      preview.loadPreview(videoPath);
    }
  }, [videoPath]);

  useEffect(() => {
    if (!videoPath || preview.videoDuration <= 0 || isRealPreviewMode) {
      return;
    }
    const timer = window.setTimeout(() => {
      preview.loadFrameAt(preview.frameTimeSec);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [hydrationSeq, videoPath, preview.videoDuration, preview.frameTimeSec, preview.loadFrameAt, isRealPreviewMode]);

  useEffect(() => {
    if (!videoPath || !preview.frameData) {
      return;
    }
    if (notifiedFramePathRef.current === videoPath) {
      return;
    }
    notifiedFramePathRef.current = videoPath;
    onFirstFrameReady?.(videoPath);
  }, [onFirstFrameReady, preview.frameData, videoPath]);

  useEffect(() => {
    if (renderSnapshotMode && realPreview.mode !== 'live') {
      realPreview.setMode('live');
    }
  }, [realPreview.mode, realPreview.setMode, renderSnapshotMode]);

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

  let mainInfo: string | null = `Rel ${preview.subtitlePositionRel.x.toFixed(3)}, ${preview.subtitlePositionRel.y.toFixed(3)}`;
  if (preview.mode === 'text_primary') {
    mainInfo = `Text1 Rel ${preview.textPrimaryPositionRel.x.toFixed(3)}, ${preview.textPrimaryPositionRel.y.toFixed(3)}`;
  } else if (preview.mode === 'text_secondary') {
    mainInfo = `Text2 Rel ${preview.textSecondaryPositionRel.x.toFixed(3)}, ${preview.textSecondaryPositionRel.y.toFixed(3)}`;
  } else if (preview.mode === 'logo') {
    mainInfo = `Pos ${preview.logoPosition ? `${preview.logoPosition.x}, ${preview.logoPosition.y}` : 'Auto'} · Scale ${Math.round(preview.logoScale * 100)}%`;
  } else if (preview.mode === 'blackout') {
    mainInfo = null;
  }
  const resolutionInfo = `${preview.videoSize.width}×${preview.videoSize.height} · ${isPortraitMode ? '9:16' : '16:9'} ${displayRenderResolution}`;

  return (
    <div className={styles.previewSection}>
      {/* Mode toggle */}
      <div className={styles.modeBar}>
        {renderSnapshotMode && (
          <span className={styles.snapshotBadge}>Render Snapshot</span>
        )}
        {canUseRealPreview && (
          <div className={styles.previewModeSwitch}>
            <button
              type="button"
              className={`${styles.modeBtn} ${realPreview.mode === 'live' ? styles.modeBtnActive : ''}`}
              onClick={() => realPreview.setMode('live')}
              title="Preview live với layer tương tác local"
            >
              Live
            </button>
            <button
              type="button"
              className={`${styles.modeBtn} ${realPreview.mode === 'real' ? styles.modeBtnActive : ''}`}
              onClick={() => realPreview.setMode('real')}
              disabled={Boolean(realPreviewDisabledReason)}
              title={realPreviewDisabledReason || 'Render 1 frame thật từ backend theo config hiện tại'}
            >
              Preview thật
            </button>
          </div>
        )}
        <button
          className={`${styles.modeBtn} ${preview.mode === 'subtitle' ? styles.modeBtnActive : ''}`}
          onClick={() => preview.setMode('subtitle')}
          title="Kéo để đặt vị trí subtitle"
          disabled={isInteractionDisabled || isRealPreviewMode}
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
          disabled={isInteractionDisabled || isRealPreviewMode}
        >
          <Square size={13} />
          {isPortraitMode ? 'Blur' : 'Mask'}
        </button>
        {isPortraitMode && (
          <>
            <button
              className={`${styles.modeBtn} ${preview.mode === 'text_primary' ? styles.modeBtnActive : ''}`}
              onClick={() => preview.setMode('text_primary')}
              title="Kéo để đặt vị trí Text1"
              disabled={isInteractionDisabled || isRealPreviewMode}
            >
              <Crosshair size={13} />
              T1
            </button>
            <button
              className={`${styles.modeBtn} ${preview.mode === 'text_secondary' ? styles.modeBtnActive : ''}`}
              onClick={() => preview.setMode('text_secondary')}
              title="Kéo để đặt vị trí Text2"
              disabled={isInteractionDisabled || isRealPreviewMode}
            >
              <Crosshair size={13} />
              T2
            </button>
          </>
        )}
        {logoPath ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`${styles.modeBtn} ${preview.mode === 'logo' ? styles.modeBtnActive : ''}`}
              onClick={() => preview.setMode('logo')}
              title="Kéo để đặt vị trí Logo Watermark"
              disabled={isInteractionDisabled || isRealPreviewMode}
            >
              <Image size={13} />
              Logo
            </button>
            <button
              className={styles.modeBtn}
              onClick={onRemoveLogo}
              title="Xóa Logo"
              style={{ padding: '5px 8px', color: '#ef4444' }}
              disabled={isInteractionDisabled || isRealPreviewMode}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ) : (
          <button
            className={styles.modeBtn}
            onClick={onSelectLogo}
            title="Thêm Logo (Watermark)"
            disabled={isInteractionDisabled || isRealPreviewMode}
          >
            <Image size={13} />
            Logo
          </button>
        )}
      </div>

      {isRealPreviewMode ? (
        <div className={`${styles.canvasContainer} ${styles.realPreviewContainer} ${renderMode === 'hardsub_portrait_9_16' ? styles.canvasContainerPortrait : ''}`}>
          {realPreview.realFrameData ? (
            <img
              src={realPreview.realFrameData}
              className={styles.realPreviewImage}
              alt="Video preview thật"
            />
          ) : (
            <div className={styles.realPreviewPlaceholder}>
              {realPreview.realMessage || 'Chưa có preview thật.'}
            </div>
          )}
          {(realPreview.realStatus === 'pending' || realPreview.realStatus === 'updating') && (
            <div className={styles.loadingOverlay}>Đang cập nhật preview thật...</div>
          )}
          {realPreview.realStatus === 'error' && (
            <div className={styles.disabledOverlay}>{realPreview.realMessage}</div>
          )}
        </div>
      ) : (
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
      )}

      {isRealPreviewMode && (
        <div className={styles.realPreviewStatusRow}>
          <span className={styles.realPreviewStatusBadge}>{realPreview.realStatus.toUpperCase()}</span>
          <span className={styles.realPreviewStatusText}>
            {realPreview.realMessage}
            {realPreview.realSize
              ? ` (${realPreview.realSize.width}x${realPreview.realSize.height})`
              : ''}
          </span>
        </div>
      )}

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
            {formatPreviewTime(preview.frameTimeSec)} / {formatPreviewTime(preview.videoDuration)}
          </span>
        </div>
      )}

      {!renderSnapshotMode && !isRealPreviewMode && (
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
          {mainInfo && (
            <span className={`${styles.positionInfo} ${styles.positionInfoPrimary}`}>{mainInfo}</span>
          )}
          <span className={styles.positionInfo}>{resolutionInfo}</span>
        </div>
        <div className={styles.actionRow}>
          <button
            className={styles.resetBtn}
            onClick={preview.resetToCenter}
            disabled={isInteractionDisabled}
          >
            <RotateCcw size={12} /> Căn giữa
          </button>

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
