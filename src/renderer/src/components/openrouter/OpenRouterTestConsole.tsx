import { useState, useEffect } from 'react'
import { Send, Trash2 } from 'lucide-react'
import { ModelPicker, isFree, formatPrice, formatContext } from './ModelPicker'
import { getModelCapabilities, CAPABILITY_LABELS, CAPABILITY_COLORS } from '@shared/types/openrouter'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function OpenRouterTestConsole() {
  const [models, setModels] = useState<any[]>([])
  const [model, setModel] = useState('openai/gpt-4o-mini')
  const [systemPrompt, setSystemPrompt] = useState('Bạn là trợ lý AI hữu ích.')
  const [userMessage, setUserMessage] = useState('Xin chào! Hãy giới thiệu về bạn.')
  const [response, setResponse] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorLoading, setErrorLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawJson, setRawJson] = useState(false)

  useEffect(() => {
    ;window.electronAPI.openRouter.getModels().then((res: any) => {
      if (res.success && res.data?.length) {
        setModels(res.data)
        if (!res.data.find((m: any) => m.id === model)) {
          setModel(res.data[0].id)
        }
      }
    }).catch(() => setErrorLoading(true))
  }, [])

  const selected = models.find((m: any) => m.id === model)

  const handleSend = async () => {
    setLoading(true)
    setResponse(null)
    setError(null)

    try {
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ]

      const res = await window.electronAPI.openRouter.chat(messages, {
        model,
        temperature: 0.7,
        max_tokens: 1024,
      })

      if (res.success) {
        if (rawJson) {
          setResponse(JSON.stringify(res.data, null, 2))
        } else {
          setResponse(res.data?.choices?.[0]?.message?.content || '(no content)')
        }
      } else {
        setError(res.error || 'Unknown error')
      }
    } catch (err) {
      setError(String(err))
    }
    setLoading(false)
  }

  const handleClear = () => {
    setResponse(null)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">Model</label>
          {models.length > 0 ? (
            <ModelPicker
              models={models}
              value={model}
              onChange={setModel}
              placeholder="Chọn model để kiểm thử..."
            />
          ) : errorLoading ? (
            <div className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-muted">
              {model}
            </div>
          ) : (
            <div className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-muted">
              Đang tải danh sách model...
            </div>
          )}
          {selected && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {isFree(selected.pricing) && (
                <span className="text-2xs px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">Free</span>
              )}
              {!isFree(selected.pricing) && selected.pricing && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-medium">{formatPrice(selected.pricing)}</span>
              )}
              {selected.context_length && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted">{formatContext(selected.context_length)} context</span>
              )}
              {getModelCapabilities(selected).filter(c => c !== 'text').map(c => (
                <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded border ${CAPABILITY_COLORS[c]}`}>{CAPABILITY_LABELS[c]}</span>
              ))}
              <span className="text-2xs px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted font-mono">{selected.id}</span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">System Prompt</label>
          <input
            type="text"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">User Message</label>
          <input
            type="text"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={rawJson}
              onChange={(e) => setRawJson(e.target.checked)}
              className="rounded border-border"
            />
            Show raw JSON
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSend}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Send size={16} />
          {loading ? 'Đang gửi...' : 'Gửi'}
        </button>
        <button
          onClick={handleClear}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-text-secondary text-sm hover:bg-surface transition-colors"
        >
          <Trash2 size={14} />
          Xóa
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">{error}</div>
      )}

      {response && (
        <div className="p-3 rounded-lg bg-surface border border-border">
          <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans">{response}</pre>
        </div>
      )}
    </div>
  )
}
