import type { MouseEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Monitor,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react';
import { Button } from '../common/Button';
import type {
  GeminiChatConfig,
  LiveTokenStats,
  TokenStats
} from './GeminiChatSettings.shared';
import { formatDateTime } from './GeminiChatSettings.shared';

interface GeminiChatAccountsPanelProps {
  configs: GeminiChatConfig[];
  isLoading: boolean;
  tokenStats: TokenStats;
  liveStats: LiveTokenStats | null;
  webApiOps: GeminiWebApiOpsSnapshot | null;
  getProxyLabel: (proxyId?: string) => string;
  onEdit: (config: GeminiChatConfig) => void;
  onDelete: (id: string, event: MouseEvent) => void;
  onToggleActive: (config: GeminiChatConfig, event: MouseEvent) => void;
  onToggleError: (config: GeminiChatConfig, event: MouseEvent) => void;
  onClearError: (configId: string, event: MouseEvent) => void;
}

function getAccountLiveStatus(liveStats: LiveTokenStats | null, configId: string) {
  if (!liveStats) return null;
  return liveStats.accounts.find((account) => account.id === configId) || null;
}

function getWebApiAccountStatus(
  webApiOps: GeminiWebApiOpsSnapshot | null,
  configId: string
) {
  if (!webApiOps) return null;
  return webApiOps.accounts.find((account) => account.accountConfigId === configId) || null;
}

export function GeminiChatAccountsPanel({
  configs,
  isLoading,
  tokenStats,
  liveStats,
  webApiOps,
  getProxyLabel,
  onEdit,
  onDelete,
  onToggleActive,
  onToggleError,
  onClearError
}: GeminiChatAccountsPanelProps) {
  return (
    <div className="grid grid-cols-1 gap-4">
      {configs.map((config) => {
        const live = getAccountLiveStatus(liveStats, config.id);
        const webApiStatus = getWebApiAccountStatus(webApiOps, config.id);
        const statusColor = !config.isActive
          ? 'bg-gray-100 text-gray-400'
          : live?.status === 'error'
            ? 'bg-red-100 text-red-600'
            : live?.status === 'busy'
              ? 'bg-yellow-100 text-yellow-600'
              : live?.status === 'cooldown'
                ? 'bg-blue-100 text-blue-600'
                : 'bg-green-100 text-green-600';

        return (
          <div
            key={config.id}
            className="bg-(--color-card) border border-(--color-border) rounded-xl p-4 flex items-center gap-4 hover:border-(--color-primary) transition-colors cursor-pointer group"
            onClick={() => onEdit(config)}
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusColor}`}>
              {!config.isActive ? <X size={20} />
                : live?.status === 'error' ? <AlertTriangle size={20} />
                : live?.status === 'busy' ? <RefreshCw size={20} className="animate-spin" />
                : live?.status === 'cooldown' ? <RefreshCw size={20} />
                : <Check size={20} />}
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-lg">{config.name}</span>
                {config.id === 'legacy' ? (
                  <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                    Legacy
                  </span>
                ) : null}
                {tokenStats.duplicateIds.has(config.id) && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                    Trung token
                  </span>
                )}
                {live && config.isActive && (
                  live.status === 'error' ? (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Loi</span>
                  ) : live.status === 'busy' ? (
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">Dang gui...</span>
                  ) : live.status === 'cooldown' ? (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                      Cho {Math.ceil(live.waitTimeMs / 1000)}s
                    </span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">San sang</span>
                  )
                )}
                {webApiStatus?.lastRefreshStatus === 'success' && (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
                    Cookie OK
                  </span>
                )}
                {webApiStatus?.lastRefreshStatus === 'failed' && (
                  <span className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded">
                    Cookie fail
                  </span>
                )}
                {webApiStatus?.lastRefreshStatus === 'running' && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                    Refreshing cookie
                  </span>
                )}
              </div>
              <div className="text-sm text-(--color-text-secondary) flex gap-4 mt-1 flex-wrap">
                <span className="flex items-center gap-1">
                  <Monitor size={12} /> {config.platform || 'Unknown'}
                </span>
                <span className="opacity-80">Proxy: {getProxyLabel(config.proxyId)}</span>
                <span className="truncate max-w-50 opacity-70">{config.cookie.substring(0, 30)}...</span>
              </div>
              {webApiStatus && (
                <div className="mt-2 text-xs text-(--color-text-secondary) flex gap-4 flex-wrap">
                  <span>Cookie source: {webApiStatus.cookieSource}</span>
                  <span>1PSID: {webApiStatus.hasSecure1PSID ? 'OK' : 'Thieu'}</span>
                  <span>1PSIDTS: {webApiStatus.hasSecure1PSIDTS ? 'OK' : 'Thieu'}</span>
                  <span>Refresh gan nhat: {formatDateTime(webApiStatus.lastRefreshAt)}</span>
                </div>
              )}
              {webApiStatus?.lastError && (
                <div className="mt-1 text-xs text-red-600">WebAPI: {webApiStatus.lastError}</div>
              )}
              {live?.status === 'error' && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-red-500 flex items-center gap-1">
                    <AlertTriangle size={12} /> Gap loi
                  </span>
                  <button
                    onClick={(event) => onClearError(config.id, event)}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 transition-all shadow-sm whitespace-nowrap"
                    title="Xoa trang thai loi de he thong thu lai"
                  >
                    <RefreshCw size={10} /> Dat lai
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={(event) => onToggleActive(config, event)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${config.isActive ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
              >
                {config.isActive ? 'Dang dung' : 'Dang tat'}
              </button>

              <button
                onClick={(event) => onToggleError(config, event)}
                className={`text-xs px-2 py-1.5 rounded-full border transition-colors ${config.isError ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}
                title={config.isError ? 'Tat trang thai loi' : 'Bat trang thai loi'}
              >
                <AlertTriangle size={16} />
              </button>

              <Button
                variant="danger"
                iconOnly
                onClick={(event) => onDelete(config.id, event)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>
        );
      })}

      {configs.length === 0 && !isLoading && (
        <div className="text-center py-20 text-gray-400">
          Chua co tai khoan nao. Nhan "Them moi" de cau hinh.
        </div>
      )}
    </div>
  );
}
