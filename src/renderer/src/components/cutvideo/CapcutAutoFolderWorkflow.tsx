import React, { useEffect, useMemo, useState } from 'react';
import styles from './CutVideo.module.css';
import { Button } from '../common/Button';
import { ArrowLeft, Folder, FolderPlus, Play, Square, Trash2, X } from 'lucide-react';

type AudioPolicy = 'prefer_existing' | 'force_extract';

interface FolderPreview {
  folderPath: string;
  folderName: string;
  projectPath: string;
  videoPath?: string;
  videoName?: string;
  videoSizeBytes?: number;
  existingAudioPath?: string;
  existingAudioName?: string;
  existingAudioSizeBytes?: number;
  draftStatus: 'exists' | 'create';
  canProcess: boolean;
  message?: string;
}

interface AutoProgress {
  total: number;
  current: number;
  percent: number;
  currentFolderName?: string;
  stage: 'preflight' | 'scanning' | 'processing' | 'completed' | 'stopped' | 'error';
  message: string;
}

interface AutoLog {
  time: string;
  status: 'info' | 'processing' | 'success' | 'error';
  message: string;
  folderPath?: string;
  folderName?: string;
}

interface AutoResultItem {
  folderPath: string;
  folderName: string;
  projectPath: string;
  draftStatus: 'exists' | 'created' | 'error';
  audioStatus: 'existing' | 'extracted' | 'error';
  videoPath?: string;
  audioPath?: string;
  status: 'success' | 'error';
  error?: string;
}

