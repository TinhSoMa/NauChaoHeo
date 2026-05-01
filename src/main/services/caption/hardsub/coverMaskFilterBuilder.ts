import { CoverQuad } from '../../../../shared/types/caption';
import {
  computeCopyOffset,
  isConvexQuad,
  normalizeQuad,
  pointInConvexQuadExprBuilder,
  quadBoundingBox,
  quadHeight,
  resolveCopySourceY,
  resolveCoverRectPixels,
  toPixelQuad,
} from '../../../../shared/utils/maskCoverGeometry';
import type { CoverFeatherStrategy } from './types';

interface BuildCopyFromAboveFilterInput {
  inputLabel: string;
  outputLabel: string;
  renderWidth: number;
  renderHeight: number;
  coverQuad?: CoverQuad | null;
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
  featherStrategy?: CoverFeatherStrategy;
  labelPrefix?: string;
}

interface BuildInPlaceBlurFilterInput {
  inputLabel: string;
  outputLabel: string;
  renderWidth: number;
  renderHeight: number;
  coverQuad?: CoverQuad | null;
  inPlaceBlurStrength?: number;
  labelPrefix?: string;
}

export interface BuildCopyFromAboveFilterOutput {
  filterParts: string[];
  outputLabel: string;
  applied: boolean;
  reason?: string;
  debug?: Record<string, unknown>;
}

function normalizeLabelName(value: string): string {
  return value.replace(/^\[/, '').replace(/\]$/, '');
}

function ensureLabelRef(value: string): string {
  return value.startsWith('[') ? value : `[${value}]`;
}

function isAxisAlignedRectangle(quad: CoverQuad, tolerance = 1e-3): boolean {
  return (
    Math.abs(quad.tl.y - quad.tr.y) <= tolerance &&
    Math.abs(quad.bl.y - quad.br.y) <= tolerance &&
    Math.abs(quad.tl.x - quad.bl.x) <= tolerance &&
    Math.abs(quad.tr.x - quad.br.x) <= tolerance
  );
}

const DEFAULT_COVER_FEATHER_PX = 18;
const MAX_COVER_FEATHER_PX = 120;
const MIN_COVER_FEATHER_PERCENT = 0;
const MAX_COVER_FEATHER_PERCENT = 50;
const DEFAULT_COVER_FEATHER_PERCENT = 20;
const DEFAULT_FEATHER_STRATEGY: Exclude<CoverFeatherStrategy, 'auto'> = 'geq_distance';

function normalizeCoverFeatherPx(value: number | undefined, maxForRect: number): number {
  const fallback = Math.min(DEFAULT_COVER_FEATHER_PX, maxForRect);
  if (!Number.isFinite(value)) {
    return Math.max(0, fallback);
  }
  const raw = Math.max(0, Math.round(value as number));
  const bounded = Math.min(MAX_COVER_FEATHER_PX, raw);
  return Math.max(0, Math.min(maxForRect, bounded));
}

function normalizeCoverFeatherAxisPx(
  value: number | undefined,
  fallback: number,
  maxForAxis: number
): number {
  const safeMax = Math.max(0, maxForAxis);
  const safeFallback = Math.max(0, Math.min(safeMax, Math.round(fallback)));
  if (!Number.isFinite(value)) {
    return safeFallback;
  }
  const raw = Math.max(0, Math.round(value as number));
  return Math.min(safeMax, Math.min(MAX_COVER_FEATHER_PX, raw));
}

function normalizeCoverFeatherPercent(
  value: number | undefined,
  fallbackPercent: number
): number {
  const safeFallback = Math.max(
    MIN_COVER_FEATHER_PERCENT,
    Math.min(MAX_COVER_FEATHER_PERCENT, Math.round(fallbackPercent))
  );
  if (!Number.isFinite(value)) {
    return safeFallback;
  }
  return Math.max(
    MIN_COVER_FEATHER_PERCENT,
    Math.min(MAX_COVER_FEATHER_PERCENT, Math.round(value as number))
  );
}

function percentToAxisPx(percent: number, axisLengthPx: number, maxForAxis: number): number {
  const raw = Math.round((Math.max(0, percent) / 100) * Math.max(1, axisLengthPx));
  return Math.max(0, Math.min(maxForAxis, raw));
}

