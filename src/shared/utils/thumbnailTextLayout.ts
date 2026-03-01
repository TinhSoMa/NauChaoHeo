export interface ThumbnailTextLayoutInput {
  text?: string;
  maxWidthPx: number;
  regionHeightPx: number;
  fontSizePx: number;
  maxLines?: number;
  lineHeightRatio?: number;
  autoWrap?: boolean;
  measureTextWidth?: (value: string) => number;
}

export interface ThumbnailTextLayoutResult {
  lines: string[];
  textForDraw: string;
  lineCount: number;
  truncated: boolean;
  wrapped: boolean;
  maxLinesApplied: number;
  effectiveMaxLines: number;
  lineHeightPx: number;
  maxWidthPx: number;
}

const DEFAULT_MAX_LINES = 3;
const DEFAULT_LINE_HEIGHT_RATIO = 1.16;

function clampMin(value: number, minValue: number): number {
  return Number.isFinite(value) ? Math.max(minValue, value) : minValue;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeInputText(value?: string): string {
  if (typeof value !== 'string') return '';
  return normalizeNewlines(value).trim();
}

function estimateCharacterWidthRatio(char: string): number {
  if (char === ' ') return 0.34;
  if (/[ilI\.,:;'`!|]/.test(char)) return 0.34;
  if (/[mwMW@#%&]/.test(char)) return 0.92;
  if (/[0-9]/.test(char)) return 0.62;
  if (/[A-Z]/.test(char)) return 0.74;
  if (char.charCodeAt(0) > 0x2e80) return 1.0;
  return 0.64;
}

export function estimateTextWidthPx(value: string, fontSizePx: number): number {
  if (!value) return 0;
  const safeFontSize = clampMin(fontSizePx, 1);
  let units = 0;
  for (const ch of Array.from(value)) {
    units += estimateCharacterWidthRatio(ch);
  }
  return units * safeFontSize;
}

function splitTokenByWidth(
  token: string,
  maxWidthPx: number,
  measureWidth: (input: string) => number
): string[] {
  if (!token) return [''];
  if (measureWidth(token) <= maxWidthPx) return [token];
  const chars = Array.from(token);
  const chunks: string[] = [];
  let current = '';
  for (const ch of chars) {
    const candidate = `${current}${ch}`;
    if (current && measureWidth(candidate) > maxWidthPx) {
      chunks.push(current);
      current = ch;
      continue;
    }
    current = candidate;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.length > 0 ? chunks : [token];
}

function wrapSingleHardLine(
  line: string,
  maxWidthPx: number,
  measureWidth: (input: string) => number
): { lines: string[]; wrapped: boolean } {
  const normalized = line.trim();
  if (!normalized) {
    return { lines: [''], wrapped: false };
  }
  if (measureWidth(normalized) <= maxWidthPx) {
    return { lines: [normalized], wrapped: false };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const wrappedLines: string[] = [];
  let current = '';
  let wrapped = false;

  const pushCurrent = () => {
    if (current) {
      wrappedLines.push(current);
      current = '';
    }
  };

  for (const word of words) {
    const wordParts = splitTokenByWidth(word, maxWidthPx, measureWidth);
    for (const part of wordParts) {
      if (!current) {
        current = part;
        if (part !== word) wrapped = true;
        continue;
      }
      const candidate = `${current} ${part}`;
      if (measureWidth(candidate) <= maxWidthPx) {
        current = candidate;
        continue;
      }
      wrapped = true;
      pushCurrent();
      current = part;
    }
  }

  pushCurrent();
  return { lines: wrappedLines.length > 0 ? wrappedLines : [''], wrapped };
}

export function layoutThumbnailText(input: ThumbnailTextLayoutInput): ThumbnailTextLayoutResult {
  const normalized = normalizeInputText(input.text);
  const maxWidthPx = clampMin(input.maxWidthPx, 1);
  const safeFontSize = clampMin(input.fontSizePx, 1);
  const lineHeightRatio = clampMin(input.lineHeightRatio ?? DEFAULT_LINE_HEIGHT_RATIO, 0);
  const lineHeightPx = safeFontSize * lineHeightRatio;
  const maxLinesApplied = Math.max(1, Math.floor(input.maxLines ?? DEFAULT_MAX_LINES));
  const allowedByHeight = Math.max(1, Math.floor(clampMin(input.regionHeightPx, lineHeightPx) / lineHeightPx));
  const effectiveMaxLines = Math.max(1, Math.min(maxLinesApplied, allowedByHeight));
  const measureWidth = input.measureTextWidth || ((value: string) => estimateTextWidthPx(value, safeFontSize));
  const autoWrap = input.autoWrap !== false;

  if (!normalized) {
    return {
      lines: [],
      textForDraw: '',
      lineCount: 0,
      truncated: false,
      wrapped: false,
      maxLinesApplied,
      effectiveMaxLines,
      lineHeightPx,
      maxWidthPx,
    };
  }

  const hardLines = normalizeNewlines(normalized).split('\n');
  const wrappedLines: string[] = [];
  let wrapped = false;
  for (const hardLine of hardLines) {
    if (!autoWrap) {
      wrappedLines.push(hardLine.trim());
      continue;
    }
    const part = wrapSingleHardLine(hardLine, maxWidthPx, measureWidth);
    wrapped ||= part.wrapped;
    wrappedLines.push(...part.lines);
  }

  let truncated = false;
  let lines = wrappedLines;
  if (lines.length > effectiveMaxLines) {
    truncated = true;
    lines = lines.slice(0, effectiveMaxLines);
  }

  return {
    lines,
    textForDraw: lines.join('\n'),
    lineCount: lines.length,
    truncated,
    wrapped,
    maxLinesApplied,
    effectiveMaxLines,
    lineHeightPx,
    maxWidthPx,
  };
}
