/**
 * AppSettings - Cau hinh giao dien (Theme, Language, Font)
 */

import { useState, useCallback } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './Settings.module.css';
import { useThemeStore } from '../../hooks/useTheme';
import { useFontEffect } from '../../hooks/useFontSettings';
import { ThemeMode, AppLanguage, THEME_OPTIONS, LANGUAGE_OPTIONS, DEFAULT_APP_LANGUAGE } from './types';

const FONT_FAMILY_OPTIONS = [
  { value: 'Inter', label: 'Inter (Mặc định)' },
  { value: 'system-ui', label: 'System UI' },
  { value: 'Noto Sans', label: 'Noto Sans' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Segoe UI', label: 'Segoe UI' },
];

const FONT_SIZE_OPTIONS = [11, 12, 13, 14, 15, 16, 18, 20];

export function AppSettings() {
  const { theme, setTheme } = useThemeStore();
  const { settings: fontSettings, updateFontSettings } = useFontEffect();
  const [language, setLanguage] = useState<AppLanguage>(DEFAULT_APP_LANGUAGE);
  const [localFontFamily, setLocalFontFamily] = useState(fontSettings.uiFontFamily);
  const [localFontSize, setLocalFontSize] = useState(fontSettings.uiFontSize);

  const handleFontFamilyChange = useCallback(async (value: string) => {
    setLocalFontFamily(value);
    await updateFontSettings({ uiFontFamily: value });
  }, [updateFontSettings]);

  const handleFontSizeChange = useCallback(async (value: number) => {
    setLocalFontSize(value);
    await updateFontSettings({ uiFontSize: value });
  }, [updateFontSettings]);

  const handleSave = useCallback(async () => {
    await updateFontSettings({ uiFontFamily: localFontFamily, uiFontSize: localFontSize });
    console.log('[AppSettings] Luu cai dat giao dien:', { theme, language, localFontFamily, localFontSize });
    alert('Đã lưu cài đặt giao diện!');
  }, [theme, language, localFontFamily, localFontSize, updateFontSettings]);

  const handleReset = useCallback(async () => {
    setTheme('dark');
    setLanguage(DEFAULT_APP_LANGUAGE);
    setLocalFontFamily('Inter');
    setLocalFontSize(14);
    await updateFontSettings({ uiFontFamily: 'Inter', uiFontSize: 14 });
  }, [setTheme, updateFontSettings]);

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitle}>Giao diện</div>
      </div>

      <div className={styles.detailContent}>
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Chế độ màu</span>
            </div>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeMode)}
              className={styles.select}
            >
              {THEME_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Ngôn ngữ hiển thị</span>
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as AppLanguage)}
              className={styles.select}
            >
              {LANGUAGE_OPTIONS.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Font chữ</span>
              <span className={styles.labelDesc}>Chọn font chữ hiển thị cho toàn bộ giao diện</span>
            </div>
            <select
              value={localFontFamily}
              onChange={(e) => handleFontFamilyChange(e.target.value)}
              className={styles.select}
            >
              {FONT_FAMILY_OPTIONS.map(f => (
                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Kích cỡ chữ</span>
              <span className={styles.labelDesc}>Điều chỉnh kích cỡ font cho toàn bộ giao diện</span>
            </div>
            <select
              value={localFontSize}
              onChange={(e) => handleFontSizeChange(Number(e.target.value))}
              className={styles.select}
            >
              {FONT_SIZE_OPTIONS.map(s => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.saveBar}>
          <Button onClick={handleReset} variant="secondary">
            <RotateCcw size={16} />
            Đặt lại mặc định
          </Button>
          <Button onClick={handleSave} variant="primary">
            <Save size={16} />
            Lưu cài đặt
          </Button>
        </div>
      </div>
    </div>
  );
}