function buildRectFeatherAlphaExpr(featherX: number, featherY: number): string {
  const xExpr = featherX > 0
    ? `min(X\\,W-1-X)/${Math.max(1, featherX)}`
    : '1';
  const yExpr = featherY > 0
    ? `min(Y\\,H-1-Y)/${Math.max(1, featherY)}`
    : '1';
  return `255*min(1,max(0,min(${xExpr},${yExpr})))`;
}

function resolveFeatherStrategy(
  strategy?: CoverFeatherStrategy
): Exclude<CoverFeatherStrategy, 'auto'> {
  if (strategy === 'gblur_mask' || strategy === 'geq_distance') {
    return strategy;
  }
  return DEFAULT_FEATHER_STRATEGY;
}

function normalizeInPlaceBlurStrength(value: unknown): number {
  if (!Number.isFinite(value)) {
    return 65;
  }
  return Math.max(0, Math.min(100, Math.round(value as number)));
}

function resolveInPlaceBlurRadius(strength: number): number {
  const normalized = Math.max(0, Math.min(1, strength / 100));
  return Math.max(2, Number((2 + normalized * 18).toFixed(3)));
}

export function buildInPlaceBlurFilter(
  input: BuildInPlaceBlurFilterInput
): BuildCopyFromAboveFilterOutput {
  const outputLabelName = normalizeLabelName(input.outputLabel);
  const outputLabel = `[${outputLabelName}]`;
  const normalized = normalizeQuad(input.coverQuad);

  if (!isConvexQuad(normalized)) {
    return {
      filterParts: [`${ensureLabelRef(input.inputLabel)}null${outputLabel}`],
      outputLabel,
      applied: false,
      reason: 'cover_quad_not_convex',
    };
  }

  const bbox = quadBoundingBox(normalized);
  const normHeight = quadHeight(normalized);
  if (normHeight <= 0.001 || bbox.maxX - bbox.minX <= 0.001) {
    return {
      filterParts: [`${ensureLabelRef(input.inputLabel)}null${outputLabel}`],
      outputLabel,
      applied: false,
      reason: 'cover_quad_too_small',
    };
  }

  const rectPx = resolveCoverRectPixels(normalized, input.renderWidth, input.renderHeight);
  const blurStrength = normalizeInPlaceBlurStrength(input.inPlaceBlurStrength);
  const blurRadius = resolveInPlaceBlurRadius(blurStrength);
  const prefix = (input.labelPrefix || 'cover_blur').replace(/[^A-Za-z0-9_]/g, '_');
  const baseLabel = `[${prefix}_base]`;
  const patchLabel = `[${prefix}_patch]`;
  const patchBlurredLabel = `[${prefix}_patch_blur]`;

  const filterParts: string[] = [
    `${ensureLabelRef(input.inputLabel)}split=2${baseLabel}[${prefix}_src]`,
    `[${prefix}_src]format=rgb24,crop=${rectPx.w}:${rectPx.h}:${rectPx.x}:${rectPx.y}${patchLabel}`,
  ];

  if (blurRadius > 0) {
    const chromaRadius = Math.max(1, Number((blurRadius * 0.6).toFixed(3)));
    filterParts.push(
      `${patchLabel}boxblur=luma_radius=${blurRadius}:luma_power=1:` +
      `chroma_radius=${chromaRadius}:chroma_power=1${patchBlurredLabel}`
    );
  } else {
    filterParts.push(`${patchLabel}null${patchBlurredLabel}`);
  }

  filterParts.push(
    `${baseLabel}${patchBlurredLabel}overlay=${rectPx.x}:${rectPx.y}:eval=init:format=auto${outputLabel}`
  );

  return {
    filterParts,
    outputLabel,
    applied: true,
    debug: {
      mode: 'blur_selected_region',
      blurType: 'boxblur',
      blurStrength,
      blurRadius,
      bbox,
      patch: {
        x: rectPx.x,
        y: rectPx.y,
        w: rectPx.w,
        h: rectPx.h,
      },
    },
  };
}

