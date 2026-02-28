import { RenderProgress, VideoMetadata } from '../../../../shared/types/caption';

export interface MediaProbeResult {
  success: boolean;
  metadata?: VideoMetadata;
  error?: string;
}

export interface SpeedAdjustedAudioResult {
  success: boolean;
  audioPath?: string;
  generated: boolean;
  error?: string;
}

export interface RunFFmpegProcessOptions {
  args: string[];
  totalFrames: number;
  fps: number;
  outputPath: string;
  tempAssPath: string;
  duration: number;
  progressCallback?: (progress: RenderProgress) => void;
}

export interface HardsubAudioMixBuildInput {
  hasVideoAudio: boolean;
  hasTtsAudio: boolean;
  videoVolume: number;
  audioVolume: number;
  videoSpeedMultiplier: number;
  audioSpeed: number;
}

export interface HardsubAudioMixBuildOutput {
  filterParts: string[];
  mapAudioArg: string | null;
}

export interface VideoFilterBuildInput {
  needsScale: boolean;
  renderWidth: number;
  renderHeight: number;
  blackoutTop?: number | null;
  videoSpeedMultiplier: number;
  subtitleFilter: string;
}

export interface PortraitVideoFilterBuildInput {
  outputWidth: number;
  outputHeight: number;
  subtitleFilter: string;
  videoSpeedMultiplier: number;
  blackoutTop?: number | null;
  bgDownscaleWidth: number;
  bgDownscaleHeight: number;
  bgBlurLumaRadius: number;
  bgBlurLumaPower: number;
}

export interface PortraitVideoFilterBuildOutput {
  filterParts: string[];
  outputLabel: string;
}
