import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  DEFAULT_INPUT_TYPE,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
  DEFAULT_SRT_SPEED,
  DEFAULT_EDGE_TTS_BATCH_SIZE,
  DEFAULT_SPLIT_BY_LINES,
  DEFAULT_LINES_PER_FILE,
  DEFAULT_NUMBER_OF_PARTS,
  normalizeVoiceValue,
  InputType,
} from '../../../config/captionConfig';
import { Step, ProcessingMode } from '../CaptionTypes';
import { ASSStyleConfig, CaptionCoverMode, CaptionProjectSettings, CoverQuad } from '@shared/types/caption';
import { useProjectContext } from '../../../context/ProjectContext';
import { nowIso } from '@shared/utils/captionSession';
import {
  clampNormalizedSubtitlePosition,
  isFiniteSubtitlePosition,
  isNormalizedSubtitlePosition,
} from '@shared/utils/subtitlePosition';
import { isConvexQuad, normalizeQuad } from '@shared/utils/maskCoverGeometry';

const PROJECT_SETTINGS_FILE = 'caption-settings.json';

type RenderMode = 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
type RenderResolution = 'original' | '1080p' | '720p' | '540p' | '360p';
type LayoutKey = 'landscape' | 'portrait';

interface LayoutProfile {
  fontSizeScaleVersion: number;
  style: ASSStyleConfig;
  subtitleFontSizeRel: number;
  renderResolution: RenderResolution;
  renderContainer: 'mp4' | 'mov';
  blackoutTop: number | null;
  coverMode: CaptionCoverMode;
  coverQuad: CoverQuad;
  coverFeatherPx: number;
  coverFeatherHorizontalPx: number;
  coverFeatherVerticalPx: number;
  coverFeatherHorizontalPercent: number;
  coverFeatherVerticalPercent: number;
  foregroundCropPercent: number;
  subtitlePosition: { x: number; y: number } | null;
  thumbnailFrameTimeSec: number | null;
  thumbnailDurationSec: number;
  thumbnailTextSecondary: string;
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale: number;
  // Legacy font chung (giữ để tương thích dữ liệu cũ)
  thumbnailFontName: string;
  thumbnailFontSize: number;
  thumbnailFontSizeRel: number;
  // Font riêng cho từng text
  thumbnailTextPrimaryFontName: string;
  thumbnailTextPrimaryFontSize: number;
  thumbnailTextPrimaryFontSizeRel: number;
  thumbnailTextPrimaryColor: string;
  thumbnailTextSecondaryFontName: string;
  thumbnailTextSecondaryFontSize: number;
  thumbnailTextSecondaryFontSizeRel: number;
  thumbnailTextSecondaryColor: string;
  thumbnailLineHeightRatio: number;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
  portraitTextPrimaryFontName: string;
  portraitTextPrimaryFontSize: number;
  portraitTextPrimaryFontSizeRel: number;
  portraitTextPrimaryColor: string;
  portraitTextSecondaryFontName: string;
  portraitTextSecondaryFontSize: number;
  portraitTextSecondaryFontSizeRel: number;
  portraitTextSecondaryColor: string;
  portraitTextPrimaryPosition: { x: number; y: number };
  portraitTextSecondaryPosition: { x: number; y: number };
}

interface LayoutProfilesState {
  landscape: LayoutProfile;
  portrait: LayoutProfile;
}

interface CaptionTypographyLayoutDefaults {
  fontSizeScaleVersion: number;
  style: ASSStyleConfig;
  subtitleFontSizeRel: number;
  subtitlePosition: { x: number; y: number } | null;
  thumbnailTextPrimaryFontName: string;
  thumbnailTextPrimaryFontSize: number;
  thumbnailTextPrimaryFontSizeRel: number;
  thumbnailTextPrimaryColor: string;
  thumbnailTextSecondaryFontName: string;
  thumbnailTextSecondaryFontSize: number;
  thumbnailTextSecondaryFontSizeRel: number;
  thumbnailTextSecondaryColor: string;
  thumbnailLineHeightRatio: number;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
  portraitTextPrimaryFontName: string;
  portraitTextPrimaryFontSize: number;
  portraitTextPrimaryFontSizeRel: number;
  portraitTextPrimaryColor: string;
  portraitTextSecondaryFontName: string;
  portraitTextSecondaryFontSize: number;
  portraitTextSecondaryFontSizeRel: number;
  portraitTextSecondaryColor: string;
  portraitTextPrimaryPosition: { x: number; y: number };
  portraitTextSecondaryPosition: { x: number; y: number };
}

interface CaptionTypographyDefaults {
  schemaVersion: 1;
  landscape: CaptionTypographyLayoutDefaults;
  portrait: CaptionTypographyLayoutDefaults;
}

export const DEFAULT_STYLE: ASSStyleConfig = {
  fontName: 'ZYVNA Fairy',
  fontSize: 62,
  fontColor: '#FFFF00',
  shadow: 4,
  marginV: 50,
  alignment: 2,
};

const MIN_SUBTITLE_FONT_SIZE = 1;
const MAX_SUBTITLE_FONT_SIZE = 1000;
const MIN_SUBTITLE_FONT_SIZE_REL = 1;
const MAX_SUBTITLE_FONT_SIZE_REL = 200;
const MIN_SUBTITLE_SHADOW = 0;
const MAX_SUBTITLE_SHADOW = 20;

const DEFAULT_THUMBNAIL_FONT_NAME = 'BrightwallPersonal';
const DEFAULT_THUMBNAIL_FONT_SIZE = 145;
const DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR = '#FFFF00';
const DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR = '#FFFF00';
const DEFAULT_THUMBNAIL_LINE_HEIGHT_RATIO = 1.16;
const MIN_THUMBNAIL_FONT_SIZE = 24;
const MAX_THUMBNAIL_FONT_SIZE = 400;
const MIN_THUMBNAIL_FONT_SIZE_REL = 8;
const MAX_THUMBNAIL_FONT_SIZE_REL = 200;
const MIN_THUMBNAIL_LINE_HEIGHT_RATIO = 0;
const MAX_THUMBNAIL_LINE_HEIGHT_RATIO = 4;
const FONT_SIZE_REL_BASE_HEIGHT = 360;
const FONT_SIZE_SCALE_VERSION = 2;
const MIN_VIDEO_VOLUME_PERCENT = 0;
const MAX_VIDEO_VOLUME_PERCENT = 200;
const MIN_TTS_VOLUME_PERCENT = 0;
const MAX_TTS_VOLUME_PERCENT = 400;
const MIN_EDGE_TTS_BATCH_SIZE = 1;
const MAX_EDGE_TTS_BATCH_SIZE = 500;
const MIN_COVER_FEATHER_PX = 0;
const MAX_COVER_FEATHER_PX = 120;
const DEFAULT_COVER_FEATHER_PX = 18;
const MIN_COVER_FEATHER_PERCENT = 0;
const MAX_COVER_FEATHER_PERCENT = 50;
const DEFAULT_COVER_FEATHER_PERCENT = 20;

function clampPercent(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(clamped * 100) / 100;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function normalizeCoverFeatherPxValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return clamp(Math.round(fallback), MIN_COVER_FEATHER_PX, MAX_COVER_FEATHER_PX);
  }
  return clamp(Math.round(value as number), MIN_COVER_FEATHER_PX, MAX_COVER_FEATHER_PX);
}

function normalizeCoverFeatherPercentValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return clamp(Math.round(fallback), MIN_COVER_FEATHER_PERCENT, MAX_COVER_FEATHER_PERCENT);
  }
  return clamp(Math.round(value as number), MIN_COVER_FEATHER_PERCENT, MAX_COVER_FEATHER_PERCENT);
}

function coverFeatherPxToPercent(valuePx: number): number {
  const normalizedPx = normalizeCoverFeatherPxValue(valuePx, DEFAULT_COVER_FEATHER_PX);
  const percent = (normalizedPx / Math.max(1, MAX_COVER_FEATHER_PX)) * MAX_COVER_FEATHER_PERCENT;
  return normalizeCoverFeatherPercentValue(percent, DEFAULT_COVER_FEATHER_PERCENT);
}

function coverFeatherPercentToPx(valuePercent: number): number {
  const normalizedPercent = normalizeCoverFeatherPercentValue(valuePercent, DEFAULT_COVER_FEATHER_PERCENT);
  const px = (normalizedPercent / Math.max(1, MAX_COVER_FEATHER_PERCENT)) * MAX_COVER_FEATHER_PX;
  return normalizeCoverFeatherPxValue(px, DEFAULT_COVER_FEATHER_PX);
}

function resolveOutputHeightByLayout(layoutKey: LayoutKey, renderResolution: RenderResolution): number {
  if (layoutKey === 'portrait') {
    if (renderResolution === '720p') return 1280;
    if (renderResolution === '540p') return 960;
    if (renderResolution === '360p') return 640;
    return 1920;
  }
  if (renderResolution === '720p') return 720;
  if (renderResolution === '540p') return 540;
  if (renderResolution === '360p') return 360;
  return 1080;
}

function resolveOutputSizeByLayout(
  layoutKey: LayoutKey,
  renderResolution: RenderResolution
): { width: number; height: number } {
  if (layoutKey === 'portrait') {
    if (renderResolution === '720p') return { width: 720, height: 1280 };
    if (renderResolution === '540p') return { width: 540, height: 960 };
    if (renderResolution === '360p') return { width: 360, height: 640 };
    return { width: 1080, height: 1920 };
  }
  if (renderResolution === '720p') return { width: 1280, height: 720 };
  if (renderResolution === '540p') return { width: 960, height: 540 };
  if (renderResolution === '360p') return { width: 640, height: 360 };
  return { width: 1920, height: 1080 };
}

function normalizePositionValue(
  value: { x: number; y: number },
  referenceWidth: number,
  referenceHeight: number
): { x: number; y: number } {
  if (isNormalizedSubtitlePosition(value)) {
    return clampNormalizedSubtitlePosition(value);
  }
  const safeW = Math.max(1, referenceWidth);
  const safeH = Math.max(1, referenceHeight);
  return {
    x: Math.min(1, Math.max(0, value.x / safeW)),
    y: Math.min(1, Math.max(0, value.y / safeH)),
  };
}

function pxToRelativeFontSize(
  pxValue: number,
  outputHeight: number,
  minRel: number,
  maxRel: number,
  fallback: number
): number {
  if (!Number.isFinite(pxValue)) {
    return fallback;
  }
  const rel = ((pxValue as number) * FONT_SIZE_REL_BASE_HEIGHT) / Math.max(1, outputHeight);
  return clamp(Math.round(rel), minRel, maxRel);
}

function relativeToPxFontSize(
  relValue: number,
  outputHeight: number,
  minPx: number,
  maxPx: number,
  fallback: number
): number {
  if (!Number.isFinite(relValue)) {
    return fallback;
  }
  const px = ((relValue as number) * Math.max(1, outputHeight)) / FONT_SIZE_REL_BASE_HEIGHT;
  return clamp(Math.round(px), minPx, maxPx);
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return fallback;
}

function normalizeAssStyle(style: ASSStyleConfig, fallback: ASSStyleConfig = DEFAULT_STYLE): ASSStyleConfig {
  const fontName = typeof style.fontName === 'string' && style.fontName.trim().length > 0
    ? style.fontName.trim()
    : fallback.fontName;
  const fontColor = typeof style.fontColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(style.fontColor)
    ? style.fontColor
    : fallback.fontColor;
  const fontSize = Number.isFinite(style.fontSize)
    ? Math.min(MAX_SUBTITLE_FONT_SIZE, Math.max(MIN_SUBTITLE_FONT_SIZE, Math.round(style.fontSize)))
    : fallback.fontSize;
  const shadow = Number.isFinite(style.shadow)
    ? Math.min(MAX_SUBTITLE_SHADOW, Math.max(MIN_SUBTITLE_SHADOW, style.shadow))
    : fallback.shadow;
  const marginV = Number.isFinite(style.marginV) ? style.marginV : fallback.marginV;
  const alignment = [2, 5, 8].includes(style.alignment) ? style.alignment : fallback.alignment;

  return {
    fontName,
    fontSize,
    fontColor,
    shadow,
    marginV,
    alignment,
  };
}

