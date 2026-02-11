/**
 * OutputSettings - Cau hinh thu muc Projects
 */

import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Save, RotateCcw } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import styles from './Settings.module.css';

interface OutputSettingsProps {
  onBack: () => void;
}

export function OutputSettings({ onBack }: OutputSettingsProps) {
  const [projectsBasePath, setProjectsBasePath] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Load projects base path on mount
  useEffect(() => {
    const loadPath = async () => {
      try {
        const result = await window.electronAPI.appSettings.getProjectsBasePath();
        if (result.success && result.data) {
          setProjectsBasePath(result.data);
        }
      } catch (err) {
        console.error('[OutputSettings] Loi load projects base path:', err);
      } finally {
        setLoading(false);
      }
    };
    loadPath();
  }, []);

  // Browse directory
  const handleBrowse = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openDirectory', {}) as {
        canceled: boolean;
        filePaths: string[];
      };
      if (!result.canceled && result.filePaths.length > 0) {
        setProjectsBasePath(result.filePaths[0]);
      }
    } catch (err) {
      console.error('[OutputSettings] Loi chon thu muc:', err);
    }
  }, []);

  // Save
  const handleSave = useCallback(async () => {
    try {
      const pathToSave = projectsBasePath.trim() || null;
      await window.electronAPI.appSettings.setProjectsBasePath(pathToSave);
      alert('Đã lưu thư mục Projects!');
    } catch (err) {
      console.error('[OutputSettings] Loi luu thu muc Projects:', err);
      alert('Không thể lưu cài đặt');
    }
  }, [projectsBasePath]);

  // Reset
  const handleReset = useCallback(() => {
    setProjectsBasePath('');
  }, []);

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Thư mục Projects</div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Thư mục lưu trữ Projects</span>
              <span className={styles.labelDesc}>
                Tất cả dự án sẽ được tạo trong thư mục này. Ví dụ: D:\NauChaoHeoContent\project1
              </span>
            </div>
            <div className={styles.flexRow}>
              <Input
                value={projectsBasePath}
                onChange={(e) => setProjectsBasePath(e.target.value)}
                placeholder="Ví dụ: D:\NauChaoHeoContent"
                disabled={loading}
              />
              <Button onClick={handleBrowse} disabled={loading}>
                Browse
              </Button>
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Lưu đường dẫn</span>
              <span className={styles.labelDesc}>Lưu cài đặt thư mục Projects</span>
            </div>
            <Button onClick={handleSave} variant="primary" disabled={loading}>
              Lưu
            </Button>
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
