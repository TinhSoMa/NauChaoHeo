import { VideoCropSettings } from '../../../../shared/types/caption';

export interface ResolvedVideoCrop {
  enabled: true;
  x: number;
  y: number;
  width: number;
  height: number;
  filter: string;
  sourceWidth: number;
  sourceHeight: number;
}

const MIN_CROP_SIZE = 64;

function toEvenFloor(value: number, minimum = 0): number {
  const rounded = Math.max(minimum, Math.floor(Number.isFinite(value) ? value : minimum));
  return rounded % 2 === 0 ? rounded : Math.max(minimum, rounded - 1);
}

function toEvenCeil(value: number, minimum = 2): number {
  const rounded = Math.max(minimum, Math.ceil(Number.isFinite(value) ? value : minimum));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function resolveVideoCrop(
  crop: VideoCropSettings | null | undefined,
  sourceWidth: number,
  sourceHeight: number
): ResolvedVideoCrop | null {
  if (!crop?.enabled) {
    return null;
  }

  const safeSourceWidth = toEvenFloor(sourceWidth, 2);
  const safeSourceHeight = toEvenFloor(sourceHeight, 2);
  if (safeSourceWidth < 2 || safeSourceHeight < 2) {
    return null;
  }

  const maxWidth = Math.max(2, safeSourceWidth);
  const maxHeight = Math.max(2, safeSourceHeight);
  const minWidth = Math.min(MIN_CROP_SIZE, maxWidth);
  const minHeight = Math.min(MIN_CROP_SIZE, maxHeight);

  let width = toEvenCeil(crop.rect?.width ?? maxWidth, minWidth);
  let height = toEvenCeil(crop.rect?.height ?? maxHeight, minHeight);
  width = Math.min(width, maxWidth);
  height = Math.min(height, maxHeight);
  if (width % 2 !== 0) width = Math.max(2, width - 1);
  if (height % 2 !== 0) height = Math.max(2, height - 1);

  let x = toEvenFloor(crop.rect?.x ?? 0, 0);
  let y = toEvenFloor(crop.rect?.y ?? 0, 0);
  x = Math.min(Math.max(0, x), Math.max(0, maxWidth - width));
  y = Math.min(Math.max(0, y), Math.max(0, maxHeight - height));
  if (x % 2 !== 0) x = Math.max(0, x - 1);
  if (y % 2 !== 0) y = Math.max(0, y - 1);

  return {
    enabled: true,
    x,
    y,
    width,
    height,
    sourceWidth: safeSourceWidth,
    sourceHeight: safeSourceHeight,
    filter: `crop=${width}:${height}:${x}:${y}`,
  };
}
