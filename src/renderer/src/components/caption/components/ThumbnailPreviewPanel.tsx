import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './ThumbnailPreviewPanel.module.css';
import { useThumbnailPreviewState } from '../hooks/useThumbnailPreviewState';
import { ThumbnailPreviewContextKey, ThumbnailPreviewLayer } from '../CaptionTypes';
import { layoutThumbnailText } from '@shared/utils/thumbnailTextLayout';

type RenderMode = 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
type RenderResolution = 'original' | '1080p' | '720p' | '540p' | '360p';

interface ThumbnailPreviewPanelProps {
  videoPath: string | null;
  sourceLabel: string;
  renderMode: RenderMode;
  renderResolution: RenderResolution;
  thumbnailText: string;
  thumbnailTextSecondary: string;
  thumbnailTextReadOnly?: boolean;
  thumbnailTextHelper?: string;
  onThumbnailTextChange?: (text: string) => void;
  onThumbnailTextSecondaryChange?: (text: string) => void;
  thumbnailFrameTimeSec: number | null;
  onThumbnailFrameTimeSecChange: (timeSec: number | null) => void;
  // Legacy font chung (fallback)
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  thumbnailTextPrimaryFontName?: string;
  thumbnailTextPrimaryFontSize?: number;
  thumbnailTextSecondaryFontName?: string;
  thumbnailTextSecondaryFontSize?: number;
  thumbnailLineHeightRatio?: number;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
  onThumbnailTextPrimaryPositionChange: (pos: { x: number; y: number }) => void;
  onThumbnailTextSecondaryPositionChange: (pos: { x: number; y: number }) => void;
  contextKey: ThumbnailPreviewContextKey | null;
  inputType: 'srt' | 'draft';
}

type DrawRect = { x: number; y: number; width: number; height: number };

type DrawState = {
  outputRect: DrawRect;
  regionRect: DrawRect;
  primaryRect: DrawRect | null;
  secondaryRect: DrawRect | null;
};

type TruncationState = {
  primary: boolean;
  secondary: boolean;
};

