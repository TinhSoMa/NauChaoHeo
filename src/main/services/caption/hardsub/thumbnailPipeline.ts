import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import {
  RenderResult,
  RenderThumbnailPreviewFrameOptions,
  RenderThumbnailPreviewFrameResult,
  RenderVideoOptions,
} from '../../../../shared/types/caption';
import { layoutThumbnailText, ThumbnailTextLayoutResult } from '../../../../shared/utils/thumbnailTextLayout';
import { getFFmpegPath } from '../../../utils/ffmpegPath';
import { getVideoMetadata } from './mediaProbe';
import { summarizeThumbnailTextForLog } from './timingDebugWriter';
import {
  InlineThumbnailSilentAudioBuildInput,
  InlineThumbnailSilentAudioBuildOutput,
  InlineThumbnailVideoFilterBuildInput,
  InlineThumbnailVideoFilterBuildOutput,
} from './types';

interface ThumbnailClipOptions {
  videoPath: string;
  timeSec: number;
  durationSec: number;
  thumbnailText?: string;
  thumbnailTextSecondary?: string;
  // Legacy font chung (fallback)
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
  width: number;
  height: number;
  renderMode?: RenderVideoOptions['renderMode'];
  sourceWidth?: number;
  sourceHeight?: number;
  fps?: number;
  includeAudio?: boolean;
}

interface ThumbnailLayoutBuildResult {
  filterComplex: string;
  outputLabel: string;
  debug: Record<string, unknown>;
}

const DEFAULT_THUMBNAIL_DURATION_SEC = 0.5;
const DEFAULT_THUMBNAIL_FONT_NAME = 'BrightwallPersonal';
const DEFAULT_THUMBNAIL_FONT_SIZE = 145;
const DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR = '#FFFF00';
const DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR = '#FFFF00';
const DEFAULT_THUMBNAIL_TEXT1_POSITION = { x: 0.5, y: 0.5 };
const DEFAULT_THUMBNAIL_TEXT2_POSITION = { x: 0.5, y: 0.64 };
const MIN_THUMBNAIL_FONT_SIZE = 24;
const MAX_THUMBNAIL_FONT_SIZE = 400;
const THUMBNAIL_TEXT_BORDER_WIDTH = 4;
const THUMBNAIL_TEXT_MAX_LINES = 3;
const THUMBNAIL_TEXT_LINE_HEIGHT_RATIO = 1.16;
const MIN_THUMBNAIL_LINE_HEIGHT_RATIO = 0;
const MAX_THUMBNAIL_LINE_HEIGHT_RATIO = 4;
const SUPPORTED_FONT_EXTENSIONS = new Set(['.ttf', '.otf']);

export function normalizeThumbnailDurationSec(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_THUMBNAIL_DURATION_SEC;
  }
  return Math.min(10, Math.max(0.1, value as number));
}

function normalizeThumbnailFontSize(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_THUMBNAIL_FONT_SIZE;
  }
  return Math.min(MAX_THUMBNAIL_FONT_SIZE, Math.max(MIN_THUMBNAIL_FONT_SIZE, Math.round(value as number)));
}

function normalizeThumbnailLineHeightRatio(value?: number): number {
  if (!Number.isFinite(value)) {
    return THUMBNAIL_TEXT_LINE_HEIGHT_RATIO;
  }
  return Math.min(MAX_THUMBNAIL_LINE_HEIGHT_RATIO, Math.max(MIN_THUMBNAIL_LINE_HEIGHT_RATIO, value as number));
}

function normalizeThumbnailTextColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return fallback;
}

function toFfmpegDrawTextColor(hexColor: string): string {
  return `0x${hexColor.replace('#', '')}`;
}

function ensureEven(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeThumbnailTextPosition(
  value: { x: number; y: number } | undefined,
  fallback: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: clamp01(value?.x ?? fallback.x),
    y: clamp01(value?.y ?? fallback.y),
  };
}

function computePortraitForegroundRect(
  outputWidth: number,
  outputHeight: number,
  sourceWidth: number,
  sourceHeight: number
): { x: number; y: number; width: number; height: number } {
  const cropH = Math.max(2, sourceHeight);
  const cropW = ensureEven(Math.min(sourceWidth, sourceHeight * 3 / 4));
  let fgW = outputWidth;
  let fgH = ensureEven((fgW * cropH) / cropW);
  if (fgH > outputHeight) {
    fgH = outputHeight;
    fgW = ensureEven((fgH * cropW) / cropH);
  }
  const fgX = Math.max(0, Math.floor((outputWidth - fgW) / 2));
  const fgY = Math.max(0, Math.floor((outputHeight - fgH) / 2));
  return {
    x: fgX,
    y: fgY,
    width: fgW,
    height: fgH,
  };
}

function resolveThumbnailTextRegion(
  renderMode: RenderVideoOptions['renderMode'] | undefined,
  outputWidth: number,
  outputHeight: number,
  sourceWidth: number,
  sourceHeight: number
): { x: number; y: number; width: number; height: number; mode: 'landscape_full' | 'portrait_fg_3_4' } {
  if (renderMode === 'hardsub_portrait_9_16') {
    const fgRect = computePortraitForegroundRect(outputWidth, outputHeight, sourceWidth, sourceHeight);
    return {
      ...fgRect,
      mode: 'portrait_fg_3_4',
    };
  }
  return {
    x: 0,
    y: 0,
    width: outputWidth,
    height: outputHeight,
    mode: 'landscape_full',
  };
}

function fmtExprNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function buildDrawTextPositionExpr(
  region: { x: number; y: number; width: number; height: number },
  normalizedPos: { x: number; y: number }
): { x: string; y: string } {
  const rx = fmtExprNumber(region.x);
  const ry = fmtExprNumber(region.y);
  const rw = fmtExprNumber(region.width);
  const rh = fmtExprNumber(region.height);
  const nx = fmtExprNumber(normalizedPos.x);
  const ny = fmtExprNumber(normalizedPos.y);
  const anchorX = `${rx}+${nx}*${rw}`;
  const anchorY = `${ry}+${ny}*${rh}`;
  return {
    x: `max(${rx},min(${anchorX}-text_w/2,${rx}+${rw}-text_w))`,
    y: `max(${ry},min(${anchorY}-text_h/2,${ry}+${rh}-text_h))`,
  };
}

function buildDrawTextBlockTopExpr(
  region: { x: number; y: number; width: number; height: number },
  normalizedPos: { x: number; y: number },
  blockHeightPx: number
): string {
  const ry = fmtExprNumber(region.y);
  const rh = fmtExprNumber(region.height);
  const ny = fmtExprNumber(normalizedPos.y);
  const anchorY = `${ry}+${ny}*${rh}`;
  const blockHeight = fmtExprNumber(Math.max(0, blockHeightPx));
  return `max(${ry},min(${anchorY}-${blockHeight}/2,${ry}+${rh}-${blockHeight}))`;
}

