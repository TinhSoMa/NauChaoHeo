import { buildAtempoFilter } from './audioSpeedAdjuster';
import { HardsubAudioMixBuildInput, HardsubAudioMixBuildOutput } from './types';

export function buildHardsubAudioMix(input: HardsubAudioMixBuildInput): HardsubAudioMixBuildOutput {
  const filterParts: string[] = [];

  const volVid = input.videoVolume / 100;
  const volAud = input.audioVolume / 100;
  const vidAtempo = (input.videoSpeedMultiplier !== 1.0) ? `,${buildAtempoFilter(input.videoSpeedMultiplier)}` : '';
  const audAtempo = (input.audioSpeed !== 1.0) ? `,${buildAtempoFilter(input.audioSpeed)}` : '';

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

