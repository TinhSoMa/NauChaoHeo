import { useState, useRef, useCallback, useEffect } from 'react';
import { ASSStyleConfig, CoverQuad, CoverQuadPoint, RenderVideoOptions, SubtitleEntry } from '@shared/types/caption';
import { resolveLandscapeOutputSize } from '@shared/utils/renderResolution';
import {
  clampNormalizedSubtitlePosition,
  isFiniteSubtitlePosition,
  isNormalizedSubtitlePosition,
  toNormalizedSubtitlePosition,
  toPixelSubtitlePosition,
} from '@shared/utils/subtitlePosition';
import {
  computeCopyOffset,
  defaultCoverQuad,
  isConvexQuad,
  normalizeQuad,
  quadBoundingBox,
} from '@shared/utils/maskCoverGeometry';

interface SubtitlePreviewState {
  frameData: string | null;
  videoSize: { width: number; height: number };
  subtitlePosition: { x: number; y: number };
  isLoading: boolean;
  error: string | null;
}

export type PreviewMode = 'subtitle' | 'blackout' | 'logo';
type PreviewRenderMode = RenderVideoOptions['renderMode'];
type PreviewRenderResolution = RenderVideoOptions['renderResolution'];

export interface UseSubtitlePreviewOptions {
  style: ASSStyleConfig;
  entries?: SubtitleEntry[];
  subtitlePosition?: { x: number; y: number } | null;
  blackoutTop?: number | null;  // fraction 0-1 (persisted from settings)
  coverMode?: 'blackout_bottom' | 'copy_from_above';
  coverQuad?: CoverQuad;
  renderMode?: PreviewRenderMode;
  renderResolution?: PreviewRenderResolution;
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;  // user-set scale multiplier (1.0 = native size)
  portraitForegroundCropPercent?: number; // crop ngang tổng (%) cho mode 9:16
  onPositionChange?: (pos: { x: number; y: number } | null) => void;
  onBlackoutChange?: (top: number | null) => void;
  onCoverModeChange?: (mode: 'blackout_bottom' | 'copy_from_above') => void;
  onCoverQuadChange?: (quad: CoverQuad) => void;
  onLogoPositionChange?: (pos: { x: number; y: number } | null) => void;
  onLogoScaleChange?: (scale: number) => void;
  renderSnapshotMode?: boolean; // true = chỉ hiển thị frame video đã render, không vẽ layer local
}

const MIN_SUBTITLE_FONT_SIZE = 1;
const MAX_SUBTITLE_FONT_SIZE = 1000;
const MIN_SUBTITLE_SHADOW = 0;
const MAX_SUBTITLE_SHADOW = 20;
const DEFAULT_SUBTITLE_FONT_SIZE = 48;
const DEFAULT_SUBTITLE_SHADOW = 2;
const SUBTITLE_SHADOW_STRONG_OPACITY = 0.9;
const SUBTITLE_SHADOW_SOFT_OPACITY = 0.15;

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function normalizeSubtitleFontSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SUBTITLE_FONT_SIZE;
  }
  return clampNumber(Math.round(value as number), MIN_SUBTITLE_FONT_SIZE, MAX_SUBTITLE_FONT_SIZE);
}

function normalizeSubtitleShadow(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SUBTITLE_SHADOW;
  }
  return clampNumber(value as number, MIN_SUBTITLE_SHADOW, MAX_SUBTITLE_SHADOW);
}

function resolveSubtitleScaleFactor(
  renderMode: PreviewRenderMode,
  renderResolution: PreviewRenderResolution,
  sourceWidth: number,
  sourceHeight: number
): number {
  if (renderMode === 'hardsub_portrait_9_16') {
    return 1;
  }
  const safeSourceW = Math.max(2, sourceWidth);
  const safeSourceH = Math.max(2, sourceHeight);
  const output = resolveLandscapeOutputSize(safeSourceW, safeSourceH, renderResolution);
  return output.height / safeSourceH;
}

function resolvePortraitCanvasByPreset(renderResolution?: PreviewRenderResolution): { width: number; height: number } {
  if (renderResolution === '720p') {
    return { width: 720, height: 1280 };
  }
  if (renderResolution === '540p') {
    return { width: 540, height: 960 };
  }
  if (renderResolution === '360p') {
    return { width: 360, height: 640 };
  }
  return { width: 1080, height: 1920 };
}