function summarizeLayoutForLog(layout: ThumbnailTextLayoutResult): Record<string, unknown> {
  return {
    lineCount: layout.lineCount,
    wrapped: layout.wrapped,
    truncated: layout.truncated,
    maxLinesApplied: layout.maxLinesApplied,
    effectiveMaxLines: layout.effectiveMaxLines,
    textForDraw: layout.textForDraw,
  };
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSupportedFontFile(fileName: string): boolean {
  return SUPPORTED_FONT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function resolveFontsDir(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'fonts'),
    path.join(app.getAppPath(), 'resources', 'fonts'),
    path.join(process.cwd(), 'resources', 'fonts'),
    path.resolve('resources', 'fonts'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function resolveThumbnailFontPath(fontName?: string): Promise<string | null> {
  const fontsDir = resolveFontsDir();
  if (!fontsDir) {
    return null;
  }

  const requestedName = (fontName?.trim() || DEFAULT_THUMBNAIL_FONT_NAME).trim();
  const requestedNormalized = normalizeName(requestedName);

  try {
    const files = await fs.readdir(fontsDir);
    const fontFiles = files.filter((file) => isSupportedFontFile(file));

    const exact = fontFiles.find((file) => normalizeName(path.parse(file).name) === requestedNormalized);
    if (exact) {
      return path.join(fontsDir, exact);
    }

    const close = fontFiles.find((file) => {
      const base = normalizeName(path.parse(file).name);
      return base.includes(requestedNormalized) || requestedNormalized.includes(base);
    });
    if (close) {
      return path.join(fontsDir, close);
    }

    const fallback = fontFiles.find((file) => normalizeName(path.parse(file).name) === 'brightwallpersonal')
      || fontFiles[0];
    return fallback ? path.join(fontsDir, fallback) : null;
  } catch {
    return null;
  }
}

async function extractFrameToPng(
  ffmpegPath: string,
  videoPath: string,
  timeSec: number,
  outputPngPath: string
): Promise<{ success: boolean; error?: string }> {
  const extractArgs = ['-y', '-ss', String(timeSec), '-i', videoPath, '-vframes', '1', '-q:v', '2', outputPngPath];
  let extractStderr = '';
  const extractOk = await new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegPath, extractArgs);
    proc.stderr?.on('data', (d) => { extractStderr += d.toString(); });
    proc.on('close', (code) => {
      const ok = code === 0 && existsSync(outputPngPath);
      if (!ok) {
        console.error('[Thumbnail] extract frame failed (code', code, '):\n', extractStderr.slice(-800));
      }
      resolve(ok);
    });
    proc.on('error', (err) => {
      console.error('[Thumbnail] spawn extract error:', err);
      resolve(false);
    });
  });
  if (!extractOk) {
    return { success: false, error: `Không extract được frame thumbnail\n${extractStderr.slice(-400)}` };
  }
  return { success: true };
}

async function buildThumbnailDrawTextFilter(options: {
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
  renderMode?: RenderVideoOptions['renderMode'];
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  textFilePath: string;
  secondaryTextFilePath: string;
}): Promise<{
  drawTextFilter: string | null;
  // Legacy alias = primary font
  thumbnailFontPath: string | null;
  thumbnailFontSize: number;
  lineSpacing: number;
  primaryFontPath: string | null;
  primaryFontSize: number;
  secondaryFontPath: string | null;
  secondaryFontSize: number;
  primaryLineSpacing: number;
  secondaryLineSpacing: number;
  textFilePaths: string[];
  textRegion: { x: number; y: number; width: number; height: number; mode: 'landscape_full' | 'portrait_fg_3_4' };
  primaryPosition: { x: number; y: number };
  secondaryPosition: { x: number; y: number };
  primaryLayout: ThumbnailTextLayoutResult;
  secondaryLayout: ThumbnailTextLayoutResult;
}> {
  const primaryFontName = options.thumbnailTextPrimaryFontName || options.thumbnailFontName;
  const secondaryFontName = options.thumbnailTextSecondaryFontName || options.thumbnailFontName;
  const primaryTextColorHex = normalizeThumbnailTextColor(
    options.thumbnailTextPrimaryColor,
    DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR
  );
  const secondaryTextColorHex = normalizeThumbnailTextColor(
    options.thumbnailTextSecondaryColor,
    DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR
  );
  const primaryTextColor = toFfmpegDrawTextColor(primaryTextColorHex);
  const secondaryTextColor = toFfmpegDrawTextColor(secondaryTextColorHex);
  const primaryFontSize = normalizeThumbnailFontSize(
    options.thumbnailTextPrimaryFontSize ?? options.thumbnailFontSize
  );
  const secondaryFontSize = normalizeThumbnailFontSize(
    options.thumbnailTextSecondaryFontSize ?? options.thumbnailFontSize ?? primaryFontSize
  );
  const lineHeightRatio = normalizeThumbnailLineHeightRatio(options.thumbnailLineHeightRatio);
  const primaryFontPath = await resolveThumbnailFontPath(primaryFontName);
  const secondaryFontPath = await resolveThumbnailFontPath(secondaryFontName);
  const textRegion = resolveThumbnailTextRegion(
    options.renderMode,
    options.outputWidth,
    options.outputHeight,
    options.sourceWidth,
    options.sourceHeight
  );
  const primaryPosition = normalizeThumbnailTextPosition(
    options.thumbnailTextPrimaryPosition,
    DEFAULT_THUMBNAIL_TEXT1_POSITION
  );
  const secondaryPosition = normalizeThumbnailTextPosition(
    options.thumbnailTextSecondaryPosition,
    DEFAULT_THUMBNAIL_TEXT2_POSITION
  );
  const primaryLineSpacing = Math.round(primaryFontSize * (lineHeightRatio - 1));
  const secondaryLineSpacing = Math.round(secondaryFontSize * (lineHeightRatio - 1));
  const layoutInputBase = {
    maxWidthPx: Math.max(1, textRegion.width * 0.92),
    regionHeightPx: textRegion.height,
    maxLines: THUMBNAIL_TEXT_MAX_LINES,
    lineHeightRatio,
    autoWrap: false,
  };
  const primaryLayout = layoutThumbnailText({
    ...layoutInputBase,
    fontSizePx: primaryFontSize,
    text: options.thumbnailText,
  });
  const secondaryLayout = layoutThumbnailText({
    ...layoutInputBase,
    fontSizePx: secondaryFontSize,
    text: options.thumbnailTextSecondary,
  });
  const textFilePaths: string[] = [];
  const hasPrimary = primaryLayout.textForDraw.trim().length > 0;
  const hasSecondary = secondaryLayout.textForDraw.trim().length > 0;
  if (!hasPrimary && !hasSecondary) {
    return {
      drawTextFilter: null,
      thumbnailFontPath: primaryFontPath,
      thumbnailFontSize: primaryFontSize,
      lineSpacing: primaryLineSpacing,
      primaryFontPath,
      primaryFontSize,
      secondaryFontPath,
      secondaryFontSize,
      primaryLineSpacing,
      secondaryLineSpacing,
      textFilePaths,
      textRegion,
      primaryPosition,
      secondaryPosition,
      primaryLayout,
      secondaryLayout,
    };
  }

  if (!primaryFontPath && hasPrimary) {
    console.warn('[Thumbnail] Không tìm thấy file font Text1, fallback dùng font mặc định của hệ thống.');
  }
  if (!secondaryFontPath && hasSecondary) {
    console.warn('[Thumbnail] Không tìm thấy file font Text2, fallback dùng font mặc định của hệ thống.');
  }
  const primaryFontParam = primaryFontPath ? `fontfile='${escapeFilterPath(primaryFontPath)}':` : '';
  const secondaryFontParam = secondaryFontPath ? `fontfile='${escapeFilterPath(secondaryFontPath)}':` : '';
  const primaryPosExpr = buildDrawTextPositionExpr(textRegion, primaryPosition);
  const secondaryPosExpr = buildDrawTextPositionExpr(textRegion, secondaryPosition);
  const drawTextFilters: string[] = [];
  const appendCenteredLineFilters = async (input: {
    layout: ThumbnailTextLayoutResult;
    lineBasePath: string;
    fontParam: string;
    fontColor: string;
    fontSize: number;
    position: { x: number; y: number };
    xExpr: string;
  }) => {
    if (input.layout.lineCount === 0) return;
    const blockHeightPx = input.layout.lineCount * input.layout.lineHeightPx;
    const blockTopExpr = buildDrawTextBlockTopExpr(textRegion, input.position, blockHeightPx);
    for (let index = 0; index < input.layout.lines.length; index++) {
      const lineText = input.layout.lines[index];
      if (!lineText || lineText.length === 0) {
        continue;
      }
      const lineFilePath = `${input.lineBasePath}.line${index}.txt`;
      await fs.writeFile(lineFilePath, lineText, 'utf-8');
      textFilePaths.push(lineFilePath);
      const lineOffsetExpr = fmtExprNumber(index * input.layout.lineHeightPx);
      drawTextFilters.push(
        `drawtext=textfile='${escapeFilterPath(lineFilePath)}':reload=0:` +
        `${input.fontParam}fontcolor=${input.fontColor}:fontsize=${input.fontSize}:borderw=${THUMBNAIL_TEXT_BORDER_WIDTH}:bordercolor=black:` +
        `text_shaping=1:fix_bounds=1:y_align=text:x='${input.xExpr}':y='${blockTopExpr}+${lineOffsetExpr}'`
      );
    }
  };
  if (hasPrimary) {
    await appendCenteredLineFilters({
      layout: primaryLayout,
      lineBasePath: options.textFilePath,
      fontParam: primaryFontParam,
      fontColor: primaryTextColor,
      fontSize: primaryFontSize,
      position: primaryPosition,
      xExpr: primaryPosExpr.x,
    });
  }
  if (hasSecondary) {
    await appendCenteredLineFilters({
      layout: secondaryLayout,
      lineBasePath: options.secondaryTextFilePath,
      fontParam: secondaryFontParam,
      fontColor: secondaryTextColor,
      fontSize: secondaryFontSize,
      position: secondaryPosition,
      xExpr: secondaryPosExpr.x,
    });
  }

  return {
    drawTextFilter: drawTextFilters.join(','),
    thumbnailFontPath: primaryFontPath,
    thumbnailFontSize: primaryFontSize,
    lineSpacing: primaryLineSpacing,
    primaryFontPath,
    primaryFontSize,
    secondaryFontPath,
    secondaryFontSize,
    primaryLineSpacing,
    secondaryLineSpacing,
    textFilePaths,
    textRegion,
    primaryPosition,
    secondaryPosition,
    primaryLayout,
    secondaryLayout,
  };
}

