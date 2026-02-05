/**
 * PromptSettings - Cấu hình prompt cho dịch truyện và tóm tắt
 */

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Save, BookOpen, Sparkles } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './Settings.module.css';

interface PromptSettingsProps {
  onBack: () => void;
}

interface Prompt {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
}

export function PromptSettings({ onBack }: PromptSettingsProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [translationPromptId, setTranslationPromptId] = useState<string>('');
  const [summaryPromptId, setSummaryPromptId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Load prompts và settings hiện tại
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load all prompts using invoke
        const promptsResult: any = await window.electronAPI.invoke('prompt:getAll');
        if (Array.isArray(promptsResult)) {
          setPrompts(promptsResult.map((p: any) => ({
            id: p.id,
            name: p.name,
            sourceLang: p.sourceLang,
            targetLang: p.targetLang
          })));
        }

        // Load current settings
        const settingsResult = await window.electronAPI.appSettings.getAll();
        if (settingsResult.success && settingsResult.data) {
          setTranslationPromptId(settingsResult.data.translationPromptId || '');
          setSummaryPromptId(settingsResult.data.summaryPromptId || '');
        }
      } catch (error) {
        console.error('[PromptSettings] Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const result = await window.electronAPI.appSettings.update({
        translationPromptId: translationPromptId || null,
        summaryPromptId: summaryPromptId || null
      });

      if (result.success) {
        alert('✅ Đã lưu cài đặt prompt!');
      } else {
        alert('❌ Lỗi khi lưu cài đặt: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('[PromptSettings] Error saving:', error);
      alert('❌ Lỗi khi lưu cài đặt: ' + String(error));
    }
  }, [translationPromptId, summaryPromptId]);

  if (loading) {
    return (
      <div className={styles.detailContainer}>
        <div className={styles.detailContent}>
          <p>Đang tải...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Cấu hình Prompts</div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <BookOpen size={20} />
            <span>Prompt cho Dịch Truyện</span>
          </div>
          <p className={styles.sectionDesc}>
            Chọn prompt template sẽ được sử dụng khi dịch truyện. 
            Nếu để trống, hệ thống sẽ tự động tìm prompt dựa trên ngôn ngữ.
          </p>
          
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Prompt Template</span>
            </div>
            <select
              value={translationPromptId}
              onChange={(e) => setTranslationPromptId(e.target.value)}
              className={styles.select}
            >
              <option value="">🔍 Tự động tìm prompt</option>
              {prompts.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sourceLang} → {p.targetLang})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <Sparkles size={20} />
            <span>Prompt cho Tóm Tắt Truyện</span>
          </div>
          <p className={styles.sectionDesc}>
            Chọn prompt template sẽ được sử dụng khi tóm tắt truyện. 
            Nếu để trống, hệ thống sẽ tự động tìm prompt có tên chứa "[SUMMARY]" hoặc "tóm tắt".
          </p>
          
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Prompt Template</span>
            </div>
            <select
              value={summaryPromptId}
              onChange={(e) => setSummaryPromptId(e.target.value)}
              className={styles.select}
            >
              <option value="">🔍 Tự động tìm prompt</option>
              {prompts.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sourceLang} → {p.targetLang})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.saveBar}>
          <Button onClick={handleSave} variant="primary">
            <Save size={16} />
            Lưu cài đặt
          </Button>
        </div>
      </div>
    </div>
  );
}
