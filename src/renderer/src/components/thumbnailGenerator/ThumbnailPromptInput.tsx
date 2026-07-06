import { useState, useEffect } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { ArrowLeft, ArrowRight, Zap, Upload, X, Trash2 } from 'lucide-react'

export function ThumbnailPromptInput() {
  const {
    generationMode, prompt, setPrompt, setCurrentStep, resetFlow,
    uploadedImagePath, setUploadedImagePath, imageDescription, setImageDescription,
    enhancePrompt, setEnhancePrompt,
  } = useThumbnailStore()
  const [error, setError] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [imageDataUrl, setImageDataUrl] = useState('')

  useEffect(() => {
    if (uploadedImagePath) {
      window.electronAPI.dialog.getImageDataUrl(uploadedImagePath).then(setImageDataUrl)
    } else {
      setImageDataUrl('')
    }
  }, [uploadedImagePath])

  const validate = (): boolean => {
    if (generationMode === 'prompt' && !prompt.trim()) {
      setError('Vui lòng nhập mô tả để tạo thumbnail')
      return false
    }
    if (generationMode === 'image' && !uploadedImagePath) {
      setError('Vui lòng chọn hình ảnh để tiếp tục')
      return false
    }
    if (generationMode === 'image' && !imageDescription.trim()) {
      setError('Vui lòng mô tả thumbnail của bạn')
      return false
    }
    return true
  }

  const handleNext = () => {
    if (!validate()) return
    setError('')
    setCurrentStep('questions')
  }

  const handleSkipToGenerate = () => {
    if (!validate()) return
    setError('')
    useThumbnailStore.getState().generateThumbnails()
  }

  const handleSelectImage = async () => {
    const result = await window.electronAPI.dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result && result.length > 0) {
      setUploadedImagePath(result[0])
      setError('')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setUploadedImagePath((file as any).path || file.name)
      setError('')
    } else {
      setError('Vui lòng thả file hình ảnh hợp lệ (PNG, JPG, WebP)')
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-6">
        <button onClick={resetFlow} className="inline-flex items-center text-text-secondary hover:text-text-primary mb-4 text-sm transition-colors">
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Quay Lại Lựa Chọn
        </button>
        <h2 className="text-2xl font-bold text-text-primary">
          {generationMode === 'prompt' ? 'Mô Tả Thumbnail Của Bạn' : 'Tải Lên Hình Ảnh'}
        </h2>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        {generationMode === 'prompt' ? (
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Mô Tả Thumbnail</label>
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setError('') }}
              className="w-full h-24 px-4 py-3 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
              placeholder="Mô tả ý tưởng thumbnail... (vd: 'Một thumbnail công nghệ tương lai với màu xanh neon')"
            />
            <div className="flex justify-between items-center mt-1.5">
              <span className="text-xs text-text-muted">{prompt.length} ký tự</span>
              <span className="text-xs text-text-muted">Mô tả càng chi tiết càng tốt</span>
            </div>

            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-blue-600 shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-200">Nâng Cao Prompt Bằng AI</h4>
                    <p className="text-xs text-blue-700 dark:text-blue-300">Để AI cải thiện prompt cho kết quả tốt hơn</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" checked={enhancePrompt} onChange={(e) => setEnhancePrompt(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {uploadedImagePath ? (
              <div className="space-y-4">
                <div className="relative bg-surface rounded-lg overflow-hidden border border-border">
                  <img src={imageDataUrl} alt="Uploaded" className="w-full h-48 object-cover" />
                  <button onClick={() => { setUploadedImagePath(null); setError('') }}
                    className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-sm text-text-secondary text-center">
                  <p className="font-medium text-text-primary">{uploadedImagePath.split('\\').pop() || uploadedImagePath.split('/').pop()}</p>
                </div>
                <button onClick={() => { setUploadedImagePath(null); setError('') }}
                  className="w-full text-sm text-red-500 hover:text-red-600 font-medium py-2 border border-red-200 dark:border-red-800 rounded-lg transition-colors flex items-center justify-center gap-2">
                  <Trash2 className="w-4 h-4" /> Xóa Hình Ảnh
                </button>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Mô Tả Thumbnail</label>
                  <textarea
                    value={imageDescription}
                    onChange={(e) => { setImageDescription(e.target.value); setError('') }}
                    className="w-full h-20 px-4 py-3 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
                    placeholder="Mô tả cách bạn muốn cải thiện hình ảnh này..."
                  />
                </div>

                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-purple-600 shrink-0" />
                      <div>
                        <h4 className="text-sm font-medium text-purple-900 dark:text-purple-200">Nâng Cao Bằng AI</h4>
                        <p className="text-xs text-purple-700 dark:text-purple-300">Để AI tự động cải thiện mô tả của bạn</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" checked={enhancePrompt} onChange={(e) => setEnhancePrompt(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600" />
                    </label>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onClick={handleSelectImage}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isDragOver ? 'border-primary bg-primary/5' : 'border-border bg-surface hover:border-primary/50 hover:bg-surface/80'
                }`}
              >
                <div className="space-y-2">
                  <div className="mx-auto w-12 h-12 bg-surface rounded-full flex items-center justify-center border border-border">
                    <Upload className="w-6 h-6 text-text-secondary" />
                  </div>
                  <p className="text-sm font-medium text-text-primary">
                    {isDragOver ? 'Thả hình ảnh vào đây' : 'Kéo & thả hình ảnh vào đây'}
                  </p>
                  <p className="text-xs text-text-muted">hoặc click để duyệt &middot; PNG, JPG, WebP &middot; Tối đa 10MB</p>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">{error}</div>
        )}

        <div className="flex items-center justify-between mt-6">
          <button onClick={handleSkipToGenerate} className="text-sm text-text-secondary hover:text-text-primary font-medium px-3 py-2 transition-colors">
            Bỏ Qua Câu Hỏi & Tạo Ngay
          </button>
          <button onClick={handleNext} className="bg-primary hover:bg-primary/90 text-white text-sm font-medium px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors">
            Tiếp: Tùy Chỉnh Phong Cách <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
