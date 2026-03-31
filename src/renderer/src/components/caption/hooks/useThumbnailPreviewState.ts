import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nowIso } from '@shared/utils/captionSession';
import {
  getSessionPathForInputPath,
  readCaptionSession,
  readThumbnailPreviewRuntime,
  updateCaptionSession,
  writeThumbnailPreviewRuntime,
  buildThumbnailPreviewHash,
  shouldSkipRealPreviewRequest,
} from './captionSessionStore';
import {
  ThumbnailPreviewContextKey,
  ThumbnailPreviewLayer,
  ThumbnailPreviewRealStatus,
  ThumbnailPreviewRuntimeState,
  ThumbnailPreviewSourceStatus,
  ThumbnailPreviewTab,
} from '../CaptionTypes';
import { getVideoMetadataCached } from './videoMetadataClientCache';

type RenderMode = 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
type RenderResolution = 'original' | '1080p' | '720p' | '540p' | '360p';

interface UseThumbnailPreviewStateOptions {
  videoPath: string | null;
  renderMode: RenderMode;
  renderResolution: RenderResolution;
  thumbnailText: string;
  thumbnailTextSecondary: string;
  thumbnailFrameTimeSec: number | null;
  onThumbnailFrameTimeSecChange: (value: number | null) => void;
  // Legacy font chung (fallback)
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  thumbnailTextPrimaryFontName?: string;
  thumbnailTextPrimaryFontSize?: number;
  thumbnailTextPrimaryColor?: string;
  thumbnailTextSecondaryFontName?: string;
  thumbnailTextSecondaryFontSize?: number;
  thumbnailTextSecondaryColor?: string;
  thumbnailLineHeightRatio?: number;
  thumbnailTextConstrainTo34?: boolean;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
  onThumbnailTextPrimaryPositionChange: (pos: { x: number; y: number }) => void;
  onThumbnailTextSecondaryPositionChange: (pos: { x: number; y: number }) => void;
  contextKey: ThumbnailPreviewContextKey | null;
  inputType: 'srt' | 'draft';
}

interface UseThumbnailPreviewStateResult {
  tab: ThumbnailPreviewTab;
  setTab: (tab: ThumbnailPreviewTab) => void;
  activeLayer: ThumbnailPreviewLayer;
  setActiveLayer: (layer: ThumbnailPreviewLayer) => void;
  sourceStatus: ThumbnailPreviewSourceStatus;
  sourceMessage: string;
  frameData: string | null;
  realStatus: ThumbnailPreviewRealStatus;
  realMessage: string;
  realFrameData: string | null;
  realSize: { width: number; height: number } | null;
  draftFrameTimeSec: number;
  setDraftFrameTimeSec: (value: number) => void;
  draftPrimaryPosition: { x: number; y: number };
  draftSecondaryPosition: { x: number; y: number };
  setDraftLayerPosition: (layer: ThumbnailPreviewLayer, pos: { x: number; y: number }) => void;
  beginDraftDrag: (layer: ThumbnailPreviewLayer) => void;
  commitDraft: () => void;
  hasDraft: boolean;
  isDraftDragging: boolean;
  isSynced: boolean;
  syncLabel: string;
  duration: number;
  fps: number;
  frameStepSec: number;
  draftFrameIndex: number;
  totalFrames: number;
  stepFrame: (delta: number) => void;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function samePos(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001;
}

function sameNum(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}

function toDataUri(frameData: string): string {
  return frameData.startsWith('data:') ? frameData : `data:image/png;base64,${frameData}`;
}

function toFrameIndex(timeSec: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeTime = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
  return Math.max(0, Math.round(safeTime * safeFps));
}

export function useThumbnailPreviewState(
  options: UseThumbnailPreviewStateOptions
): UseThumbnailPreviewStateResult {
  const {
    videoPath,
    renderMode,
    renderResolution,
    thumbnailText,
    thumbnailTextSecondary,
    thumbnailFrameTimeSec,
    onThumbnailFrameTimeSecChange,
    thumbnailFontName,
    thumbnailFontSize,
    thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio,
    thumbnailTextConstrainTo34,
    thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition,
    onThumbnailTextPrimaryPositionChange,
    onThumbnailTextSecondaryPositionChange,
    contextKey,
    inputType,
  } = options;

  const contextId = contextKey
    ? `${contextKey.projectId}|${contextKey.folderPath}|${contextKey.layoutKey}`
    : 'no-context';
  const sessionPath = contextKey ? getSessionPathForInputPath(inputType, contextKey.folderPath) : '';
  const sessionFallback = useMemo(() => {
    if (!contextKey) {
      return undefined;
    }
    return {
      projectId: contextKey.projectId || null,
      inputType,
      sourcePath: contextKey.folderPath,
      folderPath: inputType === 'draft' || inputType === 'srt'
        ? contextKey.folderPath
        : contextKey.folderPath.replace(/[^/\\]+$/, ''),
    };
  }, [contextKey, inputType]);

  const committedFrameTimeSec = Math.max(0, thumbnailFrameTimeSec ?? 0);
  const [draftFrameTimeSec, setDraftFrameTimeSecState] = useState(committedFrameTimeSec);
  const [draftPrimaryPosition, setDraftPrimaryPosition] = useState(thumbnailTextPrimaryPosition);
  const [draftSecondaryPosition, setDraftSecondaryPosition] = useState(thumbnailTextSecondaryPosition);
  const [isDraftDragging, setIsDraftDragging] = useState(false);

  const [tab, setTabState] = useState<ThumbnailPreviewTab>('edit');
  const [sourceRefreshSeq, setSourceRefreshSeq] = useState(0);
  const [activeLayer, setActiveLayerState] = useState<ThumbnailPreviewLayer>('primary');
  const [sourceStatus, setSourceStatus] = useState<ThumbnailPreviewSourceStatus>('idle');
  const [sourceMessage, setSourceMessage] = useState('Sẵn sàng.');
  const [frameData, setFrameData] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoFps, setVideoFps] = useState(30);

