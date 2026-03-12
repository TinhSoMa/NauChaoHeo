export interface SubtitlePosition {
  x: number;
  y: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function isFiniteSubtitlePosition(value: unknown): value is SubtitlePosition {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y);
}

export function isNormalizedSubtitlePosition(value: SubtitlePosition): boolean {
  return value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
}

export function clampNormalizedSubtitlePosition(value: SubtitlePosition): SubtitlePosition {
  return {
    x: clamp01(value.x),
    y: clamp01(value.y),
  };
}

export function toNormalizedSubtitlePosition(
  value: SubtitlePosition,
  referenceWidth: number,
  referenceHeight: number
): SubtitlePosition {
  if (isNormalizedSubtitlePosition(value)) {
    return clampNormalizedSubtitlePosition(value);
  }

  const safeW = Math.max(1, referenceWidth);
  const safeH = Math.max(1, referenceHeight);
  return {
    x: clamp01(value.x / safeW),
    y: clamp01(value.y / safeH),
  };
}

export function toPixelSubtitlePosition(
  value: SubtitlePosition,
  referenceWidth: number,
  referenceHeight: number
): SubtitlePosition {
  const normalized = clampNormalizedSubtitlePosition(value);
  return {
    x: Math.round(normalized.x * Math.max(1, referenceWidth)),
    y: Math.round(normalized.y * Math.max(1, referenceHeight)),
  };
}