type DownloadStatus = {
  tone: 'idle' | 'ok' | 'error' | 'pending';
  message: string;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function ensureEven(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function fitRect(containerW: number, containerH: number, targetW: number, targetH: number): DrawRect {
  const safeW = Math.max(1, targetW);
  const safeH = Math.max(1, targetH);
  const targetRatio = safeW / safeH;
  const containerRatio = Math.max(1e-6, containerW) / Math.max(1e-6, containerH);
  let width = containerW;
  let height = containerH;
  if (containerRatio > targetRatio) {
    height = containerH;
    width = height * targetRatio;
  } else {
    width = containerW;
    height = width / targetRatio;
  }
  return {
    x: (containerW - width) / 2,
    y: (containerH - height) / 2,
    width,
    height,
  };
}

function resolvePortraitCanvasByPreset(renderResolution: RenderResolution): { width: number; height: number } {
  if (renderResolution === '720p') return { width: 720, height: 1280 };
  if (renderResolution === '540p') return { width: 540, height: 960 };
  if (renderResolution === '360p') return { width: 360, height: 640 };
  return { width: 1080, height: 1920 };
}

function resolveLandscapeCanvasBySource(
  sourceWidth: number,
  sourceHeight: number,
  renderResolution: RenderResolution
): { width: number; height: number } {
  const safeSourceW = ensureEven(Math.max(2, sourceWidth));
  const safeSourceH = ensureEven(Math.max(2, sourceHeight));
  let maxOutputHeight = 1080;
  if (renderResolution === '720p') maxOutputHeight = 720;
  if (renderResolution === '540p') maxOutputHeight = 540;
  if (renderResolution === '360p') maxOutputHeight = 360;
  if (renderResolution === 'original') maxOutputHeight = 99999;
  if (safeSourceH > maxOutputHeight) {
    const scaleFactor = maxOutputHeight / safeSourceH;
    return {
      width: ensureEven(safeSourceW * scaleFactor),
      height: ensureEven(maxOutputHeight),
    };
  }
  return { width: safeSourceW, height: safeSourceH };
}

function hitRect(rect: DrawRect | null, x: number, y: number): boolean {
  if (!rect) return false;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function statusClass(status: string): string {
  if (status === 'error') return styles.badgeError;
  if (status === 'updating' || status === 'loading') return styles.badgeUpdating;
  if (status === 'pending') return styles.badgePending;
  if (status === 'ready') return styles.badgeReady;
  return styles.badgeIdle;
}

function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : 'thumbnail';
}

function formatDateToken(input: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${input.getFullYear()}${pad(input.getMonth() + 1)}${pad(input.getDate())}_${pad(input.getHours())}${pad(input.getMinutes())}${pad(input.getSeconds())}`;
}

function toBase64Payload(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, '');
}

export function ThumbnailPreviewPanel({
  videoPath,
  sourceLabel,
  renderMode,
  renderResolution,
  thumbnailText,
  thumbnailTextSecondary,
  thumbnailTextReadOnly,
  thumbnailTextHelper,
  onThumbnailTextChange,
  onThumbnailTextSecondaryChange,
  thumbnailFrameTimeSec,
  onThumbnailFrameTimeSecChange,
  thumbnailFontName,
  thumbnailFontSize,
  thumbnailTextPrimaryFontName,
  thumbnailTextPrimaryFontSize,
  thumbnailTextSecondaryFontName,
  thumbnailTextSecondaryFontSize,
  thumbnailLineHeightRatio,
  thumbnailTextPrimaryPosition,
  thumbnailTextSecondaryPosition,
  onThumbnailTextPrimaryPositionChange,
  onThumbnailTextSecondaryPositionChange,
  contextKey,
  inputType,
}: ThumbnailPreviewPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawStateRef = useRef<DrawState | null>(null);
  const dragRef = useRef<{ layer: ThumbnailPreviewLayer; offsetX: number; offsetY: number } | null>(null);

  const [videoSourceSize, setVideoSourceSize] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [truncationState, setTruncationState] = useState<TruncationState>({ primary: false, secondary: false });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({ tone: 'idle', message: '' });
  const truncationRef = useRef<TruncationState>({ primary: false, secondary: false });

  const previewState = useThumbnailPreviewState({
    videoPath,
    renderMode,
    renderResolution,
    thumbnailText,
    thumbnailTextSecondary,
    thumbnailFrameTimeSec,
    onThumbnailFrameTimeSecChange,
    thumbnailFontName,
    thumbnailFontSize,
    thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize,
    thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize,
    thumbnailLineHeightRatio,
    thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition,
    onThumbnailTextPrimaryPositionChange,
    onThumbnailTextSecondaryPositionChange,
    contextKey,
    inputType,
  });

  useEffect(() => {
    if (!previewState.frameData) {
      imageRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setVideoSourceSize({
        width: Math.max(2, img.naturalWidth || img.width || 1920),
        height: Math.max(2, img.naturalHeight || img.height || 1080),
      });
    };
    img.src = previewState.frameData;
  }, [previewState.frameData]);

  const outputSize = useMemo(() => {
    if (renderMode === 'hardsub_portrait_9_16') {
      return resolvePortraitCanvasByPreset(renderResolution);
    }
    return resolveLandscapeCanvasBySource(videoSourceSize.width, videoSourceSize.height, renderResolution);
  }, [renderMode, renderResolution, videoSourceSize.height, videoSourceSize.width]);

  const drawEditCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = Math.max(1, containerSize.width || 420);
    const ch = Math.max(1, containerSize.height || 260);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cw, ch);

    const img = imageRef.current;
    if (!img) {
      drawStateRef.current = null;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có frame nguồn để chỉnh thumbnail', cw / 2, ch / 2);
      return;
    }

    const outW = outputSize.width;
    const outH = outputSize.height;
    const outputRect = fitRect(cw, ch, outW, outH);
    const srcW = Math.max(2, img.naturalWidth || img.width);
    const srcH = Math.max(2, img.naturalHeight || img.height);

    let regionRect = { ...outputRect };
    if (renderMode === 'hardsub_portrait_9_16') {
      const cropW = ensureEven(Math.min(srcW, srcH * 3 / 4));
      const cropX = Math.max(0, Math.floor((srcW - cropW) / 2));
      const cropH = srcH;
      let fgW = outW;
      let fgH = ensureEven((fgW * cropH) / cropW);
      if (fgH > outH) {
        fgH = outH;
        fgW = ensureEven((fgH * cropW) / cropH);
      }
      const fgXOut = Math.max(0, Math.floor((outW - fgW) / 2));
      const fgYOut = Math.max(0, Math.floor((outH - fgH) / 2));
      const scaleX = outputRect.width / outW;
      const scaleY = outputRect.height / outH;
      regionRect = {
        x: outputRect.x + fgXOut * scaleX,
        y: outputRect.y + fgYOut * scaleY,
        width: fgW * scaleX,
        height: fgH * scaleY,
      };

      ctx.drawImage(img, cropX, 0, cropW, cropH, outputRect.x, outputRect.y, outputRect.width, outputRect.height);
      ctx.drawImage(img, cropX, 0, cropW, cropH, regionRect.x, regionRect.y, regionRect.width, regionRect.height);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(regionRect.x, regionRect.y, regionRect.width, regionRect.height);
      ctx.setLineDash([]);
    } else {
      ctx.drawImage(img, outputRect.x, outputRect.y, outputRect.width, outputRect.height);
    }

    const scale = outputRect.width / Math.max(1, outW);
    const primaryFontPx = Math.max(12, (thumbnailTextPrimaryFontSize ?? thumbnailFontSize ?? 145) * scale);
    const secondaryFontPx = Math.max(12, (thumbnailTextSecondaryFontSize ?? thumbnailFontSize ?? 145) * scale);
    const primaryFontName = (thumbnailTextPrimaryFontName || thumbnailFontName || 'BrightwallPersonal').trim();
    const secondaryFontName = (thumbnailTextSecondaryFontName || thumbnailFontName || 'BrightwallPersonal').trim();
    const lineHeightRatio = Math.min(4, Math.max(0, Number.isFinite(thumbnailLineHeightRatio) ? (thumbnailLineHeightRatio as number) : 1.16));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const drawTextBox = (
      text: string,
      pos: { x: number; y: number },
      layer: ThumbnailPreviewLayer,
      fontName: string,
      fontPx: number
    ): { rect: DrawRect | null; truncated: boolean } => {
      ctx.font = `bold ${fontPx}px "${fontName}", sans-serif`;
      const layout = layoutThumbnailText({
        text,
        maxWidthPx: regionRect.width * 0.92,
        regionHeightPx: regionRect.height,
        fontSizePx: fontPx,
        maxLines: 3,
        lineHeightRatio,
        autoWrap: false,
        measureTextWidth: (value: string) => ctx.measureText(value).width,
      });
      if (!layout.textForDraw || layout.lineCount === 0) {
        return { rect: null, truncated: false };
      }
      const lineWidths = layout.lines.map((line: string) => ctx.measureText(line).width);
      const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
      const maxPadX = Math.max(0, (regionRect.width - maxLineWidth) / 2);
      const maxPadY = Math.max(0, (regionRect.height - layout.lineCount * layout.lineHeightPx) / 2);
      const padX = Math.min(fontPx * 0.5, maxPadX);
      const padY = Math.min(fontPx * 0.2, maxPadY);
      const boxW = Math.min(regionRect.width, maxLineWidth + padX * 2);
      const boxH = Math.min(regionRect.height, layout.lineCount * layout.lineHeightPx + padY * 2);
      const anchorX = regionRect.x + clamp01(pos.x) * regionRect.width;
      const anchorY = regionRect.y + clamp01(pos.y) * regionRect.height;
      let x = anchorX - boxW / 2;
      let y = anchorY - boxH / 2;
      x = Math.max(regionRect.x, Math.min(x, regionRect.x + regionRect.width - boxW));
      y = Math.max(regionRect.y, Math.min(y, regionRect.y + regionRect.height - boxH));

      ctx.fillStyle = layer === previewState.activeLayer ? 'rgba(15, 23, 42, 0.68)' : 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(x, y, boxW, boxH);
      ctx.strokeStyle = layer === previewState.activeLayer ? 'rgba(56, 189, 248, 0.95)' : 'rgba(250, 200, 0, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, boxW, boxH);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1, fontPx * 0.06);
      ctx.lineJoin = 'round';
      ctx.fillStyle = '#fff';

      const startY = y + padY + layout.lineHeightPx / 2;
      for (let index = 0; index < layout.lines.length; index++) {
        const line = layout.lines[index];
        const ly = startY + index * layout.lineHeightPx;
        ctx.strokeText(line, x + boxW / 2, ly);
        ctx.fillText(line, x + boxW / 2, ly);
      }
      return {
        rect: { x, y, width: boxW, height: boxH },
        truncated: layout.truncated,
      };
    };

    const primaryResult = drawTextBox(
      thumbnailText,
      previewState.draftPrimaryPosition,
      'primary',
      primaryFontName,
      primaryFontPx
    );
    const secondaryResult = drawTextBox(
      thumbnailTextSecondary,
      previewState.draftSecondaryPosition,
      'secondary',
      secondaryFontName,
      secondaryFontPx
    );
    const nextTruncation: TruncationState = {
      primary: primaryResult.truncated,
      secondary: secondaryResult.truncated,
    };
    if (
      truncationRef.current.primary !== nextTruncation.primary
      || truncationRef.current.secondary !== nextTruncation.secondary
    ) {
      truncationRef.current = nextTruncation;
      setTruncationState(nextTruncation);
    }

    drawStateRef.current = {
      outputRect,
      regionRect,
      primaryRect: primaryResult.rect,
      secondaryRect: secondaryResult.rect,
    };
  }, [
    containerSize.height,
    containerSize.width,
    outputSize.height,
    outputSize.width,
    previewState.activeLayer,
    previewState.draftPrimaryPosition,
    previewState.draftSecondaryPosition,
    renderMode,
    thumbnailFontName,
    thumbnailFontSize,
    thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize,
    thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize,
    thumbnailLineHeightRatio,
    thumbnailText,
    thumbnailTextSecondary,
  ]);

  useEffect(() => {
    drawEditCanvas();
  }, [drawEditCanvas]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const updateLayerPositionFromPointer = useCallback((layer: ThumbnailPreviewLayer, pointerX: number, pointerY: number) => {
    const drawState = drawStateRef.current;
    if (!drawState) return;
    const region = drawState.regionRect;
    const layerRect = layer === 'primary' ? drawState.primaryRect : drawState.secondaryRect;
    if (!layerRect) return;
    const halfW = layerRect.width / 2;
    const halfH = layerRect.height / 2;
    let centerX = pointerX - (dragRef.current?.offsetX || 0);
    let centerY = pointerY - (dragRef.current?.offsetY || 0);
    centerX = Math.max(region.x + halfW, Math.min(centerX, region.x + region.width - halfW));
    centerY = Math.max(region.y + halfH, Math.min(centerY, region.y + region.height - halfH));
    previewState.setDraftLayerPosition(layer, {
      x: clamp01((centerX - region.x) / Math.max(1, region.width)),
      y: clamp01((centerY - region.y) / Math.max(1, region.height)),
    });
  }, [previewState]);

  const onCanvasMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const drawState = drawStateRef.current;
    if (!drawState) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let layer: ThumbnailPreviewLayer | null = null;
    if (hitRect(drawState.primaryRect, x, y)) {
      layer = 'primary';
    } else if (hitRect(drawState.secondaryRect, x, y)) {
      layer = 'secondary';
    } else if (previewState.activeLayer === 'primary' && drawState.primaryRect) {
      layer = 'primary';
    } else if (previewState.activeLayer === 'secondary' && drawState.secondaryRect) {
      layer = 'secondary';
    }
    if (!layer) return;

    const layerRect = layer === 'primary' ? drawState.primaryRect : drawState.secondaryRect;
    if (!layerRect) return;
    previewState.beginDraftDrag(layer);
    dragRef.current = {
      layer,
      offsetX: x - (layerRect.x + layerRect.width / 2),
      offsetY: y - (layerRect.y + layerRect.height / 2),
    };
    updateLayerPositionFromPointer(layer, x, y);
  }, [previewState, updateLayerPositionFromPointer]);

  const onCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    updateLayerPositionFromPointer(dragRef.current.layer, x, y);
  }, [updateLayerPositionFromPointer]);

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    previewState.commitDraft();
  }, [previewState]);

  const hasPrimaryText = thumbnailText.trim().length > 0;
  const hasSecondaryText = thumbnailTextSecondary.trim().length > 0;

  const handleDownloadThumbnail = useCallback(async () => {
    if (!videoPath || isDownloading) {
      return;
    }

    setIsDownloading(true);
    setDownloadStatus({ tone: 'pending', message: 'Đang render thumbnail để tải...' });

    try {
      previewState.commitDraft();
      const api = (window.electronAPI as any).captionVideo;
      const renderRes = await api.renderThumbnailPreviewFrame({
        videoPath,
        thumbnailTimeSec: previewState.draftFrameTimeSec,
        renderMode,
        renderResolution,
        thumbnailText,
        thumbnailTextSecondary,
        thumbnailFontName,
        thumbnailFontSize,
        thumbnailTextPrimaryFontName,
        thumbnailTextPrimaryFontSize,
        thumbnailTextSecondaryFontName,
        thumbnailTextSecondaryFontSize,
        thumbnailLineHeightRatio,
        thumbnailTextPrimaryPosition: previewState.draftPrimaryPosition,
        thumbnailTextSecondaryPosition: previewState.draftSecondaryPosition,
      });

      if (!renderRes?.success || !renderRes?.data?.success || !renderRes?.data?.frameData) {
        throw new Error(renderRes?.error || renderRes?.data?.error || 'Không thể tạo ảnh thumbnail.');
      }

      const now = new Date();
      const fileBase = sanitizeFileName(sourceLabel || 'thumbnail');
      const defaultPath = `${fileBase}_${renderMode}_${formatDateToken(now)}.png`;
      const saveRes = await (window.electronAPI as any).invoke('dialog:showSaveDialog', {
        title: 'Lưu thumbnail',
        defaultPath,
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      });
      if (!saveRes?.filePath) {
        setDownloadStatus({ tone: 'idle', message: 'Đã hủy lưu thumbnail.' });
        return;
      }

      const writeRes = await (window.electronAPI as any).invoke('fs:writeBase64File', {
        filePath: saveRes.filePath,
        base64Data: toBase64Payload(renderRes.data.frameData),
      });
      if (!writeRes?.success) {
        throw new Error(writeRes?.error || 'Không thể ghi file thumbnail.');
      }

      const fileName = String(saveRes.filePath).split(/[\\/]/).pop() || 'thumbnail.png';
      setDownloadStatus({ tone: 'ok', message: `Đã lưu ${fileName}` });
    } catch (error) {
      setDownloadStatus({ tone: 'error', message: `Lưu thumbnail thất bại: ${String(error)}` });
    } finally {
      setIsDownloading(false);
    }
  }, [
    isDownloading,
    previewState,
    renderMode,
    renderResolution,
    sourceLabel,
    thumbnailFontName,
    thumbnailFontSize,
    thumbnailLineHeightRatio,
    thumbnailText,
    thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize,
    thumbnailTextSecondary,
    thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize,
    videoPath,
  ]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Thumbnail Preview</span>
        <span className={styles.source}>{sourceLabel}</span>
      </div>

      <div className={styles.statusRows}>
        <div className={styles.statusLine}>
          <span className={styles.statusLabel}>Source:</span>
          <span className={`${styles.statusBadge} ${statusClass(previewState.sourceStatus)}`}>{previewState.sourceStatus}</span>
          <span className={styles.statusText}>{previewState.sourceMessage}</span>
        </div>
        <div className={styles.statusLine}>
          <span className={styles.statusLabel}>Render thật:</span>
          <span className={`${styles.statusBadge} ${statusClass(previewState.realStatus)}`}>{previewState.realStatus}</span>
          <span className={styles.statusText}>{previewState.realMessage}</span>
        </div>
        <div className={`${styles.syncBadge} ${previewState.hasDraft ? styles.syncDraft : (previewState.isSynced ? styles.syncReady : styles.syncPending)}`}>
          {previewState.syncLabel}
        </div>
      </div>

      <div className={styles.tabRow}>
        <button
          type="button"
          className={`${styles.tabBtn} ${previewState.tab === 'edit' ? styles.tabBtnActive : ''}`}
          onClick={() => previewState.setTab('edit')}
        >
          Chỉnh vị trí
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${previewState.tab === 'real' ? styles.tabBtnActive : ''}`}
          onClick={() => previewState.setTab('real')}
        >
          Preview thật
        </button>
      </div>

      <div className={styles.downloadRow}>
        <button
          type="button"
          className={styles.downloadBtn}
          onClick={handleDownloadThumbnail}
          disabled={!videoPath || isDownloading}
          title={!videoPath ? 'Chưa có video nguồn để tải thumbnail' : 'Lưu thumbnail PNG'}
        >
          {isDownloading ? 'Đang tải...' : 'Tải thumbnail PNG'}
        </button>
        {downloadStatus.message && (
          <span
            className={`${styles.downloadStatus} ${
              downloadStatus.tone === 'error'
                ? styles.downloadStatusError
                : (downloadStatus.tone === 'ok' ? styles.downloadStatusOk : styles.downloadStatusMuted)
            }`}
            title={downloadStatus.message}
          >
            {downloadStatus.message}
          </span>
        )}
      </div>

      {previewState.tab === 'edit' && (
        <>
          <div className={styles.controls}>
            <div className={styles.fullRow}>
              <span className={styles.label}>Text1</span>
              <textarea
                className={`${styles.input} ${styles.textareaInput}`}
                value={thumbnailText}
                onChange={(e) => onThumbnailTextChange?.(e.target.value)}
                readOnly={!!thumbnailTextReadOnly}
                rows={2}
                placeholder={thumbnailTextReadOnly ? 'Multi-folder: chỉnh Text1 ở danh sách bên trái' : 'Tiêu đề video...'}
              />
            </div>
            <div className={styles.fullRow}>
              <span className={styles.label}>Text2</span>
              <textarea
                className={`${styles.input} ${styles.textareaInput}`}
                value={thumbnailTextSecondary}
                onChange={(e) => onThumbnailTextSecondaryChange?.(e.target.value)}
                readOnly={!!thumbnailTextReadOnly}
                rows={2}
                placeholder={thumbnailTextReadOnly ? 'Multi-folder: chỉnh Text2 ở danh sách bên trái' : 'Tên phim...'}
              />
            </div>
            <div className={styles.fullRow}>
              <span className={styles.label}>Frame thumbnail: {previewState.draftFrameTimeSec.toFixed(2)}s</span>
              <input
                className={styles.range}
                type="range"
                min={0}
                max={previewState.duration}
                step={0.1}
                value={previewState.draftFrameTimeSec}
                onChange={(e) => previewState.setDraftFrameTimeSec(Number(e.target.value))}
                onMouseUp={previewState.commitDraft}
                onTouchEnd={previewState.commitDraft}
                onBlur={previewState.commitDraft}
              />
            </div>
          </div>

          <div className={styles.layerSwitch}>
            <button
              type="button"
              className={`${styles.layerBtn} ${previewState.activeLayer === 'primary' ? styles.layerBtnActive : ''}`}
              onClick={() => previewState.setActiveLayer('primary')}
              disabled={!hasPrimaryText}
            >
              Text1
            </button>
            <button
              type="button"
              className={`${styles.layerBtn} ${previewState.activeLayer === 'secondary' ? styles.layerBtnActive : ''}`}
              onClick={() => previewState.setActiveLayer('secondary')}
              disabled={!hasSecondaryText}
            >
              Text2
            </button>
          </div>

          <div className={styles.box} ref={containerRef}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={endDrag}
              onMouseLeave={endDrag}
            />
          </div>

          <div className={styles.metaRow}>
            <span>
              Text1 font: {(thumbnailTextPrimaryFontName || thumbnailFontName || 'BrightwallPersonal')}
              {' '}
              {thumbnailTextPrimaryFontSize ?? thumbnailFontSize ?? 145}px
            </span>
            <span>
              Text2 font: {(thumbnailTextSecondaryFontName || thumbnailFontName || 'BrightwallPersonal')}
              {' '}
              {thumbnailTextSecondaryFontSize ?? thumbnailFontSize ?? 145}px
            </span>
            <span>Line: {Number(thumbnailLineHeightRatio ?? 1.16).toFixed(2)}x</span>
            <span>Text1: ({previewState.draftPrimaryPosition.x.toFixed(3)}, {previewState.draftPrimaryPosition.y.toFixed(3)})</span>
            <span>Text2: ({previewState.draftSecondaryPosition.x.toFixed(3)}, {previewState.draftSecondaryPosition.y.toFixed(3)})</span>
          </div>
          <div className={styles.hint}>Enter để xuống dòng thủ công. Text tràn sẽ không tự xuống dòng.</div>
          {(truncationState.primary || truncationState.secondary) && (
            <div className={styles.truncateBadges}>
              {truncationState.primary && <span className={styles.truncateBadge}>Text1 bị cắt</span>}
              {truncationState.secondary && <span className={styles.truncateBadge}>Text2 bị cắt</span>}
            </div>
          )}
          {thumbnailTextHelper && <div className={styles.hint}>{thumbnailTextHelper}</div>}
          {renderMode === 'hardsub_portrait_9_16' && (
            <div className={styles.hint}>Mode 9:16: Text được clamp trong vùng foreground 3:4.</div>
          )}
        </>
      )}

      {previewState.tab === 'real' && (
        <>
          <div className={styles.box}>
            {previewState.realFrameData ? (
              <img src={previewState.realFrameData} className={styles.realImage} alt="Thumbnail preview thật" />
            ) : (
              <div className={styles.placeholder}>Chưa có preview thật.</div>
            )}
          </div>
          <div className={styles.status} title={previewState.realMessage}>
            {previewState.realStatus === 'ready' && previewState.realSize
              ? `Ready ${previewState.realSize.width}x${previewState.realSize.height}`
              : previewState.realMessage}
          </div>
        </>
      )}
    </div>
  );
}
