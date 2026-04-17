import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FolderOpen, FolderPlus, Music2, Play, Square, Trash2, Video, X } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './VideoAudioReplacer.module.css';

type RowStatus = 'ready' | 'running' | 'success' | 'error';

interface ReplaceRowItem {
  id: string;
  videoPath: string;
  audioPath: string;
  outputPreviewPath: string;
  status: RowStatus;
  error?: string;
  outputPath?: string;
}

interface ReplaceProgress {
  total: number;
  current: number;
  percent: number;
  currentVideo?: string;
  currentVideoPath?: string;
  stage: 'preflight' | 'processing' | 'completed' | 'stopped' | 'error';
  message: string;
}

interface ReplaceLogItem {
  status: 'info' | 'success' | 'error' | 'processing';
  message: string;
  time: string;
  videoPath?: string;
  audioPath?: string;
  outputPath?: string;
}

function buildPreviewOutputPath(videoPath: string): string {
  if (!videoPath) return '';
  const ext = videoPath.match(/\.[^./\\]+$/)?.[0] || '.mp4';
  return videoPath.replace(new RegExp(`${ext.replace('.', '\\.')}$`), `_audio_replaced${ext}`);
}

function getOutputFileName(videoPath: string): string {
  const base = toBaseName(videoPath);
  const ext = base.match(/\.[^./\\]+$/)?.[0] || '.mp4';
  const stem = base.slice(0, -ext.length);
  return `${stem}_audio_replaced${ext}`;
}

function joinPath(dirPath: string, fileName: string): string {
  const useBackslash = dirPath.includes('\\');
  const sep = useBackslash ? '\\' : '/';
  return `${dirPath.replace(/[\\/]+$/, '')}${sep}${fileName}`;
}

function buildPreviewOutputPathWithDir(videoPath: string, outputDir?: string): string {
  if (!videoPath) return '';
  if (!outputDir?.trim()) return buildPreviewOutputPath(videoPath);
  return joinPath(outputDir.trim(), getOutputFileName(videoPath));
}

function toBaseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

const NATURAL_NAME_COLLATOR = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

function sortPathsByBaseName(paths: string[]): string[] {
  return [...paths].sort((a, b) => NATURAL_NAME_COLLATOR.compare(toBaseName(a), toBaseName(b)));
}

