/**
 * SubtitlePreview - Canvas preview hiển thị frame video + subtitle có thể kéo thả
 * Hỗ trợ 2 chế độ:
 *  - subtitle: kéo để đặt vị trí subtitle
 *  - blackout: kéo để đặt vùng tô đen che phía dưới video
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
  blackoutTop?: number | null;
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  onPositionChange: (pos: { x: number; y: number } | null) => void;
  onBlackoutChange?: (value: number | null) => void;
  onRenderResolutionChange?: (value: 'original' | '1080p' | '720p' | '540p' | '360p') => void;
  onLogoPositionChange?: (pos: { x: number; y: number } | null) => void;
  onLogoScaleChange?: (scale: number) => void;
  onSelectLogo?: () => void;
  onRemoveLogo?: () => void;
  // Thumbnail
  thumbnailText?: string;
  onThumbnailTextChange?: (text: string) => void;
  thumbnailTextReadOnly?: boolean;
  thumbnailTextHelper?: string;
  onFrameTimeChange?: (timeSec: number | null) => void;
}

export function SubtitlePreview({ videoPath, style, entries, blackoutTop, renderResolution, logoPath, logoPosition, logoScale, onPositionChange, onBlackoutChange, onRenderResolutionChange, onLogoPositionChange, onLogoScaleChange, onSelectLogo, onRemoveLogo, thumbnailText, onThumbnailTextChange, thumbnailTextReadOnly, thumbnailTextHelper, onFrameTimeChange }: SubtitlePreviewProps) {
  const preview = useSubtitlePreview({
    style,
    entries,
    blackoutTop,
    logoPath,
    logoPosition,
    logoScale,
    onPositionChange: (pos) => onPositionChange(pos),
    onBlackoutChange,
    onLogoPositionChange,
    onLogoScaleChange,
    thumbnailText,
  });

  // Load preview when video path changes — khi video load xong, kích hoạt thumbnail ở frame 0
  useEffect(() => {
    if (videoPath) {
      preview.loadPreview(videoPath).then(() => {
        onFrameTimeChange?.(0);
      });
    } else {
      onFrameTimeChange?.(null);
    }
  }, [videoPath]);

  const blackoutPct = preview.blackoutTop !== null
    ? Math.round((1 - preview.blackoutTop) * 100)
    : 0;

  return (
    <div className={styles.previewSection}>
      {/* Mode toggle */}
      <div className={styles.modeBar}>
        <button
          className={`${styles.modeBtn} ${preview.mode === 'subtitle' ? styles.modeBtnActive : ''}`}
          onClick={() => preview.setMode('subtitle')}
          title="Kéo để đặt vị trí subtitle"
        >
          <Crosshair size={13} />
          Subtitle
        </button>
        <button
          className={`${styles.modeBtn} ${preview.mode === 'blackout' ? styles.modeBtnActive : ''}`}
          onClick={() => preview.setMode('blackout')}
          title="Kéo để đặt vùng tô đen phía dưới video"
        >
          <Square size={13} />
          Tô đen
        </button>
        {logoPath ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`${styles.modeBtn} ${preview.mode === 'logo' ? styles.modeBtnActive : ''}`}
              onClick={() => preview.setMode('logo')}
              title="Kéo để đặt vị trí Logo Watermark"
            >
              <Image size={13} />
              Logo
            </button>
            <button
              className={styles.modeBtn}
              onClick={onRemoveLogo}
              title="Xóa Logo"
              style={{ padding: '5px 8px', color: '#ef4444' }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ) : (
          <button
            className={styles.modeBtn}
            onClick={onSelectLogo}
            title="Thêm Logo (Watermark)"
          >
            <Image size={13} />
            Thêm Logo
          </button>
        )}
      </div>

      <div
        ref={preview.containerRef}
        className={`${styles.canvasContainer} ${preview.isDragging ? styles.dragging : ''} ${preview.mode === 'blackout' ? styles.blackoutMode : ''}`}
      >
        <canvas
          ref={preview.canvasRef}
          className={styles.canvas}
          onMouseDown={preview.handleMouseDown}
          onMouseMove={preview.handleMouseMove}
          onMouseUp={preview.handleMouseUp}
          onMouseLeave={preview.handleMouseUp}
          style={{ cursor: preview.canvasCursor }}
        />
        {preview.isLoading && (
          <div className={styles.loadingOverlay}>Đang tải preview...</div>
        )}
      </div>

      <div className={styles.infoBar}>
        <span className={styles.positionInfo}>
          {preview.mode === 'subtitle' ? (
            <>
              pos({preview.subtitlePosition.x}, {preview.subtitlePosition.y})
              {' | '}
              {preview.videoSize.width}×{preview.videoSize.height}
            </>
          ) : preview.mode === 'logo' ? (
            <>
              pos({preview.subtitlePosition.x}, {preview.subtitlePosition.y})
              {' | '}
              scale {Math.round(preview.logoScale * 100)}%
              {' | '}
              kéo góc để resize
            </>
          ) : (
            <>
              {preview.blackoutTop !== null
                ? `Che ${blackoutPct}% dưới video`
                : 'Kéo để đặt vùng tô đen'}
              {' | '}
              {preview.videoSize.width}×{preview.videoSize.height}
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
              >
                Tự động
              </button>
            </>
          )}
          
          <select
             className={styles.select}
             value={renderResolution || 'original'}
             onChange={e => onRenderResolutionChange?.(e.target.value as any)}
             style={{ width: 'auto', padding: '2px 8px', fontSize: '11px', height: '24px', backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
             title="Độ phân giải Video khi Render"
          >
             <option value="original">Gốc</option>
             <option value="1080p">1080p</option>
             <option value="720p">720p</option>
             <option value="540p">540p</option>
             <option value="360p">360p</option>
          </select>
          
          {preview.mode === 'blackout' && preview.blackoutTop !== null && (
            <button
              className={`${styles.resetBtn} ${styles.dangerBtn}`}
              onClick={preview.clearBlackout}
              title="Xóa vùng tô đen"
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
              max={Math.min(5, preview.videoDuration || 5)}
              step={0.1}
              value={preview.frameTimeSec}
              onChange={e => preview.setFrameTimeSec(parseFloat(e.target.value))}
              onMouseUp={e => {
                const t = parseFloat((e.target as HTMLInputElement).value);
                preview.loadFrameAt(t);
                onFrameTimeChange?.(t);
              }}
              onTouchEnd={e => {
                const t = parseFloat((e.target as HTMLInputElement).value);
                preview.loadFrameAt(t);
                onFrameTimeChange?.(t);
              }}
              title="Chọn frame xem trước trong 5s đầu video — frame được chọn sẽ dùng làm thumbnail"
            />
            <span className={styles.scrubberHint}>5s đầu</span>
          </div>
          <div className={styles.thumbnailTextRow}>
            <span className={styles.thumbnailTextLabel}>Thumbnail:</span>
            <input
              type="text"
              className={styles.thumbnailTextInput}
              placeholder={thumbnailTextReadOnly ? 'Multi-folder: chỉnh text ở danh sách phía trên' : 'Tiêu đề video... (bỏ trống = không có chữ)'}
              value={thumbnailText || ''}
              onChange={e => onThumbnailTextChange?.(e.target.value)}
              readOnly={!!thumbnailTextReadOnly}
              title={thumbnailTextReadOnly
                ? 'Đang ở chế độ multi-folder: text này chỉ để preview, hãy chỉnh trong danh sách theo folder'
                : 'Văn bản hiển thị ở trung tâm thumbnail 0.2s đầu video'}
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
