import React, { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Link2, Square, Trash2, X, ArrowLeft, FilePlus } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './CutVideo.module.css';

type MergeMode = '16_9' | '9_16';
type MergeSourceMode = 'folder' | 'file';

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

export const VideoMerger: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const [sourceMode, setSourceMode] = useState<MergeSourceMode>('folder');
  const [folders, setFolders] = useState<Array<{ path: string }>>([]);
  const [selectedVideos, setSelectedVideos] = useState<string[]>([]);
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
  const [outputDir, setOutputDir] = useState<string>('');
  const [outputDirTouched, setOutputDirTouched] = useState(false);
  const [autoScanKey, setAutoScanKey] = useState<string>('');

  const outputDirLabel = useMemo(() => outputDir || 'Chưa chọn thư mục output', [outputDir]);

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
    if (!outputDirTouched) {
      setOutputDir('');
    }
  }, [mode, sourceMode]);

  useEffect(() => {
    if (outputDirTouched || sourceMode !== 'file') return;
    if (selectedVideos.length === 0) {
      setOutputDir('');
      return;
    }
    const firstPath = selectedVideos[0];
    setOutputDir(firstPath.replace(/[\\/][^\\/]+$/, ''));
  }, [selectedVideos, sourceMode, outputDirTouched]);

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

  const handleAddVideos = async () => {
    try {
      // @ts-ignore
      const result = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Video', extensions: ['mp4', 'mov'] }],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) {
        return;
      }
      setSelectedVideos((prev) => {
        const next = [...prev];
        for (const p of result.filePaths) {
          if (!next.includes(p)) {
            next.push(p);
          }
        }
        return next;
      });
    } catch (error) {
      console.error('Lỗi thêm video merge:', error);
    }
  };

  const handleRemoveFolder = (folderPath: string) => {
    setFolders((prev) => prev.filter((item) => item.path !== folderPath));
  };

  const handleRemoveVideo = (videoPath: string) => {
    setSelectedVideos((prev) => prev.filter((item) => item !== videoPath));
  };

  const handleSelectOutputDir = async () => {
    try {
      // @ts-ignore
      const result = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openDirectory'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) {
        return;
      }
      setOutputDir(result.filePaths[0]);
      setOutputDirTouched(true);
    } catch (error) {
      console.error('Lỗi chọn thư mục output:', error);
    }
  };

  const handleScan = async () => {
    if (sourceMode === 'folder' && !folders.length) {
      alert('Vui lòng thêm ít nhất 1 folder chứa video.');
      return;
    }
    if (sourceMode === 'file' && !selectedVideos.length) {
      alert('Vui lòng chọn ít nhất 1 video để nối.');
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
        folders: sourceMode === 'folder' ? folderPaths : undefined,
        videoPaths: sourceMode === 'file' ? selectedVideos : undefined,
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
      if (!outputDirTouched && res.data.sortedVideoPaths?.length) {
        const firstPath = res.data.sortedVideoPaths[0];
        setOutputDir(firstPath.replace(/[\\/][^\\/]+$/, ''));
      }
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

  useEffect(() => {
    const listSignature =
      sourceMode === 'folder'
        ? folders.map((f) => f.path).sort().join('|')
        : selectedVideos.join('|');
    const signature = `${sourceMode}::${mode}::${listSignature}`;
    const hasItems = sourceMode === 'folder' ? folders.length > 0 : selectedVideos.length > 0;
    if (!hasItems || signature === autoScanKey || isScanning || isMerging) return;
    setAutoScanKey(signature);
    const timer = setTimeout(() => {
      handleScan();
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, selectedVideos, mode, sourceMode]);

  const handleStartMerge = async () => {
    if (sourceMode === 'folder' && !folders.length) {
      alert('Vui lòng chọn folder trước khi nối.');
      return;
    }
    if (sourceMode === 'file' && !selectedVideos.length) {
      alert('Vui lòng chọn video trước khi nối.');
      return;
    }
    if (!outputDir) {
      alert('Vui lòng chọn thư mục output trước khi nối.');
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
        folders: sourceMode === 'folder' ? folders.map((f) => f.path) : undefined,
        videoPaths: sourceMode === 'file' ? selectedVideos : undefined,
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
      <div className={styles.panelTopBar}>
        <button className={styles.panelBackButton} type="button" onClick={() => onBack?.()}>
          <ArrowLeft size={14} />
          Quay lại danh sách
        </button>
        <div className={styles.panelTopActions}>
          <Button variant="secondary" onClick={handleScan} disabled={isScanning || isMerging}>
            Quét lại
          </Button>
          <Button variant="danger" onClick={handleStop} disabled={!isMerging}>
            <Square size={16} style={{ marginRight: '8px' }} /> Dừng
          </Button>
          <Button variant="success" onClick={handleStartMerge} disabled={isScanning || isMerging || !canMerge}>
            <Link2 size={16} style={{ marginRight: '8px' }} /> Bắt đầu nối
          </Button>
        </div>
      </div>


      <div className={styles.panelLayout}>
        <div className={styles.panelColumn}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Nguồn video</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant={sourceMode === 'folder' ? 'primary' : 'secondary'}
                  onClick={() => setSourceMode('folder')}
                  disabled={isMerging}
                >
                  Folder
                </Button>
                <Button
                  variant={sourceMode === 'file' ? 'primary' : 'secondary'}
                  onClick={() => setSourceMode('file')}
                  disabled={isMerging}
                >
                  Chọn file
                </Button>
              </div>
            </div>
            <div className={styles.folderGrid}>
              {sourceMode === 'folder' && folders.length === 0 ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>
                  Chưa có folder nào. Nhấn Thêm folder để bắt đầu.
                </div>
              ) : sourceMode === 'folder' ? (
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
              ) : selectedVideos.length === 0 ? (
                <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>
                  Chưa có video nào. Nhấn Thêm video để bắt đầu.
                </div>
              ) : (
                selectedVideos.map((videoPath, idx) => {
                  const fileName = videoPath.split(/[/\\]/).pop() || videoPath;
                  const folderPath = videoPath.replace(/[\\/][^\\/]+$/, '');
                  return (
                    <div key={`${videoPath}-${idx}`} className={styles.folderBox} title={videoPath}>
                      <div className={styles.folderBoxHeader}>
                        <span className={styles.folderName}>{fileName}</span>
                      </div>
                      <div className={styles.folderBoxSubText}>{folderPath}</div>
                      <button
                        className={styles.removeFolderBoxBtn}
                        onClick={() => handleRemoveVideo(videoPath)}
                        title="Xóa video"
                        disabled={isMerging}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ marginTop: '10px' }}>
              {sourceMode === 'folder' ? (
                <Button variant="secondary" onClick={handleAddFolders} disabled={isMerging}>
                  <FolderPlus size={16} style={{ marginRight: '8px' }} /> Thêm folder
                </Button>
              ) : (
                <Button variant="secondary" onClick={handleAddVideos} disabled={isMerging}>
                  <FilePlus size={16} style={{ marginRight: '8px' }} /> Thêm video
                </Button>
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
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className={styles.input} value={outputDirLabel} readOnly />
                  <Button variant="secondary" onClick={handleSelectOutputDir} disabled={isMerging}>
                    Chọn
                  </Button>
                </div>
              </div>
            </div>
            {!!blockingReason && <div className={styles.mergeWarning}>{blockingReason}</div>}
            {!!outputPath && <div className={styles.mergeSuccess}>Output: {outputPath}</div>}
          </div>
        </div>

        <div className={`${styles.panelColumn} ${styles.panelColumnSticky}`}>
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

          {/* actions moved to top bar */}
        </div>
      </div>
    </div>
  );
};
