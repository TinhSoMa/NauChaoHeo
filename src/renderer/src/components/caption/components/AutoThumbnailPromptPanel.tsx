import { useState, useEffect, useCallback } from 'react';
import { Clipboard, ClipboardCheck, RefreshCw, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { readCaptionSession, updateCaptionSession } from '../hooks/captionSessionStore';
import type { SubtitleEntry } from '@shared/types/caption';
import styles from '../CaptionTranslator.module.css';

interface AutoThumbnailPromptPanelProps {
  sessionPath: string;
  sourcePath: string;
  translateMethod: string;
  geminiModel: string;
  deepseekModel?: string;
  projectId?: string;
}

export function AutoThumbnailPromptPanel({
  sessionPath,
  sourcePath,
  translateMethod,
  geminiModel,
  deepseekModel,
  projectId,
}: AutoThumbnailPromptPanelProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasTranslated, setHasTranslated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const fallback = { projectId, inputType: 'draft' as const, sourcePath };
        const session = await readCaptionSession(sessionPath, fallback);
        if (session.data.autoThumbnailPrompt) {
          setPrompt(session.data.autoThumbnailPrompt);
        }
        const translated = (session.data.translatedEntries || []) as SubtitleEntry[];
        setHasTranslated(translated.length > 0);
      } catch {
        // silently ignore — no saved prompt yet
      }
    })();
  }, [sessionPath, projectId, sourcePath]);

  const handleRegenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fallback = { projectId, inputType: 'draft' as const, sourcePath };
      const session = await readCaptionSession(sessionPath, fallback);
      const entries: SubtitleEntry[] = (session.data.extractedEntries || []) as SubtitleEntry[];
      if (entries.length === 0) {
        setError('Không tìm thấy subtitle entries trong session.');
        setLoading(false);
        return;
      }

      const result = await window.electronAPI.caption.generateThumbnailPrompt({
        entries,
        model: translateMethod === 'deepseek' ? (deepseekModel || geminiModel) : geminiModel,
        translateMethod: translateMethod as 'api' | 'deepseek' | 'openrouter',
      });

      if (result?.success && result?.data?.prompt) {
        const newPrompt = result.data.prompt;
        setPrompt(newPrompt);
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
  }, [sessionPath, sourcePath, translateMethod, geminiModel, deepseekModel, projectId]);

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
