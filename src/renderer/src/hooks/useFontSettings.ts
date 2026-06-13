import { useEffect, useState, useCallback } from 'react';

interface FontSettings {
  uiFontFamily: string;
  uiFontSize: number;
}

const FONT_FALLBACK: FontSettings = {
  uiFontFamily: 'Inter',
  uiFontSize: 14,
};

function applyFontSettings(settings: FontSettings): void {
  const root = window.document.documentElement;
  root.style.setProperty('--font-sans', `${settings.uiFontFamily}, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`);
  root.style.setProperty('--font-size-base', `${settings.uiFontSize}px`);
}

export function useFontEffect() {
  const [settings, setSettings] = useState<FontSettings>(FONT_FALLBACK);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await window.electronAPI.appSettings.getAll();
        if (cancelled) return;
        if (result.success && result.data) {
          const s: FontSettings = {
            uiFontFamily: typeof result.data.uiFontFamily === 'string' ? result.data.uiFontFamily : FONT_FALLBACK.uiFontFamily,
            uiFontSize: typeof result.data.uiFontSize === 'number' ? result.data.uiFontSize : FONT_FALLBACK.uiFontSize,
          };
          setSettings(s);
          applyFontSettings(s);
        } else {
          applyFontSettings(FONT_FALLBACK);
        }
      } catch {
        applyFontSettings(FONT_FALLBACK);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    applyFontSettings(settings);
  }, [settings, loaded]);

  const updateFontSettings = useCallback(async (partial: Partial<FontSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    applyFontSettings(next);
    try {
      await window.electronAPI.appSettings.update(partial);
    } catch (err) {
      console.error('[useFontSettings] Loi luu font settings:', err);
    }
  }, [settings]);

  return { settings, loaded, updateFontSettings };
}
