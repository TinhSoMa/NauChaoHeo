export const SHADOW_ALPHA_STOPS = [0.95, 0.72, 0.5, 0.28, 0.05] as const;
export const SHADOW_DISTANCE_MULTIPLIERS = [0.65, 1.0, 1.45, 1.95, 2.55] as const;
export const SHADOW_BLUR_MULTIPLIERS = [0.35, 0.65, 1.0, 1.35, 1.75] as const;

export interface SubtitleShadowLayer {
  opacity: number;
  offsetPx: number;
  blurPx: number;
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

export function buildSubtitleShadowLayers(effectiveShadow: number): SubtitleShadowLayer[] {
  if (!Number.isFinite(effectiveShadow) || effectiveShadow <= 0) {
    return [];
  }

  const safeShadow = Math.max(0, effectiveShadow);
  const layers: SubtitleShadowLayer[] = [];

  for (let i = 0; i < SHADOW_ALPHA_STOPS.length; i++) {
    const opacity = SHADOW_ALPHA_STOPS[i];
    const offsetPx = Math.max(1, Math.round(safeShadow * SHADOW_DISTANCE_MULTIPLIERS[i]));
    const blurPx = Math.max(0.6, safeShadow * SHADOW_BLUR_MULTIPLIERS[i]);
    layers.push({ opacity, offsetPx, blurPx });
  }

  return layers;
}

export function opacityToAssAlphaHex(opacity: number): string {
  const normalizedOpacity = clampNumber(opacity, 0, 1);
  const alpha = Math.round((1 - normalizedOpacity) * 255);
  return alpha.toString(16).toUpperCase().padStart(2, '0');
}

