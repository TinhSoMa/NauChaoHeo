import { useState, useEffect, useCallback } from 'react'
import { Save, RefreshCw, Key, Eye, EyeOff } from 'lucide-react'

export function ThumbnailGeneratorSettings() {
  const [geminiKey, setGeminiKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showGemini, setShowGemini] = useState(false)
  const [showOpenai, setShowOpenai] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.electronAPI.thumbnailGenerator.getConfig()
      if (res.success && res.data) {
        setGeminiKey(res.data.geminiApiKey || '')
        setOpenaiKey(res.data.openaiApiKey || '')
      }
    } catch (err) {
      console.error('[ThumbnailGeneratorSettings] Lỗi tải:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await window.electronAPI.thumbnailGenerator.updateConfig({
        geminiApiKey: geminiKey,
        openaiApiKey: openaiKey,
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
          <button type="button" className="float-right opacity-60 hover:opacity-100" onClick={() => setMessage(null)}>✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-primary flex items-center gap-1.5">
            <Key size={12} /> Gemini API Key
          </label>
          <div className="relative">
            <input
              type={showGemini ? 'text' : 'password'}
              value={geminiKey}
              onChange={e => setGeminiKey(e.target.value)}
              placeholder="Nhập Gemini API key..."
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 pr-8 text-sm text-text-primary focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowGemini(!showGemini)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              {showGemini ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <span className="text-2xs text-text-muted mt-0.5">Dùng cho sinh thumbnail qua Gemini 2.5 Flash</span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-primary flex items-center gap-1.5">
            <Key size={12} /> OpenAI API Key
          </label>
          <div className="relative">
            <input
              type={showOpenai ? 'text' : 'password'}
              value={openaiKey}
              onChange={e => setOpenaiKey(e.target.value)}
              placeholder="Nhập OpenAI API key..."
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 pr-8 text-sm text-text-primary focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowOpenai(!showOpenai)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              {showOpenai ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <span className="text-2xs text-text-muted mt-0.5">Tùy chọn. Dùng để nâng cao prompt (Prompt Enhancer)</span>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>
        <button
          type="button"
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