function buildRectFeatherMaskByGblur(
  maskW: number,
  maskH: number,
  featherX: number,
  featherY: number,
  maskLabelPrefix: string,
  outputMaskLabel: string
): string[] {
  const pad = Math.max(1, Math.max(featherX, featherY));
  const paddedW = maskW + pad * 2;
  const paddedH = maskH + pad * 2;
  const paddedLabel = `[${maskLabelPrefix}_mask_pad]`;
  const sigmaX = Math.max(0.5, Math.min(64, Math.max(1, featherX) / 4));
  const sigmaY = Math.max(0.5, Math.min(64, Math.max(1, featherY) / 4));
  return [
    `color=black:s=${paddedW}x${paddedH},format=gray,` +
      `drawbox=x=${pad}:y=${pad}:w=${maskW}:h=${maskH}:color=white:t=fill,` +
      `gblur=sigma=${Math.max(sigmaX, sigmaY).toFixed(3)}:steps=1${paddedLabel}`,
    `${paddedLabel}crop=${maskW}:${maskH}:${pad}:${pad}${outputMaskLabel}`,
  ];
}

export function buildCopyFromAboveFilter(
  input: BuildCopyFromAboveFilterInput
): BuildCopyFromAboveFilterOutput {
  const outputLabelName = normalizeLabelName(input.outputLabel);
  const outputLabel = `[${outputLabelName}]`;
  const normalized = normalizeQuad(input.coverQuad);

  if (!isConvexQuad(normalized)) {
    return {
      filterParts: [`${ensureLabelRef(input.inputLabel)}null${outputLabel}`],
      outputLabel,
      applied: false,
      reason: 'cover_quad_not_convex',
    };
  }

  const bbox = quadBoundingBox(normalized);
  const normHeight = quadHeight(normalized);
  if (normHeight <= 0.001 || bbox.maxX - bbox.minX <= 0.001) {
    return {
      filterParts: [`${ensureLabelRef(input.inputLabel)}null${outputLabel}`],
      outputLabel,
      applied: false,
      reason: 'cover_quad_too_small',
    };
  }

  const offsetNorm = computeCopyOffset(normalized);
  const offsetPx = Math.max(0, Math.round(offsetNorm * Math.max(1, input.renderHeight)));
  if (offsetPx <= 0) {
    return {
      filterParts: [`${ensureLabelRef(input.inputLabel)}null${outputLabel}`],
      outputLabel,
      applied: false,
      reason: 'copy_offset_zero',
      debug: {
        offsetNorm,
      },
    };
  }

  const quadPx = toPixelQuad(normalized, input.renderWidth, input.renderHeight);
  const condExpr = pointInConvexQuadExprBuilder('X', 'Y', quadPx);
  const prefix = (input.labelPrefix || 'cover').replace(/[^A-Za-z0-9_]/g, '_');
  const baseLabel = `[${prefix}_base]`;
  const shiftSrcLabel = `[${prefix}_shift_src]`;
  const shiftedLabel = `[${prefix}_shifted]`;
  const isRect = isAxisAlignedRectangle(normalized);

  if (isRect) {
    const rectPx = resolveCoverRectPixels(normalized, input.renderWidth, input.renderHeight);
    const sourceY = resolveCopySourceY(rectPx.y, rectPx.h, offsetPx, input.renderHeight);
    const patchLabel = `[${prefix}_patch_rgb]`;
    const patchAlphaLabel = `[${prefix}_patch_alpha]`;
    const maskPatchLabel = `[${prefix}_mask_patch]`;
    const maxRectFeatherX = Math.max(0, Math.floor((rectPx.w - 1) / 2));
    const maxRectFeatherY = Math.max(0, Math.floor((rectPx.h - 1) / 2));
    const legacyFallbackX = normalizeCoverFeatherPx(input.coverFeatherPx, maxRectFeatherX);
    const legacyFallbackY = normalizeCoverFeatherPx(input.coverFeatherPx, maxRectFeatherY);
    const requestedFeatherLegacyX = normalizeCoverFeatherAxisPx(
      input.coverFeatherHorizontalPx,
      legacyFallbackX,
      maxRectFeatherX
    );
    const requestedFeatherLegacyY = normalizeCoverFeatherAxisPx(
      input.coverFeatherVerticalPx,
      legacyFallbackY,
      maxRectFeatherY
    );
    const requestedFeatherHorizontalPercent = normalizeCoverFeatherPercent(
      input.coverFeatherHorizontalPercent,
      DEFAULT_COVER_FEATHER_PERCENT
    );
    const requestedFeatherVerticalPercent = normalizeCoverFeatherPercent(
      input.coverFeatherVerticalPercent,
      DEFAULT_COVER_FEATHER_PERCENT
    );
    const hasHorizontalPercent = Number.isFinite(input.coverFeatherHorizontalPercent);
    const hasVerticalPercent = Number.isFinite(input.coverFeatherVerticalPercent);
    const requestedFeatherX = hasHorizontalPercent
      ? percentToAxisPx(requestedFeatherHorizontalPercent, rectPx.w, maxRectFeatherX)
      : requestedFeatherLegacyX;
    const requestedFeatherY = hasVerticalPercent
      ? percentToAxisPx(requestedFeatherVerticalPercent, rectPx.h, maxRectFeatherY)
      : requestedFeatherLegacyY;
    const fallbackFeatherPx = Math.max(1, Math.max(requestedFeatherX, requestedFeatherY));
    const featherStrategy = resolveFeatherStrategy(input.featherStrategy);
    const rectFilterParts = [
      `${ensureLabelRef(input.inputLabel)}split=2${baseLabel}${shiftSrcLabel}`,
      `${shiftSrcLabel}format=rgb24,crop=${rectPx.w}:${rectPx.h}:${rectPx.x}:${sourceY}${patchLabel}`,
    ];
    if (requestedFeatherX > 0 || requestedFeatherY > 0) {
      if (featherStrategy === 'geq_distance') {
        const featherExpr = buildRectFeatherAlphaExpr(requestedFeatherX, requestedFeatherY);
        rectFilterParts.push(
          `color=black:s=${rectPx.w}x${rectPx.h},format=gray,geq=lum='${featherExpr}'${maskPatchLabel}`
        );
      } else {
        rectFilterParts.push(
          ...buildRectFeatherMaskByGblur(
            rectPx.w,
            rectPx.h,
            Math.max(1, requestedFeatherX),
            Math.max(1, requestedFeatherY),
            prefix,
            maskPatchLabel
          )
        );
      }
      rectFilterParts.push(`${patchLabel}${maskPatchLabel}alphamerge${patchAlphaLabel}`);
      rectFilterParts.push(
        `${baseLabel}${patchAlphaLabel}overlay=${rectPx.x}:${rectPx.y}:eval=init:format=auto:alpha=straight${outputLabel}`
      );
    } else {
      rectFilterParts.push(
        `${baseLabel}${patchLabel}overlay=${rectPx.x}:${rectPx.y}:eval=init:format=auto${outputLabel}`
      );
    }

    return {
      filterParts: rectFilterParts,
      outputLabel,
      applied: true,
      debug: {
        fastPath: 'bbox_overlay',
        offsetPx,
        offsetNorm,
        requestedFeatherPx: Math.max(requestedFeatherX, requestedFeatherY),
        requestedFeatherHorizontalPx: requestedFeatherX,
        requestedFeatherVerticalPx: requestedFeatherY,
        requestedFeatherHorizontalPercent,
        requestedFeatherVerticalPercent,
        fallbackFeatherPx,
        featherStrategy,
        bbox,
        quadPx,
        patch: {
          x: rectPx.x,
          y: rectPx.y,
          w: rectPx.w,
          h: rectPx.h,
          sourceY,
        },
      },
    };
  }

  return {
    filterParts: [
      `${ensureLabelRef(input.inputLabel)}split=2${baseLabel}${shiftSrcLabel}`,
      `${shiftSrcLabel}pad=${input.renderWidth}:${input.renderHeight + offsetPx}:0:${offsetPx}:color=black,` +
      `crop=${input.renderWidth}:${input.renderHeight}:0:0${shiftedLabel}`,
      `${baseLabel}${shiftedLabel}blend=all_expr='if(${condExpr},B,A)'${outputLabel}`,
    ],
    outputLabel,
    applied: true,
    debug: {
      offsetPx,
      offsetNorm,
      bbox,
      quadPx,
    },
  };
}
