import type { RenderVideoOptions } from '../types/caption';

export type CaptionRenderResolution = RenderVideoOptions['renderResolution'];

interface LandscapePreset {
  width: number;
  height: number;
}

const LANDSCAPE_PRESETS: Record<'1080p' | '720p' | '540p' | '360p', LandscapePreset> = {
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  '540p': { width: 960, height: 540 },
  '360p': { width: 640, height: 360 },
};

export function ensureEven(value: number, minValue = 2): number {
  const rounded = Math.max(minValue, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function resolveLandscapeTargetHeight(
  sourceHeight: number,
  renderResolution?: CaptionRenderResolution
): number {
  const safeSourceHeight = Math.max(2, ensureEven(sourceHeight, 2));
  if (renderResolution === 'original') {
    return safeSourceHeight;
  }
  if (renderResolution && renderResolution in LANDSCAPE_PRESETS) {
    return LANDSCAPE_PRESETS[renderResolution as keyof typeof LANDSCAPE_PRESETS].height;
  }
  return LANDSCAPE_PRESETS['1080p'].height;
}

export function resolveLandscapeOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  renderResolution?: CaptionRenderResolution
): {
  width: number;
  height: number;
  scaleFactor: number;
  isUpscale: boolean;
  isDownscale: boolean;
} {
  const safeSourceWidth = Math.max(2, ensureEven(sourceWidth, 2));
  const safeSourceHeight = Math.max(2, ensureEven(sourceHeight, 2));

  if (renderResolution === 'original') {
    return {
      width: safeSourceWidth,
      height: safeSourceHeight,
      scaleFactor: 1,
      isUpscale: false,
      isDownscale: false,
    };
  }

  const targetHeight = resolveLandscapeTargetHeight(safeSourceHeight, renderResolution);
  const scaleFactor = targetHeight / safeSourceHeight;
  const sourceAspect = safeSourceWidth / safeSourceHeight;
  const widthFromAspect = safeSourceWidth * scaleFactor;

  let targetWidth = ensureEven(widthFromAspect, 2);
  if (renderResolution && renderResolution in LANDSCAPE_PRESETS) {
    const preset = LANDSCAPE_PRESETS[renderResolution as keyof typeof LANDSCAPE_PRESETS];
    const presetAspect = preset.width / preset.height;
    // Nguồn gần 16:9 sẽ snap về đúng preset (1920x1080, 1280x720, ...).
    if (Math.abs(sourceAspect - presetAspect) <= 0.01) {
      targetWidth = preset.width;
    }
  }

  return {
    width: targetWidth,
    height: ensureEven(targetHeight, 2),
    scaleFactor,
    isUpscale: scaleFactor > 1.0001,
    isDownscale: scaleFactor < 0.9999,
  };
}
