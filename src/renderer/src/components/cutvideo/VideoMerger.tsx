import React, { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Link2, Square, Trash2, X } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './CutVideo.module.css';
import { useProjectContext } from '../../context/ProjectContext';

type MergeMode = '16_9' | '9_16';

interface MergeScanItem {
  inputFolder: string;
  scanDir: string;
  status: 'ok' | 'missing' | 'invalid' | 'mismatch';
  message?: string;
  matchedFilePath?: string;
  fileName?: string;
  metadata?: {
    duration: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    videoCodec: string;
    audioCodec?: string;
  };
}

interface MergeLogItem {
  status: 'info' | 'success' | 'error' | 'processing';
  message: string;
  time: string;
}

interface MergeProgress {
  percent: number;
  stage: 'scan' | 'preflight' | 'concat' | 'completed' | 'stopped' | 'error';
  message: string;
  currentFile?: string;
}

function formatDuration(sec: number): string {
  const safe = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const VideoMerger: React.FC = () => {
  const [folders, setFolders] = useState<Array<{ path: string }>>([]);
  const { paths } = useProjectContext();
  const [mode, setMode] = useState<MergeMode>('9_16');
  const [scanItems, setScanItems] = useState<MergeScanItem[]>([]);
  const [sortedVideoPaths, setSortedVideoPaths] = useState<string[]>([]);
  const [blockingReason, setBlockingReason] = useState<string>('');
  const [canMerge, setCanMerge] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [logs, setLogs] = useState<MergeLogItem[]>([]);
  const [progress, setProgress] = useState<MergeProgress>({
    percent: 0,
    stage: 'scan',
    message: 'Sẵn sàng quét.',
  });
  const [outputPath, setOutputPath] = useState<string>('');

  const outputDir = useMemo(
    () => (paths?.caption ? `${paths.caption.replace(/[\\/]+$/, '')}/merged_output` : ''),
    [paths?.caption]
  );

  useEffect(() => {
    if (!window.electronAPI?.cutVideo) return;

    const cleanupProgress = window.electronAPI.cutVideo.onMergeProgress((data: MergeProgress) => {
      setProgress(data);
    });
    const cleanupLog = window.electronAPI.cutVideo.onMergeLog((data: MergeLogItem) => {
      setLogs((prev) => [data, ...prev].slice(0, 200));
    });

    return () => {
      cleanupProgress();
      cleanupLog();
    };
  }, []);

  useEffect(() => {
    setCanMerge(false);
    setScanItems([]);
    setSortedVideoPaths([]);
    setBlockingReason('');
    setOutputPath('');
    setProgress({ percent: 0, stage: 'scan', message: 'Đã đổi mode, hãy quét lại.' });
  }, [mode]);

  const handleAddFolders = async () => {
    try {
      // @ts-ignore
      const result = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openDirectory', 'multiSelections'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) {
        return;
      }
      setFolders((prev) => {
        const next = [...prev];
        for (const p of result.filePaths) {
          if (!next.some((item) => item.path === p)) {
            next.push({ path: p });
          }
        }
        return next;
      });
    } catch (error) {
      console.error('Lỗi thêm folder merge:', error);
    }
  };

  const handleRemoveFolder = (folderPath: string) => {
    setFolders((prev) => prev.filter((item) => item.path !== folderPath));
  };

  const handleScan = async () => {
    if (!folders.length) {
      alert('Vui lòng thêm ít nhất 1 folder CapCut.');
      return;
    }
    setIsScanning(true);
    setOutputPath('');
    setScanItems([]);
    setSortedVideoPaths([]);
    setCanMerge(false);
    setBlockingReason('');
    setProgress({ percent: 0, stage: 'scan', message: 'Đang quét danh sách video render...' });

    try {
      const folderPaths = folders.map((f) => f.path);
      const res = await window.electronAPI.cutVideo.scanRenderedForMerge({
        folders: folderPaths,
        mode,
      });
      if (!res.success || !res.data) {
        const err = res.error || 'Quét video thất bại';
        setProgress({ percent: 0, stage: 'error', message: err });
        setBlockingReason(err);
        return;
      }

      setScanItems(res.data.items || []);
      setSortedVideoPaths(res.data.sortedVideoPaths || []);
      setCanMerge(!!res.data.canMerge);
      setBlockingReason(res.data.blockingReason || '');
      setProgress({
        percent: res.data.canMerge ? 100 : 0,
        stage: res.data.canMerge ? 'preflight' : 'error',
        message: res.data.canMerge
          ? `Đã quét xong ${res.data.sortedVideoPaths.length} video hợp lệ.`
          : (res.data.blockingReason || 'Danh sách chưa đủ điều kiện nối.'),
      });
    } catch (error) {
      const err = String(error);
      setProgress({ percent: 0, stage: 'error', message: err });
      setBlockingReason(err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleStartMerge = async () => {
    if (!folders.length) {
      alert('Vui lòng chọn folder trước khi nối.');
      return;
    }
    if (!outputDir) {
      alert('Không tìm thấy đường dẫn project caption. Hãy mở project trước.');
      return;
    }
    if (!canMerge) {
      alert(blockingReason || 'Danh sách chưa đủ điều kiện nối.');
      return;
    }

    setIsMerging(true);
    setOutputPath('');
    try {
      const res = await window.electronAPI.cutVideo.startVideoMerge({
        folders: folders.map((f) => f.path),
        mode,
        outputDir,
      });
      if (res.success && res.data?.outputPath) {
        setOutputPath(res.data.outputPath);
      } else {
        alert(res.error || 'Nối video thất bại.');
      }
    } catch (error) {
      alert(String(error));
    } finally {
      setIsMerging(false);
    }
  };

  const handleStop = async () => {
    try {
      await window.electronAPI.cutVideo.stopVideoMerge();
    } catch (error) {
      console.error(error);
    }
  };

  const clearLogs = () => setLogs([]);

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>🔗 NỐI NHIỀU VIDEO RENDER</h2>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Folder CapCut</h3>
          <Button variant="secondary" onClick={handleAddFolders} disabled={isMerging}>
            <FolderPlus size={16} style={{ marginRight: '8px' }} /> Thêm folder
          </Button>
        </div>
        <div className={styles.folderGrid}>
          {folders.length === 0 ? (
            <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>
              Chưa có folder nào. Nhấn Thêm folder để bắt đầu.
            </div>
          ) : (
            folders.map((folder, idx) => {
              const folderName = folder.path.split(/[/\\]/).pop() || folder.path;
              return (
                <div key={`${folder.path}-${idx}`} className={styles.folderBox} title={folder.path}>
                  <div className={styles.folderBoxHeader}>
                    <span className={styles.folderName}>{folderName}</span>
                  </div>
                  <div className={styles.folderBoxSubText}>{folder.path}</div>
                  <button
                    className={styles.removeFolderBoxBtn}
                    onClick={() => handleRemoveFolder(folder.path)}
                    title="Xóa folder"
                    disabled={isMerging}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.grid2}>
          <div>
            <label className={styles.label}>Mode nối</label>
            <select
              className={styles.select}
              value={mode}
              onChange={(e) => setMode(e.target.value as MergeMode)}
              disabled={isMerging}
            >
              <option value="16_9">16:9</option>
              <option value="9_16">9:16</option>
            </select>
          </div>
          <div>
            <label className={styles.label}>Thư mục output</label>
            <input className={styles.input} value={outputDir || 'Chưa có project caption path'} readOnly />
          </div>
        </div>
        {!!blockingReason && <div className={styles.mergeWarning}>{blockingReason}</div>}
        {!!outputPath && <div className={styles.mergeSuccess}>Output: {outputPath}</div>}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Kết quả quét</h3>
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>STT</th>
                <th>Folder</th>
                <th>Video match</th>
                <th>Thông số</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {scanItems.map((item, idx) => {
                const folderName = item.inputFolder.split(/[/\\]/).pop() || item.inputFolder;
                const metaText = item.metadata
                  ? `${item.metadata.width}x${item.metadata.height} | ${item.metadata.fps.toFixed(2)}fps | ${formatDuration(item.metadata.duration)}`
                  : '--';
                return (
                  <tr key={`${item.inputFolder}-${idx}`}>
                    <td>{idx + 1}</td>
                    <td>{folderName}</td>
                    <td>{item.fileName || '--'}</td>
                    <td>{metaText}</td>
                    <td>
                      {item.status === 'ok' && <span className={`${styles.badge} ${styles.badgeSuccess}`}>OK</span>}
                      {item.status === 'missing' && <span className={`${styles.badge} ${styles.badgeError}`}>Thiếu</span>}
                      {item.status === 'invalid' && <span className={`${styles.badge} ${styles.badgeError}`}>Lỗi</span>}
                      {item.status === 'mismatch' && <span className={`${styles.badge} ${styles.badgeError}`}>Lệch</span>}
                      {item.message ? ` ${item.message}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!!sortedVideoPaths.length && (
          <div className={styles.mergeListNote}>
            Thứ tự nối (natural): {sortedVideoPaths.map((p) => p.split(/[/\\]/).pop()).join(' -> ')}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Tiến trình nối</h3>
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
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Log</h3>
          <button className={styles.iconButton} onClick={clearLogs} title="Xóa log">
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
              {logs.map((log, idx) => (
                <tr key={`${log.time}-${idx}`}>
                  <td>{log.time}</td>
                  <td>
                    {log.status === 'success' && <span className={`${styles.badge} ${styles.badgeSuccess}`}>OK</span>}
                    {log.status === 'error' && <span className={`${styles.badge} ${styles.badgeError}`}>Lỗi</span>}
                    {log.status === 'processing' && <span className={`${styles.badge} ${styles.badgeProcessing}`}>Đang chạy</span>}
                    {log.status === 'info' && <span className={`${styles.badge} ${styles.bagdePending}`}>Info</span>}
                  </td>
                  <td>{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.flexRowRight}>
        <Button variant="secondary" onClick={handleScan} disabled={isScanning || isMerging}>
          Quét video
        </Button>
        <Button variant="danger" onClick={handleStop} disabled={!isMerging}>
          <Square size={16} style={{ marginRight: '8px' }} /> Dừng
        </Button>
        <Button variant="success" onClick={handleStartMerge} disabled={isScanning || isMerging || !canMerge}>
          <Link2 size={16} style={{ marginRight: '8px' }} /> Bắt đầu nối
        </Button>
      </div>
    </div>
  );
};
