import { useThumbnailStore } from '../../stores/thumbnailStore'
import { Sparkles, Edit3, Image, ArrowRight, History, Zap, Layers, Shield } from 'lucide-react'

export function ThumbnailLanding() {
  const { setGenerationMode, setCurrentStep, setHistoryView } = useThumbnailStore()

  const handleSelect = (mode: 'prompt' | 'image') => {
    setGenerationMode(mode)
    setCurrentStep('input')
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center px-3 py-1.5 bg-primary/10 rounded-full text-primary text-xs font-medium mb-4 border border-primary/20">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            Tạo Thumbnail Bằng AI
           </div>
          <h1 className="text-3xl font-bold text-text-primary mb-2">Trình Tạo Thumbnail</h1>
          <p className="text-base text-text-secondary">Tạo thumbnail YouTube ấn tượng trong vài giây với Google Gemini AI</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto mb-6">
          <button
            onClick={() => handleSelect('prompt')}
            className="group bg-card rounded-xl shadow-sm border border-border hover:border-primary/50 hover:shadow-md transition-all p-6 cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-sm shrink-0">
                <Edit3 className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold text-text-primary">Tạo từ Văn Bản</h3>
                <p className="text-sm text-text-secondary mt-0.5">Mô tả ý tưởng thumbnail của bạn</p>
              </div>
              <ArrowRight className="w-5 h-5 text-text-secondary ml-auto group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>

          <button
            onClick={() => handleSelect('image')}
            className="group bg-card rounded-xl shadow-sm border border-border hover:border-purple-500/50 hover:shadow-md transition-all p-6 cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-sm shrink-0">
                <Image className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold text-text-primary">Tạo từ Hình Ảnh</h3>
                <p className="text-sm text-text-secondary mt-0.5">Tải lên và cải thiện hình ảnh</p>
              </div>
              <ArrowRight className="w-5 h-5 text-text-secondary ml-auto group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
        </div>

        <div className="flex items-center justify-center gap-6 mb-6 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-primary" /> Tạo trong 30 giây</span>
          <span className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-primary" /> Đến 4 biến thể</span>
          <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-primary" /> Chất lượng HD</span>
        </div>

        <div className="text-center">
          <button
            onClick={() => setHistoryView(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-surface text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors"
          >
            <History className="w-4 h-4" />
            Xem Lịch Sử Tạo
          </button>
        </div>
      </div>
    </div>
  )
}
