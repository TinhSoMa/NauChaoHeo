import { VideoFilterBuildInput } from './types';

export function buildVideoFilter(input: VideoFilterBuildInput): string {
  const filterParts: string[] = [];

  if (input.needsScale) {
    filterParts.push(`scale=${input.renderWidth}:${input.renderHeight}:flags=bicubic`);
  }
  if (input.blackoutTop != null && input.blackoutTop < 1) {
    const blackoutY = Math.round(input.blackoutTop * input.renderHeight);
    const blackoutH = input.renderHeight - blackoutY;
    filterParts.push(`drawbox=x=0:y=${blackoutY}:w=iw:h=${blackoutH}:color=black:t=fill`);
  }
  if (input.videoSpeedMultiplier !== 1.0) {
    const ptsMultiplier = (1 / input.videoSpeedMultiplier).toFixed(4);
    filterParts.push(`setpts=${ptsMultiplier}*PTS`);
  }
  filterParts.push(input.subtitleFilter);

  return filterParts.join(',');
}
