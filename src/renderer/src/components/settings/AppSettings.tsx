/**
 * AppSettings - Cau hinh giao dien (Theme, Language)
 */

import { useState, useCallback } from 'react';
import { ArrowLeft, Save, RotateCcw } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './Settings.module.css';
import { useThemeStore } from '../../hooks/useTheme';
import { ThemeMode, AppLanguage, THEME_OPTIONS, LANGUAGE_OPTIONS, DEFAULT_APP_LANGUAGE } from './types';

interface AppSettingsProps {
  onBack: () => void;
}

export function AppSettings({ onBack }: AppSettingsProps) {
  const { theme, setTheme } = useThemeStore();
  const [language, setLanguage] = useState<AppLanguage>(DEFAULT_APP_LANGUAGE);

  const handleSave = useCallback(() => {
    console.log('[AppSettings] Luu cai dat:', { theme, language });
    alert('Đã lưu cài đặt giao diện!');
  }, [theme, language]);

  const handleReset = useCallback(() => {
    setTheme('dark');
    setLanguage(DEFAULT_APP_LANGUAGE);
  }, [setTheme]);

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
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