  const [realStatus, setRealStatus] = useState<ThumbnailPreviewRealStatus>('idle');
  const [realMessage, setRealMessage] = useState('Đang chờ cập nhật preview thật...');
  const [realFrameData, setRealFrameData] = useState<string | null>(null);
  const [realSize, setRealSize] = useState<{ width: number; height: number } | null>(null);
  const [lastSyncHash, setLastSyncHash] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState('');

  const sourceRequestRef = useRef(0);
  const sourceTimerRef = useRef<number | null>(null);
  const realRequestRef = useRef(0);
  const sourceHashRef = useRef('');
  const contextRef = useRef(contextId);
  const sourceFrameCacheRef = useRef(new Map<string, string>());
  const realFrameCacheRef = useRef(new Map<string, { frameData: string; size: { width: number; height: number } | null }>());
  const runtimePatchRef = useRef<Partial<ThumbnailPreviewRuntimeState> | null>(null);
  const runtimeTimerRef = useRef<number | null>(null);
  const prevContextRef = useRef(contextId);

  const hasDraft = useMemo(() => {
    return (
      !samePos(draftPrimaryPosition, thumbnailTextPrimaryPosition)
      || !samePos(draftSecondaryPosition, thumbnailTextSecondaryPosition)
      || !sameNum(draftFrameTimeSec, committedFrameTimeSec)
      || isDraftDragging
    );
  }, [
    committedFrameTimeSec,
    draftFrameTimeSec,
    draftPrimaryPosition,
    draftSecondaryPosition,
    isDraftDragging,
    thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition,
  ]);

  const persistRuntimePatch = useCallback((patch: Partial<ThumbnailPreviewRuntimeState>) => {
    if (!sessionPath) return;
    runtimePatchRef.current = {
      ...(runtimePatchRef.current || {}),
      ...patch,
    };
    if (runtimeTimerRef.current != null) {
      window.clearTimeout(runtimeTimerRef.current);
    }
    runtimeTimerRef.current = window.setTimeout(async () => {
      const currentPatch = runtimePatchRef.current;
      runtimePatchRef.current = null;
      if (!currentPatch) return;
      try {
        await updateCaptionSession(
          sessionPath,
          (session) => writeThumbnailPreviewRuntime(session, currentPatch),
          sessionFallback
        );
      } catch (error) {
        console.warn('[ThumbnailPreview] Không thể sync runtime state vào session', error);
      }
    }, 120);
  }, [sessionFallback, sessionPath]);

