import { Suspense, lazy } from 'react'
import { useThemeEffect } from '../../hooks/useTheme'
import { useFontEffect } from '../../hooks/useFontSettings'
import { ArrowLeft, Globe } from 'lucide-react'

const Settings = lazy(() =>
  import('../settings/Settings').then((mod) => ({ default: mod.Settings })),
)

// Màn cài đặt tối giản cho Dashboard (không Sidebar/AppLayout)
export function SettingsStandalone() {
  useThemeEffect() // Apply theme
  useFontEffect() // Apply font
  
  const goBack = () => {
    window.location.hash = '#/projects'
  }

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Cài đặt ứng dụng</h1>
            <p className="text-sm text-text-secondary">Điều chỉnh cấu hình chung. Nhấn quay lại để về danh sách project.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.location.hash = '#/openrouter-settings'}
              className="px-3 py-2 rounded-lg border border-border text-text-primary hover:bg-surface transition-colors flex items-center gap-2"
            >
              <Globe size={16} />
              <span>OpenRouter</span>
            </button>
            <button
              onClick={goBack}
              className="px-3 py-2 rounded-lg border border-border text-text-primary hover:bg-surface transition-colors flex items-center gap-2"
            >
              <ArrowLeft size={16} />
              <span>Quay về Projects</span>
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <Suspense fallback={<div className="text-sm text-text-secondary">Đang tải Settings...</div>}>
            <Settings />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