function resolvePortraitCanvasByPreset(
  renderResolution?: RenderVideoOptions['renderResolution']
): { width: number; height: number } {
  if (renderResolution === '720p') {
    return { width: 720, height: 1280 };
  }
  if (renderResolution === '540p') {
    return { width: 540, height: 960 };
  }
  if (renderResolution === '360p') {
    return { width: 360, height: 640 };
  }
  return { width: 1080, height: 1920 };
}

function resolveLandscapeCanvasBySource(
  sourceWidth: number,
  sourceHeight: number,
  renderResolution?: RenderVideoOptions['renderResolution']
): { width: number; height: number } {
  const safeSourceW = ensureEven(Math.max(2, sourceWidth));
  const safeSourceH = ensureEven(Math.max(2, sourceHeight));
  let maxOutputHeight = 1080;
  if (renderResolution === '720p') maxOutputHeight = 720;
  if (renderResolution === '540p') maxOutputHeight = 540;
  if (renderResolution === '360p') maxOutputHeight = 360;
  if (renderResolution === 'original') maxOutputHeight = 99999;

  if (safeSourceH > maxOutputHeight) {
    const scaleFactor = maxOutputHeight / safeSourceH;
    return {
      width: ensureEven(safeSourceW * scaleFactor),
      height: ensureEven(maxOutputHeight),
    };
  }
  return { width: safeSourceW, height: safeSourceH };
}

async function readPngDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const buffer = await fs.readFile(filePath);
    if (buffer.length < 24) {
      return null;
    }
    // PNG signature
    const signature = buffer.subarray(0, 8);
    const expected = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    if (!signature.equals(expected)) {
      return null;
    }
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
      return null;
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

function buildLandscapeThumbnailFilter(
  safeW: number,
  safeH: number,
  drawTextFilter: string | null
): ThumbnailLayoutBuildResult {
  const parts: string[] = [
    `[0:v]scale=${safeW}:${safeH},setsar=1,setdar=${safeW}/${safeH}[v_layout]`,
  ];
  if (drawTextFilter) {
    parts.push(`[v_layout]${drawTextFilter}[v_out]`);
  }
  return {
    filterComplex: parts.join(';'),
    outputLabel: drawTextFilter ? 'v_out' : 'v_layout',
    debug: {
      mode: 'landscape_hardsub',
      cropRatio: 'none',
      outputSize: `${safeW}x${safeH}`,
      bgFillMode: 'scale_to_output',
    },
  };
}

