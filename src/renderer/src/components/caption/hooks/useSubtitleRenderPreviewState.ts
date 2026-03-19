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
const REAL_PREVIEW_TIME_BUCKET_SEC = 1 / 24;
const REAL_PREVIEW_DEBOUNCE_MS = 120;
const REAL_PREVIEW_CACHE_MAX_ITEMS = 80;

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
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  hardwareAcceleration?: RenderVideoOptions['hardwareAcceleration'];
  portraitForegroundCropPercent?: number;
  thumbnailText?: string;
  thumbnailTextSecondary?: string;
  hardsubPortraitTextPrimary?: string;
  hardsubPortraitTextSecondary?: string;
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  hardsubPortraitTextPrimaryFontName?: string;
  hardsubPortraitTextPrimaryFontSize?: number;
  hardsubPortraitTextPrimaryColor?: string;
  hardsubPortraitTextSecondaryFontName?: string;
  hardsubPortraitTextSecondaryFontSize?: number;
  hardsubPortraitTextSecondaryColor?: string;
  hardsubPortraitTextPrimaryPosition?: { x: number; y: number };
  hardsubPortraitTextSecondaryPosition?: { x: number; y: number };
  portraitTextPrimaryFontName?: string;
  portraitTextPrimaryFontSize?: number;
  portraitTextPrimaryColor?: string;
  portraitTextSecondaryFontName?: string;
  portraitTextSecondaryFontSize?: number;
  portraitTextSecondaryColor?: string;
  thumbnailLineHeightRatio?: number;
  portraitTextPrimaryPosition?: { x: number; y: number };
  portraitTextSecondaryPosition?: { x: number; y: number };
  disabled?: boolean;
  disabledReason?: string;
  hydrationSeq?: number;
}

