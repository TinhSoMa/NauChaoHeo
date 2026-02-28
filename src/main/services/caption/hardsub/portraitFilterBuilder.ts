import { PortraitVideoFilterBuildInput, PortraitVideoFilterBuildOutput } from './types';

export function buildPortraitVideoFilter(input: PortraitVideoFilterBuildInput): PortraitVideoFilterBuildOutput {
  const parts: string[] = [];
  const outputAspect = (input.outputWidth / input.outputHeight).toFixed(6);

  parts.push('split=2[bg][fg]');
  parts.push(
    `[bg]scale=${input.bgDownscaleWidth}:${input.bgDownscaleHeight},` +
    `boxblur=${input.bgBlurLumaRadius}:${input.bgBlurLumaPower},` +
    `scale=${input.outputWidth}:${input.outputHeight}[bg_blur]`
  );
  parts.push(
    `[fg]scale='if(gte(a,${outputAspect}),${input.outputWidth},-2)':'if(gte(a,${outputAspect}),-2,${input.outputHeight})'[fg_fit]`
  );
  parts.push('[bg_blur][fg_fit]overlay=(W-w)/2:(H-h)/2[v_canvas]');

  let currentLabel = 'v_canvas';
  if (input.blackoutTop != null && input.blackoutTop < 1) {
    const blackoutY = Math.round(input.blackoutTop * input.outputHeight);
    const blackoutH = input.outputHeight - blackoutY;
    parts.push(
      `[${currentLabel}]drawbox=x=0:y=${blackoutY}:w=iw:h=${blackoutH}:color=black:t=fill[v_blackout]`
    );
    currentLabel = 'v_blackout';
  }

  if (input.videoSpeedMultiplier !== 1.0) {
    const ptsMultiplier = (1 / input.videoSpeedMultiplier).toFixed(4);
    parts.push(`[${currentLabel}]setpts=${ptsMultiplier}*PTS[v_timed]`);
    currentLabel = 'v_timed';
  }

  parts.push(`[${currentLabel}]${input.subtitleFilter}[v_portrait_out]`);
  return {
    filterParts: parts,
    outputLabel: 'v_portrait_out',
  };
}