function buildPortraitThumbnailFilter(
  safeW: number,
  safeH: number,
  sourceWidth: number,
  sourceHeight: number,
  drawTextFilter: string | null
): ThumbnailLayoutBuildResult {
  const cropH = sourceHeight;
  const cropW = ensureEven(Math.min(sourceWidth, sourceHeight * 3 / 4));
  const cropX = Math.max(0, Math.floor((sourceWidth - cropW) / 2));

  let fgW = safeW;
  let fgH = ensureEven((fgW * cropH) / cropW);
  if (fgH > safeH) {
    fgH = safeH;
    fgW = ensureEven((fgH * cropW) / cropH);
  }

  const parts: string[] = [
    `[0:v]crop=${cropW}:${cropH}:${cropX}:0,split=2[crop_bg][crop_fg]`,
    `[crop_bg]scale=${safeW}:${safeH}[bg_fill]`,
    `[crop_fg]scale=${fgW}:${fgH}[fg_fit]`,
    `[bg_fill][fg_fit]overlay=(W-w)/2:(H-h)/2,setsar=1,setdar=${safeW}/${safeH}[v_layout]`,
  ];
  if (drawTextFilter) {
    parts.push(`[v_layout]${drawTextFilter}[v_out]`);
  }

  return {
    filterComplex: parts.join(';'),
    outputLabel: drawTextFilter ? 'v_out' : 'v_layout',
    debug: {
      mode: 'portrait_9_16',
      cropRatio: '3:4',
      cropRect: { x: cropX, y: 0, width: cropW, height: cropH },
      outputSize: `${safeW}x${safeH}`,
      fgSize: `${fgW}x${fgH}`,
      bgFillMode: 'from_cropped_frame',
      cropStrategy: 'center_3_4',
      fillStrategy: 'cropped_bg_fill_top_bottom',
    },
  };
}

function buildInlineLandscapeThumbnailFilterParts(
  inputLabel: string,
  outputLabelPrefix: string,
  safeW: number,
  safeH: number,
  drawTextFilter: string | null
): { filterParts: string[]; outputLabel: string; debug: Record<string, unknown> } {
  const layoutLabel = `${outputLabelPrefix}_layout`;
  const outputLabel = drawTextFilter ? `${outputLabelPrefix}_out` : layoutLabel;
  const parts: string[] = [
    `${inputLabel}scale=${safeW}:${safeH},setsar=1,setdar=${safeW}/${safeH}[${layoutLabel}]`,
  ];
  if (drawTextFilter) {
    parts.push(`[${layoutLabel}]${drawTextFilter}[${outputLabel}]`);
  }
  return {
    filterParts: parts,
    outputLabel,
    debug: {
      mode: 'landscape_hardsub',
      cropRatio: 'none',
      outputSize: `${safeW}x${safeH}`,
      bgFillMode: 'scale_to_output',
    },
  };
}

function buildInlinePortraitThumbnailFilterParts(
  inputLabel: string,
  outputLabelPrefix: string,
  safeW: number,
  safeH: number,
  sourceWidth: number,
  sourceHeight: number,
  drawTextFilter: string | null
): { filterParts: string[]; outputLabel: string; debug: Record<string, unknown> } {
  const cropH = sourceHeight;
  const cropW = ensureEven(Math.min(sourceWidth, sourceHeight * 3 / 4));
  const cropX = Math.max(0, Math.floor((sourceWidth - cropW) / 2));

  let fgW = safeW;
  let fgH = ensureEven((fgW * cropH) / cropW);
  if (fgH > safeH) {
    fgH = safeH;
    fgW = ensureEven((fgH * cropW) / cropH);
  }

  const cropBgLabel = `${outputLabelPrefix}_crop_bg`;
  const cropFgLabel = `${outputLabelPrefix}_crop_fg`;
  const bgFillLabel = `${outputLabelPrefix}_bg_fill`;
  const fgFitLabel = `${outputLabelPrefix}_fg_fit`;
  const layoutLabel = `${outputLabelPrefix}_layout`;
  const outputLabel = drawTextFilter ? `${outputLabelPrefix}_out` : layoutLabel;
  const parts: string[] = [
    `${inputLabel}crop=${cropW}:${cropH}:${cropX}:0,format=yuv420p,split=2[${cropBgLabel}][${cropFgLabel}]`,
    `[${cropBgLabel}]scale=${safeW}:${safeH},format=yuv420p[${bgFillLabel}]`,
    `[${cropFgLabel}]scale=${fgW}:${fgH},format=yuv420p[${fgFitLabel}]`,
    `[${bgFillLabel}][${fgFitLabel}]overlay=(W-w)/2:(H-h)/2,format=yuv420p,setsar=1,setdar=${safeW}/${safeH}[${layoutLabel}]`,
  ];
  if (drawTextFilter) {
    parts.push(`[${layoutLabel}]${drawTextFilter}[${outputLabel}]`);
  }

  return {
    filterParts: parts,
    outputLabel,
    debug: {
      mode: 'portrait_9_16',
      cropRatio: '3:4',
      cropRect: { x: cropX, y: 0, width: cropW, height: cropH },
      outputSize: `${safeW}x${safeH}`,
      fgSize: `${fgW}x${fgH}`,
      bgFillMode: 'from_cropped_frame',
      cropStrategy: 'center_3_4',
      fillStrategy: 'cropped_bg_fill_top_bottom',
    },
  };
}