  const setTab = useCallback((nextTab: ThumbnailPreviewTab) => {
    setTabState(nextTab);
    if (nextTab === 'edit') {
      setSourceRefreshSeq((prev) => prev + 1);
    }
    persistRuntimePatch({ tab: nextTab });
  }, [persistRuntimePatch]);

  const setActiveLayer = useCallback((layer: ThumbnailPreviewLayer) => {
    setActiveLayerState(layer);
    persistRuntimePatch({ activeLayer: layer });
  }, [persistRuntimePatch]);

  const commitDraft = useCallback(() => {
    setIsDraftDragging(false);
    const nextPrimary = {
      x: clamp01(draftPrimaryPosition.x),
      y: clamp01(draftPrimaryPosition.y),
    };
    const nextSecondary = {
      x: clamp01(draftSecondaryPosition.x),
      y: clamp01(draftSecondaryPosition.y),
    };
    const nextFrameTime = Math.max(0, draftFrameTimeSec);
    if (!samePos(nextPrimary, thumbnailTextPrimaryPosition)) {
      onThumbnailTextPrimaryPositionChange(nextPrimary);
    }
    if (!samePos(nextSecondary, thumbnailTextSecondaryPosition)) {
      onThumbnailTextSecondaryPositionChange(nextSecondary);
    }
    if (!sameNum(nextFrameTime, committedFrameTimeSec)) {
      onThumbnailFrameTimeSecChange(nextFrameTime);
    }
  }, [
    committedFrameTimeSec,
    draftFrameTimeSec,
    draftPrimaryPosition,
    draftSecondaryPosition,
    onThumbnailFrameTimeSecChange,
    onThumbnailTextPrimaryPositionChange,
    onThumbnailTextSecondaryPositionChange,
    thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition,
  ]);

  const commitDraftRef = useRef(commitDraft);
  useEffect(() => {
    commitDraftRef.current = commitDraft;
  }, [commitDraft]);

  useEffect(() => {
    if (isDraftDragging) return;
    setDraftFrameTimeSecState(committedFrameTimeSec);
  }, [committedFrameTimeSec, isDraftDragging]);

  useEffect(() => {
    if (isDraftDragging) return;
    setDraftPrimaryPosition(thumbnailTextPrimaryPosition);
  }, [isDraftDragging, thumbnailTextPrimaryPosition]);

  useEffect(() => {
    if (isDraftDragging) return;
    setDraftSecondaryPosition(thumbnailTextSecondaryPosition);
  }, [isDraftDragging, thumbnailTextSecondaryPosition]);

  useEffect(() => {
    if (prevContextRef.current === contextId) return;
    commitDraftRef.current();
    prevContextRef.current = contextId;
  }, [contextId]);

  useEffect(() => {
    return () => {
      commitDraftRef.current();
    };
  }, []);

  useEffect(() => {
    contextRef.current = contextId;
  }, [contextId]);

  useEffect(() => {
    if (!sessionPath) {
      setTabState('edit');
      setActiveLayerState('primary');
      setLastSyncHash('');
      setLastSyncAt('');
      return;
    }
    let cancelled = false;
    const hydrateRuntime = async () => {
      try {
        const session = await readCaptionSession(sessionPath, sessionFallback);
        if (cancelled) return;
        const runtime = readThumbnailPreviewRuntime(session);
        setTabState(runtime.tab);
        setActiveLayerState(runtime.activeLayer);
        setSourceStatus(runtime.sourceStatus);
        setRealStatus(runtime.realStatus);
        setLastSyncHash(runtime.lastSyncHash);
        setLastSyncAt(runtime.lastSyncAt);
        if (runtime.lastRealError) {
          setRealMessage(runtime.lastRealError);
        }
        const cacheKey = `${contextId}|${runtime.lastSyncHash}`;
        const cached = runtime.lastSyncHash ? realFrameCacheRef.current.get(cacheKey) : null;
        if (cached) {
          setRealFrameData(cached.frameData);
          setRealSize(cached.size);
          setRealStatus('ready');
          setRealMessage('Preview thật đã đồng bộ.');
        } else {
          setRealFrameData(null);
          setRealSize(null);
        }
      } catch (error) {
        console.warn('[ThumbnailPreview] Không thể hydrate runtime state từ session', error);
      }
    };
    hydrateRuntime();
    return () => {
      cancelled = true;
    };
  }, [contextId, sessionFallback, sessionPath]);

