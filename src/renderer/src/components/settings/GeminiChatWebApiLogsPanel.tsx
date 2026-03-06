import { Input } from '../common/Input';
import { formatDateTime, formatLogMetadata } from './GeminiChatSettings.shared';

interface GeminiChatWebApiLogsPanelProps {
  logs: GeminiWebApiLogEntry[];
  logTypeFilter: string;
  logAccountFilter: string;
  logTextFilter: string;
  onLogTypeFilterChange: (value: string) => void;
  onLogAccountFilterChange: (value: string) => void;
  onLogTextFilterChange: (value: string) => void;
}

export function GeminiChatWebApiLogsPanel({
  logs,
  logTypeFilter,
  logAccountFilter,
  logTextFilter,
  onLogTypeFilterChange,
  onLogAccountFilterChange,
  onLogTextFilterChange
}: GeminiChatWebApiLogsPanelProps) {
  const getLevelBadgeClass = (level: GeminiWebApiLogEntry['level']) => {
    if (level === 'success') return 'bg-emerald-100 text-emerald-700';
    if (level === 'error') return 'bg-rose-100 text-rose-700';
    if (level === 'warning') return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-700';
  };

  const getDetailTextClass = (level: GeminiWebApiLogEntry['level']) => {
    if (level === 'error') return 'text-red-600';
    if (level === 'warning') return 'text-amber-700';
    if (level === 'success') return 'text-emerald-700';
    return 'text-(--color-text-secondary)';
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          placeholder="Filter event type"
          value={logTypeFilter}
          onChange={(event) => onLogTypeFilterChange(event.target.value)}
        />
        <Input
          placeholder="Filter account"
          value={logAccountFilter}
          onChange={(event) => onLogAccountFilterChange(event.target.value)}
        />
        <Input
          placeholder="Filter message / error"
          value={logTextFilter}
          onChange={(event) => onLogTextFilterChange(event.target.value)}
        />
      </div>

      <div className="bg-(--color-card) border border-(--color-border) rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-(--color-border) flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">WebAPI Logs</div>
            <div className="text-sm text-(--color-text-secondary) mt-1">
              Log runtime cua Gemini WebAPI trong phien hien tai.
            </div>
          </div>
          <div className="text-sm text-(--color-text-secondary)">{logs.length} entries</div>
        </div>

        <div className="max-h-[640px] overflow-y-auto">
          {logs.map((entry) => (
            <div key={entry.seq} className="px-5 py-4 border-b border-(--color-border)">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2 py-1 rounded-full text-xs ${getLevelBadgeClass(entry.level)}`}>
                  {entry.level}
                </span>
                <span className="text-xs bg-(--color-surface) border border-(--color-border) px-2 py-1 rounded-full">
                  {entry.type}
                </span>
                <span className="text-xs text-(--color-text-secondary)">#{entry.seq}</span>
                <span className="text-xs text-(--color-text-secondary)">{formatDateTime(entry.timestamp)}</span>
              </div>
              <div className="mt-2 font-medium">{entry.message}</div>
              <div className="mt-1 text-sm text-(--color-text-secondary)">
                account: {entry.accountName || '-'} {entry.accountConfigId ? `(${entry.accountConfigId})` : ''}
              </div>
              {entry.sourceBrowser && (
                <div className="mt-1 text-sm text-(--color-text-secondary)">browser: {entry.sourceBrowser}</div>
              )}
              {entry.errorCode && (
                <div className={`mt-1 text-sm ${getDetailTextClass(entry.level)}`}>errorCode: {entry.errorCode}</div>
              )}
              {entry.error && (
                <div className={`mt-1 text-sm break-words whitespace-pre-wrap ${getDetailTextClass(entry.level)}`}>
                  {entry.error}
                </div>
              )}
              {entry.metadata && (
                <div className="mt-2 text-xs text-(--color-text-secondary) break-words">
                  {formatLogMetadata(entry.metadata)}
                </div>
              )}
            </div>
          ))}
          {logs.length === 0 && (
            <div className="px-5 py-10 text-center text-(--color-text-secondary)">
              Khong co log phu hop bo loc.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
