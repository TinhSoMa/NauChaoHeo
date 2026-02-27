import { useState, useRef, useCallback, useEffect } from 'react';
import { ASSStyleConfig, SubtitleEntry } from '@shared/types/caption';

interface SubtitlePreviewState {
  frameData: string | null;
  videoSize: { width: number; height: number };
  subtitlePosition: { x: number; y: number };
  isLoading: boolean;
  error: string | null;
}

export type PreviewMode = 'subtitle' | 'blackout' | 'logo';

export interface UseSubtitlePreviewOptions {
  style: ASSStyleConfig;
  entries?: SubtitleEntry[];
  blackoutTop?: number | null;  // fraction 0-1 (persisted from settings)
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;  // user-set scale multiplier (1.0 = native size)
  onPositionChange?: (pos: { x: number; y: number } | null) => void;
  onBlackoutChange?: (top: number | null) => void;
  onLogoPositionChange?: (pos: { x: number; y: number } | null) => void;
  onLogoScaleChange?: (scale: number) => void;
  thumbnailText?: string; // preview overlay ở trung tâm frame khi nhập thumbnail text
}

export function useSubtitlePreview({ style, entries, blackoutTop, logoPath, logoPosition, logoScale, onPositionChange, onBlackoutChange, onLogoPositionChange, onLogoScaleChange, thumbnailText }: UseSubtitlePreviewOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const logoImageRef = useRef<HTMLImageElement | null>(null);
  // Stores logo bounding box in canvas-pixel coords, updated every drawCanvas
  const logoBoundsRef = useRef<{ cx: number; cy: number; hw: number; hh: number } | null>(null);
  // Stores corner-drag start data
  const cornerDragRef = useRef<{ initialDist: number; initialScale: number } | null>(null);
  // Video metadata for frame scrubbing (path, fps, duration) — không trigger re-render
  const videoMetaRef = useRef<{ path: string; fps: number; duration: number } | null>(null);

  const [frameTimeSec, setFrameTimeSec] = useState(0);

  const [state, setState] = useState<SubtitlePreviewState>({
    frameData: null,
    videoSize: { width: 1920, height: 1080 },
    subtitlePosition: { x: 960, y: 540 },
    isLoading: false,
    error: null,
  });

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [scaleRatio, setScaleRatio] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [canvasCursor, setCanvasCursor] = useState<string>('crosshair');

  // Mode: subtitle positioning, blackout line dragging, or logo positioning
  const [mode, setMode] = useState<PreviewMode>('subtitle');

  // Local blackout top (fraction 0-1) for live dragging — synced from prop
  const [localBlackoutTop, setLocalBlackoutTop] = useState<number | null>(blackoutTop ?? null);
  
  // Local logo position for dragging
  const [localLogoPosition, setLocalLogoPosition] = useState<{ x: number; y: number } | null>(logoPosition ?? null);
  const localLogoPositionRef = useRef<{ x: number; y: number } | null>(logoPosition ?? null);
  const setLocalLogoPositionSynced = (pos: { x: number; y: number } | null) => {
    localLogoPositionRef.current = pos;
    setLocalLogoPosition(pos);
  };

  // Local logo scale (wheel to zoom)
  const [localLogoScale, setLocalLogoScale] = useState<number>(logoScale ?? 1.0);
  const localLogoScaleRef = useRef<number>(logoScale ?? 1.0);
  const setLocalLogoScaleSynced = (s: number) => {
    localLogoScaleRef.current = s;
    setLocalLogoScale(s);
  };

  // Sync from prop when it changes externally
  useEffect(() => {
    setLocalBlackoutTop(blackoutTop ?? null);
  }, [blackoutTop]);
  
  useEffect(() => {
    localLogoPositionRef.current = logoPosition ?? null;
    setLocalLogoPosition(logoPosition ?? null);
  }, [logoPosition]);

  useEffect(() => {
    localLogoScaleRef.current = logoScale ?? 1.0;
    setLocalLogoScale(logoScale ?? 1.0);
  }, [logoScale]);

  // ---------------------------------------------------------
  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(resizeEntries => {
      for (const entry of resizeEntries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const loadPreview = useCallback(async (videoPath: string) => {
    if (!videoPath) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const api = (window.electronAPI as any).captionVideo;

      const metaRes = await api.getVideoMetadata(videoPath);
      let vw = 1920, vh = 1080;
      if (metaRes?.success && metaRes.data) {
        vw = metaRes.data.width;
        vh = metaRes.data.actualHeight || metaRes.data.height || 1080;
        // Lưu metadata để scrubber dùng sau
        videoMetaRef.current = {
          path: videoPath,
          fps: metaRes.data.fps || 30,
          duration: metaRes.data.duration || 0,
        };
        setFrameTimeSec(0);
      }

      const frameRes = await api.extractFrame(videoPath);
      if (frameRes?.success && frameRes.data) {
        const fd = frameRes.data.frameData.startsWith('data:')
          ? frameRes.data.frameData
          : `data:image/png;base64,${frameRes.data.frameData}`;

        setState(prev => {
          let initialY = Math.floor(vh / 2);
          if (localBlackoutTop !== null && localBlackoutTop < 1) {
            const blackoutMidFrac = localBlackoutTop + (1 - localBlackoutTop) / 2;
            initialY = Math.floor(vh * blackoutMidFrac);
          }
          const initialCenter = { x: Math.floor(vw / 2), y: initialY };
          
          setTimeout(() => onPositionChange?.(initialCenter), 0);

          return {
            ...prev,
            frameData: fd,
            videoSize: { width: vw, height: vh },
            subtitlePosition: initialCenter,
            isLoading: false,
          };
        });
      } else {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: frameRes?.error || 'Không lấy được frame',
        }));
      }
    } catch (e) {
      setState(prev => ({ ...prev, isLoading: false, error: `${e}` }));
    }
  }, [localBlackoutTop, onPositionChange]);

  // Chỉ thay ảnh nền canvas — KHÔNG reset subtitlePosition, KHÔNG gọi onPositionChange
  const loadFrameAt = useCallback(async (timeSec: number) => {
    const meta = videoMetaRef.current;
    if (!meta) return;
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const api = (window.electronAPI as any).captionVideo;
      const frameNumber = Math.round(timeSec * meta.fps);
      const frameRes = await api.extractFrame(meta.path, frameNumber);
      if (frameRes?.success && frameRes.data) {
        const fd = frameRes.data.frameData.startsWith('data:')
          ? frameRes.data.frameData
          : `data:image/png;base64,${frameRes.data.frameData}`;
        // Chỉ cập nhật frameData, spread prev giữ nguyên subtitlePosition/videoSize
        setState(prev => ({ ...prev, frameData: fd, isLoading: false }));
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Helper: convert canvas Y to video fraction (0-1)
  const canvasYToFraction = useCallback((cy: number) => {
    const img = imageRef.current;
    if (!img) return 0.5;
    const imgRatio = img.width / img.height;
    const cw = containerSize.width || 400;
    const ch = containerSize.height || 225;
    const canvasRatio = cw / ch;

    let drawH: number;
    if (canvasRatio > imgRatio) {
      drawH = ch;
    } else {
      const drawW = cw;
      drawH = drawW / imgRatio;
    }
    const offY = (ch - drawH) / 2;

    // Clamp to video area
    const relY = Math.max(0, Math.min(1, (cy - offY) / drawH));
    return relY;
  }, [containerSize]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = containerSize.width || 400;
    const ch = containerSize.height || 225;
    canvas.width = cw;
    canvas.height = ch;

    const img = imageRef.current;

    if (!img) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#666';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có video preview', cw / 2, ch / 2);
      return;
    }

    const imgRatio = img.width / img.height;
    const canvasRatio = cw / ch;

    let drawW: number, drawH: number;
    if (canvasRatio > imgRatio) {
      drawH = ch;
      drawW = drawH * imgRatio;
    } else {
      drawW = cw;
      drawH = drawW / imgRatio;
    }

    const offX = (cw - drawW) / 2;
    const offY = (ch - drawH) / 2;

    const ratio = img.width / drawW;
    setScaleRatio(ratio);
    setImageOffset({ x: offX, y: offY });

    // Background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, cw, ch);

    // Video frame
    ctx.drawImage(img, offX, offY, drawW, drawH);

    // ===== Draw blackout band at bottom =====
    if (localBlackoutTop !== null && localBlackoutTop < 1) {
      const bandY = offY + drawH * localBlackoutTop;
      const bandH = drawH * (1 - localBlackoutTop);

      // Black fill
      ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
      ctx.fillRect(offX, bandY, drawW, bandH);

      // Red top edge line
      ctx.strokeStyle = 'rgba(255, 60, 60, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(offX, bandY);
      ctx.lineTo(offX + drawW, bandY);
      ctx.stroke();

      // Label
      const pct = Math.round((1 - localBlackoutTop) * 100);
      ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`che ${pct}%`, offX + drawW - 6, bandY - 4);
    }

    // ===== Subtitle text =====
    let displayText = 'Caption Demo ✦';
    if (entries && entries.length > 0) {
      displayText = entries[0].translatedText || entries[0].text;
    }

    const pos = state.subtitlePosition;
    const textX = (pos.x / ratio) + offX;
    const textY = (pos.y / ratio) + offY;

    const videoH = state.videoSize.height;
    let effectiveFontSize = style.fontSize;
    if (videoH < 400) {
      effectiveFontSize = Math.max(16, Math.floor(videoH * 0.9));
    } else if (style.fontSize > videoH * 0.15) {
      effectiveFontSize = Math.floor(videoH * 0.08);
    }
    const fontSizeScaled = Math.max(12, effectiveFontSize / ratio);

    const outlineScaled = Math.max(1, 2 / ratio);
    const shadowScaled = Math.max(0, style.shadow / ratio);

    ctx.font = `${fontSizeScaled}px "${style.fontName}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = displayText.split(/\\N|\n/g);
    const lineHeight = fontSizeScaled * 1.3;
    const totalTextHeight = (lines.length - 1) * lineHeight;
    const startY = textY - totalTextHeight / 2;

    lines.forEach((line, i) => {
      const ly = startY + i * lineHeight;

      if (style.shadow > 0) {
        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = outlineScaled;
        ctx.lineJoin = 'round';
        ctx.fillText(line, textX + shadowScaled, ly + shadowScaled);
        ctx.strokeText(line, textX + shadowScaled, ly + shadowScaled);
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = outlineScaled * 2;
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'transparent';
      ctx.strokeText(line, textX, ly);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = style.fontColor;
      ctx.shadowColor = 'transparent';
      ctx.fillText(line, textX, ly);
      ctx.restore();
    });
    
    // ===== Logo Image =====
    const logoImg = logoImageRef.current;
    if (logoImg) {
      // Mặc định ném logo vào góc trên bên trái nếu chưa có vị trí
      const logoXCoord = localLogoPosition?.x ?? (logoImg.width / 2) + 50;
      const logoYCoord = localLogoPosition?.y ?? (logoImg.height / 2) + 50;
      
      const logoDrawX = (logoXCoord / ratio) + offX;
      const logoDrawY = (logoYCoord / ratio) + offY;
      
      // Vẽ logo (tâm ở logoDrawX, logoDrawY)
      const scaledLogoW = (logoImg.width / ratio) * localLogoScale;
      const scaledLogoH = (logoImg.height / ratio) * localLogoScale;
      ctx.drawImage(logoImg, logoDrawX - (scaledLogoW / 2), logoDrawY - (scaledLogoH / 2), scaledLogoW, scaledLogoH);

      // Cập nhật bounds ref để mouse handlers dùng
      logoBoundsRef.current = { cx: logoDrawX, cy: logoDrawY, hw: scaledLogoW / 2, hh: scaledLogoH / 2 };
      
      // Khung + corner handles (chỉ trong chế độ logo)
      if (mode === 'logo') {
        const HANDLE = 7; // kích thước handle vuông (px)
        const bx = logoDrawX - scaledLogoW / 2;
        const by = logoDrawY - scaledLogoH / 2;

        // Khung viền
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bx, by, scaledLogoW, scaledLogoH);
        ctx.setLineDash([]);

        // 4 corner handles
        const corners = [
          { x: bx,                   y: by                   }, // TL
          { x: bx + scaledLogoW,     y: by                   }, // TR
          { x: bx,                   y: by + scaledLogoH     }, // BL
          { x: bx + scaledLogoW,     y: by + scaledLogoH     }, // BR
        ];
        corners.forEach(({ x, y }) => {
          ctx.fillStyle = '#eab308';
          ctx.fillRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
        });
      }
    }

    // Crosshair (only in subtitle mode)
    if (mode === 'subtitle') {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(textX - 30, textY);
      ctx.lineTo(textX + 30, textY);
      ctx.moveTo(textX, textY - 15);
      ctx.lineTo(textX, textY + 15);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ===== Thumbnail text overlay (preview only) =====
    if (thumbnailText?.trim()) {
      const thumbFontSize = Math.max(14, drawH * 0.07);
      ctx.save();
      ctx.font = `bold ${thumbFontSize}px "${style.fontName}", Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const centerX = offX + drawW / 2;
      const centerY = offY + drawH / 2;
      const measured = ctx.measureText(thumbnailText.trim());
      const pad = thumbFontSize * 0.5;
      const boxW = measured.width + pad * 2;
      const boxH = thumbFontSize + pad;
      // Semi-transparent black box
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(centerX - boxW / 2, centerY - boxH / 2, boxW, boxH);
      // White text with black outline
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1, thumbFontSize * 0.06);
      ctx.lineJoin = 'round';
      ctx.strokeText(thumbnailText.trim(), centerX, centerY);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(thumbnailText.trim(), centerX, centerY);
      // Thin yellow border on box to distinguish from video content
      ctx.strokeStyle = 'rgba(250,200,0,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(centerX - boxW / 2, centerY - boxH / 2, boxW, boxH);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [state.subtitlePosition, state.videoSize, containerSize, style, entries, localBlackoutTop, localLogoPosition, localLogoScale, mode, thumbnailText]);

  // Load video frame image
  useEffect(() => {
    if (!state.frameData) {
      imageRef.current = null;
      drawCanvas();
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      drawCanvas();
    };
    img.src = state.frameData;
  }, [state.frameData, drawCanvas]);

  // Load logo image
  useEffect(() => {
    if (!logoPath) {
      logoImageRef.current = null;
      drawCanvas();
      return;
    }
    const api = (window.electronAPI as any).captionVideo;
    const loadLogo = async () => {
       try {
         // Đọc base64 từ main process để vượt qua web security limitations (không thể fill `file:///` load trực tiếp được)
         // ta có thể sử dụng extractFrame function hoặc thêm một function readLocalImage
         const res = await api.readLocalImage?.(logoPath);
         if (res?.success && res.data) {
           const logImg = new Image();
           logImg.onload = () => {
             logoImageRef.current = logImg;
             
             // Gán vị trí mặc định nếu chưa có (góc trên bên trái)
             if (!localLogoPositionRef.current) {
               const defaultPos = {
                 x: Math.floor((logImg.width / 2) + 50),
                 y: Math.floor((logImg.height / 2) + 50)
               };
               setLocalLogoPositionSynced(defaultPos);
               setTimeout(() => onLogoPositionChange?.(defaultPos), 0);
             }
             
             drawCanvas();
           };
           logImg.src = res.data.startsWith('data:') ? res.data : `data:image/png;base64,${res.data}`;
         }
       } catch (e) {
         console.warn("Failed to load logo image:", e);
       }
    };
    loadLogo();
  }, [logoPath, state.videoSize]);

  // Load custom font
  useEffect(() => {
    const fontName = style.fontName;
    if (!fontName) return;

    const styleId = `preview-font-${fontName.replace(/\s+/g, '-')}`;
    if (document.getElementById(styleId)) {
      document.fonts.load(`12px "${fontName}"`).then(() => drawCanvas());
      return;
    }

    const loadFont = async () => {
      try {
        const res = await (window.electronAPI as any).captionVideo.getFontData(fontName);
        if (res?.success && res.data) {
          const styleEl = document.createElement('style');
          styleEl.id = styleId;
          styleEl.innerHTML = `
            @font-face {
              font-family: '${fontName}';
              src: url('${res.data}') format('truetype');
            }
          `;
          document.head.appendChild(styleEl);
          
          await document.fonts.load(`12px "${fontName}"`);
          drawCanvas();
        }
      } catch (e) {
        console.error('Lỗi tải font base64:', e);
        drawCanvas();
      }
    };

    loadFont();
  }, [style.fontName, drawCanvas]);

  // Redraw on state changes
  useEffect(() => {
    if (imageRef.current || !state.frameData) {
      drawCanvas();
    }
  }, [state.subtitlePosition, containerSize, style, entries, drawCanvas]);

  // ========================================================
  // Mouse handlers
  // ========================================================

  // Helper: kiểm tra xem điểm (cx, cy) có gần góc nào của logo không
  const isNearCorner = useCallback((cx: number, cy: number) => {
    const b = logoBoundsRef.current;
    if (!b) return false;
    const HIT = 12;
    return [
      { x: b.cx - b.hw, y: b.cy - b.hh },
      { x: b.cx + b.hw, y: b.cy - b.hh },
      { x: b.cx - b.hw, y: b.cy + b.hh },
      { x: b.cx + b.hw, y: b.cy + b.hh },
    ].some(c => Math.abs(cx - c.x) <= HIT && Math.abs(cy - c.y) <= HIT);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!state.frameData) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    setIsDragging(true);

    if (mode === 'subtitle') {
      const newPos = {
        x: Math.max(0, Math.min(state.videoSize.width, Math.floor((cx - imageOffset.x) * scaleRatio))),
        y: Math.max(0, Math.min(state.videoSize.height, Math.floor((cy - imageOffset.y) * scaleRatio))),
      };
      setState(prev => ({ ...prev, subtitlePosition: newPos }));
      onPositionChange?.(newPos);
    } else if (mode === 'logo') {
      const b = logoBoundsRef.current;
      if (b && isNearCorner(cx, cy)) {
        // Bắt đầu kéo góc để resize — dùng ref để đọc scale hiện tại chính xác
        const dist = Math.sqrt((cx - b.cx) ** 2 + (cy - b.cy) ** 2);
        cornerDragRef.current = { initialDist: Math.max(dist, 1), initialScale: localLogoScaleRef.current };
      } else {
        // Di chuyển logo — chỉ cập nhật local, commit khi mouseUp
        cornerDragRef.current = null;
        const newPos = {
          x: Math.max(0, Math.min(state.videoSize.width, Math.floor((cx - imageOffset.x) * scaleRatio))),
          y: Math.max(0, Math.min(state.videoSize.height, Math.floor((cy - imageOffset.y) * scaleRatio))),
        };
        setLocalLogoPositionSynced(newPos);
      }
    } else {
      // Blackout mode: set the top Y of blackout band
      const frac = canvasYToFraction(cy);
      setLocalBlackoutTop(frac);
    }
  }, [state.frameData, state.videoSize, mode, imageOffset, scaleRatio, isNearCorner, onPositionChange, canvasYToFraction]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Cập nhật cursor khi hover (không cần đang kéo)
    if (mode === 'logo' && !isDragging) {
      setCanvasCursor(isNearCorner(cx, cy) ? 'nwse-resize' : 'move');
    } else if (mode !== 'logo') {
      setCanvasCursor(mode === 'blackout' ? 'ns-resize' : 'crosshair');
    }

    if (!isDragging || !state.frameData) return;

    if (mode === 'subtitle') {
      const newPos = {
        x: Math.max(0, Math.min(state.videoSize.width, Math.floor((cx - imageOffset.x) * scaleRatio))),
        y: Math.max(0, Math.min(state.videoSize.height, Math.floor((cy - imageOffset.y) * scaleRatio))),
      };
      setState(prev => ({ ...prev, subtitlePosition: newPos }));
    } else if (mode === 'logo') {
      if (cornerDragRef.current) {
        // Resize từ góc: tính scale theo tỉ lệ khoảng cách tới tâm
        const b = logoBoundsRef.current;
        if (!b) return;
        const dist = Math.sqrt((cx - b.cx) ** 2 + (cy - b.cy) ** 2);
        const newScale = Math.max(0.05, Math.min(10, cornerDragRef.current.initialScale * (dist / cornerDragRef.current.initialDist)));
        setLocalLogoScaleSynced(newScale);
      } else {
        // Di chuyển logo
        const newPos = {
          x: Math.max(0, Math.min(state.videoSize.width, Math.floor((cx - imageOffset.x) * scaleRatio))),
          y: Math.max(0, Math.min(state.videoSize.height, Math.floor((cy - imageOffset.y) * scaleRatio))),
        };
        setLocalLogoPositionSynced(newPos);
      }
    } else {
      const frac = canvasYToFraction(cy);
      setLocalBlackoutTop(frac);
    }
  }, [isDragging, state.frameData, state.videoSize, mode, imageOffset, scaleRatio, isNearCorner, canvasYToFraction]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    if (mode === 'subtitle') {
      if (state.frameData) {
        onPositionChange?.(state.subtitlePosition);
      }
    } else if (mode === 'logo') {
      if (cornerDragRef.current) {
        // Commit scale — dùng ref để tránh stale closure
        const finalScale = localLogoScaleRef.current;
        onLogoScaleChange?.(finalScale);
        cornerDragRef.current = null;
      } else {
        // Commit position — dùng ref để tránh stale closure, guard against null
        const finalPos = localLogoPositionRef.current;
        if (finalPos) {
          onLogoPositionChange?.(finalPos);
        }
      }
    } else {
      // Commit blackout value
      onBlackoutChange?.(localBlackoutTop);
    }
  }, [mode, state.frameData, state.subtitlePosition, onPositionChange, onLogoPositionChange, onLogoScaleChange, localBlackoutTop, onBlackoutChange]);

  const resetToCenter = useCallback(() => {
    setState(prev => {
      const center = {
        x: Math.floor(prev.videoSize.width / 2),
        y: prev.subtitlePosition.y, // Giữ nguyên độ cao (Y) hiện tại
      };
      
      // Delay call to outer handler to avoid stale state in render
      setTimeout(() => onPositionChange?.(center), 0);
      
      return { ...prev, subtitlePosition: center };
    });
  }, [onPositionChange]);

  const clearBlackout = useCallback(() => {
    setLocalBlackoutTop(null);
    onBlackoutChange?.(null);
  }, [onBlackoutChange]);

  return {
    canvasRef,
    containerRef,
    frameData: state.frameData,
    subtitlePosition: state.subtitlePosition,
    videoSize: state.videoSize,
    isLoading: state.isLoading,
    error: state.error,
    isDragging,
    canvasCursor,
    mode,
    setMode,
    blackoutTop: localBlackoutTop,
    logoScale: localLogoScale,
    loadPreview,
    loadFrameAt,
    frameTimeSec,
    setFrameTimeSec,
    videoDuration: videoMetaRef.current?.duration ?? 0,
    resetToCenter,
    clearBlackout,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
