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
  resolveCopySourceY,
  resolveCoverRectPixels,
} from '@shared/utils/maskCoverGeometry';
import { buildSubtitleShadowLayers } from '@shared/utils/subtitleShadowProfile';
import { ensureCaptionFontsLoaded } from './captionFontLoader';

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
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
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

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeLayerPosition(
  value: { x: number; y: number } | null | undefined,
  referenceWidth: number,
  referenceHeight: number
): { x: number; y: number } | null {
  if (!isFiniteSubtitlePosition(value)) {
    return null;
  }
  if (isNormalizedSubtitlePosition(value)) {
    return clampNormalizedSubtitlePosition(value);
  }
  return toNormalizedSubtitlePosition(value, Math.max(1, referenceWidth), Math.max(1, referenceHeight));
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

function coverSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): { sx: number; sy: number; sw: number; sh: number } {
  const safeSourceW = Math.max(1, sourceWidth);
  const safeSourceH = Math.max(1, sourceHeight);
  const safeTargetW = Math.max(1, targetWidth);
  const safeTargetH = Math.max(1, targetHeight);
  const sourceRatio = safeSourceW / safeSourceH;
  const targetRatio = safeTargetW / safeTargetH;

  if (sourceRatio > targetRatio) {
    const sw = safeSourceH * targetRatio;
    return {
      sx: (safeSourceW - sw) / 2,
      sy: 0,
      sw,
      sh: safeSourceH,
    };
  }

  const sh = safeSourceW / targetRatio;
  return {
    sx: 0,
    sy: (safeSourceH - sh) / 2,
    sw: safeSourceW,
    sh,
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

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type CoverDragEdge = 'left' | 'right' | 'top' | 'bottom';

const MIN_COVER_RECT_SIZE = 0.02;
const MIN_PREVIEW_ZOOM = 1;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 0.1;
const MIN_COVER_FEATHER_PX = 0;
const MAX_COVER_FEATHER_PX = 120;
const DEFAULT_COVER_FEATHER_PX = 18;
const MIN_COVER_FEATHER_PERCENT = 0;
const MAX_COVER_FEATHER_PERCENT = 50;
const DEFAULT_COVER_FEATHER_PERCENT = 20;

function normalizeCoverFeatherAxisPx(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return clampNumber(Math.round(fallback), MIN_COVER_FEATHER_PX, MAX_COVER_FEATHER_PX);
  }
  return clampNumber(Math.round(value as number), MIN_COVER_FEATHER_PX, MAX_COVER_FEATHER_PX);
}

function normalizeCoverFeatherPercent(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return clampNumber(Math.round(fallback), MIN_COVER_FEATHER_PERCENT, MAX_COVER_FEATHER_PERCENT);
  }
  return clampNumber(Math.round(value as number), MIN_COVER_FEATHER_PERCENT, MAX_COVER_FEATHER_PERCENT);
}

function coverFeatherPxToPercent(valuePx: number): number {
  const normalizedPx = normalizeCoverFeatherAxisPx(valuePx, DEFAULT_COVER_FEATHER_PX);
  const percent = (normalizedPx / Math.max(1, MAX_COVER_FEATHER_PX)) * MAX_COVER_FEATHER_PERCENT;
  return normalizeCoverFeatherPercent(percent, DEFAULT_COVER_FEATHER_PERCENT);
}

function resolveCoverFeatherPair(
  legacyFeather: number | undefined,
  horizontalFeather: number | undefined,
  verticalFeather: number | undefined,
  horizontalPercent: number | undefined,
  verticalPercent: number | undefined
): { horizontal: number; vertical: number; horizontalPercent: number; verticalPercent: number } {
  const legacy = normalizeCoverFeatherAxisPx(legacyFeather, DEFAULT_COVER_FEATHER_PX);
  const horizontalPx = normalizeCoverFeatherAxisPx(horizontalFeather, legacy);
  const verticalPx = normalizeCoverFeatherAxisPx(verticalFeather, legacy);
  const hasHorizontalPercent = Number.isFinite(horizontalPercent);
  const hasVerticalPercent = Number.isFinite(verticalPercent);
  const horizontalPct = hasHorizontalPercent
    ? normalizeCoverFeatherPercent(horizontalPercent, DEFAULT_COVER_FEATHER_PERCENT)
    : coverFeatherPxToPercent(horizontalPx);
  const verticalPct = hasVerticalPercent
    ? normalizeCoverFeatherPercent(verticalPercent, DEFAULT_COVER_FEATHER_PERCENT)
    : coverFeatherPxToPercent(verticalPx);
  return {
    horizontal: horizontalPx,
    vertical: verticalPx,
    horizontalPercent: horizontalPct,
    verticalPercent: verticalPct,
  };
}

