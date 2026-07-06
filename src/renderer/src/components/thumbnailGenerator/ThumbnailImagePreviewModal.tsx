import { X, Download } from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  imageUrl: string
  imageIndex: number
  onDownload: (url: string, index: number) => void
}

export function ThumbnailImagePreviewModal({ isOpen, onClose, imageUrl, imageIndex, onDownload }: Props) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="relative max-w-4xl w-full bg-card rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          <button onClick={() => onDownload(imageUrl, imageIndex)} className="bg-primary hover:bg-primary/90 text-white p-2 rounded-lg transition-colors">
            <Download className="w-5 h-5" />
          </button>
          <button onClick={onClose} className="bg-black/50 hover:bg-black/70 text-white p-2 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center justify-center p-4 bg-black/20">
          <img src={imageUrl.startsWith('file://') ? imageUrl : `file://${imageUrl}`} alt={`Thumbnail ${imageIndex + 1}`} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
        </div>
        <div className="p-4 text-center text-text-primary font-medium">
          Thumbnail #{imageIndex + 1}
        </div>
      </div>
    </div>
  )
}
