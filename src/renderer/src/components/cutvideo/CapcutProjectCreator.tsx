import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../common/Button';
import styles from './CutVideo.module.css';
import { FolderPlus, Play, Square, Trash2, ArrowLeft } from 'lucide-react';
import { useDragAutoScroll } from '../../hooks/useDragAutoScroll';

interface CapcutVideoItem {
  fileName: string;
  fullPath: string;
  ext: string;
}

interface CapcutProgress {
  total: number;
  current: number;
  percent: number;
  currentVideoName?: string;
  stage: 'preflight' | 'scanning' | 'creating' | 'copying_clips' | 'completed' | 'stopped' | 'error';
  message: string;
}

interface CapcutLog {
  time: string;
  status: 'info' | 'processing' | 'success' | 'error';
  message: string;
  videoName?: string;
  projectName?: string;
}

interface CapcutProjectResult {
  videoName: string;
  projectName: string;
  status: 'success' | 'error';
  copiedClipCount?: number;
  assetFolder?: string;
  error?: string;
}

const DEFAULT_CAPCUT_DRAFTS_PATH = 'D:\\User\\CongTinh\\Videos\\CapCut Drafts';

function monthDayLabel(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}${dd}`;
}

function previewProjectName(index: number): string {
  const base = monthDayLabel(new Date());
  if (index <= 1) return base;
  return `${base}_${index - 1}`;
}

export const CapcutProjectCreator: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const [sourceFolderPath, setSourceFolderPath] = useState('');
  const [capcutDraftsPath, setCapcutDraftsPath] = useState(DEFAULT_CAPCUT_DRAFTS_PATH);
  const [scanItems, setScanItems] = useState<CapcutVideoItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [logs, setLogs] = useState<CapcutLog[]>([]);
  const [createdProjects, setCreatedProjects] = useState<CapcutProjectResult[]>([]);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState<CapcutProgress>({
    total: 0,
    current: 0,
    percent: 0,
    stage: 'preflight',
    message: 'Sẵn sàng tạo project CapCut.',
  });
  const dragAutoScroll = useDragAutoScroll(tableContainerRef, dragIndex !== null, {
    edgeThreshold: 56,
    maxSpeed: 22,
  });

  useEffect(() => {
    if (!window.electronAPI?.cutVideo) return;
    const cleanupProgress = window.electronAPI.cutVideo.onCapcutProgress((data) => {
      setProgress(data);
    });
    const cleanupLog = window.electronAPI.cutVideo.onCapcutLog((data) => {
      setLogs((prev) => [data, ...prev].slice(0, 300));
    });
    return () => {
      cleanupProgress();
      cleanupLog();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadDraftsPath = async () => {
      if (!window.electronAPI?.appSettings) return;
      try {
        const result = await window.electronAPI.appSettings.getAll();
        if (!alive) return;
        if (result?.success && result.data) {
          const savedPath = typeof result.data.capcutDraftsPath === 'string' ? result.data.capcutDraftsPath.trim() : '';
          if (savedPath) {
            setCapcutDraftsPath(savedPath);
          }
        }
      } catch (error) {
        console.error('Lỗi tải cấu hình drafts path:', error);
      }
    };
    loadDraftsPath();
    return () => {
      alive = false;
    };
  }, []);

  const saveDraftsPath = async (nextPath: string) => {
    if (!window.electronAPI?.appSettings) return;
    try {
      const result = await window.electronAPI.appSettings.update({ capcutDraftsPath: nextPath });
      if (!result?.success) {
        console.error('Lỗi lưu drafts path:', result?.error);
      }
    } catch (error) {
      console.error('Lỗi lưu drafts path:', error);
    }
  };

  const handlePickSourceFolder = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openDirectory'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) return;
      setSourceFolderPath(result.filePaths[0]);
      setScanItems([]);
      setCreatedProjects([]);
    } catch (error) {
      console.error('Lỗi chọn folder video nguồn:', error);
    }
  };

  const handlePickCapcutDraftsFolder = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openFile', {
        properties: ['openDirectory'],
      }) as { canceled: boolean; filePaths: string[] };
      if (result?.canceled || !result?.filePaths?.length) return;
      const nextPath = result.filePaths[0];
      setCapcutDraftsPath(nextPath);
      void saveDraftsPath(nextPath);
    } catch (error) {
      console.error('Lỗi chọn folder drafts:', error);
    }
  };

  const handleScan = async () => {
    if (!sourceFolderPath) {
      alert('Vui lòng chọn folder video nguồn.');
      return;
    }
    setIsScanning(true);
    setCreatedProjects([]);
    try {
      const res = await window.electronAPI.cutVideo.scanVideosForCapcut(sourceFolderPath);
      if (!res.success || !res.data) {
        setScanItems([]);
        setProgress({
          total: 0,
          current: 0,
          percent: 0,
          stage: 'error',
          message: res.error || 'Quét video thất bại.',
        });
        alert(res.error || 'Quét video thất bại.');
        return;
      }
      setScanItems(res.data.videos);
      setProgress({
        total: res.data.count,
        current: 0,
        percent: 0,
        stage: 'scanning',
        message: `Đã quét ${res.data.count} video.`,
      });
    } catch (error) {
      const err = String(error);
      setProgress({
        total: 0,
        current: 0,
        percent: 0,
        stage: 'error',
        message: err,
      });
      alert(err);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (!sourceFolderPath || isCreating || isScanning) return;
    const timer = setTimeout(() => {
      handleScan();
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFolderPath]);

  const handleStart = async () => {
    if (!sourceFolderPath) {
      alert('Vui lòng chọn folder video nguồn.');
      return;
    }
    if (!capcutDraftsPath) {
      alert('Vui lòng chọn folder drafts (chứa project CapCut).');
      return;
    }
    if (!scanItems.length) {
      alert('Vui lòng quét video trước khi bắt đầu tạo project.');
      return;
    }

    setIsCreating(true);
    setLogs([]);
    setCreatedProjects([]);
    setProgress({
      total: scanItems.length,
      current: 0,
      percent: 0,
      stage: 'preflight',
      message: 'Đang chuẩn bị tạo project...',
    });

    try {
      const res = await window.electronAPI.cutVideo.startCapcutProjectBatch({
        sourceFolderPath,
        capcutDraftsPath,
        namingMode: 'month_day_suffix',
        orderedVideoPaths: scanItems.map((item) => item.fullPath),
      });
      if (res.data?.projects) {
        setCreatedProjects(res.data.projects);
      }
      if (!res.success) {
        alert(res.error || 'Tạo project CapCut thất bại.');
      }
    } catch (error) {
      alert(String(error));
    } finally {
      setIsCreating(false);
    }
  };

  const handleStop = async () => {
    try {
      await window.electronAPI.cutVideo.stopCapcutProjectBatch();
    } catch (error) {
      console.error(error);
    }
  };

  const handleClearLogs = () => setLogs([]);

  const commitReorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= scanItems.length || toIndex >= scanItems.length) {
      return;
    }
    setScanItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handlePointerDragStart = (index: number, event: React.MouseEvent<HTMLTableRowElement>) => {
    if (isCreating || event.button !== 0) return;
    event.preventDefault();
    setDragIndex(index);
    setDragOverIndex(index);
  };

  useEffect(() => {
    if (dragIndex === null || isCreating) {
      return undefined;
    }

    const container = tableContainerRef.current;
    if (!container) {
      return undefined;
    }

    document.body.style.userSelect = 'none';

    const findTargetIndex = (clientX: number, clientY: number): number | null => {
      const element = document.elementFromPoint(clientX, clientY);
      if (!element) return null;

      const row = element.closest('tr[data-row-index]') as HTMLElement | null;
      if (row?.dataset.rowIndex) {
        const parsed = Number.parseInt(row.dataset.rowIndex, 10);
        if (Number.isInteger(parsed)) return parsed;
      }

      const rect = container.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }
      if (scanItems.length === 0) return null;
      if (clientY <= rect.top + 24) return 0;
      if (clientY >= rect.bottom - 24) return scanItems.length - 1;
      return null;
    };

    const onMouseMove = (event: MouseEvent) => {
      dragAutoScroll.handlePointerMove(event.clientX, event.clientY);
      const nextIndex = findTargetIndex(event.clientX, event.clientY);
      if (nextIndex !== null && nextIndex !== dragOverIndex) {
        setDragOverIndex(nextIndex);
      }
    };

    const onMouseUp = () => {
      const toIndex = dragOverIndex ?? dragIndex;
      commitReorder(dragIndex, toIndex);
      setDragIndex(null);
      setDragOverIndex(null);
      dragAutoScroll.stopAutoScroll();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });

    return () => {
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dragAutoScroll.stopAutoScroll();
    };
  }, [dragAutoScroll, dragIndex, dragOverIndex, isCreating, scanItems.length]);

  const renderLogBadge = (status: CapcutLog['status']) => {
    if (status === 'success') return <span className={`${styles.badge} ${styles.badgeSuccess}`}>OK</span>;
    if (status === 'error') return <span className={`${styles.badge} ${styles.badgeError}`}>Lỗi</span>;
    if (status === 'processing') return <span className={`${styles.badge} ${styles.badgeProcessing}`}>Đang chạy</span>;
    return <span className={`${styles.badge} ${styles.bagdePending}`}>Info</span>;
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelTopBar}>
        <button className={styles.panelBackButton} type="button" onClick={() => onBack?.()}>
          <ArrowLeft size={14} />
          Quay lại danh sách
        </button>
        <div className={styles.panelTopPathGrid}>
          <div className={styles.panelTopPathField}>
            <label className={styles.label}>Folder video nguồn</label>
            <div className={styles.inputGroup}>
              <input
                className={styles.input}
                value={sourceFolderPath}
                readOnly
                placeholder="Chọn folder chứa video"
              />
              <Button variant="secondary" onClick={handlePickSourceFolder} disabled={isCreating || isScanning}>
                <FolderPlus size={14} />
              </Button>
            </div>
          </div>
          <div className={styles.panelTopPathField}>
            <label className={styles.label}>Folder drafts (project CapCut)</label>
            <div className={styles.inputGroup}>
              <input
                className={styles.input}
                value={capcutDraftsPath}
                onChange={(e) => setCapcutDraftsPath(e.target.value)}
                onBlur={() => void saveDraftsPath(capcutDraftsPath)}
                placeholder="Chọn folder chứa project CapCut"
              />
              <Button variant="secondary" onClick={handlePickCapcutDraftsFolder} disabled={isCreating || isScanning}>
                <FolderPlus size={14} />
              </Button>
            </div>
          </div>
        </div>
        <div className={styles.panelTopActions}>
          <Button variant="danger" onClick={handleStop} disabled={!isCreating}>
            <Square size={16} style={{ marginRight: '8px' }} /> Dừng
          </Button>
          <Button
            variant="success"
            onClick={handleStart}
            disabled={isCreating || isScanning || scanItems.length === 0}
          >
            <Play size={16} style={{ marginRight: '8px' }} /> Tạo
          </Button>
        </div>
      </div>

      <div className={styles.panelLayout}>
        <div className={styles.panelColumn}>
          <div className={`${styles.section} ${styles.sectionStretch}`}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Danh sách video quét được</h3>
              {dragIndex !== null && dragOverIndex !== null ? (
                <span className={styles.dragStatusPill}>
                  {`Dang keo #${dragIndex + 1} -> #${dragOverIndex + 1}`}
                </span>
              ) : null}
              <Button variant="secondary" onClick={handleScan} disabled={isCreating || isScanning || !sourceFolderPath}>
                Quét lại
              </Button>
            </div>
            <div
              ref={tableContainerRef}
              className={`${styles.tableContainer} ${styles.tableContainerStretch} ${dragIndex !== null ? styles.tableDragging : ''}`}
              onWheelCapture={(event) => dragAutoScroll.handleWheelWhileDragging(event as React.WheelEvent<HTMLElement>)}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>STT</th>
                    <th>Video</th>
                    <th>Project</th>
                    <th>Path</th>
                  </tr>
                </thead>
                <tbody>
                  {scanItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className={styles.textMuted} style={{ textAlign: 'center' }}>
                        Chưa có dữ liệu quét.
                      </td>
                    </tr>
                  ) : (
                    scanItems.map((item, index) => (
                      <tr
                        key={item.fullPath}
                        data-row-index={index}
                        onMouseDown={(event) => handlePointerDragStart(index, event)}
                        className={[
                          styles.draggableRow,
                          dragIndex === index ? styles.draggingRow : '',
                          dragOverIndex === index ? styles.dragOverRow : '',
                          dragOverIndex === index && dragIndex !== null && dragOverIndex < dragIndex ? styles.dropBeforeRow : '',
                          dragOverIndex === index && dragIndex !== null && dragOverIndex > dragIndex ? styles.dropAfterRow : '',
                        ].join(' ').trim()}
                        aria-grabbed={dragIndex === index}
                      >
                        <td>{index + 1}</td>
                        <td>{item.fileName}</td>
                        <td>{previewProjectName(index + 1)}</td>
                        <td title={item.fullPath}>{item.fullPath}</td>
                      </tr>
                    ))
                  )}
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
              {progress.currentVideoName ? ` | Video: ${progress.currentVideoName}` : ''}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Nhật ký</h3>
              <button className={styles.iconButton} title="Xóa log" onClick={handleClearLogs}>
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
                      <td>{renderLogBadge(log.status)}</td>
                      <td>
                        {log.projectName ? `[${log.projectName}] ` : ''}
                        {log.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Kết quả tạo project</h3>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Video</th>
                    <th>Project</th>
                    <th>Clip copy</th>
                    <th>Asset folder</th>
                    <th>Trạng thái</th>
                    <th>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {createdProjects.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={styles.textMuted} style={{ textAlign: 'center' }}>
                        Chưa có kết quả.
                      </td>
                    </tr>
                  ) : (
                    createdProjects.map((item, index) => (
                      <tr key={`${item.projectName}-${index}`}>
                        <td>{item.videoName}</td>
                        <td>{item.projectName}</td>
                        <td>{typeof item.copiedClipCount === 'number' ? item.copiedClipCount : '--'}</td>
                        <td title={item.assetFolder || ''}>{item.assetFolder || '--'}</td>
                        <td>
                          {item.status === 'success' ? (
                            <span className={`${styles.badge} ${styles.badgeSuccess}`}>OK</span>
                          ) : (
                            <span className={`${styles.badge} ${styles.badgeError}`}>Lỗi</span>
                          )}
                        </td>
                        <td>{item.error || '--'}</td>
                      </tr>
                    ))
                  )}
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
