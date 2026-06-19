import { CaptionCoverMode, CoverQuad, RenderProgress, RenderVideoOptions, VideoCropSettings, VideoMetadata } from '../../../../shared/types/caption';
import type { ResolvedVideoCrop } from './cropFilterBuilder';

export type CoverFeatherStrategy = 'auto' | 'geq_distance' | 'gblur_mask';

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
  cleanupTempPaths?: string[];
  duration: number;
  progressCallback?: (progress: RenderProgress) => void;
  debugLabel?: string;
  includeFullStderrOnError?: boolean;
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
  inputLabel: string;
  crop?: VideoCropSettings | null;
  resolvedCrop?: ResolvedVideoCrop | null;
  sourceWidth?: number;
  sourceHeight?: number;
  needsScale: boolean;
  renderWidth: number;
  renderHeight: number;
  renderMark?: boolean;
  blackoutTop?: number | null; // 0-1 từ trên xuống; dùng cho nhánh landscape (tô đen đáy)
  coverMode?: CaptionCoverMode;
  coverQuad?: CoverQuad | null;
  inPlaceBlurStrength?: number;
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
  featherStrategy?: CoverFeatherStrategy;
  videoSpeedMultiplier: number;
  renderSubtitle?: boolean;
  subtitleFilter: string;
  thumbnailEnabled?: boolean;
  thumbnailHasSeparateInput?: boolean;
}

export interface VideoFilterBuildOutput {
  filterParts: string[];
  outputLabel: string;
  cropOutputLabel?: string;
}

export interface PortraitVideoFilterBuildInput {
  inputLabel: string;
  crop?: VideoCropSettings | null;
  resolvedCrop?: ResolvedVideoCrop | null;
  sourceWidth?: number;
  sourceHeight?: number;
  outputWidth: number;
  outputHeight: number;
  renderSubtitle?: boolean;
  subtitleFilter: string;
  videoSpeedMultiplier: number;
  sourceAspect: number;
  layoutStrategy: 'blur_composite' | 'direct_fit_no_blur';
  foregroundCropPercent: number;
  renderMark?: boolean;
  blackoutTop?: number | null; // 0-1 theo output; với portrait: mốc bắt đầu blur vùng đáy của foreground
  coverMode?: CaptionCoverMode;
  coverQuad?: CoverQuad | null;
  inPlaceBlurStrength?: number;
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
  featherStrategy?: CoverFeatherStrategy;
  bgDownscaleWidth: number;
  bgDownscaleHeight: number;
  bgBlurLumaRadius: number;
  bgBlurLumaPower: number;
  thumbnailEnabled?: boolean;
  thumbnailHasSeparateInput?: boolean;
}

export interface PortraitVideoFilterBuildOutput {
  filterParts: string[];
  outputLabel: string;
  cropOutputLabel?: string;
}

export interface InlineThumbnailVideoFilterBuildInput {
  renderMode?: RenderVideoOptions['renderMode'];
  videoInputLabel?: string;
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  fps: number;
  thumbnailTimeSec: number;
  thumbnailDurationSec: number;
  thumbnailText?: string;
  thumbnailTextSecondary?: string;
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  thumbnailTextPrimaryFontName?: string;
  thumbnailTextPrimaryFontSize?: number;
  thumbnailTextPrimaryColor?: string;
  thumbnailTextSecondaryFontName?: string;
  thumbnailTextSecondaryFontSize?: number;
  thumbnailTextSecondaryColor?: string;
  thumbnailLineHeightRatio?: number;
  thumbnailTextPrimaryPosition?: { x: number; y: number };
  thumbnailTextSecondaryPosition?: { x: number; y: number };
  thumbnailTextConstrainTo34?: boolean;
  crop?: VideoCropSettings;
}

export interface InlineThumbnailVideoFilterBuildOutput {
  filterParts: string[];
  outputLabel: string;
  cleanupFiles: string[];
  debug: Record<string, unknown>;
  thumbnailFontPath: string | null;
  thumbnailFontSize: number;
  secondaryThumbnailFontPath: string | null;
  secondaryThumbnailFontSize: number;
}

export interface InlineThumbnailSilentAudioBuildInput {
  outputLabel?: string;
  durationSec: number;
  sampleRate?: number;
  channelLayout?: string;
}

export interface InlineThumbnailSilentAudioBuildOutput {
  filterPart: string;
  outputLabel: string;
  debug: Record<string, unknown>;
}
