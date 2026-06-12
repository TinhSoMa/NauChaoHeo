import type { MemoryContextHealthResult, MemoryContextStatsResult } from '../../../../../shared/types/memoryContext';

interface StoryTranslationMemoryPanelProps {
  projectId: string | null;
  enabled: boolean;
  topK: number;
  namespace: string;
  status: 'ready' | 'missing_runtime' | 'missing_provider' | 'error' | undefined;
  health: MemoryContextHealthResult | null;
  stats: MemoryContextStatsResult | null;
  disabled?: boolean;
  isClearing?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onTopKChange: (value: number) => void;
  onClearNamespace: () => void;
}

export function StoryTranslationMemoryPanel(props: StoryTranslationMemoryPanelProps) {
  const {
    projectId,
    enabled,
    topK,
    namespace,
    disabled = false,
    isClearing = false,
    onEnabledChange,
    onTopKChange,
    onClearNamespace
  } = props;

  return (
    <div className="md:col-span-12 border border-border/70 rounded-xl p-3 bg-muted/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">Memory Context</div>
          <div className="text-xs text-text-secondary">
            Query ký ức từ các chapter trước và bơm vào prompt dịch.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-text-primary">
            <input
              type="checkbox"
              checked={enabled}
              disabled={disabled || !projectId}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            Bật memory mode
          </label>
          <label className="flex items-center gap-2 text-xs text-text-primary">
            <span>Top K</span>
            <input
              type="number"
              min={1}
              max={20}
              value={topK}
              disabled={disabled || !projectId}
              onChange={(event) => onTopKChange(Number(event.target.value) || 1)}
              className="h-8 w-16 rounded-md border border-border bg-card px-2 text-xs text-text-primary"
            />
          </label>
          <button
            type="button"
            onClick={onClearNamespace}
            disabled={disabled || !projectId || !namespace || isClearing}
            className="h-8 rounded-md border border-border px-3 text-xs text-text-primary disabled:opacity-50"
          >
            {isClearing ? 'Đang xóa...' : 'Clear memory'}
          </button>
        </div>
      </div>
    </div>
  );
}
