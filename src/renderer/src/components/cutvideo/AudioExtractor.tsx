import React, { useState, useEffect } from 'react';
import styles from './CutVideo.module.css';
import { Button } from '../common/Button';
import { Play, Square, FolderPlus, Trash2, X, Folder, Film } from 'lucide-react';
import { useFolderManager } from './hooks/useFolderManager';

interface LogItem {
  file: string;
  folder: string;
  status: string;
  time: string;
}

export const AudioExtractor: React.FC = () => {
  const { folders, handleAddFolders, handleRemoveFolder } = useFolderManager();

  // ----- Process State -----
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ totalPercent: 0, currentFile: '', currentPercent: 0 });
  const [logs, setLogs] = useState<LogItem[]>([]);

  // ----- Setup IPC Listeners -----
  useEffect(() => {
    if (!window.electronAPI?.cutVideo) return;

    const cleanupProgress = window.electronAPI.cutVideo.onExtractionProgress((data: any) => {
      setProgress(data);
    });

    const cleanupLog = window.electronAPI.cutVideo.onExtractionLog((newLog: LogItem) => {
      setLogs((prev) => {
        const existingIndex = prev.findIndex(l => l.file === newLog.file && l.folder === newLog.folder);
        if (existingIndex >= 0) {
          // Update existing
          const updated = [...prev];
          updated[existingIndex] = newLog;
          return updated;
        } else {
          // Add new
          return [newLog, ...prev].slice(0, 100);
        }
      });
    });

    return () => {
      cleanupProgress();
      cleanupLog();
    };
  }, []);

  // ----- Actions -----
  const handleStart = async () => {
    if (folders.length === 0) {
      alert('Vui lòng chọn ít nhất một thư mục!');
      return;
    }
    setIsProcessing(true);
    setProgress({ totalPercent: 0, currentFile: 'Đang chuẩn bị...', currentPercent: 0 });
    
    try {
      const folderPaths = folders.map(f => f.path);
      const result = await window.electronAPI.cutVideo.startAudioExtraction({
        folders: folderPaths,
        format: 'mp3',
        keepStructure: true,
        overwrite: false
      });

      if (!result.success && result.error) {
        alert(`Lỗi: ${result.error}`);
      }
    } catch (error: any) {
      alert(`Đã xảy ra lỗi: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    if (!isProcessing) return;
    try {
      await window.electronAPI.cutVideo.stopExtraction();
      // State isProcessing will be cleared when startAudioExtraction resolves above
    } catch (error) {
      console.error(error);
    }
  };

  const handleClearLogs = () => setLogs([]);

  const renderBadge = (status: string) => {
    switch (status) {
      case 'completed': return <span className={`${styles.badge} ${styles.badgeSuccess}`}>✅ Hoàn thành</span>;
      case 'processing': return <span className={`${styles.badge} ${styles.badgeProcessing}`}>⏳ Đang xử lý</span>;
      case 'error': return <span className={`${styles.badge} ${styles.badgeError}`}>❌ Lỗi</span>;
      case 'pending': return <span className={`${styles.badge} ${styles.bagdePending}`}>⏸ Chờ</span>;
      default: return null;
    }
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>🎵 TÁCH AUDIO NHIỀU THƯ MỤC</h2>

      {/* COMPONENT 1: SOURCE FOLDERS */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Thư mục nguồn</h3>
          <Button variant="secondary" onClick={handleAddFolders}>
            <FolderPlus size={16} style={{ marginRight: '8px' }} /> Thêm thư mục
          </Button>
        </div>
        <div className={styles.folderGrid}>
          {folders.length === 0 ? (
            <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>Chưa có thư mục nào. Nhấn + để thêm</div>
          ) : (
            folders.map((folder, index) => {
              const folderName = folder.path.split(/[/\\]/).pop() || folder.path;
              return (
                <div key={index} className={styles.folderBox} title={folder.path}>
                  <div className={styles.folderBoxHeader}>
                    <Folder size={16} color="var(--color-primary)" />
                    <span className={styles.folderName}>{folderName}</span>
                  </div>
                  <div className={styles.folderBoxSubText}>
                    <Film size={14} color="var(--color-text-secondary)" />
                    {folder.firstVideoName ? folder.firstVideoName : `${folder.count} files media`}
                  </div>
                  <button className={styles.removeFolderBoxBtn} title="Xóa thư mục" onClick={() => handleRemoveFolder(folder.path)}>
                    <X size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* COMPONENT 3: PROGRESS */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Tiến trình</h3>
        <div className={styles.progressContainer}>
          <div className={styles.progressItem}>
            <div className={styles.progressLabel}>
              <span>Tiến trình tổng</span>
              <span>{progress.totalPercent}%</span>
            </div>
            <div className={styles.progressBar}>
              <div className={`${styles.progressFill} ${styles.progressFillGreen}`} style={{ width: `${progress.totalPercent}%` }}></div>
            </div>
          </div>
          <div className={styles.progressItem}>
            <div className={styles.progressLabel}>
              <span>File hiện tại: {progress.currentFile || '---'}</span>
              <span>{progress.currentPercent}%</span>
            </div>
            <div className={styles.progressBar}>
              <div className={`${styles.progressFill} ${styles.progressFillBlue}`} style={{ width: `${progress.currentPercent}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* COMPONENT 4: LOG TABLE */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Nhật ký xử lý</h3>
          <button className={styles.iconButton} title="Xóa log" onClick={handleClearLogs}>
            <Trash2 size={16} />
          </button>
        </div>
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tên file</th>
                <th>Thư mục nguồn</th>
                <th>Trạng thái</th>
                <th>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={index}>
                  <td>{log.file}</td>
                  <td>{log.folder}</td>
                  <td>{renderBadge(log.status)}</td>
                  <td>{log.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* COMPONENT 5: ACTION BUTTONS */}
      <div className={styles.flexRowRight}>
        <Button variant="danger" onClick={handleStop} disabled={!isProcessing}>
          <Square size={16} style={{ marginRight: '8px' }} /> Dừng
        </Button>
        <Button variant="success" onClick={handleStart} disabled={isProcessing}>
          <Play size={16} style={{ marginRight: '8px' }} /> Bắt đầu Tách
        </Button>
      </div>

    </div>
  );
};