export async function buildInlineThumbnailVideoFilter(
  options: InlineThumbnailVideoFilterBuildInput
): Promise<InlineThumbnailVideoFilterBuildOutput> {
  const safeW = ensureEven(options.outputWidth);
  const safeH = ensureEven(options.outputHeight);
  const safeSourceW = ensureEven(Math.max(2, options.sourceWidth));
  const safeSourceH = ensureEven(Math.max(2, options.sourceHeight));
  const safeFps = Number.isFinite(options.fps) && options.fps > 0 ? Math.round(options.fps) : 24;
  const timeSec = Math.max(0, Number.isFinite(options.thumbnailTimeSec) ? options.thumbnailTimeSec : 0);
  const durationSec = normalizeThumbnailDurationSec(options.thumbnailDurationSec);
  const prefix = 'thumb_inline';
  const inputLabel = options.videoInputLabel || '[0:v]';
  const sourceFreezeLabel = `${prefix}_src`;
  const textFilePath = path.join(os.tmpdir(), `${prefix}_text_${Date.now()}.txt`);
  const secondaryTextFilePath = path.join(os.tmpdir(), `${prefix}_text2_${Date.now()}.txt`);
  const cleanupFiles: string[] = [];

  const drawTextContext = await buildThumbnailDrawTextFilter({
    thumbnailText: options.thumbnailText,
    thumbnailTextSecondary: options.thumbnailTextSecondary,
    thumbnailFontName: options.thumbnailFontName,
    thumbnailFontSize: options.thumbnailFontSize,
    thumbnailTextPrimaryFontName: options.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: options.thumbnailTextPrimaryFontSize,
    thumbnailTextSecondaryFontName: options.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: options.thumbnailTextSecondaryFontSize,
    thumbnailLineHeightRatio: options.thumbnailLineHeightRatio,
    thumbnailTextPrimaryPosition: options.thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition: options.thumbnailTextSecondaryPosition,
    renderMode: options.renderMode,
    outputWidth: safeW,
    outputHeight: safeH,
    sourceWidth: safeSourceW,
    sourceHeight: safeSourceH,
    textFilePath,
    secondaryTextFilePath,
  });
  if (drawTextContext.textFilePaths.length > 0) {
    cleanupFiles.push(...drawTextContext.textFilePaths);
  }

  const sourceFreezePart =
    `${inputLabel}trim=start=${timeSec},settb=AVTB,setpts=PTS-STARTPTS,fps=${safeFps},` +
    `select='eq(n,0)',setpts=N/FRAME_RATE/TB,format=yuv420p,` +
    `tpad=stop_mode=clone:stop_duration=${durationSec},trim=duration=${durationSec},fps=${safeFps},format=yuv420p` +
    `[${sourceFreezeLabel}]`;

  const layout = options.renderMode === 'hardsub_portrait_9_16'
    ? buildInlinePortraitThumbnailFilterParts(
        `[${sourceFreezeLabel}]`,
        prefix,
        safeW,
        safeH,
        safeSourceW,
        safeSourceH,
        drawTextContext.drawTextFilter
      )
    : buildInlineLandscapeThumbnailFilterParts(
        `[${sourceFreezeLabel}]`,
        prefix,
        safeW,
        safeH,
        drawTextContext.drawTextFilter
      );

  return {
    filterParts: [sourceFreezePart, ...layout.filterParts],
    outputLabel: layout.outputLabel,
    cleanupFiles,
    debug: {
      ...layout.debug,
      textRegion: drawTextContext.textRegion,
      textLineHeightRatio: normalizeThumbnailLineHeightRatio(options.thumbnailLineHeightRatio),
      textLineSpacing: {
        primary: drawTextContext.primaryLineSpacing,
        secondary: drawTextContext.secondaryLineSpacing,
      },
      textPrimaryFont: {
        name: options.thumbnailTextPrimaryFontName || options.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME,
        path: drawTextContext.primaryFontPath,
        size: drawTextContext.primaryFontSize,
      },
      textSecondaryFont: {
        name: options.thumbnailTextSecondaryFontName || options.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME,
        path: drawTextContext.secondaryFontPath,
        size: drawTextContext.secondaryFontSize,
      },
      textPrimaryPosition: drawTextContext.primaryPosition,
      textSecondaryPosition: drawTextContext.secondaryPosition,
      textPrimaryLayout: summarizeLayoutForLog(drawTextContext.primaryLayout),
      textSecondaryLayout: summarizeLayoutForLog(drawTextContext.secondaryLayout),
      sourceFreeze: {
        thumbnailTimeSec: timeSec,
        durationSec,
        fps: safeFps,
      },
    },
    thumbnailFontPath: drawTextContext.thumbnailFontPath,
    thumbnailFontSize: drawTextContext.thumbnailFontSize,
    secondaryThumbnailFontPath: drawTextContext.secondaryFontPath,
    secondaryThumbnailFontSize: drawTextContext.secondaryFontSize,
  };
}

export function buildInlineThumbnailSilentAudio(
  options: InlineThumbnailSilentAudioBuildInput
): InlineThumbnailSilentAudioBuildOutput {
  const durationSec = normalizeThumbnailDurationSec(options.durationSec);
  const sampleRate = Number.isFinite(options.sampleRate) && (options.sampleRate || 0) > 0
    ? Math.round(options.sampleRate as number)
    : 44100;
  const channelLayout = options.channelLayout?.trim() || 'stereo';
  const outputLabel = options.outputLabel?.trim() || 'thumb_a_inline';
  const filterPart =
    `anullsrc=channel_layout=${channelLayout}:sample_rate=${sampleRate},` +
    `atrim=duration=${durationSec},asetpts=N/SR/TB[${outputLabel}]`;

  return {
    filterPart,
    outputLabel,
    debug: {
      mode: 'silent_prefix',
      durationSec,
      sampleRate,
      channelLayout,
    },
  };
}

