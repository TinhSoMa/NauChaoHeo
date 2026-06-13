import { useState, useEffect, useCallback } from 'react'
import { Save, RefreshCw } from 'lucide-react'
import { ModelPicker } from './ModelPicker'

export function OpenRouterGeneralSettings() {
  const [config, setConfig] = useState<{ defaultModel: string; siteUrl: string | null; appTitle: string | null }>({
    defaultModel: 'openai/gpt-4o-mini', siteUrl: null, appTitle: null,
  })
  const [models, setModels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [configRes, modelsRes] = await Promise.all([
        window.electronAPI.openRouter.getConfig(),
        window.electronAPI.openRouter.getModels(),
      ])
      if (configRes.success) setConfig(configRes.data as { defaultModel: string; siteUrl: string | null; appTitle: string | null })
      if (modelsRes.success) setModels((modelsRes.data || []) as any[])
    } catch (err) {
      console.error('[OpenRouterSettings] Lỗi tải:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await window.electronAPI.openRouter.setConfig({
        defaultModel: config.defaultModel,
        siteUrl: config.siteUrl,
        appTitle: config.appTitle,
      })
      setMessage(res.success
        ? { type: 'success', text: 'Đã lưu cấu hình' }
        : { type: 'error', text: res.error || 'Lỗi' })
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    }
    setSaving(false)
  }

  if (loading) {
    return <div className="text-sm text-text-secondary py-8 text-center">Đang tải...</div>
  }

  return (
    <div className="flex flex-col gap-5">
      {message && (
        <div className={`px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
        }`}>
          {message.text}
          <button className="float-right opacity-60 hover:opacity-100" onClick={() => setMessage(null)}>✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ModelPicker
          models={models}
          value={config.defaultModel}
          onChange={(modelId) => setConfig(prev => ({ ...prev, defaultModel: modelId }))}
          placeholder="Chọn model mặc định..."
        />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-primary">Site URL (HTTP-Referer)</label>
          <input
            type="text" value={config.siteUrl || ''}
            onChange={e => setConfig(prev => ({ ...prev, siteUrl: e.target.value || null }))}
            placeholder="https://github.com/TinhSoMa/NauChaoHeo"
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-primary">App Title (X-OpenRouter-Title)</label>
          <input
            type="text" value={config.appTitle || ''}
            onChange={e => setConfig(prev => ({ ...prev, appTitle: e.target.value || null }))}
            placeholder="NauChaoHeo"
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <button
          onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-secondary text-xs hover:bg-surface"
        >
          <RefreshCw size={13} />
          Làm mới
        </button>
      </div>
    </div>
  )
}