const DEFAULT_LANDSCAPE_PROFILE: LayoutProfile = {
  fontSizeScaleVersion: FONT_SIZE_SCALE_VERSION,
  style: { ...DEFAULT_STYLE },
  subtitleFontSizeRel: pxToRelativeFontSize(
    DEFAULT_STYLE.fontSize,
    resolveOutputHeightByLayout('landscape', 'original'),
    MIN_SUBTITLE_FONT_SIZE_REL,
    MAX_SUBTITLE_FONT_SIZE_REL,
    21
  ),
  renderResolution: 'original',
  renderContainer: 'mp4',
  blackoutTop: 0.9,
  coverMode: 'blackout_bottom',
  coverQuad: normalizeQuad(),
  coverFeatherPx: DEFAULT_COVER_FEATHER_PX,
  coverFeatherHorizontalPx: DEFAULT_COVER_FEATHER_PX,
  coverFeatherVerticalPx: DEFAULT_COVER_FEATHER_PX,
  coverFeatherHorizontalPercent: DEFAULT_COVER_FEATHER_PERCENT,
  coverFeatherVerticalPercent: DEFAULT_COVER_FEATHER_PERCENT,
  foregroundCropPercent: 0,
  subtitlePosition: null,
  thumbnailFrameTimeSec: null,
  thumbnailDurationSec: 0.5,
  thumbnailTextSecondary: '',
  logoPath: undefined,
  logoPosition: undefined,
  logoScale: 1.0,
  thumbnailFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('landscape', 'original'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  thumbnailTextPrimaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailTextPrimaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailTextPrimaryFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('landscape', 'original'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  thumbnailTextPrimaryColor: DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR,
  thumbnailTextSecondaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailTextSecondaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailTextSecondaryFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('landscape', 'original'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  thumbnailTextSecondaryColor: DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR,
  thumbnailLineHeightRatio: DEFAULT_THUMBNAIL_LINE_HEIGHT_RATIO,
  thumbnailTextPrimaryPosition: { x: 0.5, y: 0.5 },
  thumbnailTextSecondaryPosition: { x: 0.5, y: 0.64 },
  portraitTextPrimaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  portraitTextPrimaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  portraitTextPrimaryFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('portrait', '1080p'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  portraitTextPrimaryColor: DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR,
  portraitTextSecondaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  portraitTextSecondaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  portraitTextSecondaryFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('portrait', '1080p'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  portraitTextSecondaryColor: DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR,
  portraitTextPrimaryPosition: { x: 0.5, y: 0.5 },
  portraitTextSecondaryPosition: { x: 0.5, y: 0.64 },
};

const DEFAULT_PORTRAIT_PROFILE: LayoutProfile = {
  fontSizeScaleVersion: FONT_SIZE_SCALE_VERSION,
  style: { ...DEFAULT_STYLE },
  subtitleFontSizeRel: pxToRelativeFontSize(
    DEFAULT_STYLE.fontSize,
    resolveOutputHeightByLayout('portrait', '1080p'),
    MIN_SUBTITLE_FONT_SIZE_REL,
    MAX_SUBTITLE_FONT_SIZE_REL,
    21
  ),
  renderResolution: '1080p',
  renderContainer: 'mp4',
  blackoutTop: 0.9,
  coverMode: 'blackout_bottom',
  coverQuad: normalizeQuad(),
  coverFeatherPx: DEFAULT_COVER_FEATHER_PX,
  coverFeatherHorizontalPx: DEFAULT_COVER_FEATHER_PX,
  coverFeatherVerticalPx: DEFAULT_COVER_FEATHER_PX,
  coverFeatherHorizontalPercent: DEFAULT_COVER_FEATHER_PERCENT,
  coverFeatherVerticalPercent: DEFAULT_COVER_FEATHER_PERCENT,
  foregroundCropPercent: 0,
  subtitlePosition: null,
  thumbnailFrameTimeSec: null,
  thumbnailDurationSec: 0.5,
  thumbnailTextSecondary: '',
  logoPath: undefined,
  logoPosition: undefined,
  logoScale: 1.0,
  thumbnailFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('portrait', '1080p'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  thumbnailTextPrimaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailTextPrimaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailTextPrimaryFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('portrait', '1080p'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  thumbnailTextPrimaryColor: DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR,
  thumbnailTextSecondaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailTextSecondaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailTextSecondaryFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('portrait', '1080p'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  thumbnailTextSecondaryColor: DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR,
  thumbnailLineHeightRatio: DEFAULT_THUMBNAIL_LINE_HEIGHT_RATIO,
  thumbnailTextPrimaryPosition: { x: 0.5, y: 0.5 },
  thumbnailTextSecondaryPosition: { x: 0.5, y: 0.64 },
  portraitTextPrimaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  portraitTextPrimaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  portraitTextPrimaryFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('portrait', '1080p'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  portraitTextPrimaryColor: DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR,
  portraitTextSecondaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  portraitTextSecondaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  portraitTextSecondaryFontSizeRel: pxToRelativeFontSize(
    DEFAULT_THUMBNAIL_FONT_SIZE,
    resolveOutputHeightByLayout('portrait', '1080p'),
    MIN_THUMBNAIL_FONT_SIZE_REL,
    MAX_THUMBNAIL_FONT_SIZE_REL,
    48
  ),
  portraitTextSecondaryColor: DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR,
  portraitTextPrimaryPosition: { x: 0.5, y: 0.5 },
  portraitTextSecondaryPosition: { x: 0.5, y: 0.64 },
};

function cloneProfile(profile: LayoutProfile): LayoutProfile {
  return {
    ...profile,
    style: { ...profile.style },
    subtitlePosition: profile.subtitlePosition ? { ...profile.subtitlePosition } : null,
    coverQuad: normalizeQuad(profile.coverQuad),
    logoPosition: profile.logoPosition ? { ...profile.logoPosition } : undefined,
    thumbnailTextPrimaryPosition: { ...profile.thumbnailTextPrimaryPosition },
    thumbnailTextSecondaryPosition: { ...profile.thumbnailTextSecondaryPosition },
    portraitTextPrimaryPosition: { ...profile.portraitTextPrimaryPosition },
    portraitTextSecondaryPosition: { ...profile.portraitTextSecondaryPosition },
  };
}

function normalizeProfile(
  patch: Record<string, unknown> | undefined,
  fallback: LayoutProfile,
  layoutKey: LayoutKey
): LayoutProfile {
  const next = cloneProfile(fallback);
  if (!patch || typeof patch !== 'object') {
    const outputHeight = resolveOutputHeightByLayout(layoutKey, next.renderResolution);
    const portraitOutputHeight = resolveOutputHeightByLayout('portrait', '1080p');
    next.subtitleFontSizeRel = clamp(
      Number.isFinite(next.subtitleFontSizeRel)
        ? next.subtitleFontSizeRel
        : pxToRelativeFontSize(
            next.style.fontSize,
            outputHeight,
            MIN_SUBTITLE_FONT_SIZE_REL,
            MAX_SUBTITLE_FONT_SIZE_REL,
            fallback.subtitleFontSizeRel
          ),
      MIN_SUBTITLE_FONT_SIZE_REL,
      MAX_SUBTITLE_FONT_SIZE_REL
    );
    next.thumbnailTextPrimaryFontSizeRel = clamp(
      Number.isFinite(next.thumbnailTextPrimaryFontSizeRel)
        ? next.thumbnailTextPrimaryFontSizeRel
        : pxToRelativeFontSize(
            next.thumbnailTextPrimaryFontSize,
            outputHeight,
            MIN_THUMBNAIL_FONT_SIZE_REL,
            MAX_THUMBNAIL_FONT_SIZE_REL,
            fallback.thumbnailTextPrimaryFontSizeRel
          ),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    next.thumbnailTextSecondaryFontSizeRel = clamp(
      Number.isFinite(next.thumbnailTextSecondaryFontSizeRel)
        ? next.thumbnailTextSecondaryFontSizeRel
        : pxToRelativeFontSize(
            next.thumbnailTextSecondaryFontSize,
            outputHeight,
            MIN_THUMBNAIL_FONT_SIZE_REL,
            MAX_THUMBNAIL_FONT_SIZE_REL,
            fallback.thumbnailTextSecondaryFontSizeRel
          ),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    next.portraitTextPrimaryFontSizeRel = clamp(
      Number.isFinite(next.portraitTextPrimaryFontSizeRel)
        ? next.portraitTextPrimaryFontSizeRel
        : pxToRelativeFontSize(
            next.portraitTextPrimaryFontSize,
            portraitOutputHeight,
            MIN_THUMBNAIL_FONT_SIZE_REL,
            MAX_THUMBNAIL_FONT_SIZE_REL,
            fallback.portraitTextPrimaryFontSizeRel
          ),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    next.portraitTextSecondaryFontSizeRel = clamp(
      Number.isFinite(next.portraitTextSecondaryFontSizeRel)
        ? next.portraitTextSecondaryFontSizeRel
        : pxToRelativeFontSize(
            next.portraitTextSecondaryFontSize,
            portraitOutputHeight,
            MIN_THUMBNAIL_FONT_SIZE_REL,
            MAX_THUMBNAIL_FONT_SIZE_REL,
            fallback.portraitTextSecondaryFontSizeRel
          ),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    next.style = normalizeAssStyle(
      {
        ...next.style,
        fontSize: relativeToPxFontSize(
          next.subtitleFontSizeRel,
          outputHeight,
          MIN_SUBTITLE_FONT_SIZE,
          MAX_SUBTITLE_FONT_SIZE,
          next.style.fontSize
        ),
      },
      fallback.style
    );
    next.thumbnailTextPrimaryFontSize = relativeToPxFontSize(
      next.thumbnailTextPrimaryFontSizeRel,
      outputHeight,
      MIN_THUMBNAIL_FONT_SIZE,
      MAX_THUMBNAIL_FONT_SIZE,
      next.thumbnailTextPrimaryFontSize
    );
    next.thumbnailTextSecondaryFontSize = relativeToPxFontSize(
      next.thumbnailTextSecondaryFontSizeRel,
      outputHeight,
      MIN_THUMBNAIL_FONT_SIZE,
      MAX_THUMBNAIL_FONT_SIZE,
      next.thumbnailTextSecondaryFontSize
    );
    next.portraitTextPrimaryFontSize = relativeToPxFontSize(
      next.portraitTextPrimaryFontSizeRel,
      portraitOutputHeight,
      MIN_THUMBNAIL_FONT_SIZE,
      MAX_THUMBNAIL_FONT_SIZE,
      next.portraitTextPrimaryFontSize
    );
    next.portraitTextSecondaryFontSize = relativeToPxFontSize(
      next.portraitTextSecondaryFontSizeRel,
      portraitOutputHeight,
      MIN_THUMBNAIL_FONT_SIZE,
      MAX_THUMBNAIL_FONT_SIZE,
      next.portraitTextSecondaryFontSize
    );
    next.thumbnailFontSize = next.thumbnailTextPrimaryFontSize;
    next.thumbnailFontSizeRel = next.thumbnailTextPrimaryFontSizeRel;
    next.fontSizeScaleVersion = FONT_SIZE_SCALE_VERSION;
    return next;
  }

  if (patch.renderResolution && typeof patch.renderResolution === 'string') {
    const requested = patch.renderResolution as RenderResolution;
    next.renderResolution = layoutKey === 'portrait' && requested === 'original'
      ? '1080p'
      : requested;
  }
  const outputSize = resolveOutputSizeByLayout(layoutKey, next.renderResolution);
  const outputHeight = outputSize.height;
  const portraitOutputSize = resolveOutputSizeByLayout('portrait', '1080p');
  const portraitOutputHeight = portraitOutputSize.height;

  const style = patch.style as ASSStyleConfig | undefined;
  if (style && typeof style === 'object') {
    next.style = normalizeAssStyle({ ...next.style, ...style }, fallback.style);
  }

  let subtitleFontSizeRel = Number.isFinite(next.subtitleFontSizeRel)
    ? clamp(next.subtitleFontSizeRel, MIN_SUBTITLE_FONT_SIZE_REL, MAX_SUBTITLE_FONT_SIZE_REL)
    : pxToRelativeFontSize(
        next.style.fontSize,
        outputHeight,
        MIN_SUBTITLE_FONT_SIZE_REL,
        MAX_SUBTITLE_FONT_SIZE_REL,
        fallback.subtitleFontSizeRel
      );
  if (style && Number.isFinite(style.fontSize)) {
    subtitleFontSizeRel = pxToRelativeFontSize(
      style.fontSize,
      outputHeight,
      MIN_SUBTITLE_FONT_SIZE_REL,
      MAX_SUBTITLE_FONT_SIZE_REL,
      subtitleFontSizeRel
    );
  }
  if (typeof patch.subtitleFontSizeRel === 'number' && Number.isFinite(patch.subtitleFontSizeRel)) {
    subtitleFontSizeRel = clamp(
      Math.round(patch.subtitleFontSizeRel),
      MIN_SUBTITLE_FONT_SIZE_REL,
      MAX_SUBTITLE_FONT_SIZE_REL
    );
  }
  next.subtitleFontSizeRel = subtitleFontSizeRel;
  next.style = normalizeAssStyle(
    {
      ...next.style,
      fontSize: relativeToPxFontSize(
        subtitleFontSizeRel,
        outputHeight,
        MIN_SUBTITLE_FONT_SIZE,
        MAX_SUBTITLE_FONT_SIZE,
        next.style.fontSize
      ),
    },
    fallback.style
  );

  if (patch.renderContainer === 'mp4' || patch.renderContainer === 'mov') {
    next.renderContainer = patch.renderContainer;
  }
  if (patch.blackoutTop === null || typeof patch.blackoutTop === 'number') {
    next.blackoutTop = patch.blackoutTop as number | null;
  }
  if (patch.coverMode === 'blackout_bottom' || patch.coverMode === 'copy_from_above') {
    next.coverMode = patch.coverMode as CaptionCoverMode;
  }
  if (patch.coverQuad && typeof patch.coverQuad === 'object') {
    const normalized = normalizeQuad(patch.coverQuad as Partial<CoverQuad>);
    next.coverQuad = isConvexQuad(normalized) ? normalized : normalizeQuad(fallback.coverQuad);
  }
  const legacyCoverFeatherPx = typeof patch.coverFeatherPx === 'number' && Number.isFinite(patch.coverFeatherPx)
    ? normalizeCoverFeatherPxValue(patch.coverFeatherPx, DEFAULT_COVER_FEATHER_PX)
    : null;
  const hasLegacyPxPatch = legacyCoverFeatherPx != null;
  const hasHorizontalPxPatch = typeof patch.coverFeatherHorizontalPx === 'number' && Number.isFinite(patch.coverFeatherHorizontalPx);
  const hasVerticalPxPatch = typeof patch.coverFeatherVerticalPx === 'number' && Number.isFinite(patch.coverFeatherVerticalPx);
  if (legacyCoverFeatherPx != null) {
    next.coverFeatherPx = legacyCoverFeatherPx;
    next.coverFeatherHorizontalPx = legacyCoverFeatherPx;
    next.coverFeatherVerticalPx = legacyCoverFeatherPx;
  }
  if (hasHorizontalPxPatch) {
    next.coverFeatherHorizontalPx = normalizeCoverFeatherPxValue(
      patch.coverFeatherHorizontalPx as number,
      next.coverFeatherHorizontalPx
    );
  }
  if (hasVerticalPxPatch) {
    next.coverFeatherVerticalPx = normalizeCoverFeatherPxValue(
      patch.coverFeatherVerticalPx as number,
      next.coverFeatherVerticalPx
    );
  }
  const hasHorizontalPercentPatch =
    typeof patch.coverFeatherHorizontalPercent === 'number' && Number.isFinite(patch.coverFeatherHorizontalPercent);
  const hasVerticalPercentPatch =
    typeof patch.coverFeatherVerticalPercent === 'number' && Number.isFinite(patch.coverFeatherVerticalPercent);
  if (hasHorizontalPercentPatch) {
    next.coverFeatherHorizontalPercent = normalizeCoverFeatherPercentValue(
      patch.coverFeatherHorizontalPercent as number,
      next.coverFeatherHorizontalPercent
    );
  } else if (hasHorizontalPxPatch || hasLegacyPxPatch) {
    next.coverFeatherHorizontalPercent = coverFeatherPxToPercent(next.coverFeatherHorizontalPx);
  }
  if (hasVerticalPercentPatch) {
    next.coverFeatherVerticalPercent = normalizeCoverFeatherPercentValue(
      patch.coverFeatherVerticalPercent as number,
      next.coverFeatherVerticalPercent
    );
  } else if (hasVerticalPxPatch || hasLegacyPxPatch) {
    next.coverFeatherVerticalPercent = coverFeatherPxToPercent(next.coverFeatherVerticalPx);
  }
  if (hasHorizontalPercentPatch || hasVerticalPercentPatch) {
    next.coverFeatherHorizontalPx = coverFeatherPercentToPx(next.coverFeatherHorizontalPercent);
    next.coverFeatherVerticalPx = coverFeatherPercentToPx(next.coverFeatherVerticalPercent);
    next.coverFeatherPx = Math.round((next.coverFeatherHorizontalPx + next.coverFeatherVerticalPx) / 2);
  } else {
    next.coverFeatherPx = Math.round((next.coverFeatherHorizontalPx + next.coverFeatherVerticalPx) / 2);
  }
  if (typeof patch.foregroundCropPercent === 'number') {
    next.foregroundCropPercent = Math.min(20, Math.max(0, patch.foregroundCropPercent));
  }
  if (patch.subtitlePosition === null) {
    next.subtitlePosition = null;
  } else if (patch.subtitlePosition && typeof patch.subtitlePosition === 'object') {
    const p = patch.subtitlePosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.subtitlePosition = normalizePositionValue(
        { x: p.x, y: p.y },
        outputSize.width,
        outputSize.height
      );
    }
  }
  if (patch.thumbnailFrameTimeSec === null || typeof patch.thumbnailFrameTimeSec === 'number') {
    next.thumbnailFrameTimeSec = patch.thumbnailFrameTimeSec as number | null;
  }
  if (typeof patch.thumbnailDurationSec === 'number' && Number.isFinite(patch.thumbnailDurationSec)) {
    next.thumbnailDurationSec = Math.min(10, Math.max(0.1, patch.thumbnailDurationSec));
  }
  if (typeof patch.thumbnailTextSecondary === 'string') {
    next.thumbnailTextSecondary = patch.thumbnailTextSecondary;
  }
  if (typeof patch.logoPath === 'string' && patch.logoPath.trim().length > 0) {
    next.logoPath = patch.logoPath;
  } else if (patch.logoPath === null || patch.logoPath === undefined) {
    next.logoPath = undefined;
  }
  if (patch.logoPosition === null) {
    next.logoPosition = undefined;
  } else if (patch.logoPosition && typeof patch.logoPosition === 'object') {
    const p = patch.logoPosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.logoPosition = normalizePositionValue(
        { x: p.x, y: p.y },
        outputSize.width,
        outputSize.height
      );
    }
  }
  if (typeof patch.logoScale === 'number') {
    next.logoScale = patch.logoScale;
  }

  const legacyFontName = typeof patch.thumbnailFontName === 'string' && patch.thumbnailFontName.trim().length > 0
    ? patch.thumbnailFontName.trim()
    : null;
  const legacyFontSize = typeof patch.thumbnailFontSize === 'number' && Number.isFinite(patch.thumbnailFontSize)
    ? Math.min(MAX_THUMBNAIL_FONT_SIZE, Math.max(MIN_THUMBNAIL_FONT_SIZE, Math.round(patch.thumbnailFontSize)))
    : null;
  let thumbnailTextPrimaryFontSizeRel = Number.isFinite(next.thumbnailTextPrimaryFontSizeRel)
    ? clamp(next.thumbnailTextPrimaryFontSizeRel, MIN_THUMBNAIL_FONT_SIZE_REL, MAX_THUMBNAIL_FONT_SIZE_REL)
    : pxToRelativeFontSize(
        next.thumbnailTextPrimaryFontSize,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE_REL,
        MAX_THUMBNAIL_FONT_SIZE_REL,
        fallback.thumbnailTextPrimaryFontSizeRel
      );
  let thumbnailTextSecondaryFontSizeRel = Number.isFinite(next.thumbnailTextSecondaryFontSizeRel)
    ? clamp(next.thumbnailTextSecondaryFontSizeRel, MIN_THUMBNAIL_FONT_SIZE_REL, MAX_THUMBNAIL_FONT_SIZE_REL)
    : pxToRelativeFontSize(
        next.thumbnailTextSecondaryFontSize,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE_REL,
        MAX_THUMBNAIL_FONT_SIZE_REL,
        fallback.thumbnailTextSecondaryFontSizeRel
      );
  let portraitTextPrimaryFontSizeRel = Number.isFinite(next.portraitTextPrimaryFontSizeRel)
    ? clamp(next.portraitTextPrimaryFontSizeRel, MIN_THUMBNAIL_FONT_SIZE_REL, MAX_THUMBNAIL_FONT_SIZE_REL)
    : pxToRelativeFontSize(
        next.portraitTextPrimaryFontSize,
        portraitOutputHeight,
        MIN_THUMBNAIL_FONT_SIZE_REL,
        MAX_THUMBNAIL_FONT_SIZE_REL,
        fallback.portraitTextPrimaryFontSizeRel
      );
  let portraitTextSecondaryFontSizeRel = Number.isFinite(next.portraitTextSecondaryFontSizeRel)
    ? clamp(next.portraitTextSecondaryFontSizeRel, MIN_THUMBNAIL_FONT_SIZE_REL, MAX_THUMBNAIL_FONT_SIZE_REL)
    : pxToRelativeFontSize(
        next.portraitTextSecondaryFontSize,
        portraitOutputHeight,
        MIN_THUMBNAIL_FONT_SIZE_REL,
        MAX_THUMBNAIL_FONT_SIZE_REL,
        fallback.portraitTextSecondaryFontSizeRel
      );
  if (legacyFontName) {
    next.thumbnailFontName = legacyFontName;
    next.thumbnailTextPrimaryFontName = legacyFontName;
    next.thumbnailTextSecondaryFontName = legacyFontName;
  }
  if (legacyFontSize != null) {
    const legacyRel = pxToRelativeFontSize(
      legacyFontSize,
      outputHeight,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL,
      thumbnailTextPrimaryFontSizeRel
    );
    thumbnailTextPrimaryFontSizeRel = legacyRel;
    thumbnailTextSecondaryFontSizeRel = legacyRel;
  }
  if (typeof patch.thumbnailFontSizeRel === 'number' && Number.isFinite(patch.thumbnailFontSizeRel)) {
    const legacyRel = clamp(
      Math.round(patch.thumbnailFontSizeRel),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    thumbnailTextPrimaryFontSizeRel = legacyRel;
    thumbnailTextSecondaryFontSizeRel = legacyRel;
  }
  if (typeof patch.thumbnailTextPrimaryFontName === 'string' && patch.thumbnailTextPrimaryFontName.trim().length > 0) {
    next.thumbnailTextPrimaryFontName = patch.thumbnailTextPrimaryFontName.trim();
  }
  if (typeof patch.thumbnailTextPrimaryFontSize === 'number' && Number.isFinite(patch.thumbnailTextPrimaryFontSize)) {
    thumbnailTextPrimaryFontSizeRel = pxToRelativeFontSize(
      patch.thumbnailTextPrimaryFontSize,
      outputHeight,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL,
      thumbnailTextPrimaryFontSizeRel
    );
  }
  if (typeof patch.thumbnailTextPrimaryFontSizeRel === 'number' && Number.isFinite(patch.thumbnailTextPrimaryFontSizeRel)) {
    thumbnailTextPrimaryFontSizeRel = clamp(
      Math.round(patch.thumbnailTextPrimaryFontSizeRel),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
  }
  next.thumbnailTextPrimaryColor = normalizeHexColor(
    patch.thumbnailTextPrimaryColor,
    fallback.thumbnailTextPrimaryColor
  );
  if (typeof patch.thumbnailTextSecondaryFontName === 'string' && patch.thumbnailTextSecondaryFontName.trim().length > 0) {
    next.thumbnailTextSecondaryFontName = patch.thumbnailTextSecondaryFontName.trim();
  }
  if (typeof patch.thumbnailTextSecondaryFontSize === 'number' && Number.isFinite(patch.thumbnailTextSecondaryFontSize)) {
    thumbnailTextSecondaryFontSizeRel = pxToRelativeFontSize(
      patch.thumbnailTextSecondaryFontSize,
      outputHeight,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL,
      thumbnailTextSecondaryFontSizeRel
    );
  }
  if (typeof patch.thumbnailTextSecondaryFontSizeRel === 'number' && Number.isFinite(patch.thumbnailTextSecondaryFontSizeRel)) {
    thumbnailTextSecondaryFontSizeRel = clamp(
      Math.round(patch.thumbnailTextSecondaryFontSizeRel),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
  }
  next.thumbnailTextSecondaryColor = normalizeHexColor(
    patch.thumbnailTextSecondaryColor,
    fallback.thumbnailTextSecondaryColor
  );
  if (typeof patch.thumbnailLineHeightRatio === 'number' && Number.isFinite(patch.thumbnailLineHeightRatio)) {
    next.thumbnailLineHeightRatio = Math.min(
      MAX_THUMBNAIL_LINE_HEIGHT_RATIO,
      Math.max(MIN_THUMBNAIL_LINE_HEIGHT_RATIO, patch.thumbnailLineHeightRatio)
    );
  }
  if (patch.thumbnailTextPrimaryPosition && typeof patch.thumbnailTextPrimaryPosition === 'object') {
    const p = patch.thumbnailTextPrimaryPosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.thumbnailTextPrimaryPosition = normalizePositionValue(
        { x: p.x, y: p.y },
        outputSize.width,
        outputSize.height
      );
    }
  }
  if (patch.thumbnailTextSecondaryPosition && typeof patch.thumbnailTextSecondaryPosition === 'object') {
    const p = patch.thumbnailTextSecondaryPosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.thumbnailTextSecondaryPosition = normalizePositionValue(
        { x: p.x, y: p.y },
        outputSize.width,
        outputSize.height
      );
    }
  }
  const hasPortraitTextPrimaryFontNamePatch =
    typeof patch.portraitTextPrimaryFontName === 'string' && patch.portraitTextPrimaryFontName.trim().length > 0;
  const hasPortraitTextPrimaryFontSizePatch =
    typeof patch.portraitTextPrimaryFontSize === 'number' && Number.isFinite(patch.portraitTextPrimaryFontSize);
  const hasPortraitTextPrimaryFontSizeRelPatch =
    typeof patch.portraitTextPrimaryFontSizeRel === 'number' && Number.isFinite(patch.portraitTextPrimaryFontSizeRel);
  if (hasPortraitTextPrimaryFontNamePatch) {
    next.portraitTextPrimaryFontName = (patch.portraitTextPrimaryFontName as string).trim();
  }
  if (hasPortraitTextPrimaryFontSizePatch) {
    portraitTextPrimaryFontSizeRel = pxToRelativeFontSize(
      patch.portraitTextPrimaryFontSize as number,
      portraitOutputHeight,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL,
      portraitTextPrimaryFontSizeRel
    );
  }
  if (hasPortraitTextPrimaryFontSizeRelPatch) {
    portraitTextPrimaryFontSizeRel = clamp(
      Math.round(patch.portraitTextPrimaryFontSizeRel as number),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
  }
  if (typeof patch.portraitTextPrimaryColor === 'string') {
    next.portraitTextPrimaryColor = normalizeHexColor(
      patch.portraitTextPrimaryColor,
      next.portraitTextPrimaryColor
    );
  }

  const hasPortraitTextSecondaryFontNamePatch =
    typeof patch.portraitTextSecondaryFontName === 'string' && patch.portraitTextSecondaryFontName.trim().length > 0;
  const hasPortraitTextSecondaryFontSizePatch =
    typeof patch.portraitTextSecondaryFontSize === 'number' && Number.isFinite(patch.portraitTextSecondaryFontSize);
  const hasPortraitTextSecondaryFontSizeRelPatch =
    typeof patch.portraitTextSecondaryFontSizeRel === 'number' && Number.isFinite(patch.portraitTextSecondaryFontSizeRel);
  if (hasPortraitTextSecondaryFontNamePatch) {
    next.portraitTextSecondaryFontName = (patch.portraitTextSecondaryFontName as string).trim();
  }
  if (hasPortraitTextSecondaryFontSizePatch) {
    portraitTextSecondaryFontSizeRel = pxToRelativeFontSize(
      patch.portraitTextSecondaryFontSize as number,
      portraitOutputHeight,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL,
      portraitTextSecondaryFontSizeRel
    );
  }
  if (hasPortraitTextSecondaryFontSizeRelPatch) {
    portraitTextSecondaryFontSizeRel = clamp(
      Math.round(patch.portraitTextSecondaryFontSizeRel as number),
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
  }
  if (typeof patch.portraitTextSecondaryColor === 'string') {
    next.portraitTextSecondaryColor = normalizeHexColor(
      patch.portraitTextSecondaryColor,
      next.portraitTextSecondaryColor
    );
  }

  const hasPortraitTextPrimaryPositionPatch =
    !!patch.portraitTextPrimaryPosition && typeof patch.portraitTextPrimaryPosition === 'object';
  if (hasPortraitTextPrimaryPositionPatch) {
    const p = patch.portraitTextPrimaryPosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.portraitTextPrimaryPosition = normalizePositionValue(
        { x: p.x, y: p.y },
        portraitOutputSize.width,
        portraitOutputSize.height
      );
    }
  }
  const hasPortraitTextSecondaryPositionPatch =
    !!patch.portraitTextSecondaryPosition && typeof patch.portraitTextSecondaryPosition === 'object';
  if (hasPortraitTextSecondaryPositionPatch) {
    const p = patch.portraitTextSecondaryPosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.portraitTextSecondaryPosition = normalizePositionValue(
        { x: p.x, y: p.y },
        portraitOutputSize.width,
        portraitOutputSize.height
      );
    }
  }
  if (!hasPortraitTextPrimaryFontNamePatch) {
    next.portraitTextPrimaryFontName = next.thumbnailTextPrimaryFontName;
  }
  if (!hasPortraitTextSecondaryFontNamePatch) {
    next.portraitTextSecondaryFontName = next.thumbnailTextSecondaryFontName;
  }
  if (!hasPortraitTextPrimaryFontSizePatch && !hasPortraitTextPrimaryFontSizeRelPatch) {
    portraitTextPrimaryFontSizeRel = thumbnailTextPrimaryFontSizeRel;
  }
  if (!hasPortraitTextSecondaryFontSizePatch && !hasPortraitTextSecondaryFontSizeRelPatch) {
    portraitTextSecondaryFontSizeRel = thumbnailTextSecondaryFontSizeRel;
  }
  if (typeof patch.portraitTextPrimaryColor !== 'string') {
    next.portraitTextPrimaryColor = next.thumbnailTextPrimaryColor;
  }
  if (typeof patch.portraitTextSecondaryColor !== 'string') {
    next.portraitTextSecondaryColor = next.thumbnailTextSecondaryColor;
  }
  if (!hasPortraitTextPrimaryPositionPatch) {
    next.portraitTextPrimaryPosition = { ...next.thumbnailTextPrimaryPosition };
  }
  if (!hasPortraitTextSecondaryPositionPatch) {
    next.portraitTextSecondaryPosition = { ...next.thumbnailTextSecondaryPosition };
  }

  next.thumbnailTextPrimaryFontSizeRel = thumbnailTextPrimaryFontSizeRel;
  next.thumbnailTextSecondaryFontSizeRel = thumbnailTextSecondaryFontSizeRel;
  next.thumbnailTextPrimaryFontSize = relativeToPxFontSize(
    thumbnailTextPrimaryFontSizeRel,
    outputHeight,
    MIN_THUMBNAIL_FONT_SIZE,
    MAX_THUMBNAIL_FONT_SIZE,
    next.thumbnailTextPrimaryFontSize
  );
  next.thumbnailTextSecondaryFontSize = relativeToPxFontSize(
    thumbnailTextSecondaryFontSizeRel,
    outputHeight,
    MIN_THUMBNAIL_FONT_SIZE,
    MAX_THUMBNAIL_FONT_SIZE,
    next.thumbnailTextSecondaryFontSize
  );
  next.portraitTextPrimaryFontSizeRel = portraitTextPrimaryFontSizeRel;
  next.portraitTextSecondaryFontSizeRel = portraitTextSecondaryFontSizeRel;
  next.portraitTextPrimaryFontSize = relativeToPxFontSize(
    portraitTextPrimaryFontSizeRel,
    portraitOutputHeight,
    MIN_THUMBNAIL_FONT_SIZE,
    MAX_THUMBNAIL_FONT_SIZE,
    next.portraitTextPrimaryFontSize
  );
  next.portraitTextSecondaryFontSize = relativeToPxFontSize(
    portraitTextSecondaryFontSizeRel,
    portraitOutputHeight,
    MIN_THUMBNAIL_FONT_SIZE,
    MAX_THUMBNAIL_FONT_SIZE,
    next.portraitTextSecondaryFontSize
  );
  next.fontSizeScaleVersion = FONT_SIZE_SCALE_VERSION;
  next.thumbnailFontName = next.thumbnailTextPrimaryFontName;
  next.thumbnailFontSize = next.thumbnailTextPrimaryFontSize;
  next.thumbnailFontSizeRel = next.thumbnailTextPrimaryFontSizeRel;
  next.style = normalizeAssStyle(next.style, fallback.style);
  return next;
}

function resolveLayoutKey(renderMode: RenderMode): LayoutKey {
  return renderMode === 'hardsub_portrait_9_16' ? 'portrait' : 'landscape';
}

function createDefaultLayoutProfiles(): LayoutProfilesState {
  return {
    landscape: cloneProfile(DEFAULT_LANDSCAPE_PROFILE),
    portrait: cloneProfile(DEFAULT_PORTRAIT_PROFILE),
  };
}

function toTypographyLayoutDefaults(profile: LayoutProfile): CaptionTypographyLayoutDefaults {
  return {
    fontSizeScaleVersion: profile.fontSizeScaleVersion,
    style: { ...profile.style },
    subtitleFontSizeRel: profile.subtitleFontSizeRel,
    subtitlePosition: profile.subtitlePosition ? { ...profile.subtitlePosition } : null,
    thumbnailTextPrimaryFontName: profile.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: profile.thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryFontSizeRel: profile.thumbnailTextPrimaryFontSizeRel,
    thumbnailTextPrimaryColor: profile.thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName: profile.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: profile.thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryFontSizeRel: profile.thumbnailTextSecondaryFontSizeRel,
    thumbnailTextSecondaryColor: profile.thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio: profile.thumbnailLineHeightRatio,
    thumbnailTextPrimaryPosition: { ...profile.thumbnailTextPrimaryPosition },
    thumbnailTextSecondaryPosition: { ...profile.thumbnailTextSecondaryPosition },
    portraitTextPrimaryFontName: profile.portraitTextPrimaryFontName,
    portraitTextPrimaryFontSize: profile.portraitTextPrimaryFontSize,
    portraitTextPrimaryFontSizeRel: profile.portraitTextPrimaryFontSizeRel,
    portraitTextPrimaryColor: profile.portraitTextPrimaryColor,
    portraitTextSecondaryFontName: profile.portraitTextSecondaryFontName,
    portraitTextSecondaryFontSize: profile.portraitTextSecondaryFontSize,
    portraitTextSecondaryFontSizeRel: profile.portraitTextSecondaryFontSizeRel,
    portraitTextSecondaryColor: profile.portraitTextSecondaryColor,
    portraitTextPrimaryPosition: { ...profile.portraitTextPrimaryPosition },
    portraitTextSecondaryPosition: { ...profile.portraitTextSecondaryPosition },
  };
}

function buildTypographyDefaults(layoutProfiles: LayoutProfilesState): CaptionTypographyDefaults {
  return {
    schemaVersion: 1,
    landscape: toTypographyLayoutDefaults(layoutProfiles.landscape),
    portrait: toTypographyLayoutDefaults(layoutProfiles.portrait),
  };
}

function typographyDefaultsFingerprint(value: CaptionTypographyDefaults): string {
  return JSON.stringify(value);
}

function buildGlobalFallbackProfiles(rawDefaults: unknown): LayoutProfilesState {
  const defaults = createDefaultLayoutProfiles();
  if (!rawDefaults || typeof rawDefaults !== 'object') {
    return defaults;
  }
  const typed = rawDefaults as Partial<CaptionTypographyDefaults>;
  if (typed.schemaVersion !== 1) {
    return defaults;
  }

  return {
    landscape: normalizeProfile(
      typed.landscape as unknown as Record<string, unknown> | undefined,
      defaults.landscape,
      'landscape'
    ),
    portrait: normalizeProfile(
      typed.portrait as unknown as Record<string, unknown> | undefined,
      defaults.portrait,
      'portrait'
    ),
  };
}

export function useCaptionSettings() {
  const { projectId, paths } = useProjectContext();

  const [inputType, setInputType] = useState<InputType>(DEFAULT_INPUT_TYPE);
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [voice, setVoiceState] = useState(DEFAULT_VOICE);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [srtSpeed, setSrtSpeed] = useState(DEFAULT_SRT_SPEED);
  const [edgeTtsBatchSize, setEdgeTtsBatchSizeState] = useState(DEFAULT_EDGE_TTS_BATCH_SIZE);

  const setEdgeTtsBatchSize = useCallback((value: number) => {
    if (!Number.isFinite(value)) {
      setEdgeTtsBatchSizeState(DEFAULT_EDGE_TTS_BATCH_SIZE);
      return;
    }
    const rounded = Math.round(value);
    if (rounded < MIN_EDGE_TTS_BATCH_SIZE) {
      setEdgeTtsBatchSizeState(DEFAULT_EDGE_TTS_BATCH_SIZE);
      return;
    }
    const normalized = clamp(rounded, MIN_EDGE_TTS_BATCH_SIZE, MAX_EDGE_TTS_BATCH_SIZE);
    setEdgeTtsBatchSizeState(normalized);
  }, []);

  const [splitByLines, setSplitByLines] = useState(DEFAULT_SPLIT_BY_LINES);
  const [linesPerFile, setLinesPerFile] = useState(DEFAULT_LINES_PER_FILE);
  const [numberOfParts, setNumberOfParts] = useState(DEFAULT_NUMBER_OF_PARTS);

  const [audioDir, setAudioDir] = useState('');
  const [autoFitAudio, setAutoFitAudio] = useState(false);

  const [hardwareAcceleration, setHardwareAcceleration] = useState<'none' | 'qsv' | 'nvenc'>('qsv');
  const [renderMode, setRenderMode] = useState<RenderMode>('hardsub');
  const [audioSpeed, setAudioSpeed] = useState<number>(1.0);
  const [renderAudioSpeed, setRenderAudioSpeed] = useState<number>(1.0);
  const [videoVolume, setVideoVolumeState] = useState<number>(100);
  const [audioVolume, setAudioVolumeState] = useState<number>(100);

  const [layoutProfiles, setLayoutProfiles] = useState<LayoutProfilesState>(createDefaultLayoutProfiles);

  const [enabledSteps, setEnabledSteps] = useState<Set<Step>>(new Set([1, 2, 3, 4, 5, 6, 7]));
  const [translateMethod, setTranslateMethod] = useState<'api' | 'impit' | 'gemini_webapi_queue'>('api');
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('folder-first');

  const [settingsRevision, setSettingsRevision] = useState<number>(0);
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState<string>(nowIso());

  const loadedRef = useRef(false);
  const isHydratingRef = useRef(false);
  const typographyDefaultsDirtyRef = useRef(false);
  const [typographyDefaultsDirtyTick, setTypographyDefaultsDirtyTick] = useState(0);
  const lastSavedGlobalTypographyFingerprintRef = useRef('');
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef(0);

  useEffect(() => {
    saveQueueRef.current = Promise.resolve();
    revisionRef.current = 0;
    typographyDefaultsDirtyRef.current = false;
    setTypographyDefaultsDirtyTick(0);
  }, [projectId]);

  const activeLayoutKey = resolveLayoutKey(renderMode);
  const activeProfile = layoutProfiles[activeLayoutKey];

  const markTypographyDefaultsDirty = useCallback(() => {
    if (isHydratingRef.current) {
      return;
    }
    typographyDefaultsDirtyRef.current = true;
    setTypographyDefaultsDirtyTick((prev) => prev + 1);
  }, []);

  const updateActiveProfile = useCallback(
    (updater: (current: LayoutProfile) => LayoutProfile) => {
      setLayoutProfiles((prev) => ({
        ...prev,
        [activeLayoutKey]: updater(prev[activeLayoutKey]),
      }));
    },
    [activeLayoutKey]
  );
  const updatePortraitProfile = useCallback(
    (updater: (current: LayoutProfile) => LayoutProfile) => {
      setLayoutProfiles((prev) => ({
        ...prev,
        portrait: updater(prev.portrait),
      }));
    },
    []
  );

  const setVideoVolume = useCallback((value: number) => {
    setVideoVolumeState((prev) =>
      clampPercent(value, MIN_VIDEO_VOLUME_PERCENT, MAX_VIDEO_VOLUME_PERCENT, prev)
    );
  }, []);

  const setAudioVolume = useCallback((value: number) => {
    setAudioVolumeState((prev) =>
      clampPercent(value, MIN_TTS_VOLUME_PERCENT, MAX_TTS_VOLUME_PERCENT, prev)
    );
  }, []);

  const setVoice = useCallback((value: string) => {
    setVoiceState(normalizeVoiceValue(value));
  }, []);

  const setStyle = useCallback(
    (value: ASSStyleConfig | ((prev: ASSStyleConfig) => ASSStyleConfig)) => {
      markTypographyDefaultsDirty();
      updateActiveProfile((current) => {
        const outputHeight = resolveOutputHeightByLayout(activeLayoutKey, current.renderResolution);
        const nextStyle = typeof value === 'function'
          ? (value as (prev: ASSStyleConfig) => ASSStyleConfig)(current.style)
          : value;
        const normalizedStyle = normalizeAssStyle(
          { ...nextStyle, fontSize: current.style.fontSize },
          current.style
        );
        return {
          ...current,
          style: {
            ...normalizedStyle,
            fontSize: relativeToPxFontSize(
              current.subtitleFontSizeRel,
              outputHeight,
              MIN_SUBTITLE_FONT_SIZE,
              MAX_SUBTITLE_FONT_SIZE,
              current.style.fontSize
            ),
          },
        };
      });
    },
    [activeLayoutKey, markTypographyDefaultsDirty, updateActiveProfile]
  );

  const setRenderResolution = useCallback((value: RenderResolution) => {
    updateActiveProfile((current) => {
      const requested = activeLayoutKey === 'portrait' && value === 'original'
        ? '1080p'
        : value;
      const outputHeight = resolveOutputHeightByLayout(activeLayoutKey, requested);
      const subtitlePx = relativeToPxFontSize(
        current.subtitleFontSizeRel,
        outputHeight,
        MIN_SUBTITLE_FONT_SIZE,
        MAX_SUBTITLE_FONT_SIZE,
        current.style.fontSize
      );
      const thumbPrimaryPx = relativeToPxFontSize(
        current.thumbnailTextPrimaryFontSizeRel,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE,
        MAX_THUMBNAIL_FONT_SIZE,
        current.thumbnailTextPrimaryFontSize
      );
      const thumbSecondaryPx = relativeToPxFontSize(
        current.thumbnailTextSecondaryFontSizeRel,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE,
        MAX_THUMBNAIL_FONT_SIZE,
        current.thumbnailTextSecondaryFontSize
      );
      const portraitPrimaryPx = activeLayoutKey === 'portrait'
        ? relativeToPxFontSize(
            current.portraitTextPrimaryFontSizeRel,
            outputHeight,
            MIN_THUMBNAIL_FONT_SIZE,
            MAX_THUMBNAIL_FONT_SIZE,
            current.portraitTextPrimaryFontSize
          )
        : current.portraitTextPrimaryFontSize;
      const portraitSecondaryPx = activeLayoutKey === 'portrait'
        ? relativeToPxFontSize(
            current.portraitTextSecondaryFontSizeRel,
            outputHeight,
            MIN_THUMBNAIL_FONT_SIZE,
            MAX_THUMBNAIL_FONT_SIZE,
            current.portraitTextSecondaryFontSize
          )
        : current.portraitTextSecondaryFontSize;
      return {
        ...current,
        renderResolution: requested,
        style: { ...current.style, fontSize: subtitlePx },
        thumbnailTextPrimaryFontSize: thumbPrimaryPx,
        thumbnailTextSecondaryFontSize: thumbSecondaryPx,
        portraitTextPrimaryFontSize: portraitPrimaryPx,
        portraitTextSecondaryFontSize: portraitSecondaryPx,
        thumbnailFontSize: thumbPrimaryPx,
      };
    });
  }, [activeLayoutKey, updateActiveProfile]);

  const setSubtitleFontSizeRel = useCallback((value: number) => {
    const normalizedRel = clamp(
      Number.isFinite(value) ? Math.round(value) : 21,
      MIN_SUBTITLE_FONT_SIZE_REL,
      MAX_SUBTITLE_FONT_SIZE_REL
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => {
      const outputHeight = resolveOutputHeightByLayout(activeLayoutKey, current.renderResolution);
      return {
        ...current,
        subtitleFontSizeRel: normalizedRel,
        style: {
          ...current.style,
          fontSize: relativeToPxFontSize(
            normalizedRel,
            outputHeight,
            MIN_SUBTITLE_FONT_SIZE,
            MAX_SUBTITLE_FONT_SIZE,
            current.style.fontSize
          ),
        },
      };
    });
  }, [activeLayoutKey, markTypographyDefaultsDirty, updateActiveProfile]);

  const setRenderContainer = useCallback((value: 'mp4' | 'mov') => {
    updateActiveProfile((current) => ({ ...current, renderContainer: value }));
  }, [updateActiveProfile]);

  const setBlackoutTop = useCallback((value: number | null) => {
    updateActiveProfile((current) => ({ ...current, blackoutTop: value }));
  }, [updateActiveProfile]);

  const setCoverMode = useCallback((value: CaptionCoverMode) => {
    updateActiveProfile((current) => ({ ...current, coverMode: value }));
  }, [updateActiveProfile]);

  const setCoverQuad = useCallback((value: CoverQuad) => {
    const normalized = normalizeQuad(value);
    if (!isConvexQuad(normalized)) {
      return;
    }
    updateActiveProfile((current) => ({ ...current, coverQuad: normalized }));
  }, [updateActiveProfile]);

  const setCoverFeatherPx = useCallback((value: number) => {
    const normalizedPercent = normalizeCoverFeatherPercentValue(value, DEFAULT_COVER_FEATHER_PERCENT);
    const normalizedPx = coverFeatherPercentToPx(normalizedPercent);
    updateActiveProfile((current) => ({
      ...current,
      coverFeatherPx: normalizedPx,
      coverFeatherHorizontalPx: normalizedPx,
      coverFeatherVerticalPx: normalizedPx,
      coverFeatherHorizontalPercent: normalizedPercent,
      coverFeatherVerticalPercent: normalizedPercent,
    }));
  }, [updateActiveProfile]);

  const setCoverFeatherHorizontalPx = useCallback((value: number) => {
    const normalizedPx = normalizeCoverFeatherPxValue(value, DEFAULT_COVER_FEATHER_PX);
    const normalizedPercent = coverFeatherPxToPercent(normalizedPx);
    updateActiveProfile((current) => ({
      ...current,
      coverFeatherHorizontalPx: normalizedPx,
      coverFeatherHorizontalPercent: normalizedPercent,
      coverFeatherPx: Math.round((normalizedPx + current.coverFeatherVerticalPx) / 2),
    }));
  }, [updateActiveProfile]);

  const setCoverFeatherVerticalPx = useCallback((value: number) => {
    const normalizedPx = normalizeCoverFeatherPxValue(value, DEFAULT_COVER_FEATHER_PX);
    const normalizedPercent = coverFeatherPxToPercent(normalizedPx);
    updateActiveProfile((current) => ({
      ...current,
      coverFeatherVerticalPx: normalizedPx,
      coverFeatherVerticalPercent: normalizedPercent,
      coverFeatherPx: Math.round((current.coverFeatherHorizontalPx + normalizedPx) / 2),
    }));
  }, [updateActiveProfile]);

  const setCoverFeatherHorizontalPercent = useCallback((value: number) => {
    const normalized = normalizeCoverFeatherPercentValue(value, DEFAULT_COVER_FEATHER_PERCENT);
    const horizontalPx = coverFeatherPercentToPx(normalized);
    updateActiveProfile((current) => ({
      ...current,
      coverFeatherHorizontalPercent: normalized,
      coverFeatherHorizontalPx: horizontalPx,
      coverFeatherPx: Math.round((horizontalPx + current.coverFeatherVerticalPx) / 2),
    }));
  }, [updateActiveProfile]);

  const setCoverFeatherVerticalPercent = useCallback((value: number) => {
    const normalized = normalizeCoverFeatherPercentValue(value, DEFAULT_COVER_FEATHER_PERCENT);
    const verticalPx = coverFeatherPercentToPx(normalized);
    updateActiveProfile((current) => ({
      ...current,
      coverFeatherVerticalPercent: normalized,
      coverFeatherVerticalPx: verticalPx,
      coverFeatherPx: Math.round((current.coverFeatherHorizontalPx + verticalPx) / 2),
    }));
  }, [updateActiveProfile]);

  const setForegroundCropPercent = useCallback((value: number) => {
    const normalized = Math.min(20, Math.max(0, Number.isFinite(value) ? value : 0));
    updateActiveProfile((current) => ({ ...current, foregroundCropPercent: normalized }));
  }, [updateActiveProfile]);

  const setPortraitForegroundCropPercent = useCallback((value: number) => {
    const normalized = Math.min(20, Math.max(0, Number.isFinite(value) ? value : 0));
    setLayoutProfiles((prev) => ({
      ...prev,
      portrait: {
        ...prev.portrait,
        foregroundCropPercent: normalized,
      },
    }));
  }, []);

  const setThumbnailTextPrimaryFontName = useCallback((value: string) => {
    const nextValue = value && value.trim().length > 0 ? value.trim() : DEFAULT_THUMBNAIL_FONT_NAME;
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextPrimaryFontName: nextValue,
      thumbnailFontName: nextValue,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextPrimaryFontSize = useCallback((value: number) => {
    const normalizedRel = clamp(
      Number.isFinite(value) ? Math.round(value) : 48,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => {
      const outputHeight = resolveOutputHeightByLayout(activeLayoutKey, current.renderResolution);
      const normalizedPx = relativeToPxFontSize(
        normalizedRel,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE,
        MAX_THUMBNAIL_FONT_SIZE,
        current.thumbnailTextPrimaryFontSize
      );
      return {
        ...current,
        thumbnailTextPrimaryFontSizeRel: normalizedRel,
        thumbnailTextPrimaryFontSize: normalizedPx,
        thumbnailFontSizeRel: normalizedRel,
        thumbnailFontSize: normalizedPx,
      };
    });
  }, [activeLayoutKey, markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextSecondaryFontName = useCallback((value: string) => {
    const nextValue = value && value.trim().length > 0 ? value.trim() : DEFAULT_THUMBNAIL_FONT_NAME;
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextSecondaryFontName: nextValue,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextSecondaryFontSize = useCallback((value: number) => {
    const normalizedRel = clamp(
      Number.isFinite(value) ? Math.round(value) : 48,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => {
      const outputHeight = resolveOutputHeightByLayout(activeLayoutKey, current.renderResolution);
      const normalizedPx = relativeToPxFontSize(
        normalizedRel,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE,
        MAX_THUMBNAIL_FONT_SIZE,
        current.thumbnailTextSecondaryFontSize
      );
      return {
        ...current,
        thumbnailTextSecondaryFontSizeRel: normalizedRel,
        thumbnailTextSecondaryFontSize: normalizedPx,
      };
    });
  }, [activeLayoutKey, markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextPrimaryColor = useCallback((value: string) => {
    const normalized = normalizeHexColor(value, DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR);
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextPrimaryColor: normalized,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextSecondaryColor = useCallback((value: string) => {
    const normalized = normalizeHexColor(value, DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR);
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextSecondaryColor: normalized,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailLineHeightRatio = useCallback((value: number) => {
    const normalized = Math.min(
      MAX_THUMBNAIL_LINE_HEIGHT_RATIO,
      Math.max(MIN_THUMBNAIL_LINE_HEIGHT_RATIO, Number.isFinite(value) ? value : DEFAULT_THUMBNAIL_LINE_HEIGHT_RATIO)
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailLineHeightRatio: normalized,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  // Legacy setters giữ hành vi font chung cho cả 2 text.
  const setThumbnailFontName = useCallback((value: string) => {
    const nextValue = value && value.trim().length > 0 ? value.trim() : DEFAULT_THUMBNAIL_FONT_NAME;
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailFontName: nextValue,
      thumbnailTextPrimaryFontName: nextValue,
      thumbnailTextSecondaryFontName: nextValue,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailFontSize = useCallback((value: number) => {
    const normalizedRel = clamp(
      Number.isFinite(value) ? Math.round(value) : 48,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => {
      const outputHeight = resolveOutputHeightByLayout(activeLayoutKey, current.renderResolution);
      const normalizedPx = relativeToPxFontSize(
        normalizedRel,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE,
        MAX_THUMBNAIL_FONT_SIZE,
        current.thumbnailTextPrimaryFontSize
      );
      return {
        ...current,
        thumbnailFontSizeRel: normalizedRel,
        thumbnailFontSize: normalizedPx,
        thumbnailTextPrimaryFontSizeRel: normalizedRel,
        thumbnailTextPrimaryFontSize: normalizedPx,
        thumbnailTextSecondaryFontSizeRel: normalizedRel,
        thumbnailTextSecondaryFontSize: normalizedPx,
      };
    });
  }, [activeLayoutKey, markTypographyDefaultsDirty, updateActiveProfile]);

  const setLogoPath = useCallback((value: string | undefined) => {
    updateActiveProfile((current) => ({ ...current, logoPath: value }));
  }, [updateActiveProfile]);

  const setLogoPosition = useCallback((value: { x: number; y: number } | undefined) => {
    updateActiveProfile((current) => {
      if (!isFiniteSubtitlePosition(value)) {
        return { ...current, logoPosition: undefined };
      }
      const outputSize = resolveOutputSizeByLayout(activeLayoutKey, current.renderResolution);
      return {
        ...current,
        logoPosition: normalizePositionValue(value, outputSize.width, outputSize.height),
      };
    });
  }, [activeLayoutKey, updateActiveProfile]);

  const setLogoScale = useCallback((value: number) => {
    updateActiveProfile((current) => ({ ...current, logoScale: value }));
  }, [updateActiveProfile]);

  const setSubtitlePosition = useCallback((value: { x: number; y: number } | null) => {
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => {
      if (!isFiniteSubtitlePosition(value)) {
        return { ...current, subtitlePosition: null };
      }
      const outputSize = resolveOutputSizeByLayout(activeLayoutKey, current.renderResolution);
      const normalized = normalizePositionValue(value, outputSize.width, outputSize.height);
      return { ...current, subtitlePosition: normalized };
    });
  }, [activeLayoutKey, markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailFrameTimeSec = useCallback((value: number | null) => {
    updateActiveProfile((current) => ({ ...current, thumbnailFrameTimeSec: value }));
  }, [updateActiveProfile]);

  const setThumbnailDurationSec = useCallback((value: number) => {
    const normalized = Math.min(10, Math.max(0.1, Number.isFinite(value) ? value : 0.5));
    updateActiveProfile((current) => ({ ...current, thumbnailDurationSec: normalized }));
  }, [updateActiveProfile]);

  const setThumbnailTextSecondary = useCallback((value: string) => {
    updateActiveProfile((current) => ({ ...current, thumbnailTextSecondary: value }));
  }, [updateActiveProfile]);

  const setThumbnailTextPrimaryPosition = useCallback((value: { x: number; y: number }) => {
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => {
      const outputSize = resolveOutputSizeByLayout(activeLayoutKey, current.renderResolution);
      const nextRaw = {
        x: Number.isFinite(value.x) ? value.x : current.thumbnailTextPrimaryPosition.x,
        y: Number.isFinite(value.y) ? value.y : current.thumbnailTextPrimaryPosition.y,
      };
      return {
        ...current,
        thumbnailTextPrimaryPosition: normalizePositionValue(nextRaw, outputSize.width, outputSize.height),
      };
    });
  }, [activeLayoutKey, markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextSecondaryPosition = useCallback((value: { x: number; y: number }) => {
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => {
      const outputSize = resolveOutputSizeByLayout(activeLayoutKey, current.renderResolution);
      const nextRaw = {
        x: Number.isFinite(value.x) ? value.x : current.thumbnailTextSecondaryPosition.x,
        y: Number.isFinite(value.y) ? value.y : current.thumbnailTextSecondaryPosition.y,
      };
      return {
        ...current,
        thumbnailTextSecondaryPosition: normalizePositionValue(nextRaw, outputSize.width, outputSize.height),
      };
    });
  }, [activeLayoutKey, markTypographyDefaultsDirty, updateActiveProfile]);

  const setPortraitTextPrimaryFontName = useCallback((value: string) => {
    const nextValue = value && value.trim().length > 0 ? value.trim() : DEFAULT_THUMBNAIL_FONT_NAME;
    markTypographyDefaultsDirty();
    updatePortraitProfile((current) => ({
      ...current,
      portraitTextPrimaryFontName: nextValue,
    }));
  }, [markTypographyDefaultsDirty, updatePortraitProfile]);

  const setPortraitTextPrimaryFontSize = useCallback((value: number) => {
    const normalizedRel = clamp(
      Number.isFinite(value) ? Math.round(value) : 48,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    markTypographyDefaultsDirty();
    updatePortraitProfile((current) => {
      const outputHeight = resolveOutputHeightByLayout('portrait', current.renderResolution);
      const normalizedPx = relativeToPxFontSize(
        normalizedRel,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE,
        MAX_THUMBNAIL_FONT_SIZE,
        current.portraitTextPrimaryFontSize
      );
      return {
        ...current,
        portraitTextPrimaryFontSizeRel: normalizedRel,
        portraitTextPrimaryFontSize: normalizedPx,
      };
    });
  }, [markTypographyDefaultsDirty, updatePortraitProfile]);

  const setPortraitTextPrimaryColor = useCallback((value: string) => {
    const normalized = normalizeHexColor(value, DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR);
    markTypographyDefaultsDirty();
    updatePortraitProfile((current) => ({
      ...current,
      portraitTextPrimaryColor: normalized,
    }));
  }, [markTypographyDefaultsDirty, updatePortraitProfile]);

  const setPortraitTextSecondaryFontName = useCallback((value: string) => {
    const nextValue = value && value.trim().length > 0 ? value.trim() : DEFAULT_THUMBNAIL_FONT_NAME;
    markTypographyDefaultsDirty();
    updatePortraitProfile((current) => ({
      ...current,
      portraitTextSecondaryFontName: nextValue,
    }));
  }, [markTypographyDefaultsDirty, updatePortraitProfile]);

  const setPortraitTextSecondaryFontSize = useCallback((value: number) => {
    const normalizedRel = clamp(
      Number.isFinite(value) ? Math.round(value) : 48,
      MIN_THUMBNAIL_FONT_SIZE_REL,
      MAX_THUMBNAIL_FONT_SIZE_REL
    );
    markTypographyDefaultsDirty();
    updatePortraitProfile((current) => {
      const outputHeight = resolveOutputHeightByLayout('portrait', current.renderResolution);
      const normalizedPx = relativeToPxFontSize(
        normalizedRel,
        outputHeight,
        MIN_THUMBNAIL_FONT_SIZE,
        MAX_THUMBNAIL_FONT_SIZE,
        current.portraitTextSecondaryFontSize
      );
      return {
        ...current,
        portraitTextSecondaryFontSizeRel: normalizedRel,
        portraitTextSecondaryFontSize: normalizedPx,
      };
    });
  }, [markTypographyDefaultsDirty, updatePortraitProfile]);

  const setPortraitTextSecondaryColor = useCallback((value: string) => {
    const normalized = normalizeHexColor(value, DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR);
    markTypographyDefaultsDirty();
    updatePortraitProfile((current) => ({
      ...current,
      portraitTextSecondaryColor: normalized,
    }));
  }, [markTypographyDefaultsDirty, updatePortraitProfile]);

  const setPortraitTextPrimaryPosition = useCallback((value: { x: number; y: number }) => {
    markTypographyDefaultsDirty();
    updatePortraitProfile((current) => {
      const outputSize = resolveOutputSizeByLayout('portrait', current.renderResolution);
      const nextRaw = {
        x: Number.isFinite(value.x) ? value.x : current.portraitTextPrimaryPosition.x,
        y: Number.isFinite(value.y) ? value.y : current.portraitTextPrimaryPosition.y,
      };
      return {
        ...current,
        portraitTextPrimaryPosition: normalizePositionValue(nextRaw, outputSize.width, outputSize.height),
      };
    });
  }, [markTypographyDefaultsDirty, updatePortraitProfile]);

  const setPortraitTextSecondaryPosition = useCallback((value: { x: number; y: number }) => {
    markTypographyDefaultsDirty();
    updatePortraitProfile((current) => {
      const outputSize = resolveOutputSizeByLayout('portrait', current.renderResolution);
      const nextRaw = {
        x: Number.isFinite(value.x) ? value.x : current.portraitTextSecondaryPosition.x,
        y: Number.isFinite(value.y) ? value.y : current.portraitTextSecondaryPosition.y,
      };
      return {
        ...current,
        portraitTextSecondaryPosition: normalizePositionValue(nextRaw, outputSize.width, outputSize.height),
      };
    });
  }, [markTypographyDefaultsDirty, updatePortraitProfile]);

  const settingsValues = useMemo(
    () => ({
      fontSizeScaleVersion: FONT_SIZE_SCALE_VERSION,
      subtitleFontSizeRel: activeProfile.subtitleFontSizeRel,
      inputType,
      geminiModel,
      translateMethod,
      voice,
      rate,
      volume,
      edgeTtsBatchSize,
      srtSpeed,
      splitByLines,
      linesPerFile,
      numberOfParts,
      enabledSteps: Array.from(enabledSteps.values()),
      audioDir,
      autoFitAudio,
      hardwareAcceleration,
      style: activeProfile.style,
      renderMode,
      renderResolution: activeProfile.renderResolution,
      renderContainer: activeProfile.renderContainer,
      blackoutTop: activeProfile.blackoutTop,
      coverMode: activeProfile.coverMode,
      coverQuad: activeProfile.coverQuad,
      coverFeatherPx: activeProfile.coverFeatherPx,
      coverFeatherHorizontalPx: activeProfile.coverFeatherHorizontalPx,
      coverFeatherVerticalPx: activeProfile.coverFeatherVerticalPx,
      coverFeatherHorizontalPercent: activeProfile.coverFeatherHorizontalPercent,
      coverFeatherVerticalPercent: activeProfile.coverFeatherVerticalPercent,
      portraitForegroundCropPercent: layoutProfiles.portrait.foregroundCropPercent,
      audioSpeed,
      renderAudioSpeed,
      videoVolume,
      audioVolume,
      thumbnailFontName: activeProfile.thumbnailTextPrimaryFontName,
      thumbnailFontSize: activeProfile.thumbnailTextPrimaryFontSize,
      thumbnailFontSizeRel: activeProfile.thumbnailTextPrimaryFontSizeRel,
      thumbnailTextPrimaryFontName: activeProfile.thumbnailTextPrimaryFontName,
      thumbnailTextPrimaryFontSize: activeProfile.thumbnailTextPrimaryFontSize,
      thumbnailTextPrimaryFontSizeRel: activeProfile.thumbnailTextPrimaryFontSizeRel,
      thumbnailTextPrimaryColor: activeProfile.thumbnailTextPrimaryColor,
      thumbnailTextSecondaryFontName: activeProfile.thumbnailTextSecondaryFontName,
      thumbnailTextSecondaryFontSize: activeProfile.thumbnailTextSecondaryFontSize,
      thumbnailTextSecondaryFontSizeRel: activeProfile.thumbnailTextSecondaryFontSizeRel,
      thumbnailTextSecondaryColor: activeProfile.thumbnailTextSecondaryColor,
      thumbnailLineHeightRatio: activeProfile.thumbnailLineHeightRatio,
      thumbnailTextSecondary: activeProfile.thumbnailTextSecondary,
      thumbnailTextPrimaryPosition: activeProfile.thumbnailTextPrimaryPosition,
      thumbnailTextSecondaryPosition: activeProfile.thumbnailTextSecondaryPosition,
      hardsubTextPrimaryFontName: activeProfile.thumbnailTextPrimaryFontName,
      hardsubTextPrimaryFontSize: activeProfile.thumbnailTextPrimaryFontSize,
      hardsubTextPrimaryFontSizeRel: activeProfile.thumbnailTextPrimaryFontSizeRel,
      hardsubTextPrimaryColor: activeProfile.thumbnailTextPrimaryColor,
      hardsubTextSecondaryFontName: activeProfile.thumbnailTextSecondaryFontName,
      hardsubTextSecondaryFontSize: activeProfile.thumbnailTextSecondaryFontSize,
      hardsubTextSecondaryFontSizeRel: activeProfile.thumbnailTextSecondaryFontSizeRel,
      hardsubTextSecondaryColor: activeProfile.thumbnailTextSecondaryColor,
      hardsubTextPrimaryPosition: activeProfile.thumbnailTextPrimaryPosition,
      hardsubTextSecondaryPosition: activeProfile.thumbnailTextSecondaryPosition,
      hardsubPortraitTextPrimaryFontName: layoutProfiles.portrait.portraitTextPrimaryFontName,
      hardsubPortraitTextPrimaryFontSize: layoutProfiles.portrait.portraitTextPrimaryFontSize,
      hardsubPortraitTextPrimaryFontSizeRel: layoutProfiles.portrait.portraitTextPrimaryFontSizeRel,
      hardsubPortraitTextPrimaryColor: layoutProfiles.portrait.portraitTextPrimaryColor,
      hardsubPortraitTextSecondaryFontName: layoutProfiles.portrait.portraitTextSecondaryFontName,
      hardsubPortraitTextSecondaryFontSize: layoutProfiles.portrait.portraitTextSecondaryFontSize,
      hardsubPortraitTextSecondaryFontSizeRel: layoutProfiles.portrait.portraitTextSecondaryFontSizeRel,
      hardsubPortraitTextSecondaryColor: layoutProfiles.portrait.portraitTextSecondaryColor,
      hardsubPortraitTextPrimaryPosition: layoutProfiles.portrait.portraitTextPrimaryPosition,
      hardsubPortraitTextSecondaryPosition: layoutProfiles.portrait.portraitTextSecondaryPosition,
      portraitTextPrimaryFontName: layoutProfiles.portrait.portraitTextPrimaryFontName,
      portraitTextPrimaryFontSize: layoutProfiles.portrait.portraitTextPrimaryFontSize,
      portraitTextPrimaryFontSizeRel: layoutProfiles.portrait.portraitTextPrimaryFontSizeRel,
      portraitTextPrimaryColor: layoutProfiles.portrait.portraitTextPrimaryColor,
      portraitTextSecondaryFontName: layoutProfiles.portrait.portraitTextSecondaryFontName,
      portraitTextSecondaryFontSize: layoutProfiles.portrait.portraitTextSecondaryFontSize,
      portraitTextSecondaryFontSizeRel: layoutProfiles.portrait.portraitTextSecondaryFontSizeRel,
      portraitTextSecondaryColor: layoutProfiles.portrait.portraitTextSecondaryColor,
      portraitTextPrimaryPosition: layoutProfiles.portrait.portraitTextPrimaryPosition,
      portraitTextSecondaryPosition: layoutProfiles.portrait.portraitTextSecondaryPosition,
      subtitlePosition: activeProfile.subtitlePosition,
      thumbnailFrameTimeSec: activeProfile.thumbnailFrameTimeSec,
      thumbnailDurationSec: activeProfile.thumbnailDurationSec,
      logoPath: activeProfile.logoPath,
      logoPosition: activeProfile.logoPosition,
      logoScale: activeProfile.logoScale,
      layoutProfiles: {
        landscape: cloneProfile(layoutProfiles.landscape),
        portrait: cloneProfile(layoutProfiles.portrait),
      },
      processingMode,
    }),
    [
      inputType,
      geminiModel,
      translateMethod,
      voice,
      rate,
      volume,
      edgeTtsBatchSize,
      srtSpeed,
      splitByLines,
      linesPerFile,
      numberOfParts,
      enabledSteps,
      audioDir,
      autoFitAudio,
      hardwareAcceleration,
      activeProfile,
      renderMode,
      audioSpeed,
      renderAudioSpeed,
      videoVolume,
      audioVolume,
      layoutProfiles,
      processingMode,
    ]
  );

  const applyLoadedSettings = useCallback((saved: any, fallbackProfiles?: LayoutProfilesState) => {
    const fallback = fallbackProfiles ?? createDefaultLayoutProfiles();
    if (saved.inputType) setInputType(saved.inputType);
    if (saved.geminiModel) setGeminiModel(saved.geminiModel);
    if (saved.translateMethod) setTranslateMethod(saved.translateMethod as 'api' | 'impit' | 'gemini_webapi_queue');
    if (saved.voice) setVoice(saved.voice);
    if (saved.rate) setRate(String(saved.rate));
    if (saved.volume) setVolume(String(saved.volume));
    if (typeof saved.edgeTtsBatchSize === 'number') setEdgeTtsBatchSize(saved.edgeTtsBatchSize);
    if (typeof saved.srtSpeed === 'number') setSrtSpeed(saved.srtSpeed);
    if (typeof saved.splitByLines === 'boolean') setSplitByLines(saved.splitByLines);
    if (typeof saved.linesPerFile === 'number') setLinesPerFile(saved.linesPerFile);
    if (typeof saved.numberOfParts === 'number') setNumberOfParts(saved.numberOfParts);
    if (saved.enabledSteps) setEnabledSteps(new Set(saved.enabledSteps as Step[]));
    if (saved.audioDir) setAudioDir(saved.audioDir);
    if (saved.autoFitAudio !== undefined) setAutoFitAudio(saved.autoFitAudio);
    if (saved.hardwareAcceleration === 'none' || saved.hardwareAcceleration === 'qsv' || saved.hardwareAcceleration === 'nvenc') {
      setHardwareAcceleration(saved.hardwareAcceleration);
    }
    if (saved.renderMode) setRenderMode(saved.renderMode as RenderMode);
    if (typeof saved.audioSpeed === 'number') setAudioSpeed(saved.audioSpeed);
    if (typeof saved.renderAudioSpeed === 'number') setRenderAudioSpeed(saved.renderAudioSpeed);
    if (typeof saved.videoVolume === 'number') {
      setVideoVolume(
        clampPercent(saved.videoVolume, MIN_VIDEO_VOLUME_PERCENT, MAX_VIDEO_VOLUME_PERCENT, 100)
      );
    }
    if (typeof saved.audioVolume === 'number') {
      setAudioVolume(
        clampPercent(saved.audioVolume, MIN_TTS_VOLUME_PERCENT, MAX_TTS_VOLUME_PERCENT, 100)
      );
    }
    if (saved.processingMode === 'folder-first' || saved.processingMode === 'step-first') {
      setProcessingMode(saved.processingMode);
    }

    const loadedProfiles = saved.layoutProfiles as Record<string, unknown> | undefined;
    if (loadedProfiles && typeof loadedProfiles === 'object') {
      setLayoutProfiles({
        landscape: normalizeProfile(
          loadedProfiles.landscape as Record<string, unknown> | undefined,
          fallback.landscape,
          'landscape'
        ),
        portrait: normalizeProfile(
          loadedProfiles.portrait as Record<string, unknown> | undefined,
          fallback.portrait,
          'portrait'
        ),
      });
      return;
    }

    const legacyPatch: Record<string, unknown> = {
      fontSizeScaleVersion: saved.fontSizeScaleVersion,
      style: saved.style,
      subtitleFontSizeRel: saved.subtitleFontSizeRel,
      renderResolution: saved.renderResolution,
      renderContainer: saved.renderContainer,
      blackoutTop: saved.blackoutTop,
      coverMode: saved.coverMode,
      coverQuad: saved.coverQuad,
      coverFeatherPx: saved.coverFeatherPx,
      coverFeatherHorizontalPx: saved.coverFeatherHorizontalPx,
      coverFeatherVerticalPx: saved.coverFeatherVerticalPx,
      coverFeatherHorizontalPercent: saved.coverFeatherHorizontalPercent,
      coverFeatherVerticalPercent: saved.coverFeatherVerticalPercent,
      foregroundCropPercent: saved.portraitForegroundCropPercent,
      subtitlePosition: saved.subtitlePosition,
      thumbnailFrameTimeSec: saved.thumbnailFrameTimeSec,
      thumbnailDurationSec: saved.thumbnailDurationSec,
      logoPath: saved.logoPath,
      logoPosition: saved.logoPosition,
      logoScale: saved.logoScale,
      thumbnailFontName: saved.thumbnailFontName,
      thumbnailFontSize: saved.thumbnailFontSize,
      thumbnailFontSizeRel: saved.thumbnailFontSizeRel,
      thumbnailTextPrimaryFontName: saved.thumbnailTextPrimaryFontName ?? saved.hardsubTextPrimaryFontName,
      thumbnailTextPrimaryFontSize: saved.thumbnailTextPrimaryFontSize ?? saved.hardsubTextPrimaryFontSize,
      thumbnailTextPrimaryFontSizeRel: saved.thumbnailTextPrimaryFontSizeRel ?? saved.hardsubTextPrimaryFontSizeRel,
      thumbnailTextPrimaryColor: saved.thumbnailTextPrimaryColor ?? saved.hardsubTextPrimaryColor,
      thumbnailTextSecondaryFontName: saved.thumbnailTextSecondaryFontName ?? saved.hardsubTextSecondaryFontName,
      thumbnailTextSecondaryFontSize: saved.thumbnailTextSecondaryFontSize ?? saved.hardsubTextSecondaryFontSize,
      thumbnailTextSecondaryFontSizeRel: saved.thumbnailTextSecondaryFontSizeRel ?? saved.hardsubTextSecondaryFontSizeRel,
      thumbnailTextSecondaryColor: saved.thumbnailTextSecondaryColor ?? saved.hardsubTextSecondaryColor,
      thumbnailLineHeightRatio: saved.thumbnailLineHeightRatio,
      thumbnailTextSecondary: saved.thumbnailTextSecondary,
      thumbnailTextPrimaryPosition: saved.thumbnailTextPrimaryPosition ?? saved.hardsubTextPrimaryPosition,
      thumbnailTextSecondaryPosition: saved.thumbnailTextSecondaryPosition ?? saved.hardsubTextSecondaryPosition,
      portraitTextPrimaryFontName: saved.hardsubPortraitTextPrimaryFontName ?? saved.portraitTextPrimaryFontName,
      portraitTextPrimaryFontSize: saved.hardsubPortraitTextPrimaryFontSize ?? saved.portraitTextPrimaryFontSize,
      portraitTextPrimaryFontSizeRel: saved.hardsubPortraitTextPrimaryFontSizeRel ?? saved.portraitTextPrimaryFontSizeRel,
      portraitTextPrimaryColor: saved.hardsubPortraitTextPrimaryColor ?? saved.portraitTextPrimaryColor,
      portraitTextSecondaryFontName: saved.hardsubPortraitTextSecondaryFontName ?? saved.portraitTextSecondaryFontName,
      portraitTextSecondaryFontSize: saved.hardsubPortraitTextSecondaryFontSize ?? saved.portraitTextSecondaryFontSize,
      portraitTextSecondaryFontSizeRel: saved.hardsubPortraitTextSecondaryFontSizeRel ?? saved.portraitTextSecondaryFontSizeRel,
      portraitTextSecondaryColor: saved.hardsubPortraitTextSecondaryColor ?? saved.portraitTextSecondaryColor,
      portraitTextPrimaryPosition: saved.hardsubPortraitTextPrimaryPosition ?? saved.portraitTextPrimaryPosition,
      portraitTextSecondaryPosition: saved.hardsubPortraitTextSecondaryPosition ?? saved.portraitTextSecondaryPosition,
    };

    const mergedLegacyLandscape = normalizeProfile(legacyPatch, fallback.landscape, 'landscape');
    const mergedLegacyPortrait = normalizeProfile(legacyPatch, fallback.portrait, 'portrait');
    setLayoutProfiles({
      landscape: mergedLegacyLandscape,
      portrait: mergedLegacyPortrait,
    });
  }, [setAudioVolume, setVideoVolume, setVoice]);

  const parseStandaloneCaptionPayload = useCallback((raw: string | null | undefined): any | null => {
    if (typeof raw !== 'string' || !raw.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.schemaVersion === 1 && parsed?.settings && typeof parsed.settings === 'object') {
        return parsed;
      }
      if (parsed && typeof parsed === 'object') {
        return {
          schemaVersion: 1,
          settingsRevision: 1,
          source: 'standalone',
          updatedAt: nowIso(),
          settings: parsed,
        };
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (projectId && !paths) {
      loadedRef.current = false;
      isHydratingRef.current = false;
      return;
    }
    loadedRef.current = false;
    isHydratingRef.current = true;
    typographyDefaultsDirtyRef.current = false;
    let cancelled = false;

    const load = async () => {
      try {
        const appSettingsRes = await window.electronAPI.appSettings.getAll();

        const globalFallbackProfiles = buildGlobalFallbackProfiles(appSettingsRes?.data?.captionTypographyDefaults);
        const normalizedGlobalDefaults = buildTypographyDefaults(globalFallbackProfiles);
        lastSavedGlobalTypographyFingerprintRef.current = typographyDefaultsFingerprint(normalizedGlobalDefaults);

        if (!projectId) {
          const standalonePayload = parseStandaloneCaptionPayload(appSettingsRes?.data?.captionStandaloneSettings);
          if (standalonePayload?.settings && typeof standalonePayload.settings === 'object') {
            applyLoadedSettings(standalonePayload.settings, globalFallbackProfiles);
            revisionRef.current = typeof standalonePayload.settingsRevision === 'number'
              ? standalonePayload.settingsRevision
              : 1;
            if (!cancelled) {
              setSettingsRevision(revisionRef.current);
              setSettingsUpdatedAt(typeof standalonePayload.updatedAt === 'string' ? standalonePayload.updatedAt : nowIso());
            }
          } else {
            setLayoutProfiles(globalFallbackProfiles);
            revisionRef.current = 0;
            if (!cancelled) {
              setSettingsRevision(0);
              setSettingsUpdatedAt(nowIso());
            }
          }
          return;
        }

        const projectSettingsRes = await window.electronAPI.project.readFeatureFile({
          projectId,
          feature: 'caption',
          fileName: PROJECT_SETTINGS_FILE,
        });

        if (!projectSettingsRes?.success || !projectSettingsRes.data) {
          setLayoutProfiles(globalFallbackProfiles);
          revisionRef.current = 0;
          if (!cancelled) {
            setSettingsRevision(0);
            setSettingsUpdatedAt(nowIso());
          }
          return;
        }

        const parsed = JSON.parse(projectSettingsRes.data);
        if (parsed?.schemaVersion === 1 && parsed?.settings && typeof parsed.settings === 'object') {
          applyLoadedSettings(parsed.settings, globalFallbackProfiles);
          revisionRef.current = typeof parsed.settingsRevision === 'number' ? parsed.settingsRevision : 0;
          if (!cancelled) {
            setSettingsRevision(revisionRef.current);
            setSettingsUpdatedAt(typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso());
          }
          return;
        }

        applyLoadedSettings(parsed || {}, globalFallbackProfiles);
        revisionRef.current = 1;
        if (!cancelled) {
          setSettingsRevision(1);
          setSettingsUpdatedAt(nowIso());
        }
      } catch (error) {
        console.error('[CaptionSettings] Lỗi load caption-settings.json:', error);
      } finally {
        if (!cancelled) {
          isHydratingRef.current = false;
          loadedRef.current = true;
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, paths, applyLoadedSettings, parseStandaloneCaptionPayload]);

  const saveSettings = useCallback(async (source: 'ui' | 'system' = 'ui') => {
    const nextRevision = revisionRef.current + 1;
    const updatedAt = nowIso();
    const payload: CaptionProjectSettings = {
      schemaVersion: 1,
      settingsRevision: nextRevision,
      source,
      updatedAt,
      settings: settingsValues,
    };

    const queued = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!projectId) {
          const updateRes = await window.electronAPI.appSettings.update({
            captionStandaloneSettings: JSON.stringify(payload),
          });
          if (!updateRes?.success) {
            throw new Error(updateRes?.error || 'Không thể lưu caption settings standalone vào AppData');
          }
        } else {
          const writeRes = await window.electronAPI.project.writeFeatureFile({
            projectId,
            feature: 'caption',
            fileName: PROJECT_SETTINGS_FILE,
            content: payload,
          });
          if (!writeRes?.success) {
            throw new Error(writeRes?.error || 'Không thể lưu caption-settings.json');
          }
        }
        revisionRef.current = nextRevision;
        setSettingsRevision(nextRevision);
        setSettingsUpdatedAt(updatedAt);
      });
    saveQueueRef.current = queued;
    await queued;
  }, [projectId, settingsValues]);

  useEffect(() => {
    if (projectId && !paths) return;
    if (!loadedRef.current) return;
    const timer = window.setTimeout(() => {
      saveSettings('ui').catch((error) => {
        console.error('[CaptionSettings] Lỗi auto-save:', error);
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
    };
  }, [projectId, paths, settingsValues, saveSettings]);

  useEffect(() => {
    if ((projectId && !paths) || !loadedRef.current || isHydratingRef.current) {
      return;
    }
    if (!typographyDefaultsDirtyRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      const snapshot = buildTypographyDefaults(layoutProfiles);
      const nextFingerprint = typographyDefaultsFingerprint(snapshot);
      if (nextFingerprint === lastSavedGlobalTypographyFingerprintRef.current) {
        typographyDefaultsDirtyRef.current = false;
        return;
      }
      window.electronAPI.appSettings.update({ captionTypographyDefaults: snapshot }).then((res) => {
        if (!res?.success) {
          console.error('[CaptionSettings] Lỗi lưu captionTypographyDefaults vào appSettings:', res?.error);
          return;
        }
        lastSavedGlobalTypographyFingerprintRef.current = nextFingerprint;
        typographyDefaultsDirtyRef.current = false;
      }).catch((error) => {
        console.error('[CaptionSettings] Lỗi lưu captionTypographyDefaults vào AppData:', error);
      });
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [projectId, paths, layoutProfiles, typographyDefaultsDirtyTick]);

  return {
    inputType, setInputType,
    geminiModel, setGeminiModel,
    translateMethod, setTranslateMethod,
    voice, setVoice,
    rate, setRate,
    volume, setVolume,
    edgeTtsBatchSize, setEdgeTtsBatchSize,
    srtSpeed, setSrtSpeed,
    splitByLines, setSplitByLines,
    linesPerFile, setLinesPerFile,
    numberOfParts, setNumberOfParts,
    enabledSteps, setEnabledSteps,
    audioDir, setAudioDir,
    autoFitAudio, setAutoFitAudio,
    hardwareAcceleration, setHardwareAcceleration,
    fontSizeScaleVersion: FONT_SIZE_SCALE_VERSION,
    style: activeProfile.style,
    subtitleFontSizeRel: activeProfile.subtitleFontSizeRel,
    setSubtitleFontSizeRel,
    setStyle,
    renderMode, setRenderMode,
    renderResolution: activeProfile.renderResolution,
    setRenderResolution,
    renderContainer: activeProfile.renderContainer,
    setRenderContainer,
    blackoutTop: activeProfile.blackoutTop,
    setBlackoutTop,
    coverMode: activeProfile.coverMode,
    setCoverMode,
    coverQuad: activeProfile.coverQuad,
    setCoverQuad,
    coverFeatherPx: activeProfile.coverFeatherPx,
    coverFeatherHorizontalPx: activeProfile.coverFeatherHorizontalPx,
    coverFeatherVerticalPx: activeProfile.coverFeatherVerticalPx,
    coverFeatherHorizontalPercent: activeProfile.coverFeatherHorizontalPercent,
    coverFeatherVerticalPercent: activeProfile.coverFeatherVerticalPercent,
    setCoverFeatherPx,
    setCoverFeatherHorizontalPx,
    setCoverFeatherVerticalPx,
    setCoverFeatherHorizontalPercent,
    setCoverFeatherVerticalPercent,
    foregroundCropPercent: activeProfile.foregroundCropPercent,
    setForegroundCropPercent,
    portraitForegroundCropPercent: layoutProfiles.portrait.foregroundCropPercent,
    setPortraitForegroundCropPercent,
    subtitlePosition: activeProfile.subtitlePosition,
    setSubtitlePosition,
    thumbnailFrameTimeSec: activeProfile.thumbnailFrameTimeSec,
    setThumbnailFrameTimeSec,
    thumbnailDurationSec: activeProfile.thumbnailDurationSec,
    setThumbnailDurationSec,
    audioSpeed, setAudioSpeed,
    renderAudioSpeed, setRenderAudioSpeed,
    videoVolume, setVideoVolume,
    audioVolume, setAudioVolume,
    // Legacy font chung = font của Text1 để tương thích ngược.
    thumbnailFontName: activeProfile.thumbnailTextPrimaryFontName,
    setThumbnailFontName,
    thumbnailFontSize: activeProfile.thumbnailTextPrimaryFontSize,
    thumbnailFontSizeRel: activeProfile.thumbnailTextPrimaryFontSizeRel,
    setThumbnailFontSize,
    thumbnailTextPrimaryFontName: activeProfile.thumbnailTextPrimaryFontName,
    setThumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: activeProfile.thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryFontSizeRel: activeProfile.thumbnailTextPrimaryFontSizeRel,
    setThumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryColor: activeProfile.thumbnailTextPrimaryColor,
    setThumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName: activeProfile.thumbnailTextSecondaryFontName,
    setThumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: activeProfile.thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryFontSizeRel: activeProfile.thumbnailTextSecondaryFontSizeRel,
    setThumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryColor: activeProfile.thumbnailTextSecondaryColor,
    setThumbnailTextSecondaryColor,
    thumbnailLineHeightRatio: activeProfile.thumbnailLineHeightRatio,
    setThumbnailLineHeightRatio,
    thumbnailTextSecondary: activeProfile.thumbnailTextSecondary,
    setThumbnailTextSecondary,
    thumbnailTextPrimaryPosition: activeProfile.thumbnailTextPrimaryPosition,
    setThumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition: activeProfile.thumbnailTextSecondaryPosition,
    setThumbnailTextSecondaryPosition,
    // Namespace rõ ràng cho main-video mode hardsub 16:9 (hiện alias qua bộ text của thumbnail để tương thích ngược).
    hardsubTextPrimaryFontName: activeProfile.thumbnailTextPrimaryFontName,
    setHardsubTextPrimaryFontName: setThumbnailTextPrimaryFontName,
    hardsubTextPrimaryFontSize: activeProfile.thumbnailTextPrimaryFontSize,
    hardsubTextPrimaryFontSizeRel: activeProfile.thumbnailTextPrimaryFontSizeRel,
    setHardsubTextPrimaryFontSize: setThumbnailTextPrimaryFontSize,
    hardsubTextPrimaryColor: activeProfile.thumbnailTextPrimaryColor,
    setHardsubTextPrimaryColor: setThumbnailTextPrimaryColor,
    hardsubTextSecondaryFontName: activeProfile.thumbnailTextSecondaryFontName,
    setHardsubTextSecondaryFontName: setThumbnailTextSecondaryFontName,
    hardsubTextSecondaryFontSize: activeProfile.thumbnailTextSecondaryFontSize,
    hardsubTextSecondaryFontSizeRel: activeProfile.thumbnailTextSecondaryFontSizeRel,
    setHardsubTextSecondaryFontSize: setThumbnailTextSecondaryFontSize,
    hardsubTextSecondaryColor: activeProfile.thumbnailTextSecondaryColor,
    setHardsubTextSecondaryColor: setThumbnailTextSecondaryColor,
    hardsubTextPrimaryPosition: activeProfile.thumbnailTextPrimaryPosition,
    setHardsubTextPrimaryPosition: setThumbnailTextPrimaryPosition,
    hardsubTextSecondaryPosition: activeProfile.thumbnailTextSecondaryPosition,
    setHardsubTextSecondaryPosition: setThumbnailTextSecondaryPosition,
    portraitTextPrimaryFontName: layoutProfiles.portrait.portraitTextPrimaryFontName,
    setPortraitTextPrimaryFontName,
    portraitTextPrimaryFontSize: layoutProfiles.portrait.portraitTextPrimaryFontSize,
    portraitTextPrimaryFontSizeRel: layoutProfiles.portrait.portraitTextPrimaryFontSizeRel,
    setPortraitTextPrimaryFontSize,
    portraitTextPrimaryColor: layoutProfiles.portrait.portraitTextPrimaryColor,
    setPortraitTextPrimaryColor,
    portraitTextSecondaryFontName: layoutProfiles.portrait.portraitTextSecondaryFontName,
    setPortraitTextSecondaryFontName,
    portraitTextSecondaryFontSize: layoutProfiles.portrait.portraitTextSecondaryFontSize,
    portraitTextSecondaryFontSizeRel: layoutProfiles.portrait.portraitTextSecondaryFontSizeRel,
    setPortraitTextSecondaryFontSize,
    portraitTextSecondaryColor: layoutProfiles.portrait.portraitTextSecondaryColor,
    setPortraitTextSecondaryColor,
    portraitTextPrimaryPosition: layoutProfiles.portrait.portraitTextPrimaryPosition,
    setPortraitTextPrimaryPosition,
    portraitTextSecondaryPosition: layoutProfiles.portrait.portraitTextSecondaryPosition,
    setPortraitTextSecondaryPosition,
    // Namespace mới cho main-video mode hardsub 9:16.
    hardsubPortraitTextPrimaryFontName: layoutProfiles.portrait.portraitTextPrimaryFontName,
    setHardsubPortraitTextPrimaryFontName: setPortraitTextPrimaryFontName,
    hardsubPortraitTextPrimaryFontSize: layoutProfiles.portrait.portraitTextPrimaryFontSize,
    hardsubPortraitTextPrimaryFontSizeRel: layoutProfiles.portrait.portraitTextPrimaryFontSizeRel,
    setHardsubPortraitTextPrimaryFontSize: setPortraitTextPrimaryFontSize,
    hardsubPortraitTextPrimaryColor: layoutProfiles.portrait.portraitTextPrimaryColor,
    setHardsubPortraitTextPrimaryColor: setPortraitTextPrimaryColor,
    hardsubPortraitTextSecondaryFontName: layoutProfiles.portrait.portraitTextSecondaryFontName,
    setHardsubPortraitTextSecondaryFontName: setPortraitTextSecondaryFontName,
    hardsubPortraitTextSecondaryFontSize: layoutProfiles.portrait.portraitTextSecondaryFontSize,
    hardsubPortraitTextSecondaryFontSizeRel: layoutProfiles.portrait.portraitTextSecondaryFontSizeRel,
    setHardsubPortraitTextSecondaryFontSize: setPortraitTextSecondaryFontSize,
    hardsubPortraitTextSecondaryColor: layoutProfiles.portrait.portraitTextSecondaryColor,
    setHardsubPortraitTextSecondaryColor: setPortraitTextSecondaryColor,
    hardsubPortraitTextPrimaryPosition: layoutProfiles.portrait.portraitTextPrimaryPosition,
    setHardsubPortraitTextPrimaryPosition: setPortraitTextPrimaryPosition,
    hardsubPortraitTextSecondaryPosition: layoutProfiles.portrait.portraitTextSecondaryPosition,
    setHardsubPortraitTextSecondaryPosition: setPortraitTextSecondaryPosition,
    logoPath: activeProfile.logoPath,
    setLogoPath,
    logoPosition: activeProfile.logoPosition,
    setLogoPosition,
    logoScale: activeProfile.logoScale,
    setLogoScale,
    layoutProfiles,
    processingMode, setProcessingMode,
    settingsRevision,
    settingsUpdatedAt,
    saveSettings,
  };
}



