import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../common/Button';
import styles from './CutVideo.module.css';
import { ArrowDown, ArrowUp, FolderPlus, Music2, Square, Trash2, Video, X, Play } from 'lucide-react';

interface AudioItem {
  id: string;
  path: string;
  name: string;
  durationSec: number;
}

interface MixLogItem {
  status: 'info' | 'success' | 'error' | 'processing';
  message: string;
  time: string;
}

interface MixProgress {
  percent: number;
  stage: 'preflight' | 'building_playlist' | 'mixing' | 'completed' | 'stopped' | 'error';
  message: string;
  currentFile?: string;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--:--';
  const safe = Math.floor(sec);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(200, Math.round(value)));
}

export const VideoAudioMixer: React.FC = () => {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoDurationSec, setVideoDurationSec] = useState<number>(0);
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [videoVolumePercent, setVideoVolumePercent] = useState(100);
  const [musicVolumePercent, setMusicVolumePercent] = useState(100);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputPath, setOutputPath] = useState<string>('');
  const [progress, setProgress] = useState<MixProgress>({
    percent: 0,
    stage: 'preflight',
    message: 'Sẵn sàng ghép nhạc.',
  });
  const [logs, setLogs] = useState<MixLogItem[]>([]);

  useEffect(() => {
    if (!window.electronAPI?.cutVideo) return;
    const cleanupProgress = window.electronAPI.cutVideo.onAudioMixProgress((data) => {
      setProgress(data);
    });
    const cleanupLog = window.electronAPI.cutVideo.onAudioMixLog((data) => {
      setLogs((prev) => [data, ...prev].slice(0, 200));
    });
    return () => {
      cleanupProgress();
      cleanupLog();
    };
  }, []);

  const outputPreviewPath = useMemo(() => {
    if (!videoPath) return '';
    const normalized = videoPath.replace(/[\\/]+/g, '/');
    const slashIdx = normalized.lastIndexOf('/');
    const dir = slashIdx >= 0 ? normalized.slice(0, slashIdx) : '';
    const file = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
    const dot = file.lastIndexOf('.');
    const base = dot >= 0 ? file.slice(0, dot) : file;
    const ext = dot >= 0 ? file.slice(dot) : '.mp4';
    return `${dir}/${base}_musicmix${ext}`;
  }, [videoPath]);

  const handleSelectVideo = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'avi'] }],
        properties: ['openFile'],
      }) as { canceled: boolean; filePaths: string[] };

      if (!result?.canceled && result?.filePaths?.length) {
        const selected = result.filePaths[0];
        setVideoPath(selected);
        setOutputPath('');
        const infoRes = await window.electronAPI.cutVideo.getMediaInfo(selected);
        setVideoDurationSec(infoRes.success && infoRes.data ? infoRes.data.duration : 0);
      }
    } catch (error) {
      console.error('Lỗi chọn video ghép nhạc:', error);
    }
  };

  const handleRemoveVideo = () => {
    setVideoPath(null);
    setVideoDurationSec(0);
    setOutputPath('');
  };

  const handleAddAudioFiles = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'] }],
        properties: ['openFile', 'multiSelections'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) return;

      const existing = new Set(audioItems.map((item) => item.path));
      const nextItems = [...audioItems];
      const invalidFiles: string[] = [];

      for (const filePath of result.filePaths) {
        if (existing.has(filePath)) continue;
        const infoRes = await window.electronAPI.cutVideo.getMediaInfo(filePath);
        if (!infoRes.success || !infoRes.data?.hasAudio || infoRes.data.duration <= 0) {
          invalidFiles.push(filePath.split(/[/\\]/).pop() || filePath);
          continue;
        }
        nextItems.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          path: filePath,
          name: filePath.split(/[/\\]/).pop() || filePath,
          durationSec: infoRes.data.duration,
        });
      }

      setAudioItems(nextItems);
      if (invalidFiles.length > 0) {
        alert(`Bỏ qua ${invalidFiles.length} file audio không hợp lệ:\n- ${invalidFiles.join('\n- ')}`);
      }
    } catch (error) {
      console.error('Lỗi chọn audio ghép nhạc:', error);
    }
  };

  const handleMoveAudio = (index: number, direction: 'up' | 'down') => {
    setAudioItems((prev) => {
      const next = [...prev];
      if (direction === 'up' && index > 0) {
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
      }
      if (direction === 'down' && index < next.length - 1) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
      return next;
    });
  };

  const handleRemoveAudio = (id: string) => {
    setAudioItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAudios = () => {
    setAudioItems([]);
  };

  const handleStart = async () => {
    if (!videoPath) {
      alert('Vui lòng chọn video trước.');
      return;
    }
    if (audioItems.length === 0) {
      alert('Vui lòng thêm ít nhất 1 file audio.');
      return;
    }

    setIsProcessing(true);
    setOutputPath('');
    setLogs([]);
    setProgress({
      percent: 0,
      stage: 'preflight',
      message: 'Đang bắt đầu ghép nhạc...',
    });

    try {
      const res = await window.electronAPI.cutVideo.startVideoAudioMix({
        videoPath,
        audioPaths: audioItems.map((item) => item.path),
        videoVolumePercent: clampVolume(videoVolumePercent),
        musicVolumePercent: clampVolume(musicVolumePercent),
      });
      if (!res.success) {
        alert(res.error || 'Ghép nhạc thất bại.');
      } else if (res.data?.outputPath) {
        setOutputPath(res.data.outputPath);
      }
    } catch (error: any) {
      alert(String(error?.message || error));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    try {
      await window.electronAPI.cutVideo.stopVideoAudioMix();
    } catch (error) {
      console.error(error);
    }
  };

  const clearLogs = () => setLogs([]);

  const renderBadge = (status: MixLogItem['status']) => {
    if (status === 'success') return <span className={`${styles.badge} ${styles.badgeSuccess}`}>SUCCESS</span>;
    if (status === 'error') return <span className={`${styles.badge} ${styles.badgeError}`}>ERROR</span>;
    if (status === 'processing') return <span className={`${styles.badge} ${styles.badgeProcessing}`}>PROCESSING</span>;
    return <span className={`${styles.badge} ${styles.bagdePending}`}>INFO</span>;
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>🎧 GHÉP PLAYLIST NHẠC VÀO VIDEO</h2>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Video đầu vào</h3>
          {!videoPath ? (
            <Button variant="secondary" onClick={handleSelectVideo} disabled={isProcessing}>
              <Video size={16} style={{ marginRight: '8px' }} /> Chọn video
            </Button>
          ) : (
            <Button variant="secondary" onClick={handleRemoveVideo} disabled={isProcessing}>
              <X size={16} style={{ marginRight: '8px' }} /> Bỏ chọn
            </Button>
          )}
        </div>
        {!videoPath ? (
          <div className={styles.emptyState}>Chưa chọn video để ghép nhạc.</div>
        ) : (
          <div className={styles.fileInfoCard}>
            <div className={styles.fileInfoDetails}>
              <div className={styles.fileInfoItem}>
                <Video size={16} color="var(--color-primary)" />
                <strong title={videoPath}>{videoPath.split(/[/\\]/).pop()}</strong>
              </div>
              <span className={styles.textMuted}>|</span>
              <div className={styles.fileInfoItem}>⏱ {formatDuration(videoDurationSec)}</div>
            </div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Playlist audio (theo thứ tự phát)</h3>
          <div className={styles.flexRow}>
            <Button variant="secondary" onClick={handleAddAudioFiles} disabled={isProcessing}>
              <FolderPlus size={16} style={{ marginRight: '8px' }} /> Thêm audio
            </Button>
            <Button variant="secondary" onClick={handleClearAudios} disabled={isProcessing || audioItems.length === 0}>
              <Trash2 size={16} style={{ marginRight: '8px' }} /> Xóa tất cả
            </Button>
          </div>
        </div>
        {audioItems.length === 0 ? (
          <div className={styles.emptyState}>Chưa có file audio nào.</div>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: '48px' }}>#</th>
                  <th>Tên file</th>
                  <th style={{ width: '120px' }}>Duration</th>
                  <th style={{ width: '140px' }}>Thứ tự</th>
                  <th style={{ width: '64px' }}>Xóa</th>
                </tr>
              </thead>
              <tbody>
                {audioItems.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td title={item.path}>
                      <div className={styles.fileInfoItem}>
                        <Music2 size={14} color="var(--color-text-secondary)" />
                        <span>{item.name}</span>
                      </div>
                    </td>
                    <td>{formatDuration(item.durationSec)}</td>
                    <td>
                      <div className={styles.flexRow}>
                        <button
                          className={styles.iconButton}
                          onClick={() => handleMoveAudio(index, 'up')}
                          disabled={isProcessing || index === 0}
                          title="Move up"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className={styles.iconButton}
                          onClick={() => handleMoveAudio(index, 'down')}
                          disabled={isProcessing || index === audioItems.length - 1}
                          title="Move down"
                        >
                          <ArrowDown size={14} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                        onClick={() => handleRemoveAudio(item.id)}
                        disabled={isProcessing}
                        title="Xóa file audio"
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Âm lượng mix</h3>
        <div className={styles.grid2}>
          <div>
            <label className={styles.label}>Video volume (%)</label>
            <div className={styles.volumeControl}>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={videoVolumePercent}
                className={styles.rangeInput}
                disabled={isProcessing}
                onChange={(e) => setVideoVolumePercent(clampVolume(Number(e.target.value)))}
              />
              <input
                type="number"
                className={`${styles.input} ${styles.inputSmall}`}
                min={0}
                max={200}
                step={1}
                disabled={isProcessing}
                value={videoVolumePercent}
                onChange={(e) => setVideoVolumePercent(clampVolume(Number(e.target.value)))}
              />
            </div>
          </div>
          <div>
            <label className={styles.label}>Music volume (%)</label>
            <div className={styles.volumeControl}>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={musicVolumePercent}
                className={styles.rangeInput}
                disabled={isProcessing}
                onChange={(e) => setMusicVolumePercent(clampVolume(Number(e.target.value)))}
              />
              <input
                type="number"
                className={`${styles.input} ${styles.inputSmall}`}
                min={0}
                max={200}
                step={1}
                disabled={isProcessing}
                value={musicVolumePercent}
                onChange={(e) => setMusicVolumePercent(clampVolume(Number(e.target.value)))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Output</h3>
        <input className={styles.input} readOnly value={outputPath || outputPreviewPath || 'Chưa có output'} />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Tiến trình</h3>
        <div className={styles.progressContainer}>
          <div className={styles.progressItem}>
            <div className={styles.progressLabel}>
              <span>{progress.message || 'Đang chờ...'}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className={styles.progressBar}>
              <div className={`${styles.progressFill} ${styles.progressFillBlue}`} style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
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
              {logs.map((log, idx) => (
                <tr key={`${log.time}-${idx}`}>
                  <td>{log.time}</td>
                  <td>{renderBadge(log.status)}</td>
                  <td>{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.flexRowRight}>
        <Button variant="danger" onClick={handleStop} disabled={!isProcessing}>
          <Square size={16} style={{ marginRight: '8px' }} /> Dừng
        </Button>
        <Button variant="success" onClick={handleStart} disabled={isProcessing}>
          <Play size={16} style={{ marginRight: '8px' }} /> Bắt đầu ghép nhạc
        </Button>
      </div>
    </div>
  );
};
