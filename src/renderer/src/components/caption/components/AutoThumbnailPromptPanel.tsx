import { useState, useEffect, useCallback } from 'react';
import { Clipboard, ClipboardCheck, RefreshCw, Loader2 } from 'lucide-react';
import { readCaptionSession, updateCaptionSession } from '../hooks/captionSessionStore';
import type { SubtitleEntry } from '@shared/types/caption';

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

  useEffect(() => {
    (async () => {
      try {
        const fallback = { projectId, inputType: 'draft' as const, sourcePath };
        const session = await readCaptionSession(sessionPath, fallback);
        if (session.data.autoThumbnailPrompt) {
          setPrompt(session.data.autoThumbnailPrompt);
        }
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

      const result = await window.electronAPI.caption.translateBatch({
        entries,
        batchIndex: 0,
        totalBatches: 1,
        linesPerBatch: entries.length,
        targetLanguage: 'Vietnamese',
        model: translateMethod === 'deepseek' ? (deepseekModel || geminiModel) : geminiModel,
        translateMethod: translateMethod as 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui' | 'openrouter' | 'deepseek',
        projectId: projectId || undefined,
        sourcePath,
        isThumbnailPrompt: true,
      });

      if (result?.success && result?.data?.translatedTexts?.[0]) {
        const newPrompt = result.data.translatedTexts[0];
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
        setError(result?.error || result?.data?.error || 'Không nhận được prompt từ AI');
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

  const isDisabled = loading || saving;

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color, #e0e0e0)', paddingTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
        Prompt Thumbnail AI
      </div>

      {error && (
        <div style={{ color: 'var(--error-color, #e53935)', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {prompt && (
        <div style={{ marginBottom: 8 }}>
          <pre style={{
            background: 'var(--bg-subtle, #f5f5f5)',
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflowY: 'auto',
            margin: 0,
          }}>
            {prompt}
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            disabled={isDisabled}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 4,
              padding: '2px 8px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {copied ? <ClipboardCheck size={14} /> : <Clipboard size={14} />}
            {copied ? 'Đã sao chép!' : 'Sao chép'}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={handleRegenerate}
        disabled={isDisabled}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 12px',
          fontSize: 12,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.6 : 1,
        }}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {loading ? 'Đang tạo...' : saving ? 'Đang lưu...' : prompt ? 'Tạo lại' : 'Tạo Prompt Thumbnail'}
      </button>
    </div>
  );
}
