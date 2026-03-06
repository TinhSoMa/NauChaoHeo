import { PortraitVideoFilterBuildInput, PortraitVideoFilterBuildOutput } from './types';
import { buildCopyFromAboveFilter } from './coverMaskFilterBuilder';

function appendForegroundBottomBlur(
  parts: string[],
  input: PortraitVideoFilterBuildInput,
  fgLabel: string
): string {
  if (input.coverMode === 'copy_from_above') {
    return fgLabel;
  }
  if (input.blackoutTop == null || input.blackoutTop >= 1) {
    return fgLabel;
  }

  const escapeExprCommas = (expr: string) => expr.replace(/,/g, '\\,');
  const blackoutTop = Math.max(0, Math.min(1, input.blackoutTop));
  // blackoutTop cho portrait phải neo theo foreground (video gốc), không theo toàn canvas 9:16.
  const blurStartExprRaw = `max(0,min(ih-2,ih*${blackoutTop.toFixed(6)}))`;
  const blurStartEvenExprRaw = `trunc(${blurStartExprRaw}/2)*2`;
  const blurHeightExprRaw = `max(2,trunc((ih-${blurStartEvenExprRaw})/2)*2)`;
  const blurStartEvenExpr = escapeExprCommas(blurStartEvenExprRaw);
  const blurHeightExpr = escapeExprCommas(blurHeightExprRaw);

  // Tối ưu hiệu năng: chỉ blur vùng đáy cần che thay vì blur toàn bộ foreground.
  parts.push(`[${fgLabel}]split=2[fg_base][fg_blur_src]`);
  parts.push(`[fg_blur_src]crop=iw:${blurHeightExpr}:0:${blurStartEvenExpr}[fg_blur_crop]`);
  parts.push('[fg_blur_crop]gblur=sigma=16:steps=1[fg_blur]');
  parts.push('[fg_base][fg_blur]overlay=0:H-h[fg_blurred]');
  return 'fg_blurred';
}

export function buildPortraitVideoFilter(input: PortraitVideoFilterBuildInput): PortraitVideoFilterBuildOutput {
  const parts: string[] = [];
  const outputAspect = (input.outputWidth / input.outputHeight).toFixed(6);
  const sourceAspect = Number.isFinite(input.sourceAspect) ? input.sourceAspect : 0;
  const cropPercent = Math.min(20, Math.max(0, Number.isFinite(input.foregroundCropPercent) ? input.foregroundCropPercent : 0));
  const cropRatio = (1 - cropPercent / 100).toFixed(6);
  const cropWExpr = `trunc(iw*${cropRatio}/2)*2`;
  const cropFilter = `crop=${cropWExpr}:ih:(iw-${cropWExpr})/2:0`;
  const fgScaleFilter =
    `${cropFilter},` +
    `scale='if(gte(a,${outputAspect}),${input.outputWidth},-2)':'if(gte(a,${outputAspect}),-2,${input.outputHeight})'`;

  if (input.layoutStrategy === 'direct_fit_no_blur' && sourceAspect > 0) {
    parts.push(`${input.inputLabel}${fgScaleFilter}[fg_fit]`);
    const fgLabel = appendForegroundBottomBlur(parts, input, 'fg_fit');
    parts.push(
      `[${fgLabel}]pad=${input.outputWidth}:${input.outputHeight}:(ow-iw)/2:(oh-ih)/2:black,` +
      'setsar=1,setdar=9/16[v_canvas]'
    );
  } else {
    parts.push(`${input.inputLabel}split=2[bg][fg]`);
    parts.push(
      `[bg]scale=${input.bgDownscaleWidth}:${input.bgDownscaleHeight},` +
      `boxblur=${input.bgBlurLumaRadius}:${input.bgBlurLumaPower},` +
      `scale=${input.outputWidth}:${input.outputHeight}[bg_blur]`
    );
    parts.push(`[fg]${fgScaleFilter}[fg_fit]`);
    const fgLabel = appendForegroundBottomBlur(parts, input, 'fg_fit');
    parts.push(`[bg_blur][${fgLabel}]overlay=(W-w)/2:(H-h)/2,setsar=1,setdar=9/16[v_canvas]`);
  }

  let currentLabel = '[v_canvas]';

  if (input.coverMode === 'copy_from_above') {
    const cover = buildCopyFromAboveFilter({
      inputLabel: currentLabel,
      outputLabel: 'v_canvas_covered',
      renderWidth: input.outputWidth,
      renderHeight: input.outputHeight,
      coverQuad: input.coverQuad,
      coverFeatherPx: input.coverFeatherPx,
      coverFeatherHorizontalPx: input.coverFeatherHorizontalPx,
      coverFeatherVerticalPx: input.coverFeatherVerticalPx,
      coverFeatherHorizontalPercent: input.coverFeatherHorizontalPercent,
      coverFeatherVerticalPercent: input.coverFeatherVerticalPercent,
      featherStrategy: input.featherStrategy,
      labelPrefix: 'portrait_cover',
    });
    parts.push(...cover.filterParts);
    if (!cover.applied) {
      console.warn('[PortraitFilter][Cover] Skip copy_from_above:', cover.reason || 'unknown_reason');
    }
    currentLabel = cover.outputLabel;
  }

  if (input.videoSpeedMultiplier !== 1.0) {
    const ptsMultiplier = (1 / input.videoSpeedMultiplier).toFixed(4);
    parts.push(`${currentLabel}setpts=${ptsMultiplier}*PTS[v_timed]`);
    currentLabel = '[v_timed]';
  }

  parts.push(`${currentLabel}${input.subtitleFilter}[v_subbed]`);
  parts.push('[v_subbed]format=nv12[v_portrait_out]');
  return {
    filterParts: parts,
    outputLabel: 'v_portrait_out',
  };
}
