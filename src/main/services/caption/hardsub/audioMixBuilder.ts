import { buildAtempoFilter } from './audioSpeedAdjuster';
import { HardsubAudioMixBuildInput, HardsubAudioMixBuildOutput } from './types';

function clampVolumePercent(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeSpeed(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) {
    return 1;
  }
  return value as number;
}

function buildAtempoSuffix(value: number | undefined): string {
  const safeSpeed = normalizeSpeed(value);
  if (Math.abs(safeSpeed - 1.0) < 0.0001) {
    return '';
  }
  const atempo = buildAtempoFilter(safeSpeed);
  return atempo ? `,${atempo}` : '';
}

export function buildHardsubAudioMix(input: HardsubAudioMixBuildInput): HardsubAudioMixBuildOutput {
  const filterParts: string[] = [];

  const safeVideoVolume = clampVolumePercent(input.videoVolume, 0, 200, 100);
  const safeAudioVolume = clampVolumePercent(input.audioVolume, 0, 400, 100);
  const volVid = safeVideoVolume / 100;
  const volAud = safeAudioVolume / 100;
  const vidAtempo = buildAtempoSuffix(input.videoSpeedMultiplier);
  const audAtempo = buildAtempoSuffix(input.audioSpeed);

  if (input.hasVideoAudio && input.hasTtsAudio) {
    filterParts.push(`[0:a]aformat=channel_layouts=stereo,volume=${volVid}${vidAtempo},apad[a_vid]`);
    filterParts.push(`[1:a]aformat=channel_layouts=stereo,volume=${volAud}${audAtempo},apad[a_tts]`);
    filterParts.push(`[a_vid][a_tts]amerge=inputs=2[a_merged]`);
    filterParts.push('[a_merged]pan=stereo|c0<c0+c2|c1<c1+c3[a_out]');
    return { filterParts, mapAudioArg: '[a_out]' };
  }

  if (input.hasVideoAudio && !input.hasTtsAudio) {
    if (volVid !== 1.0 || !!vidAtempo) {
      filterParts.push(`[0:a]volume=${volVid}${vidAtempo}[a_out]`);
      return { filterParts, mapAudioArg: '[a_out]' };
    }
    return { filterParts, mapAudioArg: '0:a' };
  }

  if (!input.hasVideoAudio && input.hasTtsAudio) {
    if (volAud !== 1.0 || !!audAtempo) {
      filterParts.push(`[1:a]volume=${volAud}${audAtempo}[a_out]`);
      return { filterParts, mapAudioArg: '[a_out]' };
    }
    return { filterParts, mapAudioArg: '1:a' };
  }

  return { filterParts, mapAudioArg: null };
}