function applyEdgeFeatherMask(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  featherX: number,
  featherY: number
): void {
  const fx = Math.max(0, Math.min(width / 2, featherX));
  const fy = Math.max(0, Math.min(height / 2, featherY));
  if (fx <= 0 && fy <= 0) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const opaque = 'rgba(255,255,255,1)';
  const transparent = 'rgba(255,255,255,0)';

  if (fx > 0) {
    const centerW = Math.max(0, width - fx * 2);
    if (centerW > 0) {
      ctx.fillStyle = opaque;
      ctx.fillRect(fx, 0, centerW, height);
    }
    const leftGradient = ctx.createLinearGradient(0, 0, fx, 0);
    leftGradient.addColorStop(0, transparent);
    leftGradient.addColorStop(1, opaque);
    ctx.fillStyle = leftGradient;
    ctx.fillRect(0, 0, fx, height);

    const rightGradient = ctx.createLinearGradient(width - fx, 0, width, 0);
    rightGradient.addColorStop(0, opaque);
    rightGradient.addColorStop(1, transparent);
    ctx.fillStyle = rightGradient;
    ctx.fillRect(width - fx, 0, fx, height);
  }

  if (fy > 0) {
    const centerH = Math.max(0, height - fy * 2);
    if (centerH > 0) {
      ctx.fillStyle = opaque;
      ctx.fillRect(0, fy, width, centerH);
    }
    const topGradient = ctx.createLinearGradient(0, 0, 0, fy);
    topGradient.addColorStop(0, transparent);
    topGradient.addColorStop(1, opaque);
    ctx.fillStyle = topGradient;
    ctx.fillRect(0, 0, width, fy);

    const bottomGradient = ctx.createLinearGradient(0, height - fy, 0, height);
    bottomGradient.addColorStop(0, opaque);
    bottomGradient.addColorStop(1, transparent);
    ctx.fillStyle = bottomGradient;
    ctx.fillRect(0, height - fy, width, fy);
  }

  ctx.restore();
}

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
  onPositionChange,
  onBlackoutChange,
  onCoverModeChange,
  onCoverQuadChange,
  onLogoPositionChange,
  onLogoScaleChange,
  renderSnapshotMode,
}: UseSubtitlePreviewOptions) {
  const LANDSCAPE_FRAME_WIDTH = 1920;
  const LANDSCAPE_FRAME_HEIGHT = 1080;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const logoImageRef = useRef<HTMLImageElement | null>(null);
  const blurScratchRef = useRef<HTMLCanvasElement | null>(null);
  const coverPatchScratchRef = useRef<HTMLCanvasElement | null>(null);
  const worldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Stores logo bounding box in canvas-pixel coords, updated every drawCanvas
  const logoBoundsRef = useRef<{ cx: number; cy: number; hw: number; hh: number } | null>(null);
  // Stores corner-drag start data
  const cornerDragRef = useRef<{ initialDist: number; initialScale: number } | null>(null);
  // Video metadata for frame scrubbing (path, fps, duration) — không trigger re-render
  const videoMetaRef = useRef<{ path: string; fps: number; duration: number } | null>(null);
  const frameRequestSerialRef = useRef(0);

  const [frameTimeSec, setFrameTimeSec] = useState(0);
  const initialSubtitlePosition = normalizeLayerPosition(
    subtitlePosition,
    LANDSCAPE_FRAME_WIDTH,
    LANDSCAPE_FRAME_HEIGHT
  ) || { x: 0.5, y: 0.5 };

  const [state, setState] = useState<SubtitlePreviewState>({
    frameData: null,
    videoSize: { width: 1920, height: 1080 },
    subtitlePosition: initialSubtitlePosition,
    isLoading: false,
    error: null,
  });

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [canvasCursor, setCanvasCursor] = useState<string>('crosshair');
  const panDragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const previewRectRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const subtitleHitRectRef = useRef<CanvasRect | null>(null);
  const markHitRectRef = useRef<CanvasRect | null>(null);
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
  const [copyRectDebug, setCopyRectDebug] = useState<{ x: number; y: number; w: number; h: number; sourceY: number } | null>(null);
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
  const initialLogoPosition = normalizeLayerPosition(
    logoPosition,
    LANDSCAPE_FRAME_WIDTH,
    LANDSCAPE_FRAME_HEIGHT
  );
  const [localLogoPosition, setLocalLogoPosition] = useState<{ x: number; y: number } | null>(initialLogoPosition);
  const localLogoPositionRef = useRef<{ x: number; y: number } | null>(initialLogoPosition);
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

  const resolveViewOffset = useCallback((zoom: number, width: number, height: number) => {
    if (zoom <= 1) {
      return { x: 0, y: 0 };
    }
    return {
      x: (width - width * zoom) / 2,
      y: (height - height * zoom) / 2,
    };
  }, []);

  const clampViewPanOffset = useCallback((
    pan: { x: number; y: number },
    zoom: number,
    width: number,
    height: number
  ) => {
    if (zoom <= 1) {
      return { x: 0, y: 0 };
    }
    const maxX = Math.max(0, (width * zoom - width) / 2);
    const maxY = Math.max(0, (height * zoom - height) / 2);
    return {
      x: clampNumber(pan.x, -maxX, maxX),
      y: clampNumber(pan.y, -maxY, maxY),
    };
  }, []);

  const resolveViewOffsetWithPan = useCallback((
    zoom: number,
    width: number,
    height: number,
    pan: { x: number; y: number }
  ) => {
    const base = resolveViewOffset(zoom, width, height);
    const boundedPan = clampViewPanOffset(pan, zoom, width, height);
    return {
      x: base.x + boundedPan.x,
      y: base.y + boundedPan.y,
    };
  }, [clampViewPanOffset, resolveViewOffset]);

  const resetViewTransform = useCallback(() => {
    setPreviewZoom(1);
    setViewPan({ x: 0, y: 0 });
    setIsPanning(false);
    panDragRef.current = null;
  }, []);

  const setZoom = useCallback((value: number) => {
    const nextZoom = clampNumber(value, MIN_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM);
    setPreviewZoom(nextZoom);
  }, []);

  const zoomIn = useCallback(() => {
    setZoom(previewZoom + PREVIEW_ZOOM_STEP);
  }, [previewZoom, setZoom]);

  const zoomOut = useCallback(() => {
    setZoom(previewZoom - PREVIEW_ZOOM_STEP);
  }, [previewZoom, setZoom]);

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
    const nextNormalized = normalizeLayerPosition(
      subtitlePosition,
      LANDSCAPE_FRAME_WIDTH,
      LANDSCAPE_FRAME_HEIGHT
    );
    if (!nextNormalized) {
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
  }, [subtitlePosition]);

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
    if (!state.frameData || !onPositionChange) {
      return;
    }
    const legacyPosition = subtitlePosition;
    if (!isFiniteSubtitlePosition(legacyPosition) || isNormalizedSubtitlePosition(legacyPosition)) {
      return;
    }
    const signature = `${legacyPosition.x}:${legacyPosition.y}`;
    if (migratedLegacySubtitleRef.current === signature) {
      return;
    }
    migratedLegacySubtitleRef.current = signature;
    const normalized = normalizeLayerPosition(
      legacyPosition,
      LANDSCAPE_FRAME_WIDTH,
      LANDSCAPE_FRAME_HEIGHT
    );
    if (normalized) {
      onPositionChange(normalized);
    }
  }, [onPositionChange, state.frameData, subtitlePosition]);
  
  useEffect(() => {
    const previewSpace = previewSpaceRef.current;
    const normalized = normalizeLayerPosition(
      logoPosition,
      previewSpace.width,
      previewSpace.height
    );
    localLogoPositionRef.current = normalized;
    setLocalLogoPosition(normalized);
  }, [logoPosition]);

  useEffect(() => {
    localLogoScaleRef.current = logoScale ?? 1.0;
    setLocalLogoScale(logoScale ?? 1.0);
  }, [logoScale]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      setSpacePressed(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    resetViewTransform();
  }, [renderMode, renderResolution, resetViewTransform]);

  useEffect(() => {
    const cw = containerSize.width || 400;
    const ch = containerSize.height || 225;
    setViewPan((prev) => {
      const next = clampViewPanOffset(prev, previewZoom, cw, ch);
      if (next.x === prev.x && next.y === prev.y) {
        return prev;
      }
      return next;
    });
    if (previewZoom <= 1) {
      setIsPanning(false);
      panDragRef.current = null;
    }
  }, [clampViewPanOffset, containerSize.height, containerSize.width, previewZoom]);

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
    if (shouldResetFrame) {
      resetViewTransform();
    }

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
            const normalized = normalizeLayerPosition(
              subtitlePosition,
              LANDSCAPE_FRAME_WIDTH,
              LANDSCAPE_FRAME_HEIGHT
            );
            if (normalized) {
              nextPosition = normalized;
            }
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
  }, [localBlackoutTop, renderMode, renderResolution, resetViewTransform, subtitlePosition]);

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
    const hostCanvas = canvasRef.current;
    if (!hostCanvas) return;
    const hostCtx = hostCanvas.getContext('2d');
    if (!hostCtx) return;

    const cw = containerSize.width || 400;
    const ch = containerSize.height || 225;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelW = Math.max(1, Math.floor(cw * dpr));
    const pixelH = Math.max(1, Math.floor(ch * dpr));
    hostCanvas.width = pixelW;
    hostCanvas.height = pixelH;
    hostCanvas.style.width = `${cw}px`;
    hostCanvas.style.height = `${ch}px`;

    let worldCanvas = worldCanvasRef.current;
    if (!worldCanvas) {
      worldCanvas = document.createElement('canvas');
      worldCanvasRef.current = worldCanvas;
    }
    if (worldCanvas.width !== pixelW || worldCanvas.height !== pixelH) {
      worldCanvas.width = pixelW;
      worldCanvas.height = pixelH;
    }
    const canvas = worldCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const presentWorldCanvas = () => {
      hostCtx.setTransform(1, 0, 0, 1, 0, 0);
      hostCtx.clearRect(0, 0, pixelW, pixelH);
      hostCtx.fillStyle = '#111827';
      hostCtx.fillRect(0, 0, pixelW, pixelH);
      hostCtx.save();
      const viewOffset = resolveViewOffsetWithPan(previewZoom, cw, ch, viewPan);
      hostCtx.setTransform(
        dpr * previewZoom,
        0,
        0,
        dpr * previewZoom,
        viewOffset.x * dpr,
        viewOffset.y * dpr
      );
      hostCtx.imageSmoothingEnabled = true;
      hostCtx.imageSmoothingQuality = 'high';
      hostCtx.drawImage(canvas, 0, 0, cw, ch);
      hostCtx.restore();
    };

    const img = imageRef.current;

    if (!img) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#666';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có video preview', cw / 2, ch / 2);
      subtitleHitRectRef.current = null;
      markHitRectRef.current = null;
      logoBoundsRef.current = null;
      presentWorldCanvas();
      return;
    }

    const isPortraitMode = renderMode === 'hardsub_portrait_9_16' && !renderSnapshotMode;
    const outputRect = isPortraitMode
      ? fitRect(cw, ch, 9, 16)
      : fitRect(cw, ch, 16, 9);

    const previewWidth = isPortraitMode
      ? Math.max(1, state.videoSize.width)
      : LANDSCAPE_FRAME_WIDTH;
    const previewHeight = isPortraitMode
      ? Math.max(1, state.videoSize.height)
      : LANDSCAPE_FRAME_HEIGHT;
    previewRectRef.current = outputRect;
    previewSpaceRef.current = { width: previewWidth, height: previewHeight };
    markHitRectRef.current = {
      x: outputRect.x,
      y: outputRect.y + outputRect.height * 0.62,
      width: outputRect.width,
      height: outputRect.height * 0.38,
    };

    const ratio = previewWidth / Math.max(1, outputRect.width);

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
      const srcRect = coverSourceRect(img.width, img.height, outputRect.width, outputRect.height);
      ctx.drawImage(
        img,
        srcRect.sx,
        srcRect.sy,
        srcRect.sw,
        srcRect.sh,
        outputRect.x,
        outputRect.y,
        outputRect.width,
        outputRect.height
      );
    }
    portraitFgRectRef.current = portraitFgRect;
    const coverRegion = outputRect;
    coverActiveRegionRef.current = coverRegion;

    if (renderSnapshotMode) {
      subtitleHitRectRef.current = null;
      presentWorldCanvas();
      return;
    }

    // ===== Draw cover/mask layer =====
    if (localCoverMode === 'copy_from_above') {
      const quad = normalizeQuad(localCoverQuad);
      const region = coverRegion;
      const rectPx = resolveCoverRectPixels(quad, previewWidth, previewHeight);
      const normOffset = computeCopyOffset(quad);
      const offset = Math.max(0, Math.round(normOffset * previewHeight));
      const sourceYPx = resolveCopySourceY(rectPx.y, rectPx.h, offset, previewHeight);
      setCopyOffsetPx(offset);
      const validQuad = isConvexQuad(quad);
      setCoverQuadValid(validQuad);
      setCopyRectDebug((prev) => {
        if (
          prev &&
          prev.x === rectPx.x &&
          prev.y === rectPx.y &&
          prev.w === rectPx.w &&
          prev.h === rectPx.h &&
          prev.sourceY === sourceYPx
        ) {
          return prev;
        }
        return { x: rectPx.x, y: rectPx.y, w: rectPx.w, h: rectPx.h, sourceY: sourceYPx };
      });

      const scaleX = region.width / previewWidth;
      const scaleY = region.height / previewHeight;
      const coverFeatherPair = resolveCoverFeatherPair(
        coverFeatherPx,
        coverFeatherHorizontalPx,
        coverFeatherVerticalPx,
        coverFeatherHorizontalPercent,
        coverFeatherVerticalPercent
      );
      const rectCanvasX = region.x + rectPx.x * scaleX;
      const rectCanvasY = region.y + rectPx.y * scaleY;
      const rectCanvasW = rectPx.w * scaleX;
      const rectCanvasH = rectPx.h * scaleY;
      const sourceCanvasY = region.y + sourceYPx * scaleY;
      markHitRectRef.current = {
        x: rectCanvasX,
        y: rectCanvasY,
        width: rectCanvasW,
        height: rectCanvasH,
      };

      if (validQuad && offset > 0 && rectCanvasW > 0 && rectCanvasH > 0) {
        let scratch = blurScratchRef.current;
        if (!scratch) {
          scratch = document.createElement('canvas');
          blurScratchRef.current = scratch;
        }
        if (scratch.width !== pixelW || scratch.height !== pixelH) {
          scratch.width = pixelW;
          scratch.height = pixelH;
        }
        const scratchCtx = scratch.getContext('2d');
        if (scratchCtx) {
          scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
          scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
          scratchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          scratchCtx.imageSmoothingEnabled = true;
          scratchCtx.imageSmoothingQuality = 'high';
          scratchCtx.drawImage(canvas, 0, 0, cw, ch);

          if (coverFeatherPair.horizontalPercent <= 0 && coverFeatherPair.verticalPercent <= 0) {
            ctx.drawImage(
              scratch,
              rectCanvasX,
              sourceCanvasY,
              rectCanvasW,
              rectCanvasH,
              rectCanvasX,
              rectCanvasY,
              rectCanvasW,
              rectCanvasH
            );
          } else {
            let patchCanvas = coverPatchScratchRef.current;
            if (!patchCanvas) {
              patchCanvas = document.createElement('canvas');
              coverPatchScratchRef.current = patchCanvas;
            }
            const patchWidth = Math.max(1, Math.round(rectCanvasW));
            const patchHeight = Math.max(1, Math.round(rectCanvasH));
            if (patchCanvas.width !== patchWidth || patchCanvas.height !== patchHeight) {
              patchCanvas.width = patchWidth;
              patchCanvas.height = patchHeight;
            }
            const patchCtx = patchCanvas.getContext('2d');
            if (patchCtx) {
              patchCtx.setTransform(1, 0, 0, 1, 0, 0);
              patchCtx.clearRect(0, 0, patchCanvas.width, patchCanvas.height);
              patchCtx.imageSmoothingEnabled = true;
              patchCtx.imageSmoothingQuality = 'high';
              patchCtx.drawImage(
                scratch,
                rectCanvasX,
                sourceCanvasY,
                rectCanvasW,
                rectCanvasH,
                0,
                0,
                patchCanvas.width,
                patchCanvas.height
              );
              applyEdgeFeatherMask(
                patchCtx,
                patchCanvas.width,
                patchCanvas.height,
                Math.max(0, Math.round((patchCanvas.width * coverFeatherPair.horizontalPercent) / 100)),
                Math.max(0, Math.round((patchCanvas.height * coverFeatherPair.verticalPercent) / 100))
              );
              ctx.drawImage(
                patchCanvas,
                rectCanvasX,
                rectCanvasY,
                rectCanvasW,
                rectCanvasH
              );
            }
          }
        }
      }

      ctx.strokeStyle = validQuad ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rectCanvasX, rectCanvasY, rectCanvasW, rectCanvasH);
      ctx.setLineDash([]);

      if (mode === 'blackout') {
        const edgeHandles = [
          { x: rectCanvasX, y: rectCanvasY + rectCanvasH / 2 }, // left
          { x: rectCanvasX + rectCanvasW, y: rectCanvasY + rectCanvasH / 2 }, // right
          { x: rectCanvasX + rectCanvasW / 2, y: rectCanvasY }, // top
          { x: rectCanvasX + rectCanvasW / 2, y: rectCanvasY + rectCanvasH }, // bottom
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
        rectCanvasX + 6,
        rectCanvasY + 6
      );
    } else if (localBlackoutTop !== null && localBlackoutTop < 1) {
      setCopyRectDebug(null);
      const pct = Math.round((1 - localBlackoutTop) * 100);

      if (isPortraitMode && portraitFgRect) {
        const fgBottom = portraitFgRect.y + portraitFgRect.height;
        const blurStartY = portraitFgRect.y + portraitFgRect.height * localBlackoutTop;
        const blurH = fgBottom - blurStartY;
        markHitRectRef.current = {
          x: portraitFgRect.x,
          y: Math.max(portraitFgRect.y, blurStartY - 12),
          width: portraitFgRect.width,
          height: Math.max(18, fgBottom - Math.max(portraitFgRect.y, blurStartY - 12)),
        };

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
          const scratchW = Math.max(1, Math.floor(sw * dpr));
          const scratchH = Math.max(1, Math.floor(sh * dpr));
          if (scratch.width !== scratchW || scratch.height !== scratchH) {
            scratch.width = scratchW;
            scratch.height = scratchH;
          }

          const scratchCtx = scratch.getContext('2d');
          if (scratchCtx) {
            scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
            scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
            scratchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            scratchCtx.imageSmoothingEnabled = true;
            scratchCtx.imageSmoothingQuality = 'high';
            scratchCtx.drawImage(
              canvas,
              sx * dpr,
              sy * dpr,
              sw * dpr,
              sh * dpr,
              0,
              0,
              sw,
              sh
            );

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
        markHitRectRef.current = {
          x: outputRect.x,
          y: Math.max(outputRect.y, bandY - 12),
          width: outputRect.width,
          height: Math.max(18, outputRect.y + outputRect.height - Math.max(outputRect.y, bandY - 12)),
        };
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
      setCopyRectDebug(null);
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
    const shadowLayers = buildSubtitleShadowLayers(effectiveShadow).map((layer: { opacity: number; offsetPx: number; blurPx: number }) => ({
      opacity: layer.opacity,
      offsetPx: layer.offsetPx / ratio,
      blurPx: Math.max(0.6 / ratio, layer.blurPx / ratio),
    }));
    const orderedShadowLayers = [...shadowLayers].reverse();

    ctx.font = `${fontSizeScaled}px "${style.fontName}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = displayText.split(/\\N|\n/g);
    const lineWidths = lines.map((line) => ctx.measureText(line).width);
    const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
    const lineHeight = fontSizeScaled * 1.3;
    const totalTextHeight = (lines.length - 1) * lineHeight;
    const startY = textY - totalTextHeight / 2;
    const subtitlePadX = Math.max(10, fontSizeScaled * 0.35);
    const subtitlePadY = Math.max(8, fontSizeScaled * 0.25);
    subtitleHitRectRef.current = {
      x: textX - maxLineWidth / 2 - subtitlePadX,
      y: startY - lineHeight / 2 - subtitlePadY,
      width: maxLineWidth + subtitlePadX * 2,
      height: totalTextHeight + lineHeight + subtitlePadY * 2,
    };

    lines.forEach((line, i) => {
      const ly = startY + i * lineHeight;

      if (orderedShadowLayers.length > 0) {
        orderedShadowLayers.forEach((layer) => {
          ctx.save();
          ctx.shadowColor = `rgba(0, 0, 0, ${layer.opacity})`;
          ctx.shadowBlur = layer.blurPx;
          ctx.fillStyle = `rgba(0, 0, 0, ${layer.opacity})`;
          ctx.fillText(line, textX + layer.offsetPx, ly + layer.offsetPx);
          ctx.restore();
        });
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
      // Mặc định ném logo vào góc trên bên trái nếu chưa có vị trí.
      const defaultLogoPos = {
        x: clamp01(((logoImg.width / 2) + 50) / Math.max(1, previewWidth)),
        y: clamp01(((logoImg.height / 2) + 50) / Math.max(1, previewHeight)),
      };
      const logoPosNorm = localLogoPosition || defaultLogoPos;
      const logoDrawX = outputRect.x + logoPosNorm.x * outputRect.width;
      const logoDrawY = outputRect.y + logoPosNorm.y * outputRect.height;
      
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

    presentWorldCanvas();
  }, [state.subtitlePosition, state.videoSize, containerSize, style, entries, localBlackoutTop, localCoverMode, localCoverQuad, coverFeatherPx, coverFeatherHorizontalPx, coverFeatherVerticalPx, coverFeatherHorizontalPercent, coverFeatherVerticalPercent, localLogoPosition, localLogoScale, mode, previewZoom, renderMode, renderResolution, portraitForegroundCropPercent, renderSnapshotMode, resolveViewOffsetWithPan, viewPan]);

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
               const previewSpace = previewSpaceRef.current;
               const defaultPos = {
                 x: clamp01(((logImg.width / 2) + 50) / Math.max(1, previewSpace.width)),
                 y: clamp01(((logImg.height / 2) + 50) / Math.max(1, previewSpace.height)),
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
    const run = async () => {
      try {
        const fontsToLoad = Array.from(new Set([style.fontName].map((f) => f?.trim()).filter(Boolean))) as string[];
        await ensureCaptionFontsLoaded(fontsToLoad);
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

  const screenToWorldPoint = useCallback((sx: number, sy: number) => {
    const cw = containerSize.width || 400;
    const ch = containerSize.height || 225;
    const viewOffset = resolveViewOffsetWithPan(previewZoom, cw, ch, viewPan);
    return {
      x: (sx - viewOffset.x) / previewZoom,
      y: (sy - viewOffset.y) / previewZoom,
    };
  }, [containerSize.height, containerSize.width, previewZoom, resolveViewOffsetWithPan, viewPan]);

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
    const canPan = previewZoom > 1 && (spacePressed || e.altKey);
    if (canPan) {
      panDragRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: viewPan.x,
        startPanY: viewPan.y,
      };
      setIsPanning(true);
      setIsDragging(false);
      setCanvasCursor('grabbing');
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const worldPoint = screenToWorldPoint(cx, cy);
    const wx = worldPoint.x;
    const wy = worldPoint.y;

    setIsDragging(true);

    if (mode === 'subtitle') {
      const newPos = canvasToPreviewNormalized(wx, wy);
      setState(prev => ({ ...prev, subtitlePosition: newPos }));
      onPositionChange?.(newPos);
    } else if (mode === 'logo') {
      const b = logoBoundsRef.current;
      if (b && isNearCorner(wx, wy)) {
        // Bắt đầu kéo góc để resize — dùng ref để đọc scale hiện tại chính xác
        const dist = Math.sqrt((wx - b.cx) ** 2 + (wy - b.cy) ** 2);
        cornerDragRef.current = { initialDist: Math.max(dist, 1), initialScale: localLogoScaleRef.current };
      } else {
        // Di chuyển logo — chỉ cập nhật local, commit khi mouseUp
        cornerDragRef.current = null;
        const newPos = canvasToPreviewNormalized(wx, wy);
        setLocalLogoPositionSynced(newPos);
      }
    } else {
      if (localCoverMode === 'copy_from_above') {
        const edgeKey = hitCoverEdge(wx, wy);
        if (edgeKey) {
          coverDragEdgeRef.current = {
            edge: edgeKey,
            startRect: quadToRect(normalizeQuad(localCoverQuadRef.current)),
          };
          coverDragWholeRef.current = null;
          return;
        }
        if (isPointInsideCoverQuad(wx, wy)) {
          coverDragEdgeRef.current = null;
          coverDragWholeRef.current = {
            startPoint: canvasToCoverNormalized(wx, wy),
            startQuad: rectToQuad(quadToRect(normalizeQuad(localCoverQuadRef.current))),
          };
          return;
        }
        setIsDragging(false);
        return;
      }

      // Blackout mode: set the top Y of blackout band
      const frac = canvasYToFraction(wy);
      setLocalBlackoutTop(frac);
    }
  }, [
    canvasToCoverNormalized,
    canvasToPreviewNormalized,
    canvasYToFraction,
    state.frameData,
    hitCoverEdge,
    isNearCorner,
    isPointInsideCoverQuad,
    localCoverMode,
    onPositionChange,
    previewZoom,
    screenToWorldPoint,
    spacePressed,
    viewPan,
    mode,
  ]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning && panDragRef.current) {
      const cw = containerSize.width || 400;
      const ch = containerSize.height || 225;
      const dx = e.clientX - panDragRef.current.startClientX;
      const dy = e.clientY - panDragRef.current.startClientY;
      const nextPan = clampViewPanOffset(
        {
          x: panDragRef.current.startPanX + dx,
          y: panDragRef.current.startPanY + dy,
        },
        previewZoom,
        cw,
        ch
      );
      setViewPan((prev) => (
        prev.x === nextPan.x && prev.y === nextPan.y ? prev : nextPan
      ));
      setCanvasCursor('grabbing');
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const worldPoint = screenToWorldPoint(cx, cy);
    const wx = worldPoint.x;
    const wy = worldPoint.y;

    if (previewZoom > 1 && !isDragging && (spacePressed || e.altKey)) {
      setCanvasCursor('grab');
      return;
    }

    if (!isDragging) {
      if (mode === 'logo') {
        const hoverLogoCorner = isNearCorner(wx, wy);
        const logoBounds = logoBoundsRef.current;
        const hoverLogoBody = !!logoBounds
          && Math.abs(wx - logoBounds.cx) <= logoBounds.hw
          && Math.abs(wy - logoBounds.cy) <= logoBounds.hh;
        if (hoverLogoCorner) {
          setCanvasCursor('nwse-resize');
          return;
        }
        if (hoverLogoBody) {
          setCanvasCursor('move');
          return;
        }
        setCanvasCursor('crosshair');
      } else if (mode === 'blackout' && localCoverMode === 'copy_from_above') {
        const edgeKey = hitCoverEdge(wx, wy);
        if (edgeKey === 'left' || edgeKey === 'right') {
          setCanvasCursor('ew-resize');
        } else if (edgeKey === 'top' || edgeKey === 'bottom') {
          setCanvasCursor('ns-resize');
        } else if (isPointInsideCoverQuad(wx, wy)) {
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
      const newPos = canvasToPreviewNormalized(wx, wy);
      setState(prev => ({ ...prev, subtitlePosition: newPos }));
    } else if (mode === 'logo') {
      if (cornerDragRef.current) {
        // Resize từ góc: tính scale theo tỉ lệ khoảng cách tới tâm
        const b = logoBoundsRef.current;
        if (!b) return;
        const dist = Math.sqrt((wx - b.cx) ** 2 + (wy - b.cy) ** 2);
        const newScale = Math.max(0.05, Math.min(10, cornerDragRef.current.initialScale * (dist / cornerDragRef.current.initialDist)));
        setLocalLogoScaleSynced(newScale);
      } else {
        // Di chuyển logo
        const newPos = canvasToPreviewNormalized(wx, wy);
        setLocalLogoPositionSynced(newPos);
      }
    } else {
      if (localCoverMode === 'copy_from_above') {
        if (coverDragEdgeRef.current) {
          const nextPoint = canvasToCoverNormalized(wx, wy);
          const resized = resizeCoverRectByEdge(
            coverDragEdgeRef.current.startRect,
            coverDragEdgeRef.current.edge,
            nextPoint
          );
          setLocalCoverQuadSynced(rectToQuad(resized));
        } else if (coverDragWholeRef.current) {
          const nowPoint = canvasToCoverNormalized(wx, wy);
          const deltaX = nowPoint.x - coverDragWholeRef.current.startPoint.x;
          const deltaY = nowPoint.y - coverDragWholeRef.current.startPoint.y;
          const moved = translateQuad(coverDragWholeRef.current.startQuad, deltaX, deltaY);
          const movedRect = quadToRect(moved);
          setLocalCoverQuadSynced(rectToQuad(movedRect));
        }
      } else {
        const frac = canvasYToFraction(wy);
        setLocalBlackoutTop(frac);
      }
    }
  }, [
    canvasToCoverNormalized,
    canvasToPreviewNormalized,
    canvasYToFraction,
    hitCoverEdge,
    isNearCorner,
    isPointInsideCoverQuad,
    isDragging,
    isPanning,
    localCoverMode,
    mode,
    clampViewPanOffset,
    containerSize.height,
    containerSize.width,
    resizeCoverRectByEdge,
    screenToWorldPoint,
    previewZoom,
    spacePressed,
    state.frameData,
  ]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!spacePressed) {
      return;
    }
    e.preventDefault();

    const deltaSign = Math.sign(e.deltaY);
    if (!Number.isFinite(deltaSign) || deltaSign === 0) {
      return;
    }

    const nextZoom = clampNumber(
      previewZoom + (deltaSign < 0 ? PREVIEW_ZOOM_STEP : -PREVIEW_ZOOM_STEP),
      MIN_PREVIEW_ZOOM,
      MAX_PREVIEW_ZOOM
    );
    if (nextZoom === previewZoom) {
      return;
    }

    setPreviewZoom(nextZoom);
    setCanvasCursor('crosshair');
  }, [
    previewZoom,
    spacePressed,
  ]);

  const nudgeActiveObject = useCallback((dxPx: number, dyPx: number) => {
    if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx)) {
      return;
    }
    const previewSpace = previewSpaceRef.current;
    const maxW = Math.max(1, previewSpace.width);
    const maxH = Math.max(1, previewSpace.height);

    if (mode === 'subtitle') {
      setState((prev) => {
        const nextPos = {
          x: clamp01(prev.subtitlePosition.x + dxPx / maxW),
          y: clamp01(prev.subtitlePosition.y + dyPx / maxH),
        };
        if (nextPos.x === prev.subtitlePosition.x && nextPos.y === prev.subtitlePosition.y) {
          return prev;
        }
        onPositionChange?.(nextPos);
        return { ...prev, subtitlePosition: nextPos };
      });
      return;
    }

    if (mode === 'logo') {
      const current = localLogoPositionRef.current || {
        x: 0.5,
        y: 0.5,
      };
      const nextPos = {
        x: clamp01(current.x + dxPx / maxW),
        y: clamp01(current.y + dyPx / maxH),
      };
      setLocalLogoPositionSynced(nextPos);
      onLogoPositionChange?.(nextPos);
      return;
    }

    if (localCoverMode === 'copy_from_above') {
      const deltaX = dxPx / maxW;
      const deltaY = dyPx / maxH;
      const moved = translateQuad(localCoverQuadRef.current, deltaX, deltaY);
      const nextQuad = rectToQuad(quadToRect(moved));
      setLocalCoverQuadSynced(nextQuad);
      onCoverQuadChange?.(nextQuad);
      return;
    }

    const base = Number.isFinite(localBlackoutTop) ? (localBlackoutTop as number) : 0.7;
    const nextTop = clamp01(base + dyPx / maxH);
    setLocalBlackoutTop(nextTop);
    onBlackoutChange?.(nextTop);
  }, [
    localBlackoutTop,
    localCoverMode,
    mode,
    onBlackoutChange,
    onCoverQuadChange,
    onLogoPositionChange,
    onPositionChange,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === ' ') {
      e.preventDefault();
      return;
    }
    if (!e.key.startsWith('Arrow')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const step = e.shiftKey ? 10 : 2;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    if (e.key === 'ArrowRight') dx = step;
    if (e.key === 'ArrowUp') dy = -step;
    if (e.key === 'ArrowDown') dy = step;
    if (dx === 0 && dy === 0) return;

    nudgeActiveObject(dx, dy);
  }, [nudgeActiveObject]);

  const handleMouseUp = useCallback(() => {
    const wasPanning = isPanning;
    setIsPanning(false);
    panDragRef.current = null;
    if (wasPanning) {
      setCanvasCursor(previewZoom > 1 ? 'grab' : 'crosshair');
      return;
    }
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
    isPanning,
    previewZoom,
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
  const logoPositionPx = localLogoPositionRef.current
    ? toPixelSubtitlePosition(
        localLogoPositionRef.current,
        Math.max(1, state.videoSize.width),
        Math.max(1, state.videoSize.height)
      )
    : null;
  const normalizedCoverFeather = resolveCoverFeatherPair(
    coverFeatherPx,
    coverFeatherHorizontalPx,
    coverFeatherVerticalPx,
    coverFeatherHorizontalPercent,
    coverFeatherVerticalPercent
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
    isPanning,
    canvasCursor,
    zoom: previewZoom,
    setZoom,
    zoomIn,
    zoomOut,
    resetViewTransform,
    mode,
    setMode,
    coverMode: localCoverMode,
    setCoverMode,
    coverQuad: localCoverQuad,
    coverFeatherPx: Math.round((normalizedCoverFeather.horizontal + normalizedCoverFeather.vertical) / 2),
    coverFeatherHorizontalPx: normalizedCoverFeather.horizontal,
    coverFeatherVerticalPx: normalizedCoverFeather.vertical,
    coverFeatherHorizontalPercent: normalizedCoverFeather.horizontalPercent,
    coverFeatherVerticalPercent: normalizedCoverFeather.verticalPercent,
    coverQuadValid,
    copyOffsetPx,
    copyRectDebug,
    blackoutTop: localBlackoutTop,
    logoPosition: logoPositionPx,
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
    handleWheel,
    handleKeyDown,
  };
}