function fitRect(
  containerWidth: number,
  containerHeight: number,
  targetWidth: number,
  targetHeight: number
): { x: number; y: number; width: number; height: number } {
  const safeTargetWidth = Math.max(1, targetWidth);
  const safeTargetHeight = Math.max(1, targetHeight);
  const targetRatio = safeTargetWidth / safeTargetHeight;
  const containerRatio = Math.max(1e-6, containerWidth) / Math.max(1e-6, containerHeight);

  let width = containerWidth;
  let height = containerHeight;
  if (containerRatio > targetRatio) {
    height = containerHeight;
    width = height * targetRatio;
  } else {
    width = containerWidth;
    height = width / targetRatio;
  }

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

function resolvePreviewCoordinateSpace(
  renderMode: PreviewRenderMode,
  renderResolution: PreviewRenderResolution,
  sourceWidth: number,
  sourceHeight: number
): { width: number; height: number } {
  if (renderMode === 'hardsub_portrait_9_16') {
    return resolvePortraitCanvasByPreset(renderResolution);
  }
  return {
    width: Math.max(1, sourceWidth),
    height: Math.max(1, sourceHeight),
  };
}

function pointInPolygon(point: CoverQuadPoint, poly: CoverQuadPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function translateQuad(quad: CoverQuad, dx: number, dy: number): CoverQuad {
  const minX = Math.min(quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x);
  const maxX = Math.max(quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x);
  const minY = Math.min(quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y);
  const maxY = Math.max(quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y);
  const safeDx = Math.min(1 - maxX, Math.max(-minX, dx));
  const safeDy = Math.min(1 - maxY, Math.max(-minY, dy));
  return {
    tl: { x: quad.tl.x + safeDx, y: quad.tl.y + safeDy },
    tr: { x: quad.tr.x + safeDx, y: quad.tr.y + safeDy },
    br: { x: quad.br.x + safeDx, y: quad.br.y + safeDy },
    bl: { x: quad.bl.x + safeDx, y: quad.bl.y + safeDy },
  };
}

interface CoverRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type CoverDragEdge = 'left' | 'right' | 'top' | 'bottom';

const MIN_COVER_RECT_SIZE = 0.02;

function rectToQuad(rect: CoverRect): CoverQuad {
  return {
    tl: { x: rect.left, y: rect.top },
    tr: { x: rect.right, y: rect.top },
    br: { x: rect.right, y: rect.bottom },
    bl: { x: rect.left, y: rect.bottom },
  };
}

function quadToRect(quad: CoverQuad): CoverRect {
  const bbox = quadBoundingBox(quad);
  return {
    left: bbox.minX,
    right: bbox.maxX,
    top: bbox.minY,
    bottom: bbox.maxY,
  };
}

export function useSubtitlePreview({
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
  onPositionChange,
  onBlackoutChange,
  onCoverModeChange,
  onCoverQuadChange,
  onLogoPositionChange,
  onLogoScaleChange,
  renderSnapshotMode,
}: UseSubtitlePreviewOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const logoImageRef = useRef<HTMLImageElement | null>(null);
  const blurScratchRef = useRef<HTMLCanvasElement | null>(null);
  // Stores logo bounding box in canvas-pixel coords, updated every drawCanvas
  const logoBoundsRef = useRef<{ cx: number; cy: number; hw: number; hh: number } | null>(null);
  // Stores corner-drag start data
  const cornerDragRef = useRef<{ initialDist: number; initialScale: number } | null>(null);
  // Video metadata for frame scrubbing (path, fps, duration) — không trigger re-render
  const videoMetaRef = useRef<{ path: string; fps: number; duration: number } | null>(null);
  const frameRequestSerialRef = useRef(0);

  const [frameTimeSec, setFrameTimeSec] = useState(0);
  const initialSubtitlePosition = isFiniteSubtitlePosition(subtitlePosition)
    ? toNormalizedSubtitlePosition(subtitlePosition, 1920, 1080)
    : { x: 0.5, y: 0.5 };

  const [state, setState] = useState<SubtitlePreviewState>({
    frameData: null,
    videoSize: { width: 1920, height: 1080 },
    subtitlePosition: initialSubtitlePosition,
    isLoading: false,
    error: null,
  });

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [canvasCursor, setCanvasCursor] = useState<string>('crosshair');
  const previewRectRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const portraitFgRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const previewSpaceRef = useRef({ width: 1920, height: 1080 });
  const migratedLegacySubtitleRef = useRef<string | null>(null);

  // Mode: subtitle positioning, blackout line dragging, or logo positioning
  const [mode, setMode] = useState<PreviewMode>('subtitle');

  // Local blackout top (fraction 0-1) for live dragging — synced from prop
  const [localBlackoutTop, setLocalBlackoutTop] = useState<number | null>(blackoutTop ?? null);
  const [localCoverMode, setLocalCoverMode] = useState<'blackout_bottom' | 'copy_from_above'>(coverMode || 'blackout_bottom');
  const initialCoverQuad = rectToQuad(quadToRect(normalizeQuad(coverQuad)));
  const [localCoverQuad, setLocalCoverQuad] = useState<CoverQuad>(initialCoverQuad);
  const localCoverQuadRef = useRef<CoverQuad>(initialCoverQuad);
  const [coverQuadValid, setCoverQuadValid] = useState<boolean>(true);
  const [copyOffsetPx, setCopyOffsetPx] = useState<number>(0);
  const coverDragEdgeRef = useRef<{
    edge: CoverDragEdge;
    startRect: CoverRect;
  } | null>(null);
  const coverDragWholeRef = useRef<{
    startPoint: CoverQuadPoint;
    startQuad: CoverQuad;
  } | null>(null);
  const coverActiveRegionRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  
  // Local logo position for dragging
  const [localLogoPosition, setLocalLogoPosition] = useState<{ x: number; y: number } | null>(logoPosition ?? null);
  const localLogoPositionRef = useRef<{ x: number; y: number } | null>(logoPosition ?? null);
  const setLocalLogoPositionSynced = (pos: { x: number; y: number } | null) => {
    localLogoPositionRef.current = pos;
    setLocalLogoPosition(pos);
  };

  // Local logo scale (wheel to zoom)
  const [localLogoScale, setLocalLogoScale] = useState<number>(logoScale ?? 1.0);
  const localLogoScaleRef = useRef<number>(logoScale ?? 1.0);
  const setLocalLogoScaleSynced = (s: number) => {
    localLogoScaleRef.current = s;
    setLocalLogoScale(s);
  };

  const setLocalCoverQuadSynced = (quad: CoverQuad) => {
    const normalizedRectQuad = rectToQuad(quadToRect(normalizeQuad(quad)));
    localCoverQuadRef.current = normalizedRectQuad;
    setLocalCoverQuad(normalizedRectQuad);
    setCoverQuadValid(isConvexQuad(normalizedRectQuad));
  };

  // Sync from prop when it changes externally
  useEffect(() => {
    setLocalBlackoutTop(blackoutTop ?? null);
  }, [blackoutTop]);

  useEffect(() => {
    setLocalCoverMode(coverMode || 'blackout_bottom');
  }, [coverMode]);

  useEffect(() => {
    const normalized = normalizeQuad(coverQuad);
    setLocalCoverQuadSynced(normalized);
  }, [coverQuad]);

  useEffect(() => {
    if (!isFiniteSubtitlePosition(subtitlePosition)) {
      setState((prev) => {
        const fallback = { x: 0.5, y: 0.5 };
        if (
          prev.subtitlePosition.x === fallback.x &&
          prev.subtitlePosition.y === fallback.y
        ) {
          return prev;
        }
        return {
          ...prev,
          subtitlePosition: fallback,
        };
      });
      return;
    }
    const nextNormalized = toNormalizedSubtitlePosition(
      subtitlePosition,
      Math.max(1, state.videoSize.width),
      Math.max(1, state.videoSize.height)
    );
    setState((prev) => {
      if (
        prev.subtitlePosition.x === nextNormalized.x &&
        prev.subtitlePosition.y === nextNormalized.y
      ) {
        return prev;
      }
      return {
        ...prev,
        subtitlePosition: nextNormalized,
      };
    });
  }, [state.videoSize.height, state.videoSize.width, subtitlePosition]);

  // Khi đổi mode/resolution, cập nhật lại coordinate-space preview để hiển thị chính xác hơn.
  useEffect(() => {
    setState((prev) => {
      const sourceW = imageRef.current?.width ?? prev.videoSize.width;
      const sourceH = imageRef.current?.height ?? prev.videoSize.height;
      const nextSpace = resolvePreviewCoordinateSpace(renderMode, renderResolution, sourceW, sourceH);
      if (nextSpace.width === prev.videoSize.width && nextSpace.height === prev.videoSize.height) {
        return prev;
      }

      return {
        ...prev,
        videoSize: nextSpace,
      };
    });
  }, [renderMode, renderResolution]);

  useEffect(() => {
    const legacyPosition = subtitlePosition;
    if (!state.frameData || !onPositionChange) {
      return;
    }
    if (!isFiniteSubtitlePosition(legacyPosition)) {
      return;
    }
    if (isNormalizedSubtitlePosition(legacyPosition)) {
      return;
    }
    const legacyPoint = legacyPosition as { x: number; y: number };
    const signature = `${legacyPoint.x}:${legacyPoint.y}:${state.videoSize.width}:${state.videoSize.height}`;
    if (migratedLegacySubtitleRef.current === signature) {
      return;
    }
    migratedLegacySubtitleRef.current = signature;
    onPositionChange(toNormalizedSubtitlePosition(legacyPoint, state.videoSize.width, state.videoSize.height));
  }, [
    onPositionChange,
    state.frameData,
    state.videoSize.height,
    state.videoSize.width,
    subtitlePosition,
  ]);
  
  useEffect(() => {
    localLogoPositionRef.current = logoPosition ?? null;
    setLocalLogoPosition(logoPosition ?? null);
  }, [logoPosition]);

  useEffect(() => {
    localLogoScaleRef.current = logoScale ?? 1.0;
    setLocalLogoScale(logoScale ?? 1.0);
  }, [logoScale]);

  // ---------------------------------------------------------
  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(resizeEntries => {
      for (const entry of resizeEntries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const loadPreview = useCallback(async (videoPath: string, preferredTimeSec?: number | null) => {
    if (!videoPath) return;
    const shouldResetFrame = videoMetaRef.current?.path !== videoPath;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const api = (window.electronAPI as any).captionVideo;

      const metaRes = await api.getVideoMetadata(videoPath);
      let vw = 1920, vh = 1080;
      if (metaRes?.success && metaRes.data) {
        vw = metaRes.data.width;
        vh = metaRes.data.actualHeight || metaRes.data.height || 1080;
        const durationSec = Number(metaRes.data.duration) || 0;
        const fps = Number(metaRes.data.fps) || 30;
        const desiredSecRaw = preferredTimeSec ?? 0;
        const desiredSec = Math.max(0, Math.min(durationSec > 0 ? durationSec : desiredSecRaw, desiredSecRaw));
        // Lưu metadata để scrubber dùng sau
        videoMetaRef.current = {
          path: videoPath,
          fps,
          duration: durationSec,
        };
        if (shouldResetFrame || preferredTimeSec !== undefined) {
          setFrameTimeSec(desiredSec);
        }
      }

      const previewSpace = resolvePreviewCoordinateSpace(renderMode, renderResolution, vw, vh);
      const activeMeta = videoMetaRef.current;
      const targetSecRaw = preferredTimeSec ?? 0;
      const targetSec = Math.max(0, Math.min(activeMeta?.duration || targetSecRaw, targetSecRaw));
      const frameNumber = Math.round(targetSec * (activeMeta?.fps || 30));
      const requestSerial = ++frameRequestSerialRef.current;
      const frameRes = await api.extractFrame(videoPath, frameNumber);
      if (requestSerial !== frameRequestSerialRef.current) {
        return;
      }
      if (frameRes?.success && frameRes.data) {
        const fd = frameRes.data.frameData.startsWith('data:')
          ? frameRes.data.frameData
          : `data:image/png;base64,${frameRes.data.frameData}`;

        setState(prev => {
          let nextPosition = prev.subtitlePosition;
          if (isFiniteSubtitlePosition(subtitlePosition)) {
            nextPosition = toNormalizedSubtitlePosition(subtitlePosition, previewSpace.width, previewSpace.height);
          } else if (!Number.isFinite(prev.subtitlePosition.x) || !Number.isFinite(prev.subtitlePosition.y)) {
            let initialY = 0.5;
            if (localBlackoutTop !== null && localBlackoutTop < 1) {
              initialY = localBlackoutTop + (1 - localBlackoutTop) / 2;
            }
            nextPosition = { x: 0.5, y: Math.max(0, Math.min(1, initialY)) };
          }

          return {
            ...prev,
            frameData: fd,
            videoSize: previewSpace,
            subtitlePosition: nextPosition,
            isLoading: false,
          };
        });
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: frameRes?.error || 'Không lấy được frame',
        }));
      }
    } catch (e) {
      setState(prev => ({ ...prev, isLoading: false, error: `${e}` }));
    }
  }, [localBlackoutTop, renderMode, renderResolution, subtitlePosition]);

  // Chỉ thay ảnh nền canvas — KHÔNG reset subtitlePosition, KHÔNG gọi onPositionChange
  const loadFrameAt = useCallback(async (timeSec: number) => {
    const meta = videoMetaRef.current;
    if (!meta) return;
    const clampedTime = Math.max(0, Math.min(meta.duration || timeSec, timeSec));
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const api = (window.electronAPI as any).captionVideo;
      const frameNumber = Math.round(clampedTime * meta.fps);
      const requestSerial = ++frameRequestSerialRef.current;
      const frameRes = await api.extractFrame(meta.path, frameNumber);
      if (requestSerial !== frameRequestSerialRef.current) {
        return;
      }
      if (frameRes?.success && frameRes.data) {
        const fd = frameRes.data.frameData.startsWith('data:')
          ? frameRes.data.frameData
          : `data:image/png;base64,${frameRes.data.frameData}`;
        // Chỉ cập nhật frameData, spread prev giữ nguyên subtitlePosition/videoSize
        setState(prev => ({ ...prev, frameData: fd, isLoading: false }));
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Helper: convert canvas Y to video fraction (0-1)
  const canvasYToFraction = useCallback((cy: number) => {
    if (renderMode === 'hardsub_portrait_9_16') {
      const fgRect = portraitFgRectRef.current;
      if (fgRect && fgRect.height > 0) {
        return Math.max(0, Math.min(1, (cy - fgRect.y) / fgRect.height));
      }
    }
    const rect = previewRectRef.current;
    if (!rect || rect.height <= 0) return 0.5;
    const relY = Math.max(0, Math.min(1, (cy - rect.y) / rect.height));
    return relY;
  }, [renderMode]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = containerSize.width || 400;
    const ch = containerSize.height || 225;
    canvas.width = cw;
    canvas.height = ch;

    const img = imageRef.current;

    if (!img) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#666';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có video preview', cw / 2, ch / 2);
      return;
    }

    const isPortraitMode = renderMode === 'hardsub_portrait_9_16' && !renderSnapshotMode;
    const outputRect = isPortraitMode
      ? fitRect(cw, ch, 9, 16)
      : fitRect(cw, ch, img.width, img.height);

    const previewWidth = Math.max(1, state.videoSize.width);
    const previewHeight = Math.max(1, state.videoSize.height);
    previewRectRef.current = outputRect;
    previewSpaceRef.current = { width: previewWidth, height: previewHeight };

    const ratio = previewWidth / Math.max(1, outputRect.width);
    const mapPreviewToCanvas = (x: number, y: number) => ({
      x: outputRect.x + (x / previewWidth) * outputRect.width,
      y: outputRect.y + (y / previewHeight) * outputRect.height,
    });

    // Background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, cw, ch);

    let portraitFgRect: { x: number; y: number; width: number; height: number } | null = null;

    if (isPortraitMode) {
      const sourceAspect = img.width / Math.max(1, img.height);
      const outputAspect = previewWidth / Math.max(1, previewHeight);
      const aspectDiffRatio = Math.abs(sourceAspect - outputAspect) / outputAspect;
      const layoutStrategy = aspectDiffRatio <= 0.05 ? 'direct_fit_no_blur' : 'blur_composite';

      const cropPercent = Math.min(
        20,
        Math.max(0, Number.isFinite(portraitForegroundCropPercent ?? 0) ? (portraitForegroundCropPercent as number) : 0)
      );
      const cropRatio = 1 - cropPercent / 100;
      const fgSrcW = Math.max(2, Math.floor((img.width * cropRatio) / 2) * 2);
      const fgSrcX = Math.max(0, Math.floor((img.width - fgSrcW) / 2));
      const fgSrcH = img.height;
      const fgSrcY = 0;

      if (layoutStrategy === 'blur_composite') {
        // Giữ phong cách nền blur hiện tại.
        ctx.save();
        ctx.filter = 'blur(18px)';
        ctx.drawImage(
          img,
          outputRect.x - 24,
          outputRect.y - 24,
          outputRect.width + 48,
          outputRect.height + 48
        );
        ctx.restore();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.fillRect(outputRect.x, outputRect.y, outputRect.width, outputRect.height);
      } else {
        // Input gần 9:16: bypass blur để giữ nét.
        ctx.fillStyle = '#000000';
        ctx.fillRect(outputRect.x, outputRect.y, outputRect.width, outputRect.height);
      }

      const fgRectInner = fitRect(outputRect.width, outputRect.height, fgSrcW, fgSrcH);
      const fgRect = {
        x: outputRect.x + fgRectInner.x,
        y: outputRect.y + fgRectInner.y,
        width: fgRectInner.width,
        height: fgRectInner.height,
      };
      portraitFgRect = fgRect;
      ctx.drawImage(
        img,
        fgSrcX,
        fgSrcY,
        fgSrcW,
        fgSrcH,
        fgRect.x,
        fgRect.y,
        fgRect.width,
        fgRect.height
      );
    } else {
      ctx.drawImage(img, outputRect.x, outputRect.y, outputRect.width, outputRect.height);
    }
    portraitFgRectRef.current = portraitFgRect;
    const coverRegion = outputRect;
    coverActiveRegionRef.current = coverRegion;

    if (renderSnapshotMode) {
      return;
    }

    // ===== Draw cover/mask layer =====
    if (localCoverMode === 'copy_from_above') {
      const quad = normalizeQuad(localCoverQuad);
      const region = coverRegion;
      const toCanvasPoint = (point: CoverQuadPoint): CoverQuadPoint => ({
        x: region.x + point.x * region.width,
        y: region.y + point.y * region.height,
      });
      const pTl = toCanvasPoint(quad.tl);
      const pTr = toCanvasPoint(quad.tr);
      const pBr = toCanvasPoint(quad.br);
      const pBl = toCanvasPoint(quad.bl);
      const poly = [pTl, pTr, pBr, pBl];
      const normOffset = computeCopyOffset(quad);
      const offset = Math.max(0, Math.round(normOffset * region.height));
      setCopyOffsetPx(offset);
      const validQuad = isConvexQuad(quad);
      setCoverQuadValid(validQuad);

      if (validQuad && offset > 0) {
        let scratch = blurScratchRef.current;
        if (!scratch) {
          scratch = document.createElement('canvas');
          blurScratchRef.current = scratch;
        }
        if (scratch.width !== cw || scratch.height !== ch) {
          scratch.width = cw;
          scratch.height = ch;
        }
        const scratchCtx = scratch.getContext('2d');
        if (scratchCtx) {
          scratchCtx.clearRect(0, 0, cw, ch);
          scratchCtx.drawImage(canvas, 0, 0, cw, ch);

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(poly[0].x, poly[0].y);
          ctx.lineTo(poly[1].x, poly[1].y);
          ctx.lineTo(poly[2].x, poly[2].y);
          ctx.lineTo(poly[3].x, poly[3].y);
          ctx.closePath();
          ctx.clip();
          // Dịch xuống để destination lấy pixel từ phía trên.
          ctx.drawImage(scratch, 0, offset, cw, ch);
          ctx.restore();
        }
      }

      ctx.strokeStyle = validQuad ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      ctx.lineTo(poly[1].x, poly[1].y);
      ctx.lineTo(poly[2].x, poly[2].y);
      ctx.lineTo(poly[3].x, poly[3].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      if (mode === 'blackout') {
        const edgeHandles = [
          { x: (pTl.x + pBl.x) / 2, y: (pTl.y + pBl.y) / 2 }, // left
          { x: (pTr.x + pBr.x) / 2, y: (pTr.y + pBr.y) / 2 }, // right
          { x: (pTl.x + pTr.x) / 2, y: (pTl.y + pTr.y) / 2 }, // top
          { x: (pBl.x + pBr.x) / 2, y: (pBl.y + pBr.y) / 2 }, // bottom
        ];
        for (const p of edgeHandles) {
          ctx.fillStyle = '#facc15';
          ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
          ctx.strokeStyle = '#111827';
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
        }
      }

      const bbox = quadBoundingBox(quad);
      ctx.fillStyle = validQuad ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(
        `copy ${Math.round((1 - bbox.minY) * 100)}% | off=${offset}px`,
        pTl.x + 6,
        pTl.y + 6
      );
    } else if (localBlackoutTop !== null && localBlackoutTop < 1) {
      const pct = Math.round((1 - localBlackoutTop) * 100);

      if (isPortraitMode && portraitFgRect) {
        const fgBottom = portraitFgRect.y + portraitFgRect.height;
        const blurStartY = portraitFgRect.y + portraitFgRect.height * localBlackoutTop;
        const blurH = fgBottom - blurStartY;

        if (blurH > 1 && portraitFgRect.width > 1) {
          const sx = Math.max(0, Math.floor(portraitFgRect.x));
          const sy = Math.max(0, Math.floor(blurStartY));
          const sw = Math.max(1, Math.min(cw - sx, Math.floor(portraitFgRect.width)));
          const sh = Math.max(1, Math.min(ch - sy, Math.floor(blurH)));

          let scratch = blurScratchRef.current;
          if (!scratch) {
            scratch = document.createElement('canvas');
            blurScratchRef.current = scratch;
          }
          if (scratch.width !== sw || scratch.height !== sh) {
            scratch.width = sw;
            scratch.height = sh;
          }

          const scratchCtx = scratch.getContext('2d');
          if (scratchCtx) {
            scratchCtx.clearRect(0, 0, sw, sh);
            scratchCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

            ctx.save();
            ctx.beginPath();
            ctx.rect(sx, sy, sw, sh);
            ctx.clip();
            ctx.filter = 'blur(14px)';
            // Draw 2 passes để vùng blur đủ rõ mà không cần thêm slider strength.
            ctx.drawImage(scratch, sx, sy, sw, sh);
            ctx.drawImage(scratch, sx, sy, sw, sh);
            ctx.restore();
          }
        }

        ctx.strokeStyle = 'rgba(255, 60, 60, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(portraitFgRect.x, blurStartY);
        ctx.lineTo(portraitFgRect.x + portraitFgRect.width, blurStartY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`blur ${pct}%`, portraitFgRect.x + portraitFgRect.width - 6, blurStartY - 4);
      } else {
        const bandY = outputRect.y + outputRect.height * localBlackoutTop;
        const bandH = outputRect.height * (1 - localBlackoutTop);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.fillRect(outputRect.x, bandY, outputRect.width, bandH);

        ctx.strokeStyle = 'rgba(255, 60, 60, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(outputRect.x, bandY);
        ctx.lineTo(outputRect.x + outputRect.width, bandY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`che ${pct}%`, outputRect.x + outputRect.width - 6, bandY - 4);
      }
    } else {
      setCopyOffsetPx(0);
      setCoverQuadValid(isConvexQuad(localCoverQuadRef.current));
    }

    // ===== Subtitle text =====
    let displayText = 'Caption Demo ✦';
    if (entries && entries.length > 0) {
      displayText = entries[0].translatedText || entries[0].text;
    }

    const normalizedSubtitlePos = clampNormalizedSubtitlePosition(state.subtitlePosition);
    const textX = outputRect.x + normalizedSubtitlePos.x * outputRect.width;
    const textY = outputRect.y + normalizedSubtitlePos.y * outputRect.height;

    const normalizedUserFontSize = normalizeSubtitleFontSize(style.fontSize);
    const shadowBase = normalizeSubtitleShadow(style.shadow);
    const subtitleScaleFactor = resolveSubtitleScaleFactor(renderMode, renderResolution, img.width, img.height);
    const effectiveFontSize = Math.max(1, Math.round(normalizedUserFontSize * subtitleScaleFactor));
    const effectiveShadow = shadowBase === 0
      ? 0
      : Math.max(1, Math.round(effectiveFontSize * 0.04 * (shadowBase / 4)));

    const fontSizeScaled = Math.max(1, effectiveFontSize / ratio);
    const shadowScaled = effectiveShadow / ratio;
    const shadowStrongOffset = Math.max(1, shadowScaled);
    const shadowSoftOffset = Math.max(shadowStrongOffset + 1, shadowStrongOffset * 1.8);

    ctx.font = `${fontSizeScaled}px "${style.fontName}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = displayText.split(/\\N|\n/g);
    const lineHeight = fontSizeScaled * 1.3;
    const totalTextHeight = (lines.length - 1) * lineHeight;
    const startY = textY - totalTextHeight / 2;

    lines.forEach((line, i) => {
      const ly = startY + i * lineHeight;

      if (effectiveShadow > 0) {
        ctx.save();
        ctx.shadowColor = `rgba(0, 0, 0, ${SUBTITLE_SHADOW_SOFT_OPACITY})`;
        ctx.shadowBlur = Math.max(1, fontSizeScaled * 0.06);
        ctx.fillStyle = `rgba(0, 0, 0, ${SUBTITLE_SHADOW_SOFT_OPACITY})`;
        ctx.fillText(line, textX + shadowSoftOffset, ly + shadowSoftOffset);
        ctx.restore();

        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = `rgba(0, 0, 0, ${SUBTITLE_SHADOW_STRONG_OPACITY})`;
        ctx.fillText(line, textX + shadowStrongOffset, ly + shadowStrongOffset);
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = style.fontColor;
      ctx.shadowColor = 'transparent';
      ctx.fillText(line, textX, ly);
      ctx.restore();
    });
    
    // ===== Logo Image =====
    const logoImg = logoImageRef.current;
    if (logoImg) {
      // Mặc định ném logo vào góc trên bên trái nếu chưa có vị trí
      const logoXCoord = localLogoPosition?.x ?? (logoImg.width / 2) + 50;
      const logoYCoord = localLogoPosition?.y ?? (logoImg.height / 2) + 50;
      
      const mappedLogo = mapPreviewToCanvas(logoXCoord, logoYCoord);
      const logoDrawX = mappedLogo.x;
      const logoDrawY = mappedLogo.y;
      
      // Vẽ logo (tâm ở logoDrawX, logoDrawY)
      const scaledLogoW = (logoImg.width / ratio) * localLogoScale;
      const scaledLogoH = (logoImg.height / ratio) * localLogoScale;
      ctx.drawImage(logoImg, logoDrawX - (scaledLogoW / 2), logoDrawY - (scaledLogoH / 2), scaledLogoW, scaledLogoH);

      // Cập nhật bounds ref để mouse handlers dùng
      logoBoundsRef.current = { cx: logoDrawX, cy: logoDrawY, hw: scaledLogoW / 2, hh: scaledLogoH / 2 };
      
      // Khung + corner handles (chỉ trong chế độ logo)
      if (mode === 'logo') {
        const HANDLE = 7; // kích thước handle vuông (px)
        const bx = logoDrawX - scaledLogoW / 2;
        const by = logoDrawY - scaledLogoH / 2;

        // Khung viền
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bx, by, scaledLogoW, scaledLogoH);
        ctx.setLineDash([]);

        // 4 corner handles
        const corners = [
          { x: bx,                   y: by                   }, // TL
          { x: bx + scaledLogoW,     y: by                   }, // TR
          { x: bx,                   y: by + scaledLogoH     }, // BL
          { x: bx + scaledLogoW,     y: by + scaledLogoH     }, // BR
        ];
        corners.forEach(({ x, y }) => {
          ctx.fillStyle = '#eab308';
          ctx.fillRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
        });
      }
    }

    // Crosshair (only in subtitle mode)
    if (mode === 'subtitle') {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(textX - 30, textY);
      ctx.lineTo(textX + 30, textY);
      ctx.moveTo(textX, textY - 15);
      ctx.lineTo(textX, textY + 15);
      ctx.stroke();
      ctx.setLineDash([]);
    }

  }, [state.subtitlePosition, state.videoSize, containerSize, style, entries, localBlackoutTop, localCoverMode, localCoverQuad, localLogoPosition, localLogoScale, mode, renderMode, renderResolution, portraitForegroundCropPercent, renderSnapshotMode]);

  // Load video frame image
  useEffect(() => {
    if (!state.frameData) {
      imageRef.current = null;
      drawCanvas();
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      drawCanvas();
    };
    img.src = state.frameData;
  }, [state.frameData, drawCanvas]);

  // Load logo image
  useEffect(() => {
    if (!logoPath) {
      logoImageRef.current = null;
      drawCanvas();
      return;
    }
    const api = (window.electronAPI as any).captionVideo;
    const loadLogo = async () => {
       try {
         // Đọc base64 từ main process để vượt qua web security limitations (không thể fill `file:///` load trực tiếp được)
         // ta có thể sử dụng extractFrame function hoặc thêm một function readLocalImage
         const res = await api.readLocalImage?.(logoPath);
         if (res?.success && res.data) {
           const logImg = new Image();
           logImg.onload = () => {
             logoImageRef.current = logImg;
             
             // Gán vị trí mặc định nếu chưa có (góc trên bên trái)
             if (!localLogoPositionRef.current) {
               const defaultPos = {
                 x: Math.floor((logImg.width / 2) + 50),
                 y: Math.floor((logImg.height / 2) + 50)
               };
               setLocalLogoPositionSynced(defaultPos);
               setTimeout(() => onLogoPositionChange?.(defaultPos), 0);
             }
             
             drawCanvas();
           };
           logImg.src = res.data.startsWith('data:') ? res.data : `data:image/png;base64,${res.data}`;
         }
       } catch (e) {
         console.warn("Failed to load logo image:", e);
       }
    };
    loadLogo();
  }, [logoPath, state.videoSize]);

  // Load custom font for preview subtitle
  useEffect(() => {
    const loadFontByName = async (fontName: string) => {
      const normalized = fontName?.trim();
      if (!normalized) return;

      const styleId = `preview-font-${normalized.replace(/\s+/g, '-')}`;
      if (document.getElementById(styleId)) {
        await document.fonts.load(`12px "${normalized}"`);
        return;
      }

      const res = await (window.electronAPI as any).captionVideo.getFontData(normalized);
      if (!res?.success || !res.data) {
        return;
      }

      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      const fontFormat = String(res.data).includes('font/otf') ? 'opentype' : 'truetype';
      styleEl.innerHTML = `
        @font-face {
          font-family: '${normalized}';
          src: url('${res.data}') format('${fontFormat}');
        }
      `;
      document.head.appendChild(styleEl);
      await document.fonts.load(`12px "${normalized}"`);
    };

    const run = async () => {
      try {
        const fontsToLoad = Array.from(new Set([style.fontName].map(f => f?.trim()).filter(Boolean))) as string[];

        for (const fontName of fontsToLoad) {
          await loadFontByName(fontName);
        }
      } catch (e) {
        console.error('Lỗi tải font base64:', e);
      } finally {
        drawCanvas();
      }
    };

    run();
  }, [style.fontName, drawCanvas]);

  // Redraw on state changes
  useEffect(() => {
    if (imageRef.current || !state.frameData) {
      drawCanvas();
    }
  }, [state.subtitlePosition, containerSize, style, entries, drawCanvas]);

  // ========================================================
  // Mouse handlers
  // ========================================================

  // Helper: kiểm tra xem điểm (cx, cy) có gần góc nào của logo không
  const isNearCorner = useCallback((cx: number, cy: number) => {
    const b = logoBoundsRef.current;
    if (!b) return false;
    const HIT = 12;
    return [
      { x: b.cx - b.hw, y: b.cy - b.hh },
      { x: b.cx + b.hw, y: b.cy - b.hh },
      { x: b.cx - b.hw, y: b.cy + b.hh },
      { x: b.cx + b.hw, y: b.cy + b.hh },
    ].some(c => Math.abs(cx - c.x) <= HIT && Math.abs(cy - c.y) <= HIT);
  }, []);

  const canvasToPreviewCoords = useCallback((cx: number, cy: number) => {
    const rect = previewRectRef.current;
    const space = previewSpaceRef.current;
    const safeW = Math.max(1, rect.width);
    const safeH = Math.max(1, rect.height);

    const relX = Math.max(0, Math.min(1, (cx - rect.x) / safeW));
    const relY = Math.max(0, Math.min(1, (cy - rect.y) / safeH));

    return {
      x: Math.floor(relX * Math.max(1, space.width)),
      y: Math.floor(relY * Math.max(1, space.height)),
    };
  }, []);

  const canvasToPreviewNormalized = useCallback((cx: number, cy: number) => {
    const rect = previewRectRef.current;
    const safeW = Math.max(1, rect.width);
    const safeH = Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.min(1, (cx - rect.x) / safeW)),
      y: Math.max(0, Math.min(1, (cy - rect.y) / safeH)),
    };
  }, []);

  const canvasToCoverNormalized = useCallback((cx: number, cy: number) => {
    const region = coverActiveRegionRef.current || previewRectRef.current;
    const safeW = Math.max(1, region.width);
    const safeH = Math.max(1, region.height);
    return {
      x: Math.max(0, Math.min(1, (cx - region.x) / safeW)),
      y: Math.max(0, Math.min(1, (cy - region.y) / safeH)),
    };
  }, []);

  const coverQuadCanvasPoints = useCallback(() => {
    const region = coverActiveRegionRef.current || previewRectRef.current;
    const quad = localCoverQuadRef.current;
    const map = (p: CoverQuadPoint) => ({
      x: region.x + p.x * region.width,
      y: region.y + p.y * region.height,
    });
    return {
      tl: map(quad.tl),
      tr: map(quad.tr),
      br: map(quad.br),
      bl: map(quad.bl),
    };
  }, []);

  const hitCoverEdge = useCallback((cx: number, cy: number): CoverDragEdge | null => {
    const points = coverQuadCanvasPoints();
    const tolerance = 12;
    const minY = Math.min(points.tl.y, points.bl.y);
    const maxY = Math.max(points.tl.y, points.bl.y);
    const minX = Math.min(points.tl.x, points.tr.x);
    const maxX = Math.max(points.tl.x, points.tr.x);

    if (Math.abs(cx - points.tl.x) <= tolerance && cy >= minY - tolerance && cy <= maxY + tolerance) {
      return 'left';
    }
    if (Math.abs(cx - points.tr.x) <= tolerance && cy >= minY - tolerance && cy <= maxY + tolerance) {
      return 'right';
    }
    if (Math.abs(cy - points.tl.y) <= tolerance && cx >= minX - tolerance && cx <= maxX + tolerance) {
      return 'top';
    }
    if (Math.abs(cy - points.bl.y) <= tolerance && cx >= minX - tolerance && cx <= maxX + tolerance) {
      return 'bottom';
    }
    return null;
  }, [coverQuadCanvasPoints]);

  const isPointInsideCoverQuad = useCallback((cx: number, cy: number): boolean => {
    const points = coverQuadCanvasPoints();
    return pointInPolygon(
      { x: cx, y: cy },
      [points.tl, points.tr, points.br, points.bl]
    );
  }, [coverQuadCanvasPoints]);

  const resizeCoverRectByEdge = useCallback((rect: CoverRect, edge: CoverDragEdge, point: CoverQuadPoint): CoverRect => {
    let next = { ...rect };
    if (edge === 'left') {
      next.left = Math.max(0, Math.min(point.x, next.right - MIN_COVER_RECT_SIZE));
    } else if (edge === 'right') {
      next.right = Math.min(1, Math.max(point.x, next.left + MIN_COVER_RECT_SIZE));
    } else if (edge === 'top') {
      next.top = Math.max(0, Math.min(point.y, next.bottom - MIN_COVER_RECT_SIZE));
    } else if (edge === 'bottom') {
      next.bottom = Math.min(1, Math.max(point.y, next.top + MIN_COVER_RECT_SIZE));
    }
    return next;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!state.frameData) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    setIsDragging(true);

    if (mode === 'subtitle') {
      const newPos = canvasToPreviewNormalized(cx, cy);
      setState(prev => ({ ...prev, subtitlePosition: newPos }));
      onPositionChange?.(newPos);
    } else if (mode === 'logo') {
      const b = logoBoundsRef.current;
      if (b && isNearCorner(cx, cy)) {
        // Bắt đầu kéo góc để resize — dùng ref để đọc scale hiện tại chính xác
        const dist = Math.sqrt((cx - b.cx) ** 2 + (cy - b.cy) ** 2);
        cornerDragRef.current = { initialDist: Math.max(dist, 1), initialScale: localLogoScaleRef.current };
      } else {
        // Di chuyển logo — chỉ cập nhật local, commit khi mouseUp
        cornerDragRef.current = null;
        const newPos = canvasToPreviewCoords(cx, cy);
        setLocalLogoPositionSynced(newPos);
      }
    } else {
      if (localCoverMode === 'copy_from_above') {
        const edgeKey = hitCoverEdge(cx, cy);
        if (edgeKey) {
          coverDragEdgeRef.current = {
            edge: edgeKey,
            startRect: quadToRect(normalizeQuad(localCoverQuadRef.current)),
          };
          coverDragWholeRef.current = null;
          return;
        }
        if (isPointInsideCoverQuad(cx, cy)) {
          coverDragEdgeRef.current = null;
          coverDragWholeRef.current = {
            startPoint: canvasToCoverNormalized(cx, cy),
            startQuad: rectToQuad(quadToRect(normalizeQuad(localCoverQuadRef.current))),
          };
          return;
        }
        setIsDragging(false);
        return;
      }

      // Blackout mode: set the top Y of blackout band
      const frac = canvasYToFraction(cy);
      setLocalBlackoutTop(frac);
    }
  }, [
    state.frameData,
    mode,
    isNearCorner,
    onPositionChange,
    canvasYToFraction,
    canvasToPreviewCoords,
    canvasToPreviewNormalized,
    localCoverMode,
    hitCoverEdge,
    isPointInsideCoverQuad,
    canvasToCoverNormalized,
  ]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Cập nhật cursor khi hover (không cần đang kéo)
    if (mode === 'logo' && !isDragging) {
      setCanvasCursor(isNearCorner(cx, cy) ? 'nwse-resize' : 'move');
    } else if (mode !== 'logo') {
      if (mode === 'blackout' && localCoverMode === 'copy_from_above') {
        const edgeKey = hitCoverEdge(cx, cy);
        if (edgeKey === 'left' || edgeKey === 'right') {
          setCanvasCursor('ew-resize');
        } else if (edgeKey === 'top' || edgeKey === 'bottom') {
          setCanvasCursor('ns-resize');
        } else if (isPointInsideCoverQuad(cx, cy)) {
          setCanvasCursor('move');
        } else {
          setCanvasCursor('crosshair');
        }
      } else {
        setCanvasCursor(mode === 'blackout' ? 'ns-resize' : 'crosshair');
      }
    }

    if (!isDragging || !state.frameData) return;

    if (mode === 'subtitle') {
      const newPos = canvasToPreviewNormalized(cx, cy);
      setState(prev => ({ ...prev, subtitlePosition: newPos }));
    } else if (mode === 'logo') {
      if (cornerDragRef.current) {
        // Resize từ góc: tính scale theo tỉ lệ khoảng cách tới tâm
        const b = logoBoundsRef.current;
        if (!b) return;
        const dist = Math.sqrt((cx - b.cx) ** 2 + (cy - b.cy) ** 2);
        const newScale = Math.max(0.05, Math.min(10, cornerDragRef.current.initialScale * (dist / cornerDragRef.current.initialDist)));
        setLocalLogoScaleSynced(newScale);
      } else {
        // Di chuyển logo
        const newPos = canvasToPreviewCoords(cx, cy);
        setLocalLogoPositionSynced(newPos);
      }
    } else {
      if (localCoverMode === 'copy_from_above') {
        if (coverDragEdgeRef.current) {
          const nextPoint = canvasToCoverNormalized(cx, cy);
          const resized = resizeCoverRectByEdge(
            coverDragEdgeRef.current.startRect,
            coverDragEdgeRef.current.edge,
            nextPoint
          );
          setLocalCoverQuadSynced(rectToQuad(resized));
        } else if (coverDragWholeRef.current) {
          const nowPoint = canvasToCoverNormalized(cx, cy);
          const deltaX = nowPoint.x - coverDragWholeRef.current.startPoint.x;
          const deltaY = nowPoint.y - coverDragWholeRef.current.startPoint.y;
          const moved = translateQuad(coverDragWholeRef.current.startQuad, deltaX, deltaY);
          const movedRect = quadToRect(moved);
          setLocalCoverQuadSynced(rectToQuad(movedRect));
        }
      } else {
        const frac = canvasYToFraction(cy);
        setLocalBlackoutTop(frac);
      }
    }
  }, [
    isDragging,
    state.frameData,
    mode,
    isNearCorner,
    canvasYToFraction,
    canvasToPreviewCoords,
    canvasToPreviewNormalized,
    localCoverMode,
    hitCoverEdge,
    isPointInsideCoverQuad,
    canvasToCoverNormalized,
    resizeCoverRectByEdge,
  ]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    if (mode === 'subtitle') {
      if (state.frameData) {
        onPositionChange?.(state.subtitlePosition);
      }
    } else if (mode === 'logo') {
      if (cornerDragRef.current) {
        // Commit scale — dùng ref để tránh stale closure
        const finalScale = localLogoScaleRef.current;
        onLogoScaleChange?.(finalScale);
        cornerDragRef.current = null;
      } else {
        // Commit position — dùng ref để tránh stale closure, guard against null
        const finalPos = localLogoPositionRef.current;
        if (finalPos) {
          onLogoPositionChange?.(finalPos);
        }
      }
    } else {
      if (localCoverMode === 'copy_from_above') {
        coverDragEdgeRef.current = null;
        coverDragWholeRef.current = null;
        onCoverQuadChange?.(localCoverQuadRef.current);
      } else {
        // Commit blackout value
        onBlackoutChange?.(localBlackoutTop);
      }
    }
  }, [
    mode,
    state.frameData,
    state.subtitlePosition,
    onPositionChange,
    onLogoPositionChange,
    onLogoScaleChange,
    localBlackoutTop,
    onBlackoutChange,
    localCoverMode,
    onCoverQuadChange,
  ]);

  const resetToCenter = useCallback(() => {
    setState(prev => {
      const center = {
        x: 0.5,
        y: Math.max(0, Math.min(1, prev.subtitlePosition.y)), // Giữ nguyên độ cao (Y) hiện tại
      };
      
      // Delay call to outer handler to avoid stale state in render
      setTimeout(() => onPositionChange?.(center), 0);
      
      return { ...prev, subtitlePosition: center };
    });
  }, [onPositionChange]);

  const clearBlackout = useCallback(() => {
    setLocalBlackoutTop(null);
    onBlackoutChange?.(null);
  }, [onBlackoutChange]);

  const setCoverMode = useCallback((value: 'blackout_bottom' | 'copy_from_above') => {
    setLocalCoverMode(value);
    onCoverModeChange?.(value);
  }, [onCoverModeChange]);

  const resetCoverQuad = useCallback(() => {
    const next = defaultCoverQuad();
    setLocalCoverQuadSynced(next);
    onCoverQuadChange?.(next);
  }, [onCoverQuadChange]);

  const subtitlePositionRel = clampNormalizedSubtitlePosition(state.subtitlePosition);
  const subtitlePositionPx = toPixelSubtitlePosition(
    subtitlePositionRel,
    Math.max(1, state.videoSize.width),
    Math.max(1, state.videoSize.height)
  );

  return {
    canvasRef,
    containerRef,
    frameData: state.frameData,
    subtitlePosition: subtitlePositionPx,
    subtitlePositionRel,
    subtitlePositionPx,
    videoSize: state.videoSize,
    isLoading: state.isLoading,
    error: state.error,
    isDragging,
    canvasCursor,
    mode,
    setMode,
    coverMode: localCoverMode,
    setCoverMode,
    coverQuad: localCoverQuad,
    coverQuadValid,
    copyOffsetPx,
    blackoutTop: localBlackoutTop,
    logoScale: localLogoScale,
    loadPreview,
    loadFrameAt,
    frameTimeSec,
    setFrameTimeSec,
    videoDuration: videoMetaRef.current?.duration ?? 0,
    resetToCenter,
    clearBlackout,
    resetCoverQuad,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
