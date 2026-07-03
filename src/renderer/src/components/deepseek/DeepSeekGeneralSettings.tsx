import { useState, useEffect, useCallback } from 'react'
import { Save, RefreshCw, Key, Cpu } from 'lucide-react'
import { DEEPSEEK_DEFAULT_MODEL } from '@shared/types/deepseek'

export function DeepSeekGeneralSettings() {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(DEEPSEEK_DEFAULT_MODEL)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchModels = useCallback(async (key: string, currentModel: string) => {
    if (!key) {
      setAvailableModels([])
      setModelsError(null)
      return
    }
    setModelsLoading(true)
    setModelsError(null)
    try {
      const res = await window.electronAPI.deepSeek.listModels(key)
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        const ids = res.data.map((m: { id: string }) => m.id)
        setAvailableModels(ids)
        if (!ids.includes(currentModel) && ids.length > 0) {
          setModel(ids[0])
        }
      } else {
        setModelsError(res.error || 'Không thể tải danh sách model')
      }
    } catch (err) {
      setModelsError(String(err))
    }
    setModelsLoading(false)
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.deepSeek.getConfig()
      if (res.success && res.data) {
        setApiKey(res.data.apiKey || '')
        const savedModel = res.data.defaultModel || DEEPSEEK_DEFAULT_MODEL
        setModel(savedModel)
        if (res.data.apiKey) {
          fetchModels(res.data.apiKey, savedModel)
        }
      }
    } catch (err) {
      console.error('[DeepSeekSettings] Lỗi tải:', err)
    }
    setLoading(false)
  }, [fetchModels])

  useEffect(() => { loadData() }, [loadData])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await window.electronAPI.deepSeek.setConfig({
        apiKey: apiKey || null,
        defaultModel: model,
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
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-primary flex items-center gap-1.5">
            <Key size={12} /> API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Nhập DeepSeek API key..."
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
          />
          <span className="text-2xs text-text-muted mt-0.5">
            Lấy key tại <a className="text-primary hover:underline" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">platform.deepseek.com</a>
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-primary flex items-center gap-1.5">
            <Cpu size={12} /> Model
            {modelsLoading && <RefreshCw size={11} className="animate-spin text-text-muted" />}
          </label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            disabled={!apiKey || modelsLoading}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary disabled:opacity-40"
          >
            {!apiKey ? (
              <option value="">Vui lòng nhập API key trước</option>
            ) : availableModels.length > 0 ? (
              availableModels.map(id => (
                <option key={id} value={id}>{id}</option>
              ))
            ) : (
              <option value={model}>{model}</option>
            )}
          </select>
          {modelsLoading && (
            <span className="text-2xs text-text-muted mt-0.5">Đang tải danh sách model...</span>
          )}
          {modelsError && (
            <span className="text-2xs text-red-400 mt-0.5">
              Không thể tải danh sách model: {modelsError}. Ấn Làm mới để thử lại.
            </span>
          )}
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
