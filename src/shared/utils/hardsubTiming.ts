export interface HardsubTimingInput {
  step4Scale?: number;
  step7Speed?: number;
  subRenderDuration: number;
  audioScaledDuration: number;
  configuredSrtTimeScale?: number;
  srtAlreadyScaled?: boolean;
}

export interface HardsubTimingResult {
  step4Scale: number;
  step7Speed: number;
  appliedSrtTimeScale: number;
  audioEffectiveSpeed: number;
  videoSubBaseDuration: number;
  videoSpeedMultiplier: number;
  videoMarkerSec: number;
}

const EPSILON = 0.000001;

function normalizePositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export function calculateHardsubTiming(input: HardsubTimingInput): HardsubTimingResult {
  const step4Scale = normalizePositive(input.step4Scale, 1.0);
  const step7Speed = normalizePositive(input.step7Speed, 1.0);
  const configuredSrtTimeScale = normalizePositive(input.configuredSrtTimeScale, 1.0);
  const appliedSrtTimeScale = input.srtAlreadyScaled ? 1.0 : configuredSrtTimeScale;

  const subRenderDuration = input.subRenderDuration > 0 ? input.subRenderDuration : 0;
  const audioScaledDuration = input.audioScaledDuration > 0 ? input.audioScaledDuration : 0;

  const audioEffectiveSpeed = step4Scale - (step7Speed - 1);
  const videoSubBaseDuration = step4Scale > EPSILON
    ? (subRenderDuration / step4Scale)
    : subRenderDuration;

  const videoSpeedMultiplier = (videoSubBaseDuration > EPSILON && audioScaledDuration > EPSILON)
    ? (videoSubBaseDuration / audioScaledDuration)
    : 1.0;
  const videoMarkerSec = audioScaledDuration * videoSpeedMultiplier;

  return {
    step4Scale,
    step7Speed,
    appliedSrtTimeScale,
    audioEffectiveSpeed,
    videoSubBaseDuration,
    videoSpeedMultiplier,
    videoMarkerSec,
  };
}