async function createThumbnailClip(opts: ThumbnailClipOptions): Promise<{ success: boolean; clipPath?: string; error?: string }> {
  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: 'FFmpeg không tìm thấy' };
  }

  const tempDir = os.tmpdir();
  const ts = Date.now();
  const framePng = path.join(tempDir, `thumb_frame_${ts}.png`);
  const clipPath = path.join(tempDir, `thumb_clip_${ts}.mp4`);
  const textFilePath = path.join(tempDir, `thumb_text_${ts}.txt`);
  const secondaryTextFilePath = path.join(tempDir, `thumb_text2_${ts}.txt`);

  const safeW = ensureEven(opts.width);
  const safeH = ensureEven(opts.height);
  const safeFps = Number.isFinite(opts.fps) && (opts.fps || 0) > 0 ? Math.round(opts.fps || 24) : 24;
  const includeAudio = opts.includeAudio !== false;
  const isPortraitMode = opts.renderMode === 'hardsub_portrait_9_16';

  const extractRes = await extractFrameToPng(ffmpegPath, opts.videoPath, opts.timeSec, framePng);
  if (!extractRes.success) {
    return { success: false, error: extractRes.error };
  }

  const frameSize = await readPngDimensions(framePng);
  const sourceWidth = opts.sourceWidth && opts.sourceWidth > 0
    ? opts.sourceWidth
    : (frameSize?.width || safeW);
  const sourceHeight = opts.sourceHeight && opts.sourceHeight > 0
    ? opts.sourceHeight
    : (frameSize?.height || safeH);

  const drawTextContext = await buildThumbnailDrawTextFilter({
    thumbnailText: opts.thumbnailText,
    thumbnailTextSecondary: opts.thumbnailTextSecondary,
    thumbnailFontName: opts.thumbnailFontName,
    thumbnailFontSize: opts.thumbnailFontSize,
    thumbnailTextPrimaryFontName: opts.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: opts.thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryColor: opts.thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName: opts.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: opts.thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryColor: opts.thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio: opts.thumbnailLineHeightRatio,
    thumbnailTextPrimaryPosition: opts.thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition: opts.thumbnailTextSecondaryPosition,
    renderMode: opts.renderMode,
    outputWidth: safeW,
    outputHeight: safeH,
    sourceWidth,
    sourceHeight,
    textFilePath,
    secondaryTextFilePath,
  });
  const drawTextFilter = drawTextContext.drawTextFilter;

  const layoutResult = isPortraitMode
    ? buildPortraitThumbnailFilter(safeW, safeH, sourceWidth, sourceHeight, drawTextFilter)
    : buildLandscapeThumbnailFilter(safeW, safeH, drawTextFilter);

  const thumbTextLog = summarizeThumbnailTextForLog(opts.thumbnailText);
  const thumbText2Log = summarizeThumbnailTextForLog(opts.thumbnailTextSecondary);
  console.log(
    `[Thumbnail] create clip params | timeSec=${opts.timeSec}, durationSec=${opts.durationSec}, ` +
    `mode=${isPortraitMode ? 'hardsub_portrait_9_16' : 'hardsub'}, ` +
    `source=${sourceWidth}x${sourceHeight}, output=${safeW}x${safeH}, fps=${safeFps}, includeAudio=${includeAudio}, ` +
    `text1Length=${thumbTextLog.length}, text1Preview="${thumbTextLog.preview}", ` +
    `text2Length=${thumbText2Log.length}, text2Preview="${thumbText2Log.preview}", ` +
    `font1Name=${opts.thumbnailTextPrimaryFontName || opts.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME}, font1File=${drawTextContext.primaryFontPath || 'system-default'}, ` +
    `font1Size=${drawTextContext.primaryFontSize}, lineSpacing1=${drawTextContext.primaryLineSpacing}, ` +
    `font2Name=${opts.thumbnailTextSecondaryFontName || opts.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME}, font2File=${drawTextContext.secondaryFontPath || 'system-default'}, ` +
    `font2Size=${drawTextContext.secondaryFontSize}, lineSpacing2=${drawTextContext.secondaryLineSpacing}, ` +
    `lineHeightRatio=${normalizeThumbnailLineHeightRatio(opts.thumbnailLineHeightRatio).toFixed(2)}, ` +
    `fontColor1=${normalizeThumbnailTextColor(opts.thumbnailTextPrimaryColor, DEFAULT_THUMBNAIL_TEXT_PRIMARY_COLOR)}, ` +
    `fontColor2=${normalizeThumbnailTextColor(opts.thumbnailTextSecondaryColor, DEFAULT_THUMBNAIL_TEXT_SECONDARY_COLOR)}, ` +
    `border=${THUMBNAIL_TEXT_BORDER_WIDTH}, ` +
    `textRegion=${JSON.stringify(drawTextContext.textRegion)}, textPos1=${JSON.stringify(drawTextContext.primaryPosition)}, ` +
    `textPos2=${JSON.stringify(drawTextContext.secondaryPosition)}, textLayout1=${JSON.stringify(summarizeLayoutForLog(drawTextContext.primaryLayout))}, ` +
    `textLayout2=${JSON.stringify(summarizeLayoutForLog(drawTextContext.secondaryLayout))}, ` +
    `layout=${JSON.stringify(layoutResult.debug)}`
  );

  const clipArgs = includeAudio
    ? [
        '-y', '-loop', '1', '-r', String(safeFps), '-t', String(opts.durationSec), '-i', framePng,
        '-f', 'lavfi', '-t', String(opts.durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-filter_complex', layoutResult.filterComplex,
        '-map', `[${layoutResult.outputLabel}]`, '-map', '1:a',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-r', String(safeFps), '-c:a', 'aac', '-b:a', '128k', '-shortest',
        clipPath,
      ]
    : [
        '-y', '-loop', '1', '-r', String(safeFps), '-t', String(opts.durationSec), '-i', framePng,
        '-filter_complex', layoutResult.filterComplex,
        '-map', `[${layoutResult.outputLabel}]`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-r', String(safeFps), '-an',
        clipPath,
      ];

  let clipStderr = '';
  const clipOk = await new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegPath, clipArgs);
    proc.stderr?.on('data', (d) => { clipStderr += d.toString(); });
    proc.on('close', (code) => {
      const ok = code === 0 && existsSync(clipPath);
      if (!ok) {
        console.error('[Thumbnail] create clip failed (code', code, '):\n', clipStderr.slice(-1200));
      }
      resolve(ok);
    });
    proc.on('error', (err) => {
      console.error('[Thumbnail] spawn clip error:', err);
      resolve(false);
    });
  });

  try { await fs.unlink(framePng); } catch {}
  for (const cleanupPath of drawTextContext.textFilePaths) {
    try { await fs.unlink(cleanupPath); } catch {}
  }

  if (!clipOk) {
    return { success: false, error: `Không tạo được thumbnail clip\n${clipStderr.slice(-400)}` };
  }

  console.log(`[Thumbnail] clip tạo thành công: ${clipPath}`);
  return { success: true, clipPath };
}

async function prependThumbnailClip(
  thumbnailClipPath: string,
  mainOutputPath: string,
  hasAudio: boolean
): Promise<{ success: boolean; error?: string }> {
  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: 'FFmpeg không tìm thấy' };
  }
  if (!existsSync(mainOutputPath)) {
    return { success: false, error: `Không tìm thấy file render chính: ${mainOutputPath}` };
  }

  const dir = path.dirname(mainOutputPath);
  const ext = path.extname(mainOutputPath);
  const ts = Date.now();
  const tempConcatPath = path.join(dir, `_concat_thumb_temp_${ts}${ext}`);
  const backupMainPath = path.join(dir, `_main_backup_${ts}${ext}`);
  const concatListPath = path.join(dir, `_concat_list_${ts}.txt`);

  const toConcatPath = (p: string) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
  const concatListContent = `file '${toConcatPath(thumbnailClipPath)}'\nfile '${toConcatPath(mainOutputPath)}'\n`;
  try {
    await fs.writeFile(concatListPath, concatListContent, 'utf-8');
  } catch (writeErr) {
    return { success: false, error: `Không thể tạo file concat list: ${writeErr}` };
  }

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-movflags', '+faststart', tempConcatPath];
  let concatStderr = '';
  const pushStderr = (chunk: string): void => {
    concatStderr += chunk;
    if (concatStderr.length > 12000) {
      concatStderr = concatStderr.slice(-12000);
    }
  };

  return new Promise((resolve) => {
    console.log(`[Thumbnail] Bắt đầu concat demuxer (tách luồng, không render lại toàn bộ video), hasAudio=${hasAudio}...`);
    const proc = spawn(ffmpegPath, args);
    proc.stderr?.on('data', (d) => { pushStderr(d.toString()); });
    proc.on('close', async (code) => {
      try { await fs.unlink(thumbnailClipPath); } catch {}
      try { await fs.unlink(concatListPath); } catch {}

      if (code === 0 && existsSync(tempConcatPath)) {
        try {
          await fs.rename(mainOutputPath, backupMainPath);
          try {
            await fs.rename(tempConcatPath, mainOutputPath);
            try { await fs.unlink(backupMainPath); } catch {}
            resolve({ success: true });
            return;
          } catch (swapErr) {
            console.error('[Thumbnail] Swap file sau concat thất bại:', swapErr);
            try {
              if (existsSync(mainOutputPath)) {
                await fs.unlink(mainOutputPath);
              }
            } catch {}
            try { await fs.rename(backupMainPath, mainOutputPath); } catch {}
            try { await fs.unlink(tempConcatPath); } catch {}
            resolve({ success: false, error: `Không thể thay thế file output sau concat: ${swapErr}` });
            return;
          }
        } catch (backupErr) {
          console.error('[Thumbnail] Tạo backup file output thất bại:', backupErr);
          try { await fs.unlink(tempConcatPath); } catch {}
          resolve({ success: false, error: `Không thể backup file output trước khi thay thế: ${backupErr}` });
          return;
        }
      }

      try { await fs.unlink(tempConcatPath); } catch {}
      console.error('[Thumbnail] concat failed (code', code, '):\n', concatStderr.slice(-1200));
      resolve({ success: false, error: `Ghép thumbnail thất bại (exit ${code})\n${concatStderr.slice(-400)}` });
    });

    proc.on('error', async (err) => {
      try { await fs.unlink(thumbnailClipPath); } catch {}
      try { await fs.unlink(concatListPath); } catch {}
      try { await fs.unlink(tempConcatPath); } catch {}
      resolve({ success: false, error: err.message });
    });
  });
}

