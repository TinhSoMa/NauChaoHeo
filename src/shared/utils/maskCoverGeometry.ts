import { CoverQuad, CoverQuadPoint } from '../types/caption';

export interface QuadBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CoverRectPixels {
  x: number;
  y: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
}

const MIN_CONVEX_AREA = 1e-6;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function cross(o: CoverQuadPoint, a: CoverQuadPoint, b: CoverQuadPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function clampPoint01(point: CoverQuadPoint): CoverQuadPoint {
  return {
    x: clamp01(point.x),
    y: clamp01(point.y),
  };
}

export function defaultCoverQuad(): CoverQuad {
  return {
    tl: { x: 0.3, y: 0.38 },
    tr: { x: 0.7, y: 0.38 },
    br: { x: 0.7, y: 0.62 },
    bl: { x: 0.3, y: 0.62 },
  };
}

export function normalizeQuad(quad?: Partial<CoverQuad> | null): CoverQuad {
  const fallback = defaultCoverQuad();
  const source = quad ?? {};
  return {
    tl: clampPoint01(source.tl ?? fallback.tl),
    tr: clampPoint01(source.tr ?? fallback.tr),
    br: clampPoint01(source.br ?? fallback.br),
    bl: clampPoint01(source.bl ?? fallback.bl),
  };
}

export function quadBoundingBox(quad: CoverQuad): QuadBoundingBox {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function quadHeight(quad: CoverQuad): number {
  const bbox = quadBoundingBox(quad);
  return Math.max(0, bbox.maxY - bbox.minY);
}

export function isConvexQuad(quad: CoverQuad): boolean {
  const points = [quad.tl, quad.tr, quad.br, quad.bl];
  const edges = [
    cross(points[0], points[1], points[2]),
    cross(points[1], points[2], points[3]),
    cross(points[2], points[3], points[0]),
    cross(points[3], points[0], points[1]),
  ];

  const hasPositive = edges.some((v) => v > MIN_CONVEX_AREA);
  const hasNegative = edges.some((v) => v < -MIN_CONVEX_AREA);
  if (hasPositive && hasNegative) {
    return false;
  }

  // Diện tích phải đủ lớn để tránh quad suy biến.
  const area2 =
    points[0].x * points[1].y - points[1].x * points[0].y +
    points[1].x * points[2].y - points[2].x * points[1].y +
    points[2].x * points[3].y - points[3].x * points[2].y +
    points[3].x * points[0].y - points[0].x * points[3].y;
  return Math.abs(area2) > MIN_CONVEX_AREA;
}

export function computeCopyOffset(quad: CoverQuad): number {
  const bbox = quadBoundingBox(quad);
  const h = Math.max(0, bbox.maxY - bbox.minY);
  return Math.max(0, Math.min(h, bbox.minY));
}

export function resolveCoverRectPixels(
  quad: CoverQuad,
  renderWidth: number,
  renderHeight: number
): CoverRectPixels {
  const bbox = quadBoundingBox(quad);
  const safeW = Math.max(1, Math.round(renderWidth));
  const safeH = Math.max(1, Math.round(renderHeight));

  const x = Math.max(0, Math.min(safeW - 1, Math.floor(bbox.minX * safeW)));
  const y = Math.max(0, Math.min(safeH - 1, Math.floor(bbox.minY * safeH)));
  const maxX = Math.max(x + 1, Math.min(safeW, Math.ceil(bbox.maxX * safeW)));
  const maxY = Math.max(y + 1, Math.min(safeH, Math.ceil(bbox.maxY * safeH)));
  return {
    x,
    y,
    maxX,
    maxY,
    w: Math.max(1, maxX - x),
    h: Math.max(1, maxY - y),
  };
}

export function resolveCopySourceY(
  y: number,
  h: number,
  offsetPx: number,
  renderHeight: number
): number {
  const safeH = Math.max(1, Math.round(renderHeight));
  const patchH = Math.max(1, Math.round(h));
  const safeY = Math.max(0, Math.min(safeH - patchH, Math.round(y)));
  const safeOffset = Math.max(0, Math.round(offsetPx));
  return Math.max(0, Math.min(safeH - patchH, safeY - safeOffset));
}

export function translateQuadY(quad: CoverQuad, deltaY: number): CoverQuad {
  return {
    tl: clampPoint01({ x: quad.tl.x, y: quad.tl.y + deltaY }),
    tr: clampPoint01({ x: quad.tr.x, y: quad.tr.y + deltaY }),
    br: clampPoint01({ x: quad.br.x, y: quad.br.y + deltaY }),
    bl: clampPoint01({ x: quad.bl.x, y: quad.bl.y + deltaY }),
  };
}

export function toPixelQuad(
  quad: CoverQuad,
  width: number,
  height: number
): CoverQuad {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return {
    tl: { x: Math.round(quad.tl.x * w), y: Math.round(quad.tl.y * h) },
    tr: { x: Math.round(quad.tr.x * w), y: Math.round(quad.tr.y * h) },
    br: { x: Math.round(quad.br.x * w), y: Math.round(quad.br.y * h) },
    bl: { x: Math.round(quad.bl.x * w), y: Math.round(quad.bl.y * h) },
  };
}

export function pointInConvexQuadExprBuilder(
  xExpr: string,
  yExpr: string,
  quadPx: CoverQuad
): string {
  const bbox = quadBoundingBox(quadPx);

  const edgeExpr = (a: CoverQuadPoint, b: CoverQuadPoint): string =>
    `((${xExpr}-${a.x})*(${b.y - a.y})-(${yExpr}-${a.y})*(${b.x - a.x}))`;

  const e1 = edgeExpr(quadPx.tl, quadPx.tr);
  const e2 = edgeExpr(quadPx.tr, quadPx.br);
  const e3 = edgeExpr(quadPx.br, quadPx.bl);
  const e4 = edgeExpr(quadPx.bl, quadPx.tl);

  const sameSignPos = `gte(${e1},0)*gte(${e2},0)*gte(${e3},0)*gte(${e4},0)`;
  const sameSignNeg = `lte(${e1},0)*lte(${e2},0)*lte(${e3},0)*lte(${e4},0)`;
  const bboxCond =
    `gte(${xExpr},${Math.floor(bbox.minX)})*lte(${xExpr},${Math.ceil(bbox.maxX)})*` +
    `gte(${yExpr},${Math.floor(bbox.minY)})*lte(${yExpr},${Math.ceil(bbox.maxY)})`;

  return `${bboxCond}*gte((${sameSignPos}+${sameSignNeg}),1)`;
}
