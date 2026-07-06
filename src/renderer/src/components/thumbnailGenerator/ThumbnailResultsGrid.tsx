import { useState } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { CheckCircle, Download, Plus, Eye, Loader2 } from 'lucide-react'
import { ThumbnailImagePreviewModal } from './ThumbnailImagePreviewModal'

export function ThumbnailResultsGrid() {
  const { generatedImages, downloadImage } = useThumbnailStore()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [previewModal, setPreviewModal] = useState({ isOpen: false, imageUrl: '', imageIndex: 0 })
  const [isDownloadingZip, setIsDownloadingZip] = useState(false)

  const handleDownload = (imageUrl: string, _index?: number) => {
    downloadImage(imageUrl)
  }

  const handleDownloadAll = async () => {
    setIsDownloadingZip(true)
    for (let i = 0; i < generatedImages.length; i++) {
      await downloadImage(generatedImages[i])
    }
    setIsDownloadingZip(false)
  }

  const handlePreview = (imageUrl: string, index: number) => {
    setPreviewModal({ isOpen: true, imageUrl, imageIndex: index })
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-4">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mr-4">
            <CheckCircle className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-3xl font-bold text-text-primary">Your Thumbnails Are Ready!</h2>
        </div>
        <p className="text-lg text-text-secondary">Choose your favorite or download all of them</p>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
        <button onClick={handleDownloadAll} disabled={isDownloadingZip} className="bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-white font-medium px-6 py-3 rounded-lg flex items-center transition-colors">
          {isDownloadingZip ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
          {isDownloadingZip ? 'Downloading...' : 'Download All'}
        </button>
        <button onClick={() => { useThumbnailStore.getState().resetFlow() }} className="border-2 border-border hover:border-text-secondary text-text-primary font-medium px-6 py-3 rounded-lg flex items-center transition-colors">
          <Plus className="w-5 h-5 mr-2" />
          Create New Thumbnails
        </button>
      </div>

      <div className={`grid gap-6 ${generatedImages.length === 1 ? 'grid-cols-1 max-w-2xl mx-auto' : 'md:grid-cols-2'}`}>
        {generatedImages.map((imagePath, index) => {
          const src = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`
          return (
            <div key={index} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden hover:shadow-md transition-all"
              onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}>
              <div className="relative group">
                <img src={src} alt={`Thumbnail ${index + 1}`} className="w-full h-64 object-cover" />
                {hoveredIndex === index && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-3 transition-opacity">
                    <button onClick={() => handlePreview(imagePath, index)} className="bg-white text-gray-900 font-medium px-4 py-2 rounded-lg hover:bg-gray-100 flex items-center transition-colors">
                      <Eye className="w-4 h-4 mr-2" /> Preview
                    </button>
                    <button onClick={() => handleDownload(imagePath, index)} className="bg-primary text-white font-medium px-4 py-2 rounded-lg hover:bg-primary/90 flex items-center transition-colors">
                      <Download className="w-4 h-4 mr-2" /> Download
                    </button>
                  </div>
                )}
                <div className="absolute top-3 left-3">
                  <span className="bg-primary text-white text-xs font-semibold px-2 py-1 rounded-full">HD Quality</span>
                </div>
                <div className="absolute top-3 right-3">
                  <span className="bg-white/90 text-gray-900 text-sm font-semibold w-8 h-8 rounded-full flex items-center justify-center">{index + 1}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-12 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-6">
        <h3 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-3">Pro Tips</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm text-yellow-800 dark:text-yellow-300">
          <ul className="list-disc list-inside space-y-1">
            <li>Use as your YouTube thumbnail immediately</li>
            <li>Test different versions to see what works best</li>
            <li>Make sure text is readable on mobile devices</li>
          </ul>
          <ul className="list-disc list-inside space-y-1">
            <li>A/B test your thumbnails for better CTR</li>
            <li>Keep important elements away from the edges</li>
            <li>Ensure high contrast for better visibility</li>
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
