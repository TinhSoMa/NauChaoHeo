import { buildCopyFromAboveFilter, buildInPlaceBlurFilter } from './coverMaskFilterBuilder';
import { VideoFilterBuildInput, VideoFilterBuildOutput } from './types';

function ensureLabelRef(value: string): string {
  return value.startsWith('[') ? value : `[${value}]`;
}

export function buildVideoFilter(input: VideoFilterBuildInput): VideoFilterBuildOutput {
  const filterParts: string[] = [];
  let currentLabel = ensureLabelRef(input.inputLabel);
  const enableMark = input.renderMark !== false;
  const enableSubtitle = input.renderSubtitle !== false;

  if (input.needsScale) {
    const scaledLabel = '[v_scaled]';
    filterParts.push(
      `${currentLabel}scale=${input.renderWidth}:${input.renderHeight}:flags=bicubic${scaledLabel}`
    );
    currentLabel = scaledLabel;
  }

  if (enableMark && input.coverMode === 'blur_selected_region') {
    const blurCover = buildInPlaceBlurFilter({
      inputLabel: currentLabel,
      outputLabel: 'v_covered',
      renderWidth: input.renderWidth,
      renderHeight: input.renderHeight,
      coverQuad: input.coverQuad,
      inPlaceBlurStrength: input.inPlaceBlurStrength,
      labelPrefix: 'landscape_blur',
    });
    filterParts.push(...blurCover.filterParts);
    if (!blurCover.applied) {
      console.warn('[VideoFilter][Cover] Skip blur_selected_region:', blurCover.reason || 'unknown_reason');
    }
    currentLabel = blurCover.outputLabel;
  } else if (enableMark && input.coverMode === 'copy_from_above') {
    const cover = buildCopyFromAboveFilter({
      inputLabel: currentLabel,
      outputLabel: 'v_covered',
      renderWidth: input.renderWidth,
      renderHeight: input.renderHeight,
      coverQuad: input.coverQuad,
      coverFeatherPx: input.coverFeatherPx,
      coverFeatherHorizontalPx: input.coverFeatherHorizontalPx,
      coverFeatherVerticalPx: input.coverFeatherVerticalPx,
      coverFeatherHorizontalPercent: input.coverFeatherHorizontalPercent,
      coverFeatherVerticalPercent: input.coverFeatherVerticalPercent,
      featherStrategy: input.featherStrategy,
      labelPrefix: 'landscape_cover',
    });
    filterParts.push(...cover.filterParts);
    if (!cover.applied) {
      console.warn('[VideoFilter][Cover] Skip copy_from_above:', cover.reason || 'unknown_reason');
    }
    currentLabel = cover.outputLabel;
  } else if (enableMark && input.blackoutTop != null && input.blackoutTop < 1) {
    const blackoutY = Math.round(input.blackoutTop * input.renderHeight);
    const blackoutH = input.renderHeight - blackoutY;
    const blackoutLabel = '[v_covered]';
    filterParts.push(
      `${currentLabel}drawbox=x=0:y=${blackoutY}:w=iw:h=${blackoutH}:color=black:t=fill${blackoutLabel}`
    );
    currentLabel = blackoutLabel;
  }

  if (input.videoSpeedMultiplier !== 1.0) {
    const ptsMultiplier = (1 / input.videoSpeedMultiplier).toFixed(4);
    const timedLabel = '[v_timed]';
    filterParts.push(`${currentLabel}setpts=${ptsMultiplier}*PTS${timedLabel}`);
    currentLabel = timedLabel;
  }

  const outputLabel = '[v_subbed]';
  filterParts.push(`${currentLabel}${enableSubtitle ? input.subtitleFilter : 'null'}${outputLabel}`);

  return {
    filterParts,
    outputLabel,
  };
}
