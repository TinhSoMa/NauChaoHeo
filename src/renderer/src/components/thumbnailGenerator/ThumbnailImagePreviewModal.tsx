import { useEffect, useCallback, useState } from 'react'
import { X, Download } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  imageUrl: string
  imageIndex: number
  onDownload: (url: string, index: number) => void
}

export function ThumbnailImagePreviewModal({ isOpen, onClose, imageUrl, imageIndex, onDownload }: Props) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    if (!isOpen || !imageUrl) { setDataUrl(''); return }
    if (imageUrl.startsWith('data:')) { setDataUrl(imageUrl); return }
    window.electronAPI.dialog.getImageDataUrl(imageUrl).then(url => {
      if (url) setDataUrl(url)
    })
  }, [isOpen, imageUrl])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="relative max-w-4xl w-full bg-card rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Xem Trước Thumbnail {imageIndex + 1}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => onDownload(imageUrl, imageIndex)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:bg-primary/90 transition-colors">
              <Download className="w-3.5 h-3.5" /> Tải Xuống
            </button>
            <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center bg-black/10 min-h-[200px]">
          {dataUrl ? (
            <img src={dataUrl} alt={`Thumbnail ${imageIndex + 1}`} className="max-w-full max-h-[70vh] object-contain" />
          ) : (
            <div className="w-full h-48 flex items-center justify-center text-text-secondary text-sm">Đang tải...</div>
          )}
        </div>
        <div className="p-3 border-t border-border bg-surface flex items-center justify-between text-xs text-text-secondary">
          <span>1280 × 720 pixels &middot; Chất Lượng HD</span>
          <span>Hoàn hảo cho thumbnail YouTube</span>
        </div>
      </div>
    </div>
  )
}
