import { Settings } from '../settings/Settings'
import { useThemeEffect } from '../../hooks/useTheme'
import { ArrowLeft } from 'lucide-react'

// Màn cài đặt tối giản cho Dashboard (không Sidebar/AppLayout)
export function SettingsStandalone() {
  useThemeEffect() // Apply theme
  
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
          <button
            onClick={goBack}
            className="px-3 py-2 rounded-lg border border-border text-text-primary hover:bg-surface transition-colors flex items-center gap-2"
          >
            <ArrowLeft size={16} />
            <span>Quay về Projects</span>
          </button>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <Settings />
        </div>
      </div>
    </div>
  )
}