export async function renderThumbnailPreviewFrame(
  options: RenderThumbnailPreviewFrameOptions
): Promise<RenderThumbnailPreviewFrameResult> {
  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: 'FFmpeg không tìm thấy' };
  }
  if (!options?.videoPath || !existsSync(options.videoPath)) {
    return { success: false, error: 'Thiếu videoPath để render thumbnail preview' };
  }
  if (!Number.isFinite(options.thumbnailTimeSec) || (options.thumbnailTimeSec as number) < 0) {
    return { success: false, error: 'thumbnailTimeSec không hợp lệ' };
  }

  const tempDir = os.tmpdir();
  const ts = Date.now();
  const framePng = path.join(tempDir, `thumb_preview_frame_${ts}.png`);
  const textFilePath = path.join(tempDir, `thumb_preview_text_${ts}.txt`);
  const secondaryTextFilePath = path.join(tempDir, `thumb_preview_text2_${ts}.txt`);
  const timeSec = Number(options.thumbnailTimeSec);

  try {
    const extractRes = await extractFrameToPng(ffmpegPath, options.videoPath, timeSec, framePng);
    if (!extractRes.success) {
      return { success: false, error: extractRes.error };
    }

    const sourceMeta = await getVideoMetadata(options.videoPath);
    const sourceWidth = sourceMeta.success && sourceMeta.metadata
      ? sourceMeta.metadata.width
      : 1920;
    const sourceHeight = sourceMeta.success && sourceMeta.metadata
      ? (sourceMeta.metadata.actualHeight || sourceMeta.metadata.height)
      : 1080;

    const outputCanvas = options.renderMode === 'hardsub_portrait_9_16'
      ? resolvePortraitCanvasByPreset(options.renderResolution)
      : resolveLandscapeCanvasBySource(sourceWidth, sourceHeight, options.renderResolution);
    const safeW = ensureEven(outputCanvas.width);
    const safeH = ensureEven(outputCanvas.height);

    const drawTextContext = await buildThumbnailDrawTextFilter({
      thumbnailText: options.thumbnailText,
      thumbnailTextSecondary: options.thumbnailTextSecondary,
      thumbnailFontName: options.thumbnailFontName,
      thumbnailFontSize: options.thumbnailFontSize,
      thumbnailTextPrimaryFontName: options.thumbnailTextPrimaryFontName,
      thumbnailTextPrimaryFontSize: options.thumbnailTextPrimaryFontSize,
      thumbnailTextPrimaryColor: options.thumbnailTextPrimaryColor,
      thumbnailTextSecondaryFontName: options.thumbnailTextSecondaryFontName,
      thumbnailTextSecondaryFontSize: options.thumbnailTextSecondaryFontSize,
      thumbnailTextSecondaryColor: options.thumbnailTextSecondaryColor,
      thumbnailLineHeightRatio: options.thumbnailLineHeightRatio,
      thumbnailTextPrimaryPosition: options.thumbnailTextPrimaryPosition,
      thumbnailTextSecondaryPosition: options.thumbnailTextSecondaryPosition,
      renderMode: options.renderMode,
      outputWidth: safeW,
      outputHeight: safeH,
      sourceWidth,
      sourceHeight,
      textFilePath,
      secondaryTextFilePath,
    });

    const layoutResult = options.renderMode === 'hardsub_portrait_9_16'
      ? buildPortraitThumbnailFilter(safeW, safeH, sourceWidth, sourceHeight, drawTextContext.drawTextFilter)
      : buildLandscapeThumbnailFilter(safeW, safeH, drawTextContext.drawTextFilter);

    let stderr = '';
    const chunks: Buffer[] = [];
    const args = [
      '-y',
      '-i', framePng,
      '-filter_complex', layoutResult.filterComplex,
      '-map', `[${layoutResult.outputLabel}]`,
      '-frames:v', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-',
    ];

    const ok = await new Promise<boolean>((resolve) => {
      const proc = spawn(ffmpegPath, args);
      proc.stdout?.on('data', (d) => chunks.push(d as Buffer));
      proc.stderr?.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => resolve(code === 0 && chunks.length > 0));
      proc.on('error', () => resolve(false));
    });

    if (!ok) {
      return { success: false, error: `Không render được thumbnail preview frame\n${stderr.slice(-400)}` };
    }

    const frameBuffer = Buffer.concat(chunks);
    const thumbTextLog = summarizeThumbnailTextForLog(options.thumbnailText);
    const thumbText2Log = summarizeThumbnailTextForLog(options.thumbnailTextSecondary);
    console.log('[ThumbnailPreview] render frame success', {
      mode: options.renderMode || 'hardsub',
      renderResolution: options.renderResolution || 'original',
      sourceSize: `${sourceWidth}x${sourceHeight}`,
      outputSize: `${safeW}x${safeH}`,
      thumbnailTimeSec: timeSec,
      text1Length: thumbTextLog.length,
      text1Preview: thumbTextLog.preview,
      text2Length: thumbText2Log.length,
      text2Preview: thumbText2Log.preview,
      textPrimaryFontName: options.thumbnailTextPrimaryFontName || options.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME,
      textPrimaryFontSize: drawTextContext.primaryFontSize,
      textSecondaryFontName: options.thumbnailTextSecondaryFontName || options.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME,
      textSecondaryFontSize: drawTextContext.secondaryFontSize,
      textLineHeightRatio: normalizeThumbnailLineHeightRatio(options.thumbnailLineHeightRatio),
      textLineSpacing: {
        primary: drawTextContext.primaryLineSpacing,
        secondary: drawTextContext.secondaryLineSpacing,
      },
      textRegion: drawTextContext.textRegion,
      textPrimaryPosition: drawTextContext.primaryPosition,
      textSecondaryPosition: drawTextContext.secondaryPosition,
      textPrimaryLayout: summarizeLayoutForLog(drawTextContext.primaryLayout),
      textSecondaryLayout: summarizeLayoutForLog(drawTextContext.secondaryLayout),
      layout: layoutResult.debug,
    });

    return {
      success: true,
      frameData: frameBuffer.toString('base64'),
      width: safeW,
      height: safeH,
      debug: {
        ...layoutResult.debug,
        sourceSize: { width: sourceWidth, height: sourceHeight },
        outputSize: { width: safeW, height: safeH },
        thumbnailTimeSec: timeSec,
        thumbnailTextSecondary: options.thumbnailTextSecondary,
        textPrimaryFontName: options.thumbnailTextPrimaryFontName || options.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME,
        textPrimaryFontSize: drawTextContext.primaryFontSize,
        textSecondaryFontName: options.thumbnailTextSecondaryFontName || options.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME,
        textSecondaryFontSize: drawTextContext.secondaryFontSize,
        textLineHeightRatio: normalizeThumbnailLineHeightRatio(options.thumbnailLineHeightRatio),
        textLineSpacing: {
          primary: drawTextContext.primaryLineSpacing,
          secondary: drawTextContext.secondaryLineSpacing,
        },
        textRegion: drawTextContext.textRegion,
        textPrimaryPosition: drawTextContext.primaryPosition,
        textSecondaryPosition: drawTextContext.secondaryPosition,
        textPrimaryLayout: summarizeLayoutForLog(drawTextContext.primaryLayout),
        textSecondaryLayout: summarizeLayoutForLog(drawTextContext.secondaryLayout),
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  } finally {
    try { await fs.unlink(framePng); } catch {}
    try { await fs.unlink(textFilePath); } catch {}
    try { await fs.unlink(secondaryTextFilePath); } catch {}
  }
}

