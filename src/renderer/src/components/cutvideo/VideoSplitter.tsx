import React, { useState, useEffect } from 'react';
import styles from './CutVideo.module.css';
import { Button } from '../common/Button';
import { Play, Square, Scissors, FileVideo, X } from 'lucide-react';
import { useFolderManager } from './hooks/useFolderManager';

interface VideoMetadata {
  duration: number;
  fps: number;
  width: number;
  height: number;
  sizeBytes: number;
}

interface SplitClip {
  id: string;
  name: string;
  start: string; // HH:MM:SS
  end: string;   // HH:MM:SS
  duration: string; // HH:MM:SS
}

interface SplitResultLog {
  clipName: string;
  status: string;
  time: string;
}

// Helpers
const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const parseTime = (timeStr: string) => {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  }
  return 0;
};

export const VideoSplitter: React.FC = () => {
  const { selectedFile, handleSelectVideoFile, handleRemoveVideoFile } = useFolderManager();
  const hasFile = !!selectedFile;
  
  // State
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [clips, setClips] = useState<SplitClip[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [progress, setProgress] = useState({ totalPercent: 0, currentClipName: '', currentPercent: 0 });
  const [logs, setLogs] = useState<SplitResultLog[]>([]);

  // 1. Fetch metadata on file selection change
  useEffect(() => {
    if (!selectedFile) {
      setMetadata(null);
      setClips([]);
      return;
    }

    const fetchMeta = async () => {
      try {
        const res = await window.electronAPI.cutVideo.getVideoInfo(selectedFile);
        if (res.success && res.data) {
          setMetadata(res.data);
          // Auto add 1 default clip representing full video
          setClips([{
            id: Date.now().toString(),
            name: `${selectedFile.split(/[/\\]/).pop()?.split('.')[0]}_part1`,
            start: '00:00:00',
            end: formatTime(res.data.duration),
            duration: formatTime(res.data.duration)
          }]);
        } else {
          console.error("Failed to load video info:", res.error);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchMeta();
  }, [selectedFile]);

  // 2. Setup IPC progress / logs
  useEffect(() => {
    if (!window.electronAPI?.cutVideo) return;

    const cleanupProgress = window.electronAPI.cutVideo.onSplitProgress((data: any) => {
      setProgress(data);
    });

    const cleanupLog = window.electronAPI.cutVideo.onSplitLog((newLog: any) => {
      setLogs((prev) => {
        const existing = prev.findIndex(l => l.clipName === newLog.clipName);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = newLog;
          return updated;
        }
        return [newLog, ...prev];
      });
    });

    return () => {
      cleanupProgress();
      cleanupLog();
    };
  }, []);

  // 3. Actions
  const handleChiaDeu = () => {
    if (!metadata) return;
    const partsStr = window.prompt('Nhập số đoạn muốn chia đều:', '3');
    if (!partsStr) return;
    const parts = parseInt(partsStr);
    if (isNaN(parts) || parts <= 0) return;

    const newClips: SplitClip[] = [];
    const durPerPart = metadata.duration / parts;
    const baseName = selectedFile?.split(/[/\\]/).pop()?.split('.')[0] || 'clip';

    for (let i = 0; i < parts; i++) {
        const startSec = i * durPerPart;
        const endSec = (i === parts - 1) ? metadata.duration : (i + 1) * durPerPart;
        
        newClips.push({
            id: `part_${i}_${Date.now()}`,
            name: `${baseName}_part${i + 1}`,
            start: formatTime(startSec),
            end: formatTime(endSec),
            duration: formatTime(endSec - startSec)
        });
    }
    setClips(newClips);
  };

  const handleAddClip = () => {
    setClips([...clips, {
       id: Date.now().toString(),
       name: 'clip_new',
       start: '00:00:00',
       end: '00:00:00',
       duration: '00:00:00'
    }]);
  };

  const handleRemoveClip = (id: string) => {
    setClips(clips.filter(c => c.id !== id));
  };

  const handleClipChange = (id: string, field: keyof SplitClip, value: string) => {
    setClips(clips.map(c => {
      if (c.id === id) {
        const updated = { ...c, [field]: value };
        // simple recalculate duration if start or end changed
        if (field === 'start' || field === 'end') {
           const startSec = parseTime(updated.start);
           const endSec = parseTime(updated.end);
           if (endSec > startSec) {
             updated.duration = formatTime(endSec - startSec);
           } else {
             updated.duration = '00:00:00';
           }
        }
        return updated;
      }
      return c;
    }));
  };

  const handleStart = async () => {
    if (!selectedFile || clips.length === 0) return;
    setIsProcessing(true);
    setProgress({ totalPercent: 0, currentClipName: 'Bắt đầu...', currentPercent: 0 });
    setLogs([]);

    try {
      // Map clips to IPC format (durationStr is required explicitly for FFmpeg -t flag)
      const mappedClips = clips.map(c => {
         const durSecs = parseTime(c.duration);
         return {
            name: c.name,
            startStr: c.start,
            durationStr: formatTime(durSecs)
         };
      });

      const res = await window.electronAPI.cutVideo.startVideoSplit({
         inputPath: selectedFile,
         clips: mappedClips
      });

      if (!res.success) {
         alert(`Lỗi: ${res.error}`);
      }
    } catch (e: any) {
       alert(`Lỗi: ${e.message}`);
    } finally {
       setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    if (!isProcessing) return;
    try {
       await window.electronAPI.cutVideo.stopVideoSplit();
    } catch(e) {
       console.error(e);
    }
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>✂️ CẮT VIDEO THÀNH NHIỀU ĐOẠN</h2>

      {/* COMPONENT 1: FILE SELECTION */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Chọn video</h3>
        {!hasFile ? (
          <div className={styles.dropzone}>
            <FileVideo className={styles.dropzoneIcon} color="var(--color-primary)" />
            <span className={styles.dropzoneText}>Kéo thả video vào đây</span>
            <span className={styles.dropzoneSubText}>hoặc</span>
            <Button variant="secondary" onClick={handleSelectVideoFile}>📂 Chọn file video</Button>
          </div>
        ) : (
          <div className={styles.fileInfoCard}>
            <div className={styles.fileInfoDetails}>
              <div className={styles.fileInfoItem}>
                <FileVideo size={16} color="var(--color-primary)" />
                <strong title={selectedFile}>{selectedFile.split(/[/\\]/).pop()}</strong>
              </div>
              <span className={styles.textMuted}>|</span>
              <div className={styles.fileInfoItem}>⏱ {metadata ? formatTime(metadata.duration) : '--:--:--'}</div>
              <span className={styles.textMuted}>|</span>
              <div className={styles.fileInfoItem}>💾 {metadata ? (metadata.sizeBytes / (1024 * 1024)).toFixed(2) : '---'} MB</div>
              <span className={styles.textMuted}>|</span>
              <div className={styles.fileInfoItem}>🎞 {metadata ? metadata.fps : '--'}fps</div>
            </div>
            <Button variant="secondary" className={styles.btnSmall} onClick={handleRemoveVideoFile} disabled={isProcessing}>
              ✕ Đổi file
            </Button>
          </div>
        )}
      </div>

      {/* COMPONENT 2: SPLIT LIST */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Danh sách đoạn cắt</h3>
          <div className={styles.flexRow}>
            <Button variant="secondary" className={styles.btnSmall} onClick={handleChiaDeu} disabled={!hasFile || isProcessing}>🎯 Chia đều</Button>
          </div>
        </div>
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>STT</th>
                <th>Tên đoạn</th>
                <th>Bắt đầu</th>
                <th>Kết thúc</th>
                <th>Thời lượng</th>
                <th style={{ width: '50px' }}>Xóa</th>
              </tr>
            </thead>
            <tbody>
              {clips.map((clip, index) => (
                <tr key={clip.id}>
                  <td className={styles.textMuted}>{index + 1}</td>
                  <td>
                    <input type="text" className={styles.clipInput} value={clip.name} onChange={(e) => handleClipChange(clip.id, 'name', e.target.value)} disabled={isProcessing} />
                  </td>
                  <td>
                    <input type="text" className={`${styles.clipInput} ${styles.clipTimeInput}`} value={clip.start} onChange={(e) => handleClipChange(clip.id, 'start', e.target.value)} disabled={isProcessing} />
                  </td>
                  <td>
                    <input type="text" className={`${styles.clipInput} ${styles.clipTimeInput}`} value={clip.end} onChange={(e) => handleClipChange(clip.id, 'end', e.target.value)} disabled={isProcessing} />
                  </td>
                  <td className={styles.textMuted}>{clip.duration}</td>
                  <td>
                    <button className={`${styles.iconButton} ${styles.iconButtonDanger}`} onClick={() => handleRemoveClip(clip.id)} disabled={isProcessing}>
                      <X size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: '8px' }}>
          <Button variant="secondary" className={styles.btnSmall} onClick={handleAddClip} disabled={!hasFile || isProcessing}>
            <Scissors size={14} style={{ marginRight: '6px' }} /> Thêm đoạn mới
          </Button>
        </div>
      </div>

      {/* COMPONENT 4: PROGRESS & RESULTS */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Tiến trình cắt</h3>
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
               <span>{progress.currentClipName || '---'}</span>
               <span>{progress.currentPercent}%</span>
             </div>
             <div className={styles.progressBar}>
               <div className={`${styles.progressFill} ${styles.progressFillBlue}`} style={{ width: `${progress.currentPercent}%` }}></div>
             </div>
           </div>
        </div>
        
        <div className={styles.tableContainer} style={{ marginTop: '16px' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tên file</th>
                <th>Trạng thái</th>
                <th style={{ textAlign: 'center' }}>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, idx) => (
              <tr key={idx}>
                <td>{log.clipName}</td>
                <td>
                   {log.status === 'completed' && <span className={`${styles.badge} ${styles.badgeSuccess}`}>✅ Hoàn thành</span>}
                   {log.status === 'processing' && <span className={`${styles.badge} ${styles.badgeProcessing}`}>⏳ Đang xử lý</span>}
                   {log.status === 'error' && <span className={`${styles.badge} ${styles.badgeError}`}>❌ Lỗi</span>}
                </td>
                <td style={{ textAlign: 'center' }}>{log.time}</td>
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
        <Button variant="primary" onClick={handleStart} disabled={!hasFile || isProcessing || clips.length === 0}>
          <Play size={16} style={{ marginRight: '8px' }} /> Bắt đầu Cắt
        </Button>
      </div>

    </div>
  );
};
