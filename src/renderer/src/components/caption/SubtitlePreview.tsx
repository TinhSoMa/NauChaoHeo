import { useEffect, useRef } from 'react';
import { Crop, Crosshair, Square, Trash2, Image } from 'lucide-react';
import styles from './SubtitlePreview.module.css';

interface SubtitlePreviewProps {
  videoPath: string | null;
  preview: {
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    containerRef: React.RefObject<HTMLDivElement | null>;
    frameData: string | null;
    isLoading: boolean;
    isDragging: boolean;
    isPanning: boolean;
    canvasCursor: string;
    mode: string;
    setMode: (mode: any) => void;
    coverMode: string;
    setCoverMode: (mode: any) => void;
    loadPreview: (path: string) => void;
    loadFrameAt: (time: number) => void;
    frameTimeSec: number;
    videoDuration: number;
    handleMouseDown: (event: React.MouseEvent<HTMLCanvasElement>) => void;
    handleMouseMove: (event: React.MouseEvent<HTMLCanvasElement>) => void;
    handleMouseUp: (event: React.MouseEvent<HTMLCanvasElement>) => void;
    handleWheel: (event: React.WheelEvent<HTMLCanvasElement>) => void;
    handleKeyDown: (event: React.KeyboardEvent<HTMLCanvasElement>) => void;
    subtitlePositionRel: { x: number; y: number };
    textPrimaryPositionRel: { x: number; y: number };
    textSecondaryPositionRel: { x: number; y: number };
    logoPosition: { x: number; y: number } | null;
    logoScale: number;
    crop: { rect: { x: number; y: number; width: number; height: number }; enabled: boolean };
    videoSize: { width: number; height: number };
    zoom: number;
    setZoom: (zoom: number) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    resetViewTransform: () => void;
    resetToCenter: () => void;
    setFrameTimeSec: (time: number) => void;
  };
  realPreview: {
    mode: 'live' | 'real';
    setMode: (mode: 'live' | 'real') => void;
    realStatus: 'idle' | 'pending' | 'updating' | 'ready' | 'error';
    realMessage: string;
    realFrameData: string | null;
    realSize: { width: number; height: number } | null;
    lastSyncHash: string;
  };
  renderSnapshotMode?: boolean;
  interactiveDisabledReason?: string;
  realPreviewDisabledReason?: string;
  renderMode?: string;
  renderSubtitle?: boolean;
  renderMark?: boolean;
  onSelectLogo?: () => void;
  onRemoveLogo?: () => void;
  onFirstFrameReady?: (videoPath: string) => void;
  hydrationSeq?: number;
}

