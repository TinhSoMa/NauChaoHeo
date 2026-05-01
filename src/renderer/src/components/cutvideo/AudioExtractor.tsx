import React, { useState, useEffect } from 'react';
import styles from './CutVideo.module.css';
import { Button } from '../common/Button';
import { Play, Square, FolderPlus, Trash2, X, Folder, Film, ArrowLeft } from 'lucide-react';
import { useFolderManager } from './hooks/useFolderManager';

interface LogItem {
  file: string;
  folder: string;
  status: string;
  time: string;
  phase?: 'extract' | 'capcut_attach';
  detail?: string;
}

const DEFAULT_CAPCUT_PROJECT_PATH = '';

export const AudioExtractor: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { folders, handleAddFolders, handleRemoveFolder, handleClearFolders } = useFolderManager();

  // ----- Process State -----
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ totalPercent: 0, currentFile: '', currentPercent: 0 });
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [capcutProjectPath, setCapcutProjectPath] = useState(DEFAULT_CAPCUT_PROJECT_PATH);

  // ----- Setup IPC Listeners -----
  useEffect(() => {
    if (!window.electronAPI?.cutVideo) return;

    const cleanupProgress = window.electronAPI.cutVideo.onExtractionProgress((data: any) => {
      setProgress(data);
    });

    const cleanupLog = window.electronAPI.cutVideo.onExtractionLog((newLog: LogItem) => {
      setLogs((prev) => {
        const existingIndex = prev.findIndex(
          (l) => l.file === newLog.file && l.folder === newLog.folder && l.phase === newLog.phase,
        );
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

  const handlePickCapcutProjectFolder = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openDirectory'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) return;
      setCapcutProjectPath(result.filePaths[0]);
    } catch (error) {
      console.error('Lỗi chọn thư mục project CapCut:', error);
    }
  };

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
        overwrite: false,
        capcutProjectPath: capcutProjectPath.trim() || undefined,
        autoAttachToCapcut: true,
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
      case 'info': return <span className={`${styles.badge} ${styles.bagdePending}`}>ℹ️ Info</span>;
      case 'pending': return <span className={`${styles.badge} ${styles.bagdePending}`}>⏸ Chờ</span>;
      default: return null;
    }
  };

  const phaseLabel = (phase?: LogItem['phase']) => {
    if (phase === 'capcut_attach') return 'CapCut';
    return 'Extract';
  };

  return (
    <div className={styles.panel}>
      {/* <h2 className={styles.panelTitle}>🎵 TÁCH AUDIO NHIỀU THƯ MỤC</h2> */}
      <div className={styles.panelTopBar}>
        <button className={styles.panelBackButton} type="button" onClick={() => onBack?.()}>
          <ArrowLeft size={14} />
          Quay lại danh sách
        </button>
        <div className={styles.panelTopActions}>
          <Button variant="danger" onClick={handleStop} disabled={!isProcessing}>
            <Square size={16} style={{ marginRight: '8px' }} /> Dừng
          </Button>
          <Button variant="success" onClick={handleStart} disabled={isProcessing}>
            <Play size={16} style={{ marginRight: '8px' }} /> Bắt đầu Tách
          </Button>
        </div>
      </div>

      <div className={styles.panelLayout}>
        <div className={styles.panelColumn}>
          {/* COMPONENT 1: SOURCE FOLDERS */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Thư mục nguồn</h3>
              <div className={styles.flexRow}>
                <Button variant="secondary" onClick={handleAddFolders}>
                  <FolderPlus size={16} style={{ marginRight: '8px' }} /> Thêm thư mục
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleClearFolders}
                  disabled={folders.length === 0}
                >
                  <Trash2 size={16} style={{ marginRight: '8px' }} /> Xóa hết
                </Button>
              </div>
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

          <details className={styles.sectionCompact}>
            <summary className={styles.sectionSummary}>Project CapCut (tùy chọn)</summary>
            <div className={styles.inputGroup}>
              <input
                className={styles.input}
                value={capcutProjectPath}
                onChange={(e) => setCapcutProjectPath(e.target.value)}
                placeholder="Để trống = dùng chính folder đang xử lý"
                disabled={isProcessing}
              />
              <Button variant="secondary" onClick={handlePickCapcutProjectFolder} disabled={isProcessing}>
                <FolderPlus size={14} />
              </Button>
            </div>
          </details>
        </div>

        <div className={`${styles.panelColumn} ${styles.panelColumnSticky}`}>
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
                    <th>Pha</th>
                    <th>Trạng thái</th>
                    <th>Chi tiết</th>
                    <th>Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => (
                    <tr key={`${log.file}-${log.folder}-${log.phase || 'extract'}-${index}`}>
                      <td>{log.file}</td>
                      <td>{log.folder}</td>
                      <td>{phaseLabel(log.phase)}</td>
                      <td>{renderBadge(log.status)}</td>
                      <td title={log.detail || ''}>{log.detail || '--'}</td>
                      <td>{log.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* COMPONENT 5: ACTION BUTTONS */}
        </div>
      </div>

    </div>
  );
};