  const setDraftFrameTimeSec = useCallback((value: number) => {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    const maxDuration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : safeValue;
    setDraftFrameTimeSecState(Math.min(safeValue, maxDuration));
  }, [videoDuration]);

  const stepFrame = useCallback((delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    const safeFps = Number.isFinite(videoFps) && videoFps > 0 ? videoFps : 30;
    const nextStep = 1 / safeFps;
    setDraftFrameTimeSecState((prev) => {
      const currentFrame = toFrameIndex(prev, safeFps);
      const maxFrame = Math.max(0, toFrameIndex(videoDuration, safeFps));
      const nextFrame = Math.max(0, Math.min(maxFrame, currentFrame + Math.round(delta)));
      return nextFrame * nextStep;
    });
  }, [videoDuration, videoFps]);

  const beginDraftDrag = useCallback((layer: ThumbnailPreviewLayer) => {
    setIsDraftDragging(true);
    setActiveLayer(layer);
  }, [setActiveLayer]);

  const setDraftLayerPosition = useCallback((layer: ThumbnailPreviewLayer, pos: { x: number; y: number }) => {
    const next = { x: clamp01(pos.x), y: clamp01(pos.y) };
    if (layer === 'primary') {
      setDraftPrimaryPosition(next);
      return;
    }
    setDraftSecondaryPosition(next);
  }, []);

