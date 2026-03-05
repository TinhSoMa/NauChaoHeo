import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ASSStyleConfig,
  CoverQuad,
  RenderVideoOptions,
  SubtitleEntry,
} from '@shared/types/caption';
import { buildObjectFingerprint } from './captionSessionStore';

type PreviewMode = 'live' | 'real';
type RealPreviewStatus = 'idle' | 'pending' | 'updating' | 'ready' | 'error';

interface UseSubtitleRenderPreviewStateOptions {
  videoPath: string | null;
  entries?: SubtitleEntry[];
  previewTimeSec: number;
  style: ASSStyleConfig;
  renderMode?: RenderVideoOptions['renderMode'];
  renderResolution?: RenderVideoOptions['renderResolution'];
  subtitlePosition?: { x: number; y: number } | null;
  blackoutTop?: number | null;
  coverMode?: 'blackout_bottom' | 'copy_from_above';
  coverQuad?: CoverQuad;
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  portraitForegroundCropPercent?: number;
  disabled?: boolean;
  disabledReason?: string;
}

interface RenderVideoPreviewFrameRequest {
  videoPath: string;
  entries: SubtitleEntry[];
  previewTimeSec: number;
  style?: ASSStyleConfig;
  renderMode?: RenderVideoOptions['renderMode'];
  renderResolution?: RenderVideoOptions['renderResolution'];
  position?: { x: number; y: number };
  blackoutTop?: number;
  coverMode?: 'blackout_bottom' | 'copy_from_above';
  coverQuad?: CoverQuad;
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  portraitForegroundCropPercent?: number;
}

interface UseSubtitleRenderPreviewStateResult {
  mode: PreviewMode;
  setMode: (mode: PreviewMode) => void;
  realStatus: RealPreviewStatus;
  realMessage: string;
  realFrameData: string | null;
  realSize: { width: number; height: number } | null;
  lastSyncHash: string;
}

function toDataUri(frameData: string): string {
  return frameData.startsWith('data:') ? frameData : `data:image/png;base64,${frameData}`;
}

function sanitizeEntries(entries?: SubtitleEntry[]): SubtitleEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry, idx) => ({
      index: Number.isFinite(entry.index) ? entry.index : idx + 1,
      startTime: entry.startTime,
      endTime: entry.endTime,
      startMs: entry.startMs,
      endMs: entry.endMs,
      durationMs: entry.durationMs,
      text: entry.text,
      translatedText: entry.translatedText,
    }))
    .filter((entry) => {
      const content = (entry.translatedText || entry.text || '').trim();
      return content.length > 0;
    });
}

export function useSubtitleRenderPreviewState(
  options: UseSubtitleRenderPreviewStateOptions
): UseSubtitleRenderPreviewStateResult {
  const [mode, setMode] = useState<PreviewMode>('live');
  const [realStatus, setRealStatus] = useState<RealPreviewStatus>('idle');
  const [realMessage, setRealMessage] = useState('Sẵn sàng xem preview thật.');
  const [realFrameData, setRealFrameData] = useState<string | null>(null);
  const [realSize, setRealSize] = useState<{ width: number; height: number } | null>(null);
  const [lastSyncHash, setLastSyncHash] = useState('');

  const requestIdRef = useRef(0);
  const cacheRef = useRef(new Map<string, { frameData: string; size: { width: number; height: number } | null }>());

  const normalizedEntries = useMemo(() => sanitizeEntries(options.entries), [options.entries]);

  const requestPayload = useMemo<RenderVideoPreviewFrameRequest | null>(() => {
    if (!options.videoPath) {
      return null;
    }
    if (normalizedEntries.length === 0) {
      return null;
    }
    const safePreviewTime = Number.isFinite(options.previewTimeSec) ? Math.max(0, options.previewTimeSec) : 0;
    return {
      videoPath: options.videoPath,
      entries: normalizedEntries,
      previewTimeSec: safePreviewTime,
      style: options.style,
      renderMode: options.renderMode,
      renderResolution: options.renderResolution,
      position: options.subtitlePosition || undefined,
      blackoutTop: options.blackoutTop == null ? undefined : options.blackoutTop,
      coverMode: options.coverMode,
      coverQuad: options.coverQuad,
      logoPath: options.logoPath,
      logoPosition: options.logoPosition,
      logoScale: options.logoScale,
      portraitForegroundCropPercent: options.portraitForegroundCropPercent,
    };
  }, [
    normalizedEntries,
    options.blackoutTop,
    options.coverMode,
    options.coverQuad,
    options.logoPath,
    options.logoPosition,
    options.logoScale,
    options.portraitForegroundCropPercent,
    options.previewTimeSec,
    options.renderMode,
    options.renderResolution,
    options.style,
    options.subtitlePosition,
    options.videoPath,
  ]);

  const dependencyHash = useMemo(() => {
    if (!requestPayload) {
      return '';
    }
    return buildObjectFingerprint(requestPayload);
  }, [requestPayload]);

  useEffect(() => {
    if (options.disabled && mode === 'real') {
      setMode('live');
    }
  }, [mode, options.disabled]);

  useEffect(() => {
    if (mode !== 'real') {
      setRealStatus('idle');
      setRealMessage('Sẵn sàng xem preview thật.');
      return;
    }

    if (options.disabled) {
      setRealStatus('error');
      setRealMessage(options.disabledReason || 'Preview thật đang tạm khóa.');
      return;
    }

    if (!requestPayload) {
      if (!options.videoPath) {
        setRealStatus('error');
        setRealMessage('Chưa có video nguồn để render preview thật.');
      } else {
        setRealStatus('error');
        setRealMessage('Không có subtitle để render preview thật.');
      }
      return;
    }

    const cached = cacheRef.current.get(dependencyHash);
    if (cached) {
      setRealStatus('ready');
      setRealFrameData(cached.frameData);
      setRealSize(cached.size);
      setRealMessage('Preview thật đã đồng bộ (cache).');
      setLastSyncHash(dependencyHash);
      return;
    }

    setRealStatus('pending');
    setRealMessage('Đang chờ cập nhật preview thật...');
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(async () => {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setRealStatus('updating');
      setRealMessage('Đang cập nhật preview thật...');
      try {
        const res = await (window.electronAPI as any).captionVideo.renderVideoPreviewFrame(requestPayload);
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (!res?.success || !res.data?.success || !res.data?.frameData) {
          const errorMessage = res?.error || res?.data?.error || 'Không thể render preview thật.';
          setRealStatus('error');
          setRealMessage(errorMessage);
          return;
        }

        const frameData = toDataUri(res.data.frameData);
        const nextSize = (
          typeof res.data.width === 'number' && typeof res.data.height === 'number'
            ? { width: res.data.width, height: res.data.height }
            : null
        );
        cacheRef.current.set(dependencyHash, {
          frameData,
          size: nextSize,
        });
        setRealStatus('ready');
        setRealFrameData(frameData);
        setRealSize(nextSize);
        setRealMessage('Preview thật đã đồng bộ.');
        setLastSyncHash(dependencyHash);
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setRealStatus('error');
        setRealMessage(String(error));
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    dependencyHash,
    mode,
    options.disabled,
    options.disabledReason,
    options.videoPath,
    requestPayload,
  ]);

  return {
    mode,
    setMode,
    realStatus,
    realMessage,
    realFrameData,
    realSize,
    lastSyncHash,
  };
}
