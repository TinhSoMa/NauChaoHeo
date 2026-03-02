import { CoverQuad } from '../../../../shared/types/caption';
import {
  computeCopyOffset,
  isConvexQuad,
  normalizeQuad,
  pointInConvexQuadExprBuilder,
  quadBoundingBox,
  quadHeight,
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
    const bboxX = Math.max(0, Math.min(input.renderWidth - 1, Math.floor(bbox.minX * input.renderWidth)));
    const bboxY = Math.max(0, Math.min(input.renderHeight - 1, Math.floor(bbox.minY * input.renderHeight)));
    const bboxMaxX = Math.max(bboxX + 1, Math.min(input.renderWidth, Math.ceil(bbox.maxX * input.renderWidth)));
    const bboxMaxY = Math.max(bboxY + 1, Math.min(input.renderHeight, Math.ceil(bbox.maxY * input.renderHeight)));
    const bboxW = Math.max(1, bboxMaxX - bboxX);
    const bboxH = Math.max(1, bboxMaxY - bboxY);
    const sourceY = Math.max(0, Math.min(input.renderHeight - bboxH, bboxY - offsetPx));
    const patchLabel = `[${prefix}_patch]`;

    return {
      filterParts: [
        `${ensureLabelRef(input.inputLabel)}split=2${baseLabel}${shiftSrcLabel}`,
        `${shiftSrcLabel}crop=${bboxW}:${bboxH}:${bboxX}:${sourceY}${patchLabel}`,
        `${baseLabel}${patchLabel}overlay=${bboxX}:${bboxY}:eval=init${outputLabel}`,
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
          x: bboxX,
          y: bboxY,
          w: bboxW,
          h: bboxH,
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
