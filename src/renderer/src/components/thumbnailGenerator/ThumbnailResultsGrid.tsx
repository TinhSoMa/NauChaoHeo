import { useState, useEffect } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { CheckCircle, Download, Plus, Eye, Loader2 } from 'lucide-react'
import { ThumbnailImagePreviewModal } from './ThumbnailImagePreviewModal'

export function ThumbnailResultsGrid() {
  const { generatedImages, downloadImage } = useThumbnailStore()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [previewModal, setPreviewModal] = useState({ isOpen: false, imageUrl: '', imageIndex: 0 })
  const [isDownloadingZip, setIsDownloadingZip] = useState(false)
  const [imageDataUrls, setImageDataUrls] = useState<Record<number, string>>({})

  useEffect(() => {
    generatedImages.forEach(async (path, i) => {
      try {
        const dataUrl = await window.electronAPI.dialog.getImageDataUrl(path)
        if (dataUrl) setImageDataUrls(prev => ({ ...prev, [i]: dataUrl }))
      } catch { /* skip */ }
    })
  }, [generatedImages])

  const handleDownload = (imageUrl: string) => {
    downloadImage(imageUrl)
  }

  const handleDownloadAll = async () => {
    setIsDownloadingZip(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      await Promise.all(
        generatedImages.map(async (_, i) => {
          try {
            const dataUrl = imageDataUrls[i]
            if (!dataUrl) return
            const resp = await fetch(dataUrl)
            const blob = await resp.blob()
            zip.file(`thumbnail-${i + 1}.png`, blob)
          } catch { /* skip failed */ }
        })
      )
      const blob = await zip.generateAsync({ type: 'blob' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `thumbnails-${Date.now()}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)
    } catch {
      await Promise.all(generatedImages.map((url, i) =>
        new Promise<void>(resolve => setTimeout(() => { downloadImage(url); resolve() }, i * 100))
      ))
    } finally {
      setIsDownloadingZip(false)
    }
  }

  const handlePreview = (imageUrl: string, index: number) => {
    setPreviewModal({ isOpen: true, imageUrl, imageIndex: index })
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-6">
        <div className="flex items-center justify-center mb-3">
          <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center mr-3">
            <CheckCircle className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-text-primary">Thumbnail Đã Sẵn Sàng!</h2>
        </div>
        <p className="text-sm text-text-secondary">Chọn ảnh yêu thích hoặc tải tất cả</p>
      </div>

      <div className="flex items-center justify-center gap-3 mb-6">
        <button onClick={handleDownloadAll} disabled={isDownloadingZip}
          className="bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-white text-sm font-medium px-5 py-2.5 rounded-lg flex items-center gap-2 transition-colors">
          {isDownloadingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {isDownloadingZip ? 'Đang tạo ZIP...' : 'Tải Tất Cả (ZIP)'}
        </button>
        <button onClick={() => useThumbnailStore.getState().resetFlow()}
          className="border-2 border-border hover:border-text-secondary text-text-primary text-sm font-medium px-5 py-2.5 rounded-lg flex items-center gap-2 transition-colors">
          <Plus className="w-4 h-4" />
          Tạo Thumbnail Mới
        </button>
      </div>

      <div className={`grid gap-4 ${generatedImages.length === 1 ? 'grid-cols-1 max-w-md mx-auto' : 'md:grid-cols-2'}`}>
        {generatedImages.length === 0 ? (
          <div className="col-span-full text-center py-12 text-text-secondary text-sm">
            Không có hình ảnh nào được tạo. Vui lòng thử lại.
          </div>
        ) : (
          generatedImages.map((imagePath, index) => {
            const src = imageDataUrls[index]
            const imageUrlForModal = imageDataUrls[index] || imagePath
            return (
              <div key={index} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden hover:shadow-md transition-all"
                onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}>
                <div className="relative group aspect-video">
                  {src ? (
                    <img src={src} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-surface animate-pulse">
                      <Loader2 className="w-8 h-8 text-text-secondary animate-spin" />
                    </div>
                  )}
                  {hoveredIndex === index && src && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2">
                      <button onClick={() => handlePreview(imageUrlForModal, index)}
                        className="bg-white text-gray-900 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-1.5 transition-colors">
                        <Eye className="w-3.5 h-3.5" /> Xem Trước
                      </button>
                      <button onClick={() => handleDownload(imagePath)}
                        className="bg-primary text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-primary/90 flex items-center gap-1.5 transition-colors">
                        <Download className="w-3.5 h-3.5" /> Tải Xuống
                      </button>
                    </div>
                  )}
                  <div className="absolute top-2 left-2">
                    <span className="bg-primary text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">HD</span>
                  </div>
                  <div className="absolute top-2 right-2">
                    <span className="bg-black/60 text-white text-xs font-semibold w-6 h-6 rounded-full flex items-center justify-center">{index + 1}</span>
                  </div>
                </div>
                <div className="p-3">
                  <button onClick={() => handleDownload(imagePath)}
                    className="w-full bg-primary hover:bg-primary/90 text-white text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors">
                    <Download className="w-3.5 h-3.5" /> Tải Xuống
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="mt-6 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
        <h3 className="font-semibold text-sm text-yellow-900 dark:text-yellow-200 mb-2">Mẹo Cho Thumbnail Của Bạn</h3>
        <div className="grid md:grid-cols-2 gap-3 text-xs text-yellow-800 dark:text-yellow-300">
          <ul className="list-disc list-inside space-y-0.5">
            <li>Sử dụng làm thumbnail YouTube ngay lập tức</li>
            <li>Thử nghiệm các phiên bản khác nhau</li>
            <li>Đảm bảo chữ dễ đọc trên thiết bị di động</li>
          </ul>
          <ul className="list-disc list-inside space-y-0.5">
            <li>A/B test thumbnail để tăng CTR</li>
            <li>Giữ các yếu tố quan trọng tránh xa mép ảnh</li>
            <li>Đảm bảo độ tương phản cao để dễ nhìn</li>
          </ul>
        </div>
      </div>

      <ThumbnailImagePreviewModal
        isOpen={previewModal.isOpen}
        onClose={() => setPreviewModal({ isOpen: false, imageUrl: '', imageIndex: 0 })}
        imageUrl={previewModal.imageUrl}
        imageIndex={previewModal.imageIndex}
        onDownload={handleDownload}
      />
    </div>
  )
}