export async function applyThumbnailPostProcess(
  options: RenderVideoOptions,
  result: RenderResult
): Promise<RenderResult> {
  const thumbnailDurationSec = normalizeThumbnailDurationSec(options.thumbnailDurationSec);
  console.log(
    `[VideoRenderer] Thumbnail check: enabled=${options.thumbnailEnabled}, videoPath=${!!options.videoPath}, timeSec=${options.thumbnailTimeSec}, durationSec=${thumbnailDurationSec}, mode=${options.renderMode || 'black_bg'}`
  );
  if (!result.success || !options.thumbnailEnabled) {
    return result;
  }

  if (!options.videoPath || options.thumbnailTimeSec === undefined) {
    return {
      success: false,
      error: 'Thiếu cấu hình thumbnail: cần videoPath và thumbnailTimeSec khi bật thumbnailEnabled.',
    };
  }

  const outputMeta = await getVideoMetadata(options.outputPath);
  if (!outputMeta.success || !outputMeta.metadata) {
    return {
      success: false,
      error: `Không đọc được metadata output để tạo thumbnail: ${outputMeta.error || 'unknown error'}`,
    };
  }

  const sourceMeta = await getVideoMetadata(options.videoPath);
  const sourceWidth = sourceMeta.success && sourceMeta.metadata
    ? sourceMeta.metadata.width
    : undefined;
  const sourceHeight = sourceMeta.success && sourceMeta.metadata
    ? (sourceMeta.metadata.actualHeight || sourceMeta.metadata.height)
    : undefined;

  console.log('[VideoRenderer] Thumbnail output metadata', {
    width: outputMeta.metadata.width,
    height: outputMeta.metadata.actualHeight || outputMeta.metadata.height,
    fps: outputMeta.metadata.fps,
    hasAudio: !!outputMeta.metadata.hasAudio,
    duration: outputMeta.metadata.duration,
  });

  const thumbTextLog = summarizeThumbnailTextForLog(options.thumbnailText);
  const thumbText2Log = summarizeThumbnailTextForLog(options.thumbnailTextSecondary);
  console.log(
    `[VideoRenderer] 🖼 Tạo thumbnail tại ${options.thumbnailTimeSec}s`,
    {
      renderMode: options.renderMode || 'black_bg',
      sourceSize: sourceWidth && sourceHeight ? `${sourceWidth}x${sourceHeight}` : 'unknown',
      outputSize: `${outputMeta.metadata.width}x${outputMeta.metadata.actualHeight || outputMeta.metadata.height}`,
      durationSec: thumbnailDurationSec,
      text1Length: thumbTextLog.length,
      text1Preview: thumbTextLog.preview,
      text2Length: thumbText2Log.length,
      text2Preview: thumbText2Log.preview,
      textPrimaryFontName: options.thumbnailTextPrimaryFontName || options.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME,
      textPrimaryFontSize: normalizeThumbnailFontSize(options.thumbnailTextPrimaryFontSize ?? options.thumbnailFontSize),
      textSecondaryFontName: options.thumbnailTextSecondaryFontName || options.thumbnailFontName || DEFAULT_THUMBNAIL_FONT_NAME,
      textSecondaryFontSize: normalizeThumbnailFontSize(
        options.thumbnailTextSecondaryFontSize ?? options.thumbnailFontSize
      ),
      textLineHeightRatio: normalizeThumbnailLineHeightRatio(options.thumbnailLineHeightRatio),
      thumbnailTextPrimaryPosition: options.thumbnailTextPrimaryPosition || DEFAULT_THUMBNAIL_TEXT1_POSITION,
      thumbnailTextSecondaryPosition: options.thumbnailTextSecondaryPosition || DEFAULT_THUMBNAIL_TEXT2_POSITION,
    }
  );

  const thumbResult = await createThumbnailClip({
    videoPath: options.videoPath,
    timeSec: options.thumbnailTimeSec,
    durationSec: thumbnailDurationSec,
    thumbnailText: options.thumbnailText,
    thumbnailTextSecondary: options.thumbnailTextSecondary,
    thumbnailFontName: options.thumbnailFontName,
    thumbnailFontSize: options.thumbnailFontSize,
    thumbnailTextPrimaryFontName: options.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: options.thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryColor: options.thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName: options.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: options.thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryColor: options.thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio: options.thumbnailLineHeightRatio,
    thumbnailTextPrimaryPosition: options.thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition: options.thumbnailTextSecondaryPosition,
    width: outputMeta.metadata.width,
    height: outputMeta.metadata.actualHeight || outputMeta.metadata.height,
    renderMode: options.renderMode,
    sourceWidth,
    sourceHeight,
    fps: outputMeta.metadata.fps,
    includeAudio: !!outputMeta.metadata.hasAudio,
  });

  if (!thumbResult.success || !thumbResult.clipPath) {
    return { success: false, error: `Tạo thumbnail thất bại: ${thumbResult.error || 'unknown error'}` };
  }

  console.log('[VideoRenderer] Ghép thumbnail vào đầu video...');
  const prependResult = await prependThumbnailClip(
    thumbResult.clipPath,
    options.outputPath,
    !!outputMeta.metadata.hasAudio
  );

  if (!prependResult.success) {
    return { success: false, error: `Ghép thumbnail thất bại: ${prependResult.error || 'unknown error'}` };
  }

  console.log('[VideoRenderer] ✅ Thumbnail đã ghép thành công');
  return result;
}
