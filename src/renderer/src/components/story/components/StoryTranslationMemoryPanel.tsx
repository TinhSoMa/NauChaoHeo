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
    status,
    health,
    stats,
    disabled = false,
    isClearing = false,
    onEnabledChange,
    onTopKChange,
    onClearNamespace
  } = props;

  const statusLabel =
    status === 'ready'
      ? 'Sẵn sàng'
      : status === 'missing_provider'
        ? 'Fallback local'
        : status === 'missing_runtime'
          ? 'Thiếu runtime'
          : 'Lỗi';
  const expectedModel = health?.details?.spacyModelName || 'xx_ent_wiki_sm';
  const loadedModel = health?.details?.spacyLoadedModel || '(chưa load)';

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

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-card/60 p-2">
          <div className="text-[11px] uppercase tracking-wide text-text-secondary">Status</div>
          <div className="mt-1 text-sm text-text-primary">{statusLabel}</div>
          <div className="mt-1 text-[11px] text-text-secondary">
            spaCy: {expectedModel} | loaded: {loadedModel}
          </div>
          {health?.warning && (
            <div className="mt-1 text-[11px] text-text-secondary">{health.warning}</div>
          )}
        </div>
        <div className="rounded-lg border border-border/60 bg-card/60 p-2">
          <div className="text-[11px] uppercase tracking-wide text-text-secondary">Namespace</div>
          <div className="mt-1 break-all font-mono text-[11px] text-text-primary">
            {namespace || '(chưa có)'}
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card/60 p-2">
          <div className="text-[11px] uppercase tracking-wide text-text-secondary">Stats</div>
          <div className="mt-1 text-sm text-text-primary">
            {stats?.totalMemories ?? 0} memories
          </div>
          {stats?.recentEntities?.length ? (
            <div className="mt-1 text-[11px] text-text-secondary">
              {stats.recentEntities.slice(0, 6).join(', ')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
