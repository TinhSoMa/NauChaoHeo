import { PortraitVideoFilterBuildInput, PortraitVideoFilterBuildOutput } from './types';
import { buildCopyFromAboveFilter, buildInPlaceBlurFilter } from './coverMaskFilterBuilder';

function appendBackgroundBottomBlur(
  parts: string[],
  input: PortraitVideoFilterBuildInput,
  bgLabel: string
): string {
  if (input.coverMode === 'copy_from_above' || input.coverMode === 'blur_selected_region') {
    return bgLabel;
  }
  if (input.blackoutTop == null || input.blackoutTop >= 1) {
    return bgLabel;
  }

  const escapeExprCommas = (expr: string) => expr.replace(/,/g, '\\,');
  const blackoutTop = Math.max(0, Math.min(1, input.blackoutTop));
  // Portrait blackout: chỉ tác động nền (hai đầu), không làm mờ vùng foreground ở giữa.
  const blurStartExprRaw = `max(0,min(ih-2,ih*${blackoutTop.toFixed(6)}))`;
  const blurStartEvenExprRaw = `trunc(${blurStartExprRaw}/2)*2`;
  const blurHeightExprRaw = `max(2,trunc((ih-${blurStartEvenExprRaw})/2)*2)`;
  const blurStartEvenExpr = escapeExprCommas(blurStartEvenExprRaw);
  const blurHeightExpr = escapeExprCommas(blurHeightExprRaw);

  // Tối ưu hiệu năng: chỉ blur dải đáy nền cần che thay vì blur toàn bộ khung.
  parts.push(`[${bgLabel}]split=2[bg_base][bg_blur_src]`);
  parts.push(`[bg_blur_src]crop=iw:${blurHeightExpr}:0:${blurStartEvenExpr}[bg_blur_crop]`);
  parts.push('[bg_blur_crop]gblur=sigma=16:steps=1[bg_bottom_blur]');
  parts.push('[bg_base][bg_bottom_blur]overlay=0:H-h[bg_blurred]');
  return 'bg_blurred';
}

export function buildPortraitVideoFilter(input: PortraitVideoFilterBuildInput): PortraitVideoFilterBuildOutput {
  const parts: string[] = [];
  const enableMark = input.renderMark !== false;
  const enableSubtitle = input.renderSubtitle !== false;
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
    parts.push(
      '[fg_fit]pad=' +
      `${input.outputWidth}:${input.outputHeight}:(ow-iw)/2:(oh-ih)/2:black,` +
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
    const bgLabel = enableMark ? appendBackgroundBottomBlur(parts, input, 'bg_blur') : 'bg_blur';
    parts.push(`[${bgLabel}][fg_fit]overlay=(W-w)/2:(H-h)/2,setsar=1,setdar=9/16[v_canvas]`);
  }

  let currentLabel = '[v_canvas]';

  if (enableMark && input.coverMode === 'blur_selected_region') {
    const blurCover = buildInPlaceBlurFilter({
      inputLabel: currentLabel,
      outputLabel: 'v_canvas_covered',
      renderWidth: input.outputWidth,
      renderHeight: input.outputHeight,
      coverQuad: input.coverQuad,
      inPlaceBlurStrength: input.inPlaceBlurStrength,
      labelPrefix: 'portrait_blur',
    });
    parts.push(...blurCover.filterParts);
    if (!blurCover.applied) {
      console.warn('[PortraitFilter][Cover] Skip blur_selected_region:', blurCover.reason || 'unknown_reason');
    }
    currentLabel = blurCover.outputLabel;
  } else if (enableMark && input.coverMode === 'copy_from_above') {
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

  parts.push(`${currentLabel}${enableSubtitle ? input.subtitleFilter : 'null'}[v_subbed]`);
  // Dùng yuv420p để tránh artifact nửa khung xanh trên một số pipeline decode/render preview.
  parts.push('[v_subbed]format=yuv420p[v_portrait_out]');
  return {
    filterParts: parts,
    outputLabel: 'v_portrait_out',
  };
}