interface RenderVideoPreviewFrameRequest {
  videoPath: string;
  entries: SubtitleEntry[];
  previewTimeSec: number;
  requestToken?: string;
  previewCacheKey?: string;
  timeBucketSec?: number;
  hardwareAcceleration?: RenderVideoOptions['hardwareAcceleration'];
  style?: ASSStyleConfig;
  renderMode?: RenderVideoOptions['renderMode'];
  renderResolution?: RenderVideoOptions['renderResolution'];
  position?: { x: number; y: number };
  blackoutTop?: number;
  coverMode?: 'blackout_bottom' | 'copy_from_above';
  coverQuad?: CoverQuad;
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  portraitForegroundCropPercent?: number;
  thumbnailText?: string;
  thumbnailTextSecondary?: string;
  hardsubPortraitTextPrimary?: string;
  hardsubPortraitTextSecondary?: string;
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  hardsubPortraitTextPrimaryFontName?: string;
  hardsubPortraitTextPrimaryFontSize?: number;
  hardsubPortraitTextPrimaryColor?: string;
  hardsubPortraitTextSecondaryFontName?: string;
  hardsubPortraitTextSecondaryFontSize?: number;
  hardsubPortraitTextSecondaryColor?: string;
  hardsubPortraitTextPrimaryPosition?: { x: number; y: number };
  hardsubPortraitTextSecondaryPosition?: { x: number; y: number };
  portraitTextPrimaryFontName?: string;
  portraitTextPrimaryFontSize?: number;
  portraitTextPrimaryColor?: string;
  portraitTextSecondaryFontName?: string;
  portraitTextSecondaryFontSize?: number;
  portraitTextSecondaryColor?: string;
  thumbnailLineHeightRatio?: number;
  portraitTextPrimaryPosition?: { x: number; y: number };
  portraitTextSecondaryPosition?: { x: number; y: number };
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

function quantizePreviewTimeSec(timeSec: number, bucketSec: number): number {
  if (!Number.isFinite(timeSec)) {
    return 0;
  }
  const safeBucket = Number.isFinite(bucketSec) && bucketSec > 0 ? bucketSec : REAL_PREVIEW_TIME_BUCKET_SEC;
  const safeTime = Math.max(0, timeSec);
  return Math.round(safeTime / safeBucket) * safeBucket;
}

function makeRequestToken(hash: string): string {
  return `${hash}::${Date.now().toString(36)}::${Math.random().toString(36).slice(2, 9)}`;
}

function isPreviewStoppedError(raw: unknown): boolean {
  const text = String(raw || '');
  return /dừng preview frame|preview frame đang chạy|request token/i.test(text);
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

  const debounceTimerRef = useRef<number | null>(null);
  const activeRequestTokenRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const cacheRef = useRef(new Map<string, { frameData: string; size: { width: number; height: number } | null }>());

  const normalizedEntries = useMemo(() => sanitizeEntries(options.entries), [options.entries]);
  const quantizedPreviewTimeSec = useMemo(
    () => quantizePreviewTimeSec(options.previewTimeSec, REAL_PREVIEW_TIME_BUCKET_SEC),
    [options.previewTimeSec]
  );

  const visualPayload = useMemo<Omit<RenderVideoPreviewFrameRequest, 'previewTimeSec'> | null>(() => {
    if (!options.videoPath) {
      return null;
    }
    return {
      videoPath: options.videoPath,
      entries: normalizedEntries,
      style: options.style,
      renderMode: options.renderMode,
      renderResolution: options.renderResolution,
      position: options.subtitlePosition || undefined,
      blackoutTop: options.blackoutTop == null ? undefined : options.blackoutTop,
      coverMode: options.coverMode,
      coverQuad: options.coverQuad,
      coverFeatherPx: options.coverFeatherPx,
      coverFeatherHorizontalPx: options.coverFeatherHorizontalPx,
      coverFeatherVerticalPx: options.coverFeatherVerticalPx,
      coverFeatherHorizontalPercent: options.coverFeatherHorizontalPercent,
      coverFeatherVerticalPercent: options.coverFeatherVerticalPercent,
      logoPath: options.logoPath,
      logoPosition: options.logoPosition,
      logoScale: options.logoScale,
      hardwareAcceleration: options.hardwareAcceleration,
      portraitForegroundCropPercent: options.portraitForegroundCropPercent,
      thumbnailText: options.thumbnailText,
      thumbnailTextSecondary: options.thumbnailTextSecondary,
      hardsubPortraitTextPrimary: options.hardsubPortraitTextPrimary,
      hardsubPortraitTextSecondary: options.hardsubPortraitTextSecondary,
      thumbnailFontName: options.thumbnailFontName,
      thumbnailFontSize: options.thumbnailFontSize,
      hardsubPortraitTextPrimaryFontName: options.hardsubPortraitTextPrimaryFontName,
      hardsubPortraitTextPrimaryFontSize: options.hardsubPortraitTextPrimaryFontSize,
      hardsubPortraitTextPrimaryColor: options.hardsubPortraitTextPrimaryColor,
      hardsubPortraitTextSecondaryFontName: options.hardsubPortraitTextSecondaryFontName,
      hardsubPortraitTextSecondaryFontSize: options.hardsubPortraitTextSecondaryFontSize,
      hardsubPortraitTextSecondaryColor: options.hardsubPortraitTextSecondaryColor,
      hardsubPortraitTextPrimaryPosition: options.hardsubPortraitTextPrimaryPosition,
      hardsubPortraitTextSecondaryPosition: options.hardsubPortraitTextSecondaryPosition,
      portraitTextPrimaryFontName: options.portraitTextPrimaryFontName,
      portraitTextPrimaryFontSize: options.portraitTextPrimaryFontSize,
      portraitTextPrimaryColor: options.portraitTextPrimaryColor,
      portraitTextSecondaryFontName: options.portraitTextSecondaryFontName,
      portraitTextSecondaryFontSize: options.portraitTextSecondaryFontSize,
      portraitTextSecondaryColor: options.portraitTextSecondaryColor,
      thumbnailLineHeightRatio: options.thumbnailLineHeightRatio,
      portraitTextPrimaryPosition: options.portraitTextPrimaryPosition,
      portraitTextSecondaryPosition: options.portraitTextSecondaryPosition,
    };
  }, [
    normalizedEntries,
    options.blackoutTop,
    options.coverMode,
    options.coverQuad,
    options.coverFeatherPx,
    options.coverFeatherHorizontalPx,
    options.coverFeatherVerticalPx,
    options.coverFeatherHorizontalPercent,
    options.coverFeatherVerticalPercent,
    options.logoPath,
    options.logoPosition,
    options.logoScale,
    options.hardwareAcceleration,
    options.portraitForegroundCropPercent,
    options.thumbnailText,
    options.thumbnailTextSecondary,
    options.hardsubPortraitTextPrimary,
    options.hardsubPortraitTextSecondary,
    options.thumbnailFontName,
    options.thumbnailFontSize,
    options.hardsubPortraitTextPrimaryFontName,
    options.hardsubPortraitTextPrimaryFontSize,
    options.hardsubPortraitTextPrimaryColor,
    options.hardsubPortraitTextSecondaryFontName,
    options.hardsubPortraitTextSecondaryFontSize,
    options.hardsubPortraitTextSecondaryColor,
    options.hardsubPortraitTextPrimaryPosition,
    options.hardsubPortraitTextSecondaryPosition,
    options.portraitTextPrimaryFontName,
    options.portraitTextPrimaryFontSize,
    options.portraitTextPrimaryColor,
    options.portraitTextSecondaryFontName,
    options.portraitTextSecondaryFontSize,
    options.portraitTextSecondaryColor,
    options.thumbnailLineHeightRatio,
    options.portraitTextPrimaryPosition,
    options.portraitTextSecondaryPosition,
    options.renderMode,
    options.renderResolution,
    options.style,
    options.subtitlePosition,
    options.videoPath,
  ]);

  const requestPayload = useMemo<RenderVideoPreviewFrameRequest | null>(() => {
    if (!visualPayload) {
      return null;
    }
    return {
      ...visualPayload,
      previewTimeSec: quantizedPreviewTimeSec,
      timeBucketSec: quantizedPreviewTimeSec,
    };
  }, [visualPayload, quantizedPreviewTimeSec]);

  const visualPayloadHash = useMemo(() => {
    if (!visualPayload) {
      return '';
    }
    return buildObjectFingerprint(visualPayload);
  }, [visualPayload]);

  const dependencyHash = useMemo(() => {
    if (!visualPayloadHash) {
      return '';
    }
    const hydrationKey = options.hydrationSeq ?? 0;
    return `${visualPayloadHash}::t=${quantizedPreviewTimeSec.toFixed(3)}::h=${hydrationKey}`;
  }, [quantizedPreviewTimeSec, visualPayloadHash, options.hydrationSeq]);

  const insertCacheEntry = (key: string, value: { frameData: string; size: { width: number; height: number } | null }) => {
    const cache = cacheRef.current;
    if (cache.has(key)) {
      cache.delete(key);
    }
    cache.set(key, value);
    while (cache.size > REAL_PREVIEW_CACHE_MAX_ITEMS) {
      const oldest = cache.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      cache.delete(oldest);
    }
  };

  const clearDebounceTimer = () => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  const stopActivePreviewRequest = async () => {
    const token = activeRequestTokenRef.current;
    if (!token) {
      return;
    }
    activeRequestTokenRef.current = null;
    try {
      await (window.electronAPI as any).captionVideo.stopVideoPreviewFrame?.(token);
    } catch {}
  };

  useEffect(() => {
    if (options.disabled && mode === 'real') {
      setMode('live');
    }
  }, [mode, options.disabled]);

  useEffect(() => {
    return () => {
      clearDebounceTimer();
      void stopActivePreviewRequest();
    };
  }, []);

  useEffect(() => {
    if (mode !== 'real') {
      clearDebounceTimer();
      void stopActivePreviewRequest();
      setRealStatus('idle');
      setRealMessage('Sẵn sàng xem preview thật.');
      return;
    }

    if (options.disabled) {
      clearDebounceTimer();
      void stopActivePreviewRequest();
      setRealStatus('error');
      setRealMessage(options.disabledReason || 'Preview thật đang tạm khóa.');
      return;
    }

    if (!requestPayload) {
      setRealStatus('error');
      setRealMessage('Chưa có video nguồn để render preview thật.');
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

    clearDebounceTimer();
    requestGenerationRef.current += 1;
    const currentGeneration = requestGenerationRef.current;
    void stopActivePreviewRequest();

    setRealStatus('pending');
    setRealMessage('Đang chờ cập nhật preview thật...');
    debounceTimerRef.current = window.setTimeout(async () => {
      if (currentGeneration !== requestGenerationRef.current) {
        return;
      }
      const requestToken = makeRequestToken(dependencyHash);
      activeRequestTokenRef.current = requestToken;
      setRealStatus('updating');
      setRealMessage('Đang cập nhật preview thật...');
      try {
        const payloadWithToken: RenderVideoPreviewFrameRequest = {
          ...requestPayload,
          requestToken,
          previewCacheKey: dependencyHash,
          timeBucketSec: quantizedPreviewTimeSec,
        };
        const res = await (window.electronAPI as any).captionVideo.renderVideoPreviewFrame(payloadWithToken);
        if (activeRequestTokenRef.current === requestToken) {
          activeRequestTokenRef.current = null;
        }
        if (currentGeneration !== requestGenerationRef.current) {
          return;
        }
        if (!res?.success || !res.data?.success || !res.data?.frameData) {
          const errorMessage = res?.error || res?.data?.error || 'Không thể render preview thật.';
          if (isPreviewStoppedError(errorMessage)) {
            return;
          }
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
        insertCacheEntry(dependencyHash, {
          frameData,
          size: nextSize,
        });
        setRealStatus('ready');
        setRealFrameData(frameData);
        setRealSize(nextSize);
        setRealMessage('Preview thật đã đồng bộ.');
        setLastSyncHash(dependencyHash);
      } catch (error) {
        if (activeRequestTokenRef.current === requestToken) {
          activeRequestTokenRef.current = null;
        }
        if (currentGeneration !== requestGenerationRef.current) {
          return;
        }
        if (isPreviewStoppedError(error)) {
          return;
        }
        setRealStatus('error');
        setRealMessage(String(error));
      }
    }, REAL_PREVIEW_DEBOUNCE_MS);

    return () => {
      clearDebounceTimer();
    };
  }, [
    dependencyHash,
    mode,
    options.disabled,
    options.disabledReason,
    quantizedPreviewTimeSec,
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
