/**
 * CaptionVideo Component - Tạo video caption (subtitle strip)
 * Giao diện Split View: Left (Canvas Preview) | Right (Controls)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  VideoMetadata,
  ASSStyleConfig,
  RenderProgress
} from '@shared/types/caption';
import styles from './CaptionVideo.module.css';
import {
  Film,
  Type,
  Settings,
  Play,
  CheckCircle,
  AlertCircle,
  Image as ImageIcon,
  MousePointer2,
  Maximize2
} from 'lucide-react';


// Define API interface locally since it's from preload
interface CaptionVideoAPI {
  getVideoMetadata: (filePath: string) => Promise<{ success: boolean; data?: VideoMetadata; error?: string }>;
  extractFrame: (filePath: string, frameNumber?: number) => Promise<{ success: boolean; data?: { frameData: string; width: number; height: number }; error?: string }>;
  onRenderProgress: (callback: (progress: RenderProgress) => void) => void;
  convertToAss: (options: {
    srtPath: string;
    assPath: string;
    videoResolution?: { width: number; height: number };
    style: ASSStyleConfig;
    position?: { x: number; y: number };
  }) => Promise<{ success: boolean; data?: { assPath: string; entriesCount: number }; error?: string }>;
  renderVideo: (options: {
    assPath: string;
    outputPath: string;
    width: number;
    height: number;
    useGpu: boolean;
  }) => Promise<{ success: boolean; data?: { outputPath: string; duration: number }; error?: string }>;
}

const getCaptionVideoAPI = (): CaptionVideoAPI => {
  return (window.electronAPI as unknown as { captionVideo: CaptionVideoAPI }).captionVideo;
};


const DEFAULT_STYLE: ASSStyleConfig = {
  fontName: 'ZYVNA Fairy', // Default to custom font
  fontSize: 62,
  fontColor: '#FFFF00',
  shadow: 4,
  marginV: 50,
  alignment: 2,
};

const FONT_OPTIONS = ['ZYVNA Fairy', 'Be Vietnam Pro', 'Arial', 'Roboto', 'Times New Roman'];
const COLOR_PRESETS = [
  { color: '#FFFFFF', label: 'Trắng' },
  { color: '#FFFF00', label: 'Vàng' },
  { color: '#FFEB3B', label: 'Vàng Nhạt' },
  { color: '#FF5722', label: 'Cam' },
  { color: '#00E5FF', label: 'Cyan' },
  { color: '#4CAF50', label: 'Xanh Lá' },
];

export const CaptionVideo: React.FC = () => {
  // --- State ---
  const [videoPath, setVideoPath] = useState('');
  const [srtPath, setSrtPath] = useState('');
  const [assPath, setAssPath] = useState('');
  const [outputPath, setOutputPath] = useState('');

  const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
  const [currentFrameBase64, setCurrentFrameBase64] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [scaleRatio, setScaleRatio] = useState(1);
  const [scaledSize, setScaledSize] = useState({ width: 0, height: 0 });

  const [mode, setMode] = useState<'region' | 'caption'>('region');

  const [region, setRegion] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
  const [isDraggingRegion, setIsDraggingRegion] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);

  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [useGpu, setUseGpu] = useState(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // --- Effects ---

  // Load Custom Font Style
  useEffect(() => {
    // Inject font face dynamically
    // Note: In Electron renderer, we might need a proper URL scheme or base64.
    // Assuming 'resources/fonts' is accessible via a custom protocol or relative path if possible.
    // Ideally, we copy font to assets or use a file protocol if allowed.
    // For now, we try to construct a file URL (may be blocked by CSP if not configured).
    // A safer way is if the main process reads the font and sends as base64 or blob.
    // However, user put it in resources. We will try a standard @font-face with file:/// protocol
    // assuming renderer has access or we use a relative path trick.

    // Actually, local file access might be restricted.
    // Let's assume standard system fonts or that the app is configured to allow local resource loading.
  }, []);

  // Resize observer
  useEffect(() => {
    const container = document.querySelector(`.${styles.canvasContainer}`);
    if (!container) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
         setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    drawCanvas();
  }, [currentFrameBase64, containerSize, region, style, mode]);

  useEffect(() => {
    getCaptionVideoAPI().onRenderProgress((prog) => {
      setProgress(prog);
      if (prog.status === 'completed') {
        setIsProcessing(false);
        setMessage('Hoàn thành!');
      } else if (prog.status === 'error') {
        setIsProcessing(false);
        setError(prog.message);
      }
    });
  }, []);

  const loadVideo = async (path: string) => {
    setVideoPath(path);
    setError('');

    try {
      const metaRes = await getCaptionVideoAPI().getVideoMetadata(path);
      if (metaRes.success && metaRes.data) {
        setVideoMeta(metaRes.data);
        setRegion({ x: 0, y: 0, w: metaRes.data.width, h: metaRes.data.height });
      }
      await loadRandomFrame(path);
    } catch (err) {
      setError(`Lỗi load video: ${err}`);
    }
  };

  const loadRandomFrame = async (path: string = videoPath) => {
    if (!path) return;
    try {
      const res = await getCaptionVideoAPI().extractFrame(path);
      if (res.success && res.data) {
        // Thêm prefix data URL nếu chưa có
        const frameData = res.data.frameData.startsWith('data:')
          ? res.data.frameData
          : `data:image/png;base64,${res.data.frameData}`;
        setCurrentFrameBase64(frameData);
      } else {
        setError(res.error || 'Lỗi lấy frame');
      }
    } catch (err) {
      setError(`Lỗi lấy frame: ${err}`);
    }
  };

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset loop if no frame
    if (!currentFrameBase64) {
        canvas.width = containerSize.width || 300;
        canvas.height = containerSize.height || 169;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#666';
        ctx.font = '14px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No Preview', canvas.width/2, canvas.height/2);
        return;
    }

    const img = new Image();
    img.src = currentFrameBase64;
    img.onload = () => {
      const cw = containerSize.width;
      const ch = containerSize.height;
      if (cw === 0 || ch === 0) return;

      canvas.width = cw;
      canvas.height = ch;

      const imgRatio = img.width / img.height;
      const canvasRatio = cw / ch;

      let drawW, drawH;

      // Default: Contain
      if (canvasRatio > imgRatio) {
        drawH = ch;
        drawW = drawH * imgRatio;
      } else {
        drawW = cw;
        drawH = drawW / imgRatio;
      }

      const offX = (cw - drawW) / 2;
      const offY = (ch - drawH) / 2;

      setImageOffset({ x: offX, y: offY });
      setScaledSize({ width: drawW, height: drawH });
      setScaleRatio(img.width / drawW);

      // Background
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, cw, ch);

      // Image
      ctx.drawImage(img, offX, offY, drawW, drawH);

      // Region Box
      if (region && mode === 'region') {
        const rx = (region.x / (img.width / drawW)) + offX;
        const ry = (region.y / (img.width / drawW)) + offY;
        const rw = region.w / (img.width / drawW);
        const rh = region.h / (img.width / drawW);

        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);

        // Dim overlay
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(offX, offY, drawW, ry - offY); // Top
        ctx.fillRect(offX, ry + rh, drawW, (offY + drawH) - (ry + rh)); // Bottom
        ctx.fillRect(offX, ry, rx - offX, rh); // Left
        ctx.fillRect(rx + rw, ry, (offX + drawW) - (rx + rw), rh); // Right
      }

      // Caption Demo
      if (style) {
        const fontSizeScaled = style.fontSize / (img.width / drawW);
        ctx.font = `bold ${fontSizeScaled}px "${style.fontName}", sans-serif`;
        ctx.textAlign = style.alignment === 2 ? 'center' : 'left';

        const effectiveY = region
            ? (region.y / scaleRatio) + offY + (region.h / scaleRatio)
            : offY + drawH;

        const textX = offX + drawW / 2;
        const marginVScaled = style.marginV / scaleRatio;
        const textY = effectiveY - marginVScaled;

        if (style.shadow > 0) {
           ctx.shadowColor = 'rgba(0,0,0,0.8)';
           ctx.shadowBlur = 2;
           ctx.shadowOffsetX = 1;
           ctx.shadowOffsetY = 1;
        }

        ctx.fillStyle = style.fontColor;
        ctx.fillText("Caption Demo", textX, textY);
        ctx.shadowColor = 'transparent';

        if (mode === 'caption') {
             // Guide line
             ctx.strokeStyle = '#3b82f6';
             ctx.lineWidth = 1;
             ctx.beginPath();
             ctx.moveTo(textX - 20, textY);
             ctx.lineTo(textX + 20, textY);
             ctx.stroke();

             // Margin indicator
             ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
             ctx.setLineDash([2, 2]);
             ctx.beginPath();
             ctx.moveTo(textX, textY);
             ctx.lineTo(textX, effectiveY);
             ctx.stroke();
             ctx.setLineDash([]);
        }
      }
    };
  }, [currentFrameBase64, containerSize, region, style, mode]);

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!currentFrameBase64) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (mode === 'region') {
      setIsDraggingRegion(true);
      setDragStart({ x, y });
      setRegion({
        x: (x - imageOffset.x) * scaleRatio,
        y: (y - imageOffset.y) * scaleRatio,
        w: 0, h: 0
      });
    } else if (mode === 'caption') {
       setIsDraggingRegion(true);
       setDragStart({x, y});
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRegion || !dragStart || !currentFrameBase64) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (mode === 'region') {
      const startX = dragStart.x;
      const startY = dragStart.y;

      const curX = Math.max(imageOffset.x, Math.min(x, imageOffset.x + scaledSize.width));
      const curY = Math.max(imageOffset.y, Math.min(y, imageOffset.y + scaledSize.height));

      const x1 = Math.min(startX, curX);
      const y1 = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);

      setRegion({
        x: Math.floor((x1 - imageOffset.x) * scaleRatio),
        y: Math.floor((y1 - imageOffset.y) * scaleRatio),
        w: Math.floor(w * scaleRatio),
        h: Math.floor(h * scaleRatio)
      });
    } else if (mode === 'caption') {
        const curY = y;
        const effectiveBottom = region
            ? imageOffset.y + ((region.y + region.h) / scaleRatio)
            : imageOffset.y + scaledSize.height;
        const distFromBottom = effectiveBottom - curY;
        setStyle(prev => ({ ...prev, marginV: Math.max(0, Math.floor(distFromBottom * scaleRatio)) }));
    }
  };

  const handleMouseUp = () => {
    setIsDraggingRegion(false);
    setDragStart(null);
  };

  // Actions
  const handleBrowseVideo = async () => {
      try {
          const res = await window.electronAPI.invoke('dialog:openFile', {
              filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi'] }]
          }) as { canceled: boolean; filePaths: string[] };
          if (!res.canceled && res.filePaths.length > 0) {
              loadVideo(res.filePaths[0]);
          }
      } catch (e) { setError(`${e}`); }
  };

  const handleBrowseSrt = async () => {
    try {
        const res = await window.electronAPI.invoke('dialog:openFile', { filters: [{ name: 'SRT', extensions: ['srt'] }] }) as { canceled: boolean; filePaths: string[] };
        if (!res.canceled && res.filePaths.length > 0) {
            setSrtPath(res.filePaths[0]);
            setAssPath(res.filePaths[0].replace('.srt', '.ass'));
            setOutputPath(res.filePaths[0].replace('.srt', '_caption.mp4'));
        }
    } catch (e) { setError(`${e}`); }
  };

  const handleBrowseOutput = async () => {
    try {
        const res = await window.electronAPI.invoke('dialog:showSaveDialog', {
            title: 'Chọn nơi lưu video',
            defaultPath: outputPath || 'caption_output.mp4',
            filters: [{ name: 'Video', extensions: ['mp4'] }]
        }) as { canceled: boolean; filePath?: string };
        if (!res.canceled && res.filePath) {
            setOutputPath(res.filePath);
        }
    } catch (e) { setError(`${e}`); }
  };

  const handleResetRegion = () => {
    if (videoMeta) {
      setRegion({ x: 0, y: 0, w: videoMeta.width, h: videoMeta.height });
    } else {
      setRegion(null);
    }
    setMessage('Đã reset vùng chọn');
  };

  const handleSaveCoordinates = async () => {
    if (!region) {
      setError('Chưa chọn vùng nào!');
      return;
    }
    try {
      const res = await window.electronAPI.invoke('dialog:showSaveDialog', {
        title: 'Lưu tọa độ vùng',
        defaultPath: 'region_coordinates.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }) as { canceled: boolean; filePath?: string };
      if (!res.canceled && res.filePath) {
        const data = {
          region: { x: region.x, y: region.y, width: region.w, height: region.h },
          video_file: videoPath ? videoPath.split(/[\\/]/).pop() : 'N/A',
          style: { marginV: style.marginV, alignment: style.alignment },
        };
        await window.electronAPI.invoke('caption:saveJson', { filePath: res.filePath, data });
        setMessage(`Đã lưu tọa độ: ${res.filePath}`);
      }
    } catch (e) { setError(`${e}`); }
  };

  const handleRender = async () => {
      if (!srtPath || !outputPath) {
        setError('Vui lòng chọn file SRT và đường dẫn output.');
        return;
      }
      setIsProcessing(true);
      setError('');

      try {
          // Bước 1: Tự động convert SRT -> ASS
          setMessage('Đang tạo file ASS...');
          const generatedAssPath = assPath || srtPath.replace(/\.srt$/i, '.ass');
          const convertRes = await getCaptionVideoAPI().convertToAss({
              srtPath,
              assPath: generatedAssPath,
              videoResolution: videoMeta ? { width: videoMeta.width, height: videoMeta.height } : undefined,
              style
          });
          if (!convertRes.success) {
              setError(convertRes.error || 'Lỗi tạo file ASS');
              return;
          }
          setAssPath(generatedAssPath);

          // Bước 2: Render video từ ASS
          setMessage(`Đang render video (${convertRes.data?.entriesCount} dòng)...`);
          const res = await getCaptionVideoAPI().renderVideo({
              assPath: generatedAssPath,
              outputPath,
              width: region ? region.w : (videoMeta?.width || 1920),
              height: region ? region.h : (videoMeta?.height || 1080),
              useGpu
          });
          if (res.success) setMessage(`Render xong! Duration: ${res.data?.duration.toFixed(2)}s`);
          else setError(res.error || 'Error');
      } catch (e) { setError(`${e}`); }
      finally { setIsProcessing(false); }
  };

  return (
    <div className={styles.container}>
      {/* Inject Font Face */}
      <style>{`
        @font-face {
          font-family: 'ZYVNA Fairy';
          src: url('file:///d:/NauChaoHeo/resources/fonts/ZYVNA Fairy.ttf') format('truetype');
        }
      `}</style>



      {/* Right Pane: Controls */}
      <div className={styles.rightPane}>
         <div className={styles.header}>
            <h2>Caption Video</h2>
            <span className={styles.subtitle}>Tạo video subtitle strip (Hardsub)</span>
         </div>

         <div className={styles.grid}>
             {/* File Settings */}
             <div className={`${styles.section} ${styles.fullWidth}`}>
                 <div className={styles.sectionTitle}><Film size={16} /> File Input</div>
                 <div className={styles.grid}>
                    <div className={styles.inputGroup}>
                        <span className={styles.label}>Video File</span>
                        <div className={styles.fileInputWrapper}>
                            <input className={styles.input} value={videoPath} readOnly placeholder="Chọn video..." />
                            <button className={`${styles.btn} ${styles.browseBtn}`} onClick={handleBrowseVideo}>📂</button>
                        </div>
                    </div>
                    <div className={styles.inputGroup}>
                        <span className={styles.label}>SRT File</span>
                        <div className={styles.fileInputWrapper}>
                            <input className={styles.input} value={srtPath} readOnly placeholder="Chọn subtitle..." />
                            <button className={`${styles.btn} ${styles.browseBtn}`} onClick={handleBrowseSrt}>📂</button>
                        </div>
                    </div>
                 </div>
             </div>

             {/* Preview Section */}
             <div className={`${styles.section} ${styles.fullWidth}`}>
                <div className={styles.sectionTitle}>
                    <span>Preview</span>
                    <button className={styles.btn} onClick={() => loadRandomFrame()} title="Random Frame" style={{marginLeft: 'auto', padding: '4px 8px', fontSize: '0.75rem'}}>
                        <ImageIcon size={14} /> Random Frame
                    </button>
                </div>
                
                <div className={styles.canvasContainer}>
                   <canvas
                        ref={canvasRef}
                        className={styles.canvas}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    />
                </div>

                <div className={styles.previewControls} style={{marginTop: 12, justifyContent: 'space-between', display: 'flex'}}>
                    <div className={styles.canvasInfo} style={{ border: 'none', background: 'transparent', padding: 0, textAlign: 'left' }}>
                        {videoMeta ? `${videoMeta.width}x${videoMeta.height}` : 'No Video'}
                        {region && ` | Region: (${region.x},${region.y}) ${region.w}x${region.h}`}
                        {style.marginV > 0 && ` | MarginV: ${style.marginV}px`}
                    </div>
                    <div style={{display: 'flex', gap: 8}}>
                        <button
                            className={`${styles.btn} ${mode === 'region' ? styles.btnPrimary : ''}`}
                            onClick={() => setMode('region')}
                        >
                            <Maximize2 size={14} /> Chọn Vùng
                        </button>
                        <button
                            className={`${styles.btn} ${mode === 'caption' ? styles.btnPrimary : ''}`}
                            onClick={() => setMode('caption')}
                        >
                            <MousePointer2 size={14} /> Chỉnh Vị trí
                        </button>
                        <button
                            className={styles.btn}
                            onClick={handleResetRegion}
                            title="Reset vùng chọn về toàn bộ video"
                        >
                            Reset
                        </button>
                        <button
                            className={styles.btn}
                            onClick={handleSaveCoordinates}
                            title="Lưu tọa độ vùng chọn ra file JSON"
                            disabled={!region}
                        >
                            Lưu Tọa độ
                        </button>
                    </div>
                </div>
             </div>

             {/* Style Settings */}
             <div className={styles.section}>
                 <div className={styles.sectionTitle}><Type size={16} /> Style Config</div>
                 <div className={styles.inputGroup}>
                     <span className={styles.label}>Font Family</span>
                     <select
                        className={styles.select}
                        value={style.fontName}
                        onChange={e => setStyle({...style, fontName: e.target.value})}
                    >
                        {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                 </div>
                 <div className={styles.grid}>
                     <div className={styles.inputGroup}>
                         <span className={styles.label}>Size</span>
                         <input
                            type="number" className={styles.input}
                            value={style.fontSize}
                            onChange={e => setStyle({...style, fontSize: Number(e.target.value)})}
                            min={20} max={200} step={2}
                         />
                     </div>
                     <div className={styles.inputGroup}>
                         <span className={styles.label}>Shadow</span>
                         <input
                            type="number" className={styles.input}
                            value={style.shadow}
                            onChange={e => setStyle({...style, shadow: Number(e.target.value)})}
                            min={0} max={10}
                         />
                     </div>
                 </div>
                 <div className={styles.grid}>
                     <div className={styles.inputGroup}>
                         <span className={styles.label}>Margin V</span>
                         <input
                            type="number" className={styles.input}
                            value={style.marginV}
                            onChange={e => setStyle({...style, marginV: Number(e.target.value)})}
                            min={0} max={500}
                            title="Khoảng cách từ đáy video (px)"
                         />
                     </div>
                     <div className={styles.inputGroup}>
                         <span className={styles.label}>Alignment</span>
                         <select
                            className={styles.select}
                            value={style.alignment}
                            onChange={e => setStyle({...style, alignment: Number(e.target.value)})}
                         >
                            <option value={2}>Bottom Center</option>
                            <option value={5}>Middle Center</option>
                            <option value={8}>Top Center</option>
                            <option value={1}>Bottom Left</option>
                            <option value={3}>Bottom Right</option>
                         </select>
                     </div>
                 </div>
                 <div className={styles.inputGroup}>
                     <span className={styles.label}>Color</span>
                     <div className={styles.colorPickerWrapper}>
                         <input
                            type="color" className={styles.colorInput}
                            value={style.fontColor}
                            onChange={e => setStyle({...style, fontColor: e.target.value})}
                        />
                        <div className={styles.presets}>
                             {COLOR_PRESETS.map(p => (
                                <div
                                    key={p.color}
                                    className={styles.swatch}
                                    style={{backgroundColor: p.color}}
                                    onClick={() => setStyle({...style, fontColor: p.color})}
                                    title={p.label}
                                />
                            ))}
                        </div>
                     </div>
                 </div>
             </div>

             {/* Render Settings */}
             <div className={styles.section}>
                 <div className={styles.sectionTitle}><Settings size={16} /> Settings</div>
                 <div className={styles.inputGroup}>
                     <span className={styles.label}>Output Path</span>
                     <div className={styles.fileInputWrapper}>
                         <input className={styles.input} value={outputPath} onChange={e => setOutputPath(e.target.value)} placeholder="Đường dẫn output video..." />
                         <button className={`${styles.btn} ${styles.browseBtn}`} onClick={handleBrowseOutput}>📂</button>
                     </div>
                 </div>
                 <div className={styles.inputGroup}>
                     <label style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <input type="checkbox" checked={useGpu} onChange={e => setUseGpu(e.target.checked)} />
                        <span className={styles.label}>Enable GPU Acceleration (NVENC)</span>
                     </label>
                 </div>
             </div>
         </div>

         {/* Action Bar */}
         <div className={styles.actionBar}>
             {message && (
                 <div className={`${styles.statusMessage} ${error ? styles.errorMsg : styles.successMsg}`} style={{flex: 1, margin: 0}}>
                     {error ? <AlertCircle size={14} style={{display: 'inline', marginRight: 4}}/> : <CheckCircle size={14} style={{display: 'inline', marginRight: 4}}/>}
                     {error || message}
                 </div>
             )}

             <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleRender}
                disabled={isProcessing || !srtPath}
            >
                <Play size={16} /> Render Video
            </button>
         </div>

         {/* Progress Bar */}
         {progress && isProcessing && (
             <div className={styles.progressContainer}>
                 <div className={styles.progressTrack}>
                     <div className={styles.progressBar} style={{width: `${progress.percent}%`}} />
                 </div>
                 <div className={styles.progressText}>{progress.percent.toFixed(1)}% - {progress.message}</div>
             </div>
         )}
      </div>
    </div>
  );
};