function fmtSize(sizeBytes?: number): string {
  if (!sizeBytes || sizeBytes <= 0) return '--';
  const mb = sizeBytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export const CapcutAutoFolderWorkflow: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [audioPolicy, setAudioPolicy] = useState<AudioPolicy>('prefer_existing');
  const [isScanning, setIsScanning] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [previews, setPreviews] = useState<FolderPreview[]>([]);
  const [logs, setLogs] = useState<AutoLog[]>([]);
  const [results, setResults] = useState<AutoResultItem[]>([]);
  const [progress, setProgress] = useState<AutoProgress>({
    total: 0,
    current: 0,
    percent: 0,
    stage: 'preflight',
    message: 'Sẵn sàng xử lý.',
  });

  useEffect(() => {
    if (!window.electronAPI?.cutVideo) return;
    const cleanProgress = window.electronAPI.cutVideo.onCapcutAutoProgress((data) => {
      setProgress(data);
    });
    const cleanLog = window.electronAPI.cutVideo.onCapcutAutoLog((data) => {
      setLogs((prev) => [data, ...prev].slice(0, 400));
    });
    return () => {
      cleanProgress();
      cleanLog();
    };
  }, []);

  const scanFolders = async (paths: string[]) => {
    setIsScanning(true);
    try {
      const res = await window.electronAPI.cutVideo.scanCapcutAutoBatch(paths);
      if (!res.success || !res.data) {
        setPreviews([]);
        setProgress({
          total: 0,
          current: 0,
          percent: 0,
          stage: 'error',
          message: res.error || 'Không thể quét folder.',
        });
        return;
      }
      setPreviews(res.data.folders);
      setProgress({
        total: res.data.total,
        current: 0,
        percent: 0,
        stage: 'scanning',
        message: `Đã quét ${res.data.total} folder.`,
      });
    } catch (error) {
      setPreviews([]);
      setProgress({
        total: 0,
        current: 0,
        percent: 0,
        stage: 'error',
        message: String(error),
      });
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (folderPaths.length === 0) {
      setPreviews([]);
      return;
    }
    const timer = setTimeout(() => {
      void scanFolders(folderPaths);
    }, 150);
    return () => clearTimeout(timer);
  }, [folderPaths]);

  const handleAddFolders = async () => {
    try {
      const picked = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openDirectory', 'multiSelections'],
      }) as { canceled: boolean; filePaths: string[] };
      if (picked?.canceled || !picked?.filePaths?.length) return;
      const set = new Set(folderPaths);
      for (const filePath of picked.filePaths) {
        set.add(filePath);
      }
      setFolderPaths(Array.from(set));
    } catch (error) {
      console.error('Lỗi chọn folder:', error);
    }
  };

  const handleRemoveFolder = (folderPath: string) => {
    setFolderPaths((prev) => prev.filter((item) => item !== folderPath));
  };

  const handleClearFolders = () => {
    setFolderPaths([]);
    setResults([]);
  };

  const handleStart = async () => {
    if (folderPaths.length === 0) {
      alert('Vui lòng chọn ít nhất một folder.');
      return;
    }
    if (previews.length === 0) {
      alert('Chưa có dữ liệu preview để xử lý.');
      return;
    }
    setIsRunning(true);
    setResults([]);
    setLogs([]);
    try {
      const res = await window.electronAPI.cutVideo.startCapcutAutoBatch({
        folderPaths,
        audioPolicy,
      });
      if (res.data?.results) {
        setResults(res.data.results);
      }
      if (!res.success) {
        alert(res.error || 'Xử lý batch thất bại.');
      }
    } catch (error) {
      alert(String(error));
    } finally {
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    try {
      await window.electronAPI.cutVideo.stopCapcutAutoBatch();
    } catch (error) {
      console.error(error);
    }
  };

  const clearLogs = () => setLogs([]);

  const canStart = useMemo(
    () => previews.some((item) => item.canProcess) && !isRunning && !isScanning,
    [previews, isRunning, isScanning],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.panelTopBar}>
        <button className={styles.panelBackButton} type="button" onClick={() => onBack?.()}>
          <ArrowLeft size={14} />
          Quay lại danh sách
        </button>
        <div className={styles.panelTopActions}>
          <Button variant="danger" onClick={handleStop} disabled={!isRunning}>
            <Square size={16} style={{ marginRight: '8px' }} /> Dừng
          </Button>
          <Button variant="success" onClick={handleStart} disabled={!canStart}>
            <Play size={16} style={{ marginRight: '8px' }} /> Chạy Auto
          </Button>
        </div>
      </div>

      <div className={styles.panelLayout}>
        <div className={styles.panelColumn}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Folder nguồn (cũng là project CapCut)</h3>
              <div className={styles.flexRow}>
                <Button variant="secondary" onClick={handleAddFolders} disabled={isRunning}>
                  <FolderPlus size={16} style={{ marginRight: '8px' }} /> Thêm folder
                </Button>
                <Button variant="secondary" onClick={handleClearFolders} disabled={isRunning || folderPaths.length === 0}>
                  <Trash2 size={16} style={{ marginRight: '8px' }} /> Xóa hết
                </Button>
              </div>
            </div>

            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  className={styles.radio}
                  type="radio"
                  checked={audioPolicy === 'prefer_existing'}
                  onChange={() => setAudioPolicy('prefer_existing')}
                  disabled={isRunning}
                />
                Ưu tiên audio có sẵn, thiếu thì tự tách từ mp4
              </label>
              <label className={styles.radioLabel}>
                <input
                  className={styles.radio}
                  type="radio"
                  checked={audioPolicy === 'force_extract'}
                  onChange={() => setAudioPolicy('force_extract')}
                  disabled={isRunning}
                />
                Luôn tách audio mới từ mp4
              </label>
            </div>

            <div className={styles.folderGrid}>
              {folderPaths.length === 0 ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>
                  Chưa có folder nào.
                </div>
              ) : (
                folderPaths.map((folderPath) => {
                  const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
                  return (
                    <div key={folderPath} className={styles.folderBox} title={folderPath}>
                      <div className={styles.folderBoxHeader}>
                        <Folder size={16} color="var(--color-primary)" />
                        <span className={styles.folderName}>{folderName}</span>
                      </div>
                      <div className={styles.folderBoxSubText}>{folderPath}</div>
                      <button className={styles.removeFolderBoxBtn} title="Xóa folder" onClick={() => handleRemoveFolder(folderPath)}>
                        <X size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className={`${styles.section} ${styles.sectionStretch}`}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Preview xử lý từng folder</h3>
              <Button variant="secondary" onClick={() => void scanFolders(folderPaths)} disabled={isRunning || folderPaths.length === 0}>
                Quét lại
              </Button>
            </div>
            <div className={`${styles.tableContainer} ${styles.tableContainerStretch}`}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Folder</th>
                    <th>Video mp4 (lớn nhất)</th>
                    <th>Audio sẵn có</th>
                    <th>Draft</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={styles.textMuted} style={{ textAlign: 'center' }}>
                        Chưa có dữ liệu preview.
                      </td>
                    </tr>
                  ) : previews.map((item) => (
                    <tr key={item.folderPath}>
                      <td title={item.folderPath}>{item.folderName}</td>
                      <td title={item.videoPath || ''}>
                        {item.videoName ? `${item.videoName} (${fmtSize(item.videoSizeBytes)})` : '--'}
                      </td>
                      <td title={item.existingAudioPath || ''}>
                        {item.existingAudioName ? `${item.existingAudioName} (${fmtSize(item.existingAudioSizeBytes)})` : 'Không có'}
                      </td>
                      <td>
                        {item.draftStatus === 'exists' ? (
                          <span className={`${styles.badge} ${styles.badgeSuccess}`}>Đã có</span>
                        ) : (
                          <span className={`${styles.badge} ${styles.bagdePending}`}>Sẽ tạo</span>
                        )}
                      </td>
                      <td title={item.message || ''}>
                        {item.canProcess ? (
                          <span className={`${styles.badge} ${styles.badgeSuccess}`}>Sẵn sàng</span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgeError}`}>{item.message || 'Lỗi'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className={`${styles.panelColumn} ${styles.panelColumnSticky}`}>
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Tiến trình</h3>
            <div className={styles.progressContainer}>
              <div className={styles.progressItem}>
                <div className={styles.progressLabel}>
                  <span>{progress.message}</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className={styles.progressBar}>
                  <div className={`${styles.progressFill} ${styles.progressFillBlue}`} style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            </div>
            <div className={styles.textMuted} style={{ fontSize: 12, marginTop: 8 }}>
              {progress.total > 0 ? `Đã xử lý ${progress.current}/${progress.total}` : 'Chưa bắt đầu.'}
              {progress.currentFolderName ? ` | Folder: ${progress.currentFolderName}` : ''}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Nhật ký</h3>
              <button className={styles.iconButton} title="Xóa log" onClick={clearLogs}>
                <Trash2 size={16} />
              </button>
            </div>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Trạng thái</th>
                    <th>Nội dung</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => (
                    <tr key={`${log.time}-${index}`}>
                      <td>{log.time}</td>
                      <td>
                        {log.status === 'success' && <span className={`${styles.badge} ${styles.badgeSuccess}`}>OK</span>}
                        {log.status === 'error' && <span className={`${styles.badge} ${styles.badgeError}`}>Lỗi</span>}
                        {log.status === 'processing' && <span className={`${styles.badge} ${styles.badgeProcessing}`}>Đang chạy</span>}
                        {log.status === 'info' && <span className={`${styles.badge} ${styles.bagdePending}`}>Info</span>}
                      </td>
                      <td>
                        {log.folderName ? `[${log.folderName}] ` : ''}
                        {log.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Kết quả</h3>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Folder</th>
                    <th>Draft</th>
                    <th>Audio</th>
                    <th>Trạng thái</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={styles.textMuted} style={{ textAlign: 'center' }}>
                        Chưa có kết quả.
                      </td>
                    </tr>
                  ) : results.map((item) => (
                    <tr key={item.folderPath}>
                      <td title={item.folderPath}>{item.folderName}</td>
                      <td>{item.draftStatus}</td>
                      <td>{item.audioStatus}</td>
                      <td>
                        {item.status === 'success' ? (
                          <span className={`${styles.badge} ${styles.badgeSuccess}`}>OK</span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgeError}`}>Lỗi</span>
                        )}
                      </td>
                      <td title={item.error || item.audioPath || ''}>{item.error || item.audioPath || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
