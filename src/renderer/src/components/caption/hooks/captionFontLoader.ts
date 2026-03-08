const loadedFontPromises = new Map<string, Promise<boolean>>();

function normalizeFontName(fontName: string): string {
  return typeof fontName === 'string' ? fontName.trim() : '';
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeFontQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildStyleId(fontName: string): string {
  const normalized = normalizeFontName(fontName).toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'font';
  return `caption-font-${slug}-${Math.abs(hash).toString(36)}`;
}

function resolveFontFormat(dataUri: string): 'opentype' | 'truetype' {
  if (typeof dataUri === 'string' && dataUri.toLowerCase().includes('font/otf')) {
    return 'opentype';
  }
  return 'truetype';
}

async function loadFontWithStyleTag(fontName: string): Promise<boolean> {
  const safeName = normalizeFontName(fontName);
  if (!safeName) {
    return false;
  }

  const fontQuery = `12px "${escapeFontQuery(safeName)}"`;
  const styleId = buildStyleId(safeName);
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    await document.fonts.load(fontQuery);
    return document.fonts.check(fontQuery);
  }

  const response = await window.electronAPI.captionVideo.getFontData(safeName);
  if (!response?.success || typeof response.data !== 'string' || !response.data.startsWith('data:')) {
    return false;
  }

  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.textContent =
    `@font-face {` +
    `font-family: '${escapeCssString(safeName)}';` +
    `src: url("${response.data}") format("${resolveFontFormat(response.data)}");` +
    `font-display: block;` +
    `}`;
  document.head.appendChild(styleEl);
  await document.fonts.load(fontQuery);
  return document.fonts.check(fontQuery);
}

export async function ensureCaptionFontLoaded(fontName: string): Promise<boolean> {
  const normalized = normalizeFontName(fontName);
  if (!normalized) {
    return false;
  }

  const cached = loadedFontPromises.get(normalized);
  if (cached) {
    return cached;
  }

  const task = (async () => {
    const fontQuery = `12px "${escapeFontQuery(normalized)}"`;
    try {
      await document.fonts.load(fontQuery);
      if (document.fonts.check(fontQuery)) {
        return true;
      }
    } catch {
      // Ignore and fallback to explicit @font-face loading.
    }
    return loadFontWithStyleTag(normalized);
  })();

  loadedFontPromises.set(normalized, task);
  const loaded = await task;
  if (!loaded) {
    loadedFontPromises.delete(normalized);
  }
  return loaded;
}

export async function ensureCaptionFontsLoaded(fontNames: string[]): Promise<void> {
  const unique = Array.from(
    new Set(
      (fontNames || [])
        .map((fontName) => normalizeFontName(fontName))
        .filter(Boolean)
    )
  );

  for (const fontName of unique) {
    await ensureCaptionFontLoaded(fontName);
  }
}
