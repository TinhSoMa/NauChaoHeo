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

interface BuildCopyFromAboveFilterInput {
  inputLabel: string;
  outputLabel: string;
  renderWidth: number;
  renderHeight: number;
  coverQuad?: CoverQuad | null;
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
    const patchLabel = `[${prefix}_patch]`;

    return {
      filterParts: [
        `${ensureLabelRef(input.inputLabel)}split=2${baseLabel}${shiftSrcLabel}`,
        `${shiftSrcLabel}crop=${rectPx.w}:${rectPx.h}:${rectPx.x}:${sourceY}${patchLabel}`,
        `${baseLabel}${patchLabel}overlay=${rectPx.x}:${rectPx.y}:eval=init${outputLabel}`,
      ],
      outputLabel,
      applied: true,
      debug: {
        fastPath: 'bbox_overlay',
        offsetPx,
        offsetNorm,
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
