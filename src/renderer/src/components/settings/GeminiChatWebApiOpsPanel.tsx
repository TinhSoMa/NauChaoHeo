import { RefreshCw } from 'lucide-react';
import { Button } from '../common/Button';
import { formatDateTime } from './GeminiChatSettings.shared';

interface GeminiChatWebApiOpsPanelProps {
  webApiHealth: GeminiWebApiHealthSnapshot | null;
  webApiOps: GeminiWebApiOpsSnapshot | null;
  webApiLoading: boolean;
  onRefreshHealth: () => Promise<void> | void;
}

export function GeminiChatWebApiOpsPanel({
  webApiHealth,
  webApiOps,
  webApiLoading,
  onRefreshHealth
}: GeminiChatWebApiOpsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          ['Accounts', webApiOps?.summary.totalAccounts ?? 0],
          ['Active', webApiOps?.summary.activeAccounts ?? 0],
          ['Cookie Ready', webApiOps?.summary.cookieReadyCount ?? 0],
          ['Refresh OK', webApiOps?.summary.refreshSuccessCount ?? 0],
          ['Refresh Fail', webApiOps?.summary.refreshFailCount ?? 0],
          ['Refreshing', webApiOps?.summary.refreshRunningCount ?? 0]
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-(--color-card) border border-(--color-border) rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-(--color-text-secondary)">{label}</div>
            <div className="text-2xl font-semibold mt-2">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-(--color-card) border border-(--color-border) rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">Gemini WebAPI Health</div>
            <div className="text-sm text-(--color-text-secondary) mt-1">
              Kiem tra Python runtime, modules va tinh trang cookie hien dung.
            </div>
          </div>
          <Button variant="secondary" onClick={onRefreshHealth} disabled={webApiLoading}>
            <RefreshCw size={16} className={webApiLoading ? 'animate-spin' : ''} />
            Check Service
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
            <div className="text-xs text-(--color-text-secondary)">Python runtime</div>
            <div className="font-semibold mt-2">{webApiHealth?.runtimeMode || '-'}</div>
            <div className="text-xs text-(--color-text-secondary) mt-2 break-all">{webApiHealth?.pythonPath || '-'}</div>
          </div>
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
            <div className="text-xs text-(--color-text-secondary)">Python version</div>
            <div className="font-semibold mt-2">{webApiHealth?.pythonVersion || '-'}</div>
            <div className="text-xs text-(--color-text-secondary) mt-2">
              Checked: {formatDateTime(webApiHealth?.checkedAt)}
            </div>
          </div>
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
            <div className="text-xs text-(--color-text-secondary)">Modules</div>
            <div className="mt-2 text-sm">
              <div>gemini_webapi: {webApiHealth?.modules?.gemini_webapi ? 'OK' : 'Missing'}</div>
              <div>browser_cookie3: {webApiHealth?.modules?.browser_cookie3 ? 'OK' : 'Missing'}</div>
            </div>
          </div>
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
            <div className="text-xs text-(--color-text-secondary)">Status</div>
            <div className="mt-2 text-sm">
              <div>pythonOk: {webApiHealth?.pythonOk ? 'true' : 'false'}</div>
              <div>modulesOk: {webApiHealth?.modulesOk ? 'true' : 'false'}</div>
              <div>cookieReady: {webApiHealth?.cookieReady ? 'true' : 'false'}</div>
            </div>
          </div>
        </div>

        {webApiHealth?.error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
            {webApiHealth.error}
          </div>
        )}
      </div>

      <div className="bg-(--color-card) border border-(--color-border) rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-(--color-border)">
          <div className="text-lg font-semibold">Cookie Refresh by Account</div>
          <div className="text-sm text-(--color-text-secondary) mt-1">
            Theo doi account nao refresh cookie thanh cong hoac that bai trong phien hien tai.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-(--color-surface)">
              <tr className="text-left text-(--color-text-secondary)">
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Cookie</th>
                <th className="px-4 py-3">Refresh</th>
                <th className="px-4 py-3">Browser</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Last error</th>
              </tr>
            </thead>
            <tbody>
              {webApiOps?.accounts.map((account) => (
                <tr key={account.accountConfigId} className="border-t border-(--color-border)">
                  <td className="px-4 py-3">
                    <div className="font-medium">{account.accountName}</div>
                    <div className="text-xs text-(--color-text-secondary)">{account.accountConfigId}</div>
                  </td>
                  <td className="px-4 py-3">{account.isActive ? 'ON' : 'OFF'}</td>
                  <td className="px-4 py-3">
                    <div>{account.cookieSource}</div>
                    <div className="text-xs text-(--color-text-secondary)">
                      1PSID {account.hasSecure1PSID ? 'OK' : 'Missing'} | 1PSIDTS {account.hasSecure1PSIDTS ? 'OK' : 'Missing'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      account.lastRefreshStatus === 'success'
                        ? 'bg-emerald-100 text-emerald-700'
                        : account.lastRefreshStatus === 'failed'
                          ? 'bg-rose-100 text-rose-700'
                          : account.lastRefreshStatus === 'running'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700'
                    }`}>
                      {account.lastRefreshStatus}
                    </span>
                    <div className="text-xs text-(--color-text-secondary) mt-1">
                      {formatDateTime(account.lastRefreshAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3">{account.lastRefreshBrowser || '-'}</td>
                  <td className="px-4 py-3">
                    primary {account.updatedPrimary ? 'OK' : '-'} | fallback {account.updatedFallback ? 'OK' : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-red-600">{account.lastError || '-'}</td>
                </tr>
              ))}
              {!webApiOps?.accounts.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-(--color-text-secondary)">
                    Chua co account de hien thi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