  useEffect(() => {
    if (!videoPath) {
      setVideoDuration(5);
      setVideoFps(30);
      return;
    }
    let cancelled = false;
    const loadMeta = async () => {
      try {
        const metaRes = await getVideoMetadataCached(videoPath);
        if (cancelled) return;
        if (metaRes?.success && metaRes.data) {
          setVideoDuration(metaRes.data.duration && metaRes.data.duration > 0 ? metaRes.data.duration : 5);
          setVideoFps(metaRes.data.fps && metaRes.data.fps > 0 ? metaRes.data.fps : 30);
        }
      } catch {}
    };
    loadMeta();
    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  const draftFrameIndex = useMemo(
    () => toFrameIndex(draftFrameTimeSec, videoFps),
    [draftFrameTimeSec, videoFps]
  );

  const sourceDependencyHash = useMemo(() => {
    return buildThumbnailPreviewHash({
      videoPath,
      frameIndex: draftFrameIndex,
      tab,
      refreshSeq: sourceRefreshSeq,
    });
  }, [draftFrameIndex, sourceRefreshSeq, tab, videoPath]);

  useEffect(() => {
    if (!videoPath) {
      setFrameData(null);
      setSourceStatus('idle');
      setSourceMessage('Chưa có video nguồn.');
      setVideoDuration(5);
      persistRuntimePatch({ sourceStatus: 'idle' });
      return;
    }
    if (sourceHashRef.current === sourceDependencyHash && frameData) {
      return;
    }
    sourceHashRef.current = sourceDependencyHash;
    const cacheKey = `${videoPath}|${draftFrameIndex}`;
    const cachedFrame = sourceFrameCacheRef.current.get(cacheKey);
    if (cachedFrame) {
      setFrameData(cachedFrame);
      setSourceStatus('ready');
      setSourceMessage(`Frame #${draftFrameIndex} (${draftFrameTimeSec.toFixed(2)}s)`);
      persistRuntimePatch({ sourceStatus: 'ready' });
      return;
    }

    if (sourceTimerRef.current != null) {
      window.clearTimeout(sourceTimerRef.current);
      sourceTimerRef.current = null;
    }

    const requestId = ++sourceRequestRef.current;
    setSourceStatus('loading');
    setSourceMessage('Đang tải frame nguồn...');
    persistRuntimePatch({ sourceStatus: 'loading' });

    const sourceDebounceMs = tab === 'edit' ? 0 : 90;
    sourceTimerRef.current = window.setTimeout(async () => {
      try {
        const api = (window.electronAPI as any).captionVideo;
        const frameRes = await api.extractFrame(videoPath, draftFrameIndex);
        if (requestId !== sourceRequestRef.current || contextRef.current !== contextId) return;
        if (!frameRes?.success || !frameRes.data?.frameData) {
          setFrameData(null);
          setSourceStatus('error');
          setSourceMessage(frameRes?.error || 'Không tải được frame nguồn.');
          persistRuntimePatch({ sourceStatus: 'error' });
          return;
        }
        const dataUri = toDataUri(frameRes.data.frameData);
        sourceFrameCacheRef.current.set(cacheKey, dataUri);
        if (sourceFrameCacheRef.current.size > 150) {
          const firstKey = sourceFrameCacheRef.current.keys().next().value as string | undefined;
          if (firstKey) {
            sourceFrameCacheRef.current.delete(firstKey);
          }
        }
        setFrameData(dataUri);
        setSourceStatus('ready');
        setSourceMessage(`Frame #${draftFrameIndex} (${draftFrameTimeSec.toFixed(2)}s)`);
        persistRuntimePatch({ sourceStatus: 'ready' });
      } catch (error) {
        if (requestId !== sourceRequestRef.current || contextRef.current !== contextId) return;
        setFrameData(null);
        setSourceStatus('error');
        setSourceMessage(String(error));
        persistRuntimePatch({ sourceStatus: 'error' });
      }
    }, sourceDebounceMs);

    return () => {
      if (sourceTimerRef.current != null) {
        window.clearTimeout(sourceTimerRef.current);
        sourceTimerRef.current = null;
      }
    };
  }, [contextId, draftFrameIndex, draftFrameTimeSec, frameData, persistRuntimePatch, sourceDependencyHash, tab, videoPath]);

  const realDependencyHash = useMemo(() => {
    if (!videoPath) return '';
    return buildThumbnailPreviewHash({
      videoPath,
      frameTimeSec: committedFrameTimeSec,
      renderMode,
      renderResolution,
      thumbnailText,
      thumbnailTextSecondary,
      thumbnailFontName,
      thumbnailFontSize,
      thumbnailTextPrimaryFontName,
      thumbnailTextPrimaryFontSize,
      thumbnailTextPrimaryColor,
      thumbnailTextSecondaryFontName,
      thumbnailTextSecondaryFontSize,
      thumbnailTextSecondaryColor,
      thumbnailLineHeightRatio,
      thumbnailTextConstrainTo34,
      thumbnailTextPrimaryPosition,
      thumbnailTextSecondaryPosition,
    });
  }, [
    committedFrameTimeSec,
    renderMode,
    renderResolution,
    thumbnailFontName,
    thumbnailFontSize,
    thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio,
    thumbnailTextConstrainTo34,
    thumbnailText,
    thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition,
    thumbnailTextSecondary,
    videoPath,
  ]);

  useEffect(() => {
    if (!videoPath) {
      setRealStatus('idle');
      setRealMessage('Chưa có video nguồn để render preview thật.');
      setRealFrameData(null);
      setRealSize(null);
      persistRuntimePatch({ realStatus: 'idle' });
      return;
    }

    const cacheKey = `${contextId}|${realDependencyHash}`;
    const cached = realFrameCacheRef.current.get(cacheKey);
    if (shouldSkipRealPreviewRequest(lastSyncHash, realDependencyHash) && cached) {
      setRealStatus('ready');
      setRealFrameData(cached.frameData);
      setRealSize(cached.size);
      setRealMessage('Preview thật đã đồng bộ.');
      persistRuntimePatch({ realStatus: 'ready' });
      return;
    }

    setRealStatus('pending');
    setRealMessage('Đang chờ cập nhật preview thật...');
    persistRuntimePatch({ realStatus: 'pending' });
    const requestId = ++realRequestRef.current;
    const timer = window.setTimeout(async () => {
      try {
        if (requestId !== realRequestRef.current || contextRef.current !== contextId) return;
        setRealStatus('updating');
        setRealMessage('Đang cập nhật preview thật...');
        persistRuntimePatch({ realStatus: 'updating' });

        const api = (window.electronAPI as any).captionVideo;
        const res = await api.renderThumbnailPreviewFrame({
          videoPath,
          thumbnailTimeSec: committedFrameTimeSec,
          renderMode,
          renderResolution,
          thumbnailText,
          thumbnailTextSecondary,
          thumbnailFontName,
          thumbnailFontSize,
          thumbnailTextPrimaryFontName,
          thumbnailTextPrimaryFontSize,
          thumbnailTextPrimaryColor,
          thumbnailTextSecondaryFontName,
          thumbnailTextSecondaryFontSize,
          thumbnailTextSecondaryColor,
          thumbnailLineHeightRatio,
          thumbnailTextConstrainTo34,
          thumbnailTextPrimaryPosition,
          thumbnailTextSecondaryPosition,
        });
        if (requestId !== realRequestRef.current || contextRef.current !== contextId) return;
        if (!res?.success || !res.data?.success || !res.data?.frameData) {
          const errorMessage = res?.error || res?.data?.error || 'Không thể render preview thật.';
          setRealStatus('error');
          setRealMessage(errorMessage);
          persistRuntimePatch({
            realStatus: 'error',
            lastRealError: errorMessage,
          });
          return;
        }

        const size = (
          typeof res.data.width === 'number' && typeof res.data.height === 'number'
            ? { width: res.data.width, height: res.data.height }
            : null
        );
        const nextFrameData = toDataUri(res.data.frameData);
        realFrameCacheRef.current.set(cacheKey, {
          frameData: nextFrameData,
          size,
        });

        const syncedAt = nowIso();
        setRealStatus('ready');
        setRealFrameData(nextFrameData);
        setRealSize(size);
        setRealMessage('Preview thật đã đồng bộ.');
        setLastSyncHash(realDependencyHash);
        setLastSyncAt(syncedAt);
        persistRuntimePatch({
          realStatus: 'ready',
          lastRealError: '',
          lastSyncHash: realDependencyHash,
          lastSyncAt: syncedAt,
        });
      } catch (error) {
        if (requestId !== realRequestRef.current || contextRef.current !== contextId) return;
        const errorMessage = String(error);
        setRealStatus('error');
        setRealMessage(errorMessage);
        persistRuntimePatch({
          realStatus: 'error',
          lastRealError: errorMessage,
        });
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    committedFrameTimeSec,
    contextId,
    lastSyncHash,
    persistRuntimePatch,
    realDependencyHash,
    renderMode,
    renderResolution,
    thumbnailFontName,
    thumbnailFontSize,
    thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio,
    thumbnailTextConstrainTo34,
    thumbnailText,
    thumbnailTextPrimaryPosition,
    thumbnailTextSecondary,
    thumbnailTextSecondaryPosition,
    videoPath,
  ]);

  const isSynced = realStatus === 'ready' && !hasDraft && realDependencyHash === lastSyncHash;
  const syncLabel = hasDraft
    ? 'Draft'
    : (isSynced
      ? (lastSyncAt ? `Synced ${new Date(lastSyncAt).toLocaleTimeString()}` : 'Synced')
      : 'Out of sync');

  const frameStepSec = Number.isFinite(videoFps) && videoFps > 0 ? (1 / videoFps) : (1 / 30);
  const totalFrames = Math.max(1, toFrameIndex(videoDuration, videoFps) + 1);

  return {
    tab,
    setTab,
    activeLayer,
    setActiveLayer,
    sourceStatus,
    sourceMessage,
    frameData,
    realStatus,
    realMessage,
    realFrameData,
    realSize,
    draftFrameTimeSec,
    setDraftFrameTimeSec,
    draftPrimaryPosition,
    draftSecondaryPosition,
    setDraftLayerPosition,
    beginDraftDrag,
    commitDraft,
    hasDraft,
    isDraftDragging,
    isSynced,
    syncLabel,
    duration: videoDuration,
    fps: videoFps,
    frameStepSec,
    draftFrameIndex,
    totalFrames,
    stepFrame,
  };
}
