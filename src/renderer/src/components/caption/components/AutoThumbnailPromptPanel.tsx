import { useState, useEffect, useCallback, useRef } from 'react';
import { Clipboard, ClipboardCheck, RefreshCw, Loader2, Sparkles, Trash2, Image, Bug } from 'lucide-react';
import { readCaptionSession, updateCaptionSession } from '../hooks/captionSessionStore';
import { getVideoMetadataCached } from '../hooks/videoMetadataClientCache';
import type { SubtitleEntry, VideoCropSettings } from '@shared/types/caption';
import styles from '../CaptionTranslator.module.css';

interface AutoThumbnailPromptPanelProps {
  sessionPath: string;
  sourcePath: string;
  translateMethod: string;
  geminiModel: string;
  deepseekModel?: string;
  projectId?: string;
  videoPath?: string | null;
  thumbnailFrameTimeSec?: number | null;
  crop?: VideoCropSettings | null;
}

export function AutoThumbnailPromptPanel({
  sessionPath,
  sourcePath,
  translateMethod,
  geminiModel,
  deepseekModel,
  projectId,
  videoPath,
  thumbnailFrameTimeSec,
  crop,
}: AutoThumbnailPromptPanelProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasTranslated, setHasTranslated] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [hasVision, setHasVision] = useState(false);
  const fpsRef = useRef(30);
  const lastInputPromptRef = useRef<string>('');
  const lastImageBase64Ref = useRef<string | undefined>(undefined);
  const [debugSaved, setDebugSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const fallback = { projectId, inputType: 'draft' as const, sourcePath };
        const session = await readCaptionSession(sessionPath, fallback);
        if (session.data.autoThumbnailPrompt) {
          setPrompt(session.data.autoThumbnailPrompt);
        }
        if (session.data.customThumbnailTitle) {
          setCustomTitle(session.data.customThumbnailTitle);
        }
        const translated = (session.data.translatedEntries || []) as SubtitleEntry[];
        setHasTranslated(translated.length > 0);
      } catch {
        // silently ignore — no saved prompt yet
      }
    })();
  }, [sessionPath, projectId, sourcePath]);

  useEffect(() => {
    if (!videoPath) return;
    let cancelled = false;
    (async () => {
      try {
        const metaRes = await getVideoMetadataCached(videoPath);
        if (cancelled) return;
        if (metaRes?.success && metaRes.data) {
          fpsRef.current = metaRes.data.fps && metaRes.data.fps > 0 ? metaRes.data.fps : 30;
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [videoPath]);

  useEffect(() => {
    setHasVision(!!videoPath && !!thumbnailFrameTimeSec);
  }, [videoPath, thumbnailFrameTimeSec]);

  const saveTitleToSession = useCallback(async (title: string) => {
    try {
      const fallback = { projectId, inputType: 'draft' as const, sourcePath };
      await updateCaptionSession(sessionPath, (s) => ({
        ...s,
        data: {
          ...s.data,
          customThumbnailTitle: title || undefined,
        },
      }), fallback);
    } catch {
      // ignore
    }
  }, [sessionPath, projectId, sourcePath]);

  const handleTitleChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomTitle(val);
    await saveTitleToSession(val);
  }, [saveTitleToSession]);

  const handleRegenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fallback = { projectId, inputType: 'draft' as const, sourcePath };
      const session = await readCaptionSession(sessionPath, fallback);
      const translated = (session.data.translatedEntries || []) as SubtitleEntry[];
      const extracted = (session.data.extractedEntries || []) as SubtitleEntry[];
      const entries: SubtitleEntry[] = translated.length > 0 ? translated : extracted;
      if (entries.length === 0) {
        setError('Không tìm thấy subtitle entries trong session.');
        setLoading(false);
        return;
      }

      let imageBase64: string | undefined;
      if (videoPath && thumbnailFrameTimeSec != null) {
        try {
          const frameIndex = Math.round(thumbnailFrameTimeSec * fpsRef.current);
          const videoApi = (window.electronAPI as any).captionVideo;
          const frameRes = await videoApi.extractFrame(videoPath, frameIndex, crop || undefined);
          if (frameRes?.success && frameRes.data?.frameData) {
            imageBase64 = frameRes.data.frameData;
          }
        } catch (e) {
          console.warn('[ThumbnailPrompt] extractFrame failed, continuing without image:', e);
        }
      }

      const result = await window.electronAPI.caption.generateThumbnailPrompt({
        entries,
        model: translateMethod === 'deepseek' ? (deepseekModel || geminiModel) : geminiModel,
        translateMethod: translateMethod as 'api' | 'deepseek' | 'openrouter',
        projectName: customTitle || projectId || undefined,
        imageBase64,
      });

      if (result?.success && result?.data?.prompt) {
        const newPrompt = result.data.prompt;
        setPrompt(newPrompt);
        lastInputPromptRef.current = result.data.inputPrompt || '';
        lastImageBase64Ref.current = imageBase64;
        setDebugSaved(false);
        setSaving(true);
        try {
          await updateCaptionSession(sessionPath, (s) => ({
            ...s,
            data: {
              ...s.data,
              autoThumbnailPrompt: newPrompt,
            },
          }), fallback);
        } finally {
          setSaving(false);
        }
      } else {
        setError(result?.error || 'Không nhận được prompt từ AI');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionPath, sourcePath, translateMethod, geminiModel, deepseekModel, projectId, customTitle, videoPath, thumbnailFrameTimeSec, crop]);

  const handleCopy = useCallback(async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);

  const handleDelete = useCallback(async () => {
    setPrompt(null);
    setCopied(false);
    setError(null);
    try {
      const fallback = { projectId, inputType: 'draft' as const, sourcePath };
      await updateCaptionSession(sessionPath, (s) => ({
        ...s,
        data: {
          ...s.data,
          autoThumbnailPrompt: undefined,
        },
      }), fallback);
    } catch {
      // ignore
    }
  }, [sessionPath, projectId, sourcePath]);

  const canGenerate = hasTranslated;
  const isDisabled = loading || saving || !canGenerate;

  const handleDebugSave = useCallback(async () => {
    if (!lastInputPromptRef.current) return;
    setDebugSaved(false);
    try {
      const api = window.electronAPI as any;
      const res = await api.invoke('debug:saveThumbnailPromptDebug', {
        prompt: lastInputPromptRef.current,
        imageBase64: lastImageBase64Ref.current,
        videoPath: videoPath || undefined,
      });
      if (res?.success) {
        setDebugSaved(true);
        setTimeout(() => setDebugSaved(false), 3000);
      }
    } catch (err) {
      console.warn('[ThumbnailPrompt] Debug save failed:', err);
    }
  }, [videoPath]);

  return (
    <div className={styles.panelSection}>
      <div className={styles.configSummaryTitle}>
        <Sparkles size={14} style={{ marginRight: 5, verticalAlign: -2 }} />
        AI Prompt Thumbnail
      </div>

      {!prompt && !loading && !error && (
        <div className={styles.commonHint} style={{ margin: '6px 0' }}>
          {canGenerate
            ? 'Tạo prompt từ nội dung subtitle để dùng với AI sinh ảnh (Midjourney, DALL-E, Stable Diffusion...).'
            : 'Cần dịch ít nhất 1 batch (Step 3) trước khi tạo Prompt Thumbnail.'}
        </div>
      )}

      <div style={{ marginTop: 6, marginBottom: 6 }}>
        <input
          type="text"
          placeholder="Tên phim / nội dung (tuỳ chọn, để trống AI tự suy luận)"
          value={customTitle}
          onChange={handleTitleChange}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '4px 8px',
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            outline: 'none',
          }}
        />
      </div>

      {hasVision && (
        <div style={{ marginBottom: 4, fontSize: 11, color: 'var(--color-text-secondary)' }}>
          <Image size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
          Frame preview sẽ được gửi kèm để AI thấy cảnh quay
        </div>
      )}

      {error && (
        <div className={styles.step3BatchErrorRow} style={{ marginBottom: 6 }}>
          <span>{error}</span>
        </div>
      )}

      {prompt && (
        <div style={{ marginTop: 6 }}>
          <textarea
            className={styles.input}
            rows={6}
            value={prompt}
            readOnly
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 12,
              lineHeight: 1.5,
              resize: 'vertical',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          />
          <div className={styles.commonInlineActions} style={{ marginTop: 6, gap: 6 }}>
            <button
              type="button"
              className={styles.resetBtnLike}
              onClick={handleCopy}
              disabled={isDisabled}
            >
              {copied ? <ClipboardCheck size={14} /> : <Clipboard size={14} />}
              <span style={{ marginLeft: 4 }}>{copied ? 'Đã sao chép!' : 'Sao chép'}</span>
            </button>
            <button
              type="button"
              className={styles.resetBtnLike}
              onClick={handleDelete}
              disabled={isDisabled}
              style={{ color: 'var(--color-danger, #e53935)' }}
            >
              <Trash2 size={14} />
              <span style={{ marginLeft: 4 }}>Xoá</span>
            </button>
            {lastInputPromptRef.current && (
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={handleDebugSave}
                title="Lưu prompt + ảnh đã gửi cho AI"
                style={{ color: debugSaved ? 'var(--color-success, #4caf50)' : 'var(--color-text-secondary)' }}
              >
                <Bug size={14} />
                <span style={{ marginLeft: 4 }}>{debugSaved ? 'Đã lưu' : 'Debug'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className={styles.step3BatchActionBtn}
          onClick={handleRegenerate}
          disabled={isDisabled}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          <span style={{ marginLeft: 5 }}>
            {loading ? 'Đang tạo...' : saving ? 'Đang lưu...' : prompt ? 'Tạo lại Prompt' : 'Tạo Prompt Thumbnail'}
          </span>
        </button>
      </div>
    </div>
  );
}