export const VideoAudioReplacer: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const [rows, setRows] = useState<ReplaceRowItem[]>([]);
  const [outputDir, setOutputDir] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [keepOriginalAudioPercent, setKeepOriginalAudioPercent] = useState(0);
  const [logs, setLogs] = useState<ReplaceLogItem[]>([]);
  const [progress, setProgress] = useState<ReplaceProgress>({
    total: 0,
    current: 0,
    percent: 0,
    stage: 'preflight',
    message: 'Sẵn sàng ghép audio tương ứng.',
  });

  useEffect(() => {
    if (!window.electronAPI?.cutVideo) return;
    const cleanupProgress = window.electronAPI.cutVideo.onAudioReplaceProgress((data) => {
      setProgress(data);
      if (!data.currentVideoPath) return;
      setRows((prev) => prev.map((row) => {
        if (row.videoPath !== data.currentVideoPath) return row;
        return { ...row, status: data.stage === 'processing' ? 'running' : row.status };
      }));
    });
    const cleanupLog = window.electronAPI.cutVideo.onAudioReplaceLog((data) => {
      setLogs((prev) => [data, ...prev].slice(0, 300));
    });

    return () => {
      cleanupProgress();
      cleanupLog();
    };
  }, []);

  const canStart = useMemo(() => {
    if (isProcessing || rows.length === 0) return false;
    return rows.every((row) => !!row.videoPath && !!row.audioPath);
  }, [isProcessing, rows]);

  const handleAddVideos = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] }],
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) return;

      setRows((prev) => {
        const existing = new Set(prev.map((row) => row.videoPath));
        const added: ReplaceRowItem[] = [];
        for (const videoPath of result.filePaths) {
          if (existing.has(videoPath)) continue;
          added.push({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            videoPath,
            audioPath: '',
            outputPreviewPath: buildPreviewOutputPathWithDir(videoPath, outputDir),
            status: 'ready',
          });
        }
        return [...prev, ...added];
      });
    } catch (error) {
      console.error('Lỗi chọn video:', error);
    }
  };

  const handlePickOutputFolder = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openDirectory'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) return;
      const nextOutputDir = result.filePaths[0];
      setOutputDir(nextOutputDir);
      setRows((prev) => prev.map((row) => ({
        ...row,
        outputPreviewPath: buildPreviewOutputPathWithDir(row.videoPath, nextOutputDir),
      })));
    } catch (error) {
      console.error('Lỗi chọn thư mục output:', error);
    }
  };

  const handleClearOutputFolder = () => {
    setOutputDir('');
    setRows((prev) => prev.map((row) => ({
      ...row,
      outputPreviewPath: buildPreviewOutputPath(row.videoPath),
    })));
  };

  const handlePickAudioForRow = async (rowId: string) => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus'] }],
        properties: ['openFile'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) return;
      const audioPath = result.filePaths[0];
      setRows((prev) => prev.map((row) => {
        if (row.id !== rowId) return row;
        return {
          ...row,
          audioPath,
          status: 'ready',
          error: undefined,
          outputPath: undefined,
        };
      }));
    } catch (error) {
      console.error('Lỗi chọn audio:', error);
    }
  };

  const handleAddAudios = async () => {
    if (rows.length === 0) {
      alert('Vui lòng thêm video trước khi chọn audio hàng loạt.');
      return;
    }

    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus'] }],
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) return;

      const sortedAudios = sortPathsByBaseName(result.filePaths);

      setRows((prev) => {
        const sortedRows = [...prev].sort((a, b) =>
          NATURAL_NAME_COLLATOR.compare(toBaseName(a.videoPath), toBaseName(b.videoPath))
        );

        const nextById = new Map(prev.map((row) => [row.id, { ...row }]));
        const assignCount = Math.min(sortedRows.length, sortedAudios.length);

        for (let i = 0; i < assignCount; i += 1) {
          const targetRow = sortedRows[i];
          const targetAudio = sortedAudios[i];
          const existing = nextById.get(targetRow.id);
          if (!existing) continue;
          existing.audioPath = targetAudio;
          existing.status = 'ready';
          existing.error = undefined;
          existing.outputPath = undefined;
          nextById.set(targetRow.id, existing);
        }

        return prev.map((row) => nextById.get(row.id) || row);
      });

      if (sortedAudios.length < rows.length) {
        alert(`Bạn chọn ${sortedAudios.length} audio cho ${rows.length} video. Các dòng còn lại giữ nguyên/chưa có audio.`);
      } else if (sortedAudios.length > rows.length) {
        alert(`Bạn chọn dư ${sortedAudios.length - rows.length} audio. Hệ thống chỉ lấy theo số lượng video hiện tại.`);
      }
    } catch (error) {
      console.error('Lỗi chọn audio hàng loạt:', error);
    }
  };

  const handleClearAll = () => {
    setRows([]);
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => prev.filter((row) => row.id !== rowId));
  };

  const handleStart = async () => {
    if (!canStart) {
      alert('Vui lòng thêm video và chọn audio tương ứng cho tất cả dòng.');
      return;
    }

    setIsProcessing(true);
    setLogs([]);
    setRows((prev) => prev.map((row) => ({
      ...row,
      status: 'ready',
      error: undefined,
      outputPath: undefined,
    })));
    setProgress({
      total: rows.length,
      current: 0,
      percent: 0,
      stage: 'preflight',
      message: 'Đang bắt đầu ghép audio...',
    });

    try {
      const result = await window.electronAPI.cutVideo.startVideoAudioReplaceBatch({
        items: rows.map((row) => ({
          videoPath: row.videoPath,
          audioPath: row.audioPath,
          outputPath: outputDir ? joinPath(outputDir, getOutputFileName(row.videoPath)) : undefined,
        })),
        keepOriginalAudioPercent,
      });

      if (result.data?.results) {
        const byVideo = new Map(result.data.results.map((item) => [item.videoPath, item]));
        setRows((prev) => prev.map((row) => {
          const res = byVideo.get(row.videoPath);
          if (!res) return row;
          return {
            ...row,
            status: res.status === 'success' ? 'success' : 'error',
            error: res.error,
            outputPath: res.outputPath,
          };
        }));
      }

      if (!result.success) {
        alert(result.error || 'Ghép audio tương ứng thất bại.');
      }
    } catch (error: any) {
      alert(String(error?.message || error));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    try {
      await window.electronAPI.cutVideo.stopVideoAudioReplaceBatch();
    } catch (error) {
      console.error(error);
    }
  };

  const clearLogs = () => setLogs([]);

  const renderBadge = (status: RowStatus) => {
    if (status === 'success') return <span className={`${styles.badge} ${styles.badgeSuccess}`}>Success</span>;
    if (status === 'error') return <span className={`${styles.badge} ${styles.badgeError}`}>Error</span>;
    if (status === 'running') return <span className={`${styles.badge} ${styles.badgeProcessing}`}>Running</span>;
    return <span className={`${styles.badge} ${styles.badgeReady}`}>Ready</span>;
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroMain}>
          <button className={styles.backButton} type="button" onClick={() => onBack?.()}>
            <ArrowLeft size={14} />
            Quay lại CutVideo
          </button>
          <h2 className={styles.title}>Ghép Audio Theo Video</h2>
        </div>
        <div className={styles.heroActions}>
          <Button variant="danger" onClick={handleStop} disabled={!isProcessing}>
            <Square size={16} /> Dừng
          </Button>
          <Button variant="success" onClick={handleStart} disabled={!canStart}>
            <Play size={16} /> Ghép batch
          </Button>
        </div>
      </header>

      <div className={styles.contentGrid}>
        <section className={styles.mainPanel}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <Button variant="secondary" onClick={handleAddVideos} disabled={isProcessing}>
                <FolderPlus size={16} /> Thêm video
              </Button>
              <Button variant="secondary" onClick={handleAddAudios} disabled={isProcessing || rows.length === 0}>
                <Music2 size={16} /> Thêm audio
              </Button>
              <Button variant="secondary" onClick={handleClearAll} disabled={isProcessing || rows.length === 0}>
                <Trash2 size={16} /> Xóa hết
              </Button>
            </div>
            <div className={styles.toolbarRight}>
              <div className={styles.outputBox}>
                <label className={styles.volumeLabel}>Thư mục lưu output (tùy chọn)</label>
                <div className={styles.outputRow}>
                  <input
                    className={styles.outputInput}
                    value={outputDir}
                    readOnly
                    placeholder="Mặc định: lưu cùng thư mục của video"
                  />
                  <Button variant="secondary" onClick={handlePickOutputFolder} disabled={isProcessing}>
                    <FolderOpen size={14} /> Chọn
                  </Button>
                  <Button variant="secondary" onClick={handleClearOutputFolder} disabled={isProcessing || !outputDir}>
                    Mặc định
                  </Button>
                </div>
              </div>
              <div className={styles.volumeBox}>
                <label className={styles.volumeLabel}>Giữ audio gốc</label>
                <div className={styles.volumeControl}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={keepOriginalAudioPercent}
                    className={styles.rangeInput}
                    disabled={isProcessing}
                    onChange={(e) => setKeepOriginalAudioPercent(Math.max(0, Math.min(100, Number(e.target.value))))}
                  />
                  <input
                    type="number"
                    className={styles.numberInput}
                    min={0}
                    max={100}
                    step={1}
                    disabled={isProcessing}
                    value={keepOriginalAudioPercent}
                    onChange={(e) => setKeepOriginalAudioPercent(Math.max(0, Math.min(100, Number(e.target.value))))}
                  />
                  <span className={styles.percent}>%</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: '46px' }}>#</th>
                  <th>Video đầu vào</th>
                  <th>Audio tương ứng</th>
                  <th>Output preview</th>
                  <th style={{ width: '90px' }}>Trạng thái</th>
                  <th style={{ width: '62px' }} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      Chưa có video nào. Nhấn "Thêm video" để bắt đầu.
                    </td>
                  </tr>
                ) : rows.map((row, index) => (
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td title={row.videoPath}>
                      <div className={styles.fileChip}>
                        <Video size={14} />
                        <span>{toBaseName(row.videoPath)}</span>
                      </div>
                    </td>
                    <td title={row.audioPath || ''}>
                      <div className={styles.audioCell}>
                        <div className={styles.fileChip}>
                          <Music2 size={14} />
                          <span>{row.audioPath ? toBaseName(row.audioPath) : 'Chưa chọn audio'}</span>
                        </div>
                        <Button variant="secondary" onClick={() => void handlePickAudioForRow(row.id)} disabled={isProcessing}>
                          <FolderOpen size={14} /> Chọn
                        </Button>
                      </div>
                    </td>
                    <td title={row.outputPath || row.outputPreviewPath}>
                      <div className={styles.outputText}>{row.outputPath || row.outputPreviewPath}</div>
                      {row.error ? <div className={styles.errorText}>{row.error}</div> : null}
                    </td>
                    <td>{renderBadge(row.status)}</td>
                    <td>
                      <button
                        className={styles.removeButton}
                        onClick={() => handleRemoveRow(row.id)}
                        disabled={isProcessing}
                        title="Xóa dòng"
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className={styles.sidePanel}>
          <section className={styles.card}>
            <div className={styles.cardTitle}>Tiến trình</div>
            <div className={styles.progressRow}>
              <div>{progress.message}</div>
              <strong>{progress.percent}%</strong>
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progress.percent}%` }} />
            </div>
            <div className={styles.progressMeta}>
              {progress.total > 0 ? `Đã xử lý ${progress.current}/${progress.total}` : 'Chưa bắt đầu.'}
              {progress.currentVideo ? ` | ${progress.currentVideo}` : ''}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.logHeader}>
              <div className={styles.cardTitle}>Nhật ký</div>
              <button className={styles.logClearBtn} title="Xóa log" onClick={clearLogs}>
                <Trash2 size={14} />
              </button>
            </div>
            <div className={styles.logList}>
              {logs.length === 0 ? (
                <div className={styles.logEmpty}>Chưa có log.</div>
              ) : logs.map((log, idx) => (
                <div key={`${log.time}-${idx}`} className={styles.logItem}>
                  <div className={styles.logTop}>
                    <span className={`${styles.logDot} ${styles[`dot_${log.status}`] || styles.dot_info}`} />
                    <span className={styles.logTime}>{log.time}</span>
                  </div>
                  <div className={styles.logMessage}>
                    {log.videoPath ? `[${toBaseName(log.videoPath)}] ` : ''}
                    {log.message}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};