export function SubtitlePreview({
  videoPath,
  preview,
  realPreview,
  renderSnapshotMode,
  interactiveDisabledReason,
  realPreviewDisabledReason,
  renderMode,
  renderSubtitle,
  renderMark,
  onSelectLogo,
  onRemoveLogo,
  onFirstFrameReady,
  hydrationSeq,
}: SubtitlePreviewProps) {
  const notifiedFramePathRef = useRef('');
  const isPortraitMode = renderMode === 'hardsub_portrait_9_16';
  const isInteractionDisabled = Boolean(interactiveDisabledReason);
  const isRealPreviewMode = realPreview.mode === 'real';
  const canUseRealPreview = !renderSnapshotMode;

  useEffect(() => {
    if (videoPath) {
      preview.loadPreview(videoPath);
    }
  }, [videoPath]);

  const prevIsRealRef = useRef(isRealPreviewMode);
  useEffect(() => {
    if (!videoPath || preview.videoDuration <= 0 || isRealPreviewMode) {
      prevIsRealRef.current = isRealPreviewMode;
      return;
    }
    const justSwitchedFromReal = prevIsRealRef.current === true && isRealPreviewMode === false;
    prevIsRealRef.current = isRealPreviewMode;
    const delay = justSwitchedFromReal ? 0 : 120;
    const timer = window.setTimeout(() => {
      preview.loadFrameAt(preview.frameTimeSec);
    }, delay);
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

  return (
    <div className={styles.previewSection}>
      {/* Mode toggle */}
      <div className={styles.modeBar}>
        {renderSnapshotMode && (
          <span className={styles.snapshotBadge} title="Render Snapshot">Chụp</span>
        )}
        {canUseRealPreview && (
          <div className={styles.previewModeSwitch}>
            <button
              type="button"
              className={`${styles.modeBtn} ${realPreview.mode === 'live' ? styles.modeBtnActive : ''}`}
              onClick={() => realPreview.setMode('live')}
              title="Preview live với layer tương tác local"
            >
              Trực
            </button>
            <button
              type="button"
              className={`${styles.modeBtn} ${realPreview.mode === 'real' ? styles.modeBtnActive : ''}`}
              onClick={() => realPreview.setMode('real')}
              disabled={Boolean(realPreviewDisabledReason)}
              title={realPreviewDisabledReason || 'Render 1 frame thật từ backend theo config hiện tại'}
            >
              Thật
            </button>
          </div>
        )}
        <button
          className={`${styles.modeBtn} ${preview.mode === 'subtitle' ? styles.modeBtnActive : ''}`}
          onClick={() => preview.setMode('subtitle')}
          title={renderSubtitle === false ? 'Đang tắt render subtitle' : 'Kéo để đặt vị trí subtitle'}
          disabled={isInteractionDisabled || isRealPreviewMode || renderSubtitle === false}
        >
          <Crosshair size={13} />
          Phụ
        </button>
        <button
          className={`${styles.modeBtn} ${preview.mode === 'blackout' ? styles.modeBtnActive : ''}`}
          onClick={() => preview.setMode('blackout')}
          title={
            renderMark === false
              ? 'Đang tắt render mask/mark'
              :
            preview.coverMode === 'copy_from_above'
              ? 'Kéo cạnh trái/phải/top/bottom hoặc kéo cả vùng để copy vùng phía trên che nội dung'
              : preview.coverMode === 'blur_selected_region'
                ? 'Kéo cạnh trái/phải/top/bottom hoặc kéo cả vùng để làm mờ trực tiếp trong vùng chọn'
              : (isPortraitMode ? 'Kéo để đặt vùng blur đáy video chính' : 'Kéo để đặt vùng tô đen phía dưới video')
          }
          disabled={isInteractionDisabled || isRealPreviewMode || renderMark === false}
        >
          <Square size={13} />
          {isPortraitMode ? 'Mờ' : 'Che'}
        </button>
        <button
          className={`${styles.modeBtn} ${preview.mode === 'crop' ? styles.modeBtnActive : ''}`}
          onClick={() => preview.setMode('crop')}
          title="Cắt khung video: kéo cạnh/góc, kéo trong khung để di chuyển"
          disabled={isInteractionDisabled || isRealPreviewMode}
        >
          <Crop size={13} />
          Crop
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
        {onRemoveLogo ? (
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

      <div className={styles.previewWorkArea}>
        <div className={styles.previewCanvasPane}>
          <div
            ref={preview.containerRef}
            className={`${styles.canvasContainer} ${renderMode === 'hardsub_portrait_9_16' ? styles.canvasContainerPortrait : ''} ${preview.isDragging ? styles.dragging : ''} ${preview.isPanning ? styles.panning : ''} ${preview.mode === 'blackout' ? ((preview.coverMode === 'copy_from_above' || preview.coverMode === 'blur_selected_region') ? styles.coverCopyMode : styles.blackoutMode) : ''}`}
            style={{ display: isRealPreviewMode ? 'none' : undefined }}
          >
            <canvas
              ref={preview.canvasRef}
              className={styles.canvas}
              onMouseDown={isInteractionDisabled || isRealPreviewMode ? undefined : (event) => {
                event.currentTarget.focus();
                preview.handleMouseDown(event);
              }}
              onMouseMove={isInteractionDisabled || isRealPreviewMode ? undefined : preview.handleMouseMove}
              onMouseUp={isInteractionDisabled || isRealPreviewMode ? undefined : preview.handleMouseUp}
              onMouseLeave={isInteractionDisabled || isRealPreviewMode ? undefined : preview.handleMouseUp}
              onWheel={isInteractionDisabled || isRealPreviewMode ? undefined : preview.handleWheel}
              onKeyDown={isInteractionDisabled || isRealPreviewMode ? undefined : preview.handleKeyDown}
              tabIndex={isInteractionDisabled || isRealPreviewMode ? -1 : 0}
              style={{ cursor: isInteractionDisabled ? 'not-allowed' : isRealPreviewMode ? undefined : preview.canvasCursor }}
            />
            {preview.isLoading && (
              <div className={styles.loadingOverlay}>Đang tải preview...</div>
            )}
            {(isInteractionDisabled || isRealPreviewMode) && (
              <div className={styles.disabledOverlay}>{isRealPreviewMode ? '' : interactiveDisabledReason}</div>
            )}
          </div>
          {isRealPreviewMode && (
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
          )}
        </div>
      </div>

      {!videoPath && (
        <div className={styles.hint} title="Chọn thư mục CapCut có video để xem preview">
          Chọn thư mục để preview
        </div>
      )}
    </div>
  );
}
