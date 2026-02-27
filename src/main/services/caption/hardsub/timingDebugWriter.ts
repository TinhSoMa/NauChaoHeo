import * as path from 'path';
import { existsSync } from 'fs';
import { RenderVideoOptions } from '../../../../shared/types/caption';
import { SubtitlePrepResult } from '../subtitleAssBuilder';

export function roundValue(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return Math.round(value * 1000) / 1000;
}

export function summarizeThumbnailTextForLog(text?: string): { length: number; preview: string } {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  const preview = normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
  return {
    length: normalized.length,
    preview,
  };
}

export function buildHardsubTimingPayload(input: {
  options: RenderVideoOptions;
  renderOptions: RenderVideoOptions;
  prep: SubtitlePrepResult;
  outputPath: string;
  subtitleDurationOriginalSec: number;
  subtitleDurationScaledSec: number;
  audioOriginalDurationSec: number | null;
  audioAfterSpeedDurationSec: number | null;
  videoSubDurationAfterScaleSec: number;
  outputDuration: number;
  stretchedVideoDuration: number;
  hasTtsAudio: boolean;
  audioStartInVideoSec: number | null;
  audioEndInVideoSec: number | null;
  audioStartInOutputSec: number | null;
  audioEndInOutputSec: number | null;
  trimApplied: boolean;
  adjustedAudioGenerated: boolean;
  step4SrtScale: number;
  srtTimeScaleConfigured: number;
  srtTimeScaleApplied: number;
  step7AudioSpeed: number;
  audioEffectiveSpeed: number;
  videoMarkerSec: number;
}): unknown {
  const {
    options,
    renderOptions,
    prep,
    outputPath,
    subtitleDurationOriginalSec,
    subtitleDurationScaledSec,
    audioOriginalDurationSec,
    audioAfterSpeedDurationSec,
    videoSubDurationAfterScaleSec,
    outputDuration,
    stretchedVideoDuration,
    hasTtsAudio,
    audioStartInVideoSec,
    audioEndInVideoSec,
    audioStartInOutputSec,
    audioEndInOutputSec,
    trimApplied,
    adjustedAudioGenerated,
    step4SrtScale,
    srtTimeScaleConfigured,
    srtTimeScaleApplied,
    step7AudioSpeed,
    audioEffectiveSpeed,
    videoMarkerSec,
  } = input;

  const translatedSrtPath = path.join(path.dirname(options.srtPath), 'translated.srt');

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    paths: {
      inputVideo: renderOptions.videoPath ?? null,
      inputAudioOriginal: options.audioPath ?? null,
      inputAudioAfterStep7Scale: renderOptions.audioPath ?? null,
      inputSrtForRender: options.srtPath,
      translatedSrt_1_0x: existsSync(translatedSrtPath) ? translatedSrtPath : null,
      outputVideo: outputPath,
    },
    beforeSlowdownOriginal: {
      videoOriginalDurationSec: roundValue(prep.originalVideoDuration),
      videoWithSubtitleDurationSec_1_0x: roundValue(subtitleDurationOriginalSec),
      audioOriginalDurationSec: roundValue(audioOriginalDurationSec),
      audioAfterStep7ScaleDurationSec: roundValue(audioAfterSpeedDurationSec),
    },
    afterScale: {
      calcMode: 'audio_speed_adjusted_video_marker',
      audioSpeedModel: options.audioSpeedModel || 'step4_minus_step7_delta',
      step4SrtScale,
      srtTimeScaleConfigured,
      srtTimeScaleApplied,
      srtAlreadyScaled: prep.srtAlreadyScaled,
      step7AudioSpeedInput: step7AudioSpeed,
      audioEffectiveSpeed: roundValue(audioEffectiveSpeed),
      subtitleDurationScaledSec: roundValue(subtitleDurationScaledSec),
      videoWithSubtitleDurationAfterStep4ScaleSec: roundValue(videoSubDurationAfterScaleSec),
      videoMarkerSec: roundValue(videoMarkerSec),
      videoSpeedNeeded: roundValue(prep.videoSpeedMultiplier),
    },
    mergeWindowInVideo: hasTtsAudio
      ? {
          startSec: roundValue(audioStartInVideoSec),
          endSec: roundValue(audioEndInVideoSec),
          startLabel: `${(audioStartInVideoSec ?? 0).toFixed(3)}s`,
          endLabel: `${(audioEndInVideoSec ?? 0).toFixed(3)}s`,
        }
      : null,
    mergeWindowInOutputTimeline: hasTtsAudio
      ? {
          startSec: roundValue(audioStartInOutputSec),
          endSec: roundValue(audioEndInOutputSec),
          startLabel: `${(audioStartInOutputSec ?? 0).toFixed(3)}s`,
          endLabel: `${(audioEndInOutputSec ?? 0).toFixed(3)}s`,
        }
      : null,
    render: {
      outputRenderDurationSec: roundValue(outputDuration),
      stretchedVideoDurationSec: roundValue(stretchedVideoDuration),
      videoSpeedMultiplier: roundValue(prep.videoSpeedMultiplier),
      trimApplied,
      hasVideoAudio: prep.hasVideoAudio,
      hasTtsAudio,
      speedCalcSource: prep.speedCalcSource,
      audioPreAdjustedFile: adjustedAudioGenerated,
    },
  };
}
