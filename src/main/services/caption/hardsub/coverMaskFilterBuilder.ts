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
  featherStrategy?: CoverFeatherStrategy;
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
const DEFAULT_FEATHER_STRATEGY: Exclude<CoverFeatherStrategy, 'auto'> = 'geq_distance';
const FEATHER_EDGE_RATIO = 0.20;

function normalizeCoverFeatherPx(value: number | undefined, maxForRect: number): number {
  const fallback = Math.min(DEFAULT_COVER_FEATHER_PX, maxForRect);
  if (!Number.isFinite(value)) {
    return Math.max(0, fallback);
  }
  const raw = Math.max(0, Math.round(value as number));
  const bounded = Math.min(MAX_COVER_FEATHER_PX, raw);
  return Math.max(0, Math.min(maxForRect, bounded));
}

function resolveEdgeFadePxByRatio(lengthPx: number): number {
  const safeLen = Math.max(1, Math.round(lengthPx));
  const maxForAxis = Math.max(1, Math.floor((safeLen - 1) / 2));
  const ratioPx = Math.max(1, Math.round(safeLen * FEATHER_EDGE_RATIO));
  return Math.min(maxForAxis, ratioPx);
}

function buildRectFeatherAlphaExpr(featherX: number, featherY: number): string {
  // Mờ dần từ ngoài vào trong: chỉ áp dụng trong dải biên featherX/featherY.
  return `255*min(1,max(0,min(min(X\\,W-1-X)/${featherX},min(Y\\,H-1-Y)/${featherY})))`;
}

function resolveFeatherStrategy(
  strategy?: CoverFeatherStrategy
): Exclude<CoverFeatherStrategy, 'auto'> {
  if (strategy === 'gblur_mask' || strategy === 'geq_distance') {
    return strategy;
  }
  return DEFAULT_FEATHER_STRATEGY;
}

function buildRectFeatherMaskByGblur(
  maskW: number,
  maskH: number,
  featherPx: number,
  maskLabelPrefix: string,
  outputMaskLabel: string
): string[] {
  const pad = featherPx;
  const paddedW = maskW + pad * 2;
  const paddedH = maskH + pad * 2;
  const paddedLabel = `[${maskLabelPrefix}_mask_pad]`;
  const sigma = Math.max(0.5, Math.min(64, featherPx / 4));
  return [
    `color=black:s=${paddedW}x${paddedH},format=gray,` +
      `drawbox=x=${pad}:y=${pad}:w=${maskW}:h=${maskH}:color=white:t=fill,` +
      `gblur=sigma=${sigma.toFixed(3)}:steps=1${paddedLabel}`,
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
    const maxRectFeather = Math.max(0, Math.floor((Math.min(rectPx.w, rectPx.h) - 1) / 2));
    const requestedFeatherPx = normalizeCoverFeatherPx(input.coverFeatherPx, maxRectFeather);
    const featherX = resolveEdgeFadePxByRatio(rectPx.w);
    const featherY = resolveEdgeFadePxByRatio(rectPx.h);
    const fallbackFeatherPx = Math.max(1, Math.round((featherX + featherY) / 2));
    const featherStrategy = resolveFeatherStrategy(input.featherStrategy);
    const rectFilterParts = [
      `${ensureLabelRef(input.inputLabel)}split=2${baseLabel}${shiftSrcLabel}`,
      `${shiftSrcLabel}format=rgb24,crop=${rectPx.w}:${rectPx.h}:${rectPx.x}:${sourceY}${patchLabel}`,
    ];
    if (requestedFeatherPx > 0 && featherX > 0 && featherY > 0) {
      if (featherStrategy === 'geq_distance') {
        const featherExpr = buildRectFeatherAlphaExpr(Math.max(1, featherX), Math.max(1, featherY));
        rectFilterParts.push(
          `color=black:s=${rectPx.w}x${rectPx.h},format=gray,geq=lum='${featherExpr}'${maskPatchLabel}`
        );
      } else {
        rectFilterParts.push(
          ...buildRectFeatherMaskByGblur(rectPx.w, rectPx.h, fallbackFeatherPx, prefix, maskPatchLabel)
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
        requestedFeatherPx,
        fallbackFeatherPx,
        featherX,
        featherY,
        featherEdgeRatio: FEATHER_EDGE_RATIO,
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
