import { useThumbnailStore } from '../../stores/thumbnailStore'
import { Sparkles, Edit3, Image, ArrowRight, History } from 'lucide-react'

export function ThumbnailLanding() {
  const { setGenerationMode, setCurrentStep, setHistoryView } = useThumbnailStore()

  const handleSelect = (mode: 'prompt' | 'image') => {
    setGenerationMode(mode)
    setCurrentStep('input')
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="relative w-full">
        <div className="text-center mb-12">
          <div className="inline-flex items-center px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full text-primary text-sm font-medium mb-8 shadow-sm border border-border">
            <Sparkles className="w-4 h-4 mr-2" />
            AI-Powered Thumbnail Generation
          </div>
          <h1 className="text-4xl font-bold text-text-primary mb-6">
            Thumbnail Generator
          </h1>
          <p className="text-lg text-text-secondary max-w-3xl mx-auto mb-8">
            Create stunning YouTube thumbnails in seconds using Google Gemini AI
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-8">
          <button
            onClick={() => handleSelect('prompt')}
            className="group bg-card rounded-2xl shadow-lg border border-border hover:border-primary/50 hover:shadow-xl transition-all duration-300 p-10 cursor-pointer"
          >
            <div className="text-center">
              <div className="p-4 w-max bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl mx-auto mb-8 shadow-lg">
                <Edit3 className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-text-primary mb-4">Create from Text</h3>
              <p className="text-text-secondary text-lg mb-8">
                Describe your thumbnail idea and watch AI bring it to life
              </p>
              <div className="flex items-center justify-center text-primary font-semibold text-lg">
                Start Creating <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </button>

          <button
            onClick={() => handleSelect('image')}
            className="group bg-card rounded-2xl shadow-lg border border-border hover:border-purple-500/50 hover:shadow-xl transition-all duration-300 p-10 cursor-pointer"
          >
            <div className="text-center">
              <div className="p-4 w-max bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl mx-auto mb-8 shadow-lg">
                <Image className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-text-primary mb-4">Create from Image</h3>
              <p className="text-text-secondary text-lg mb-8">
                Upload an image and enhance it with AI-powered optimization
              </p>
              <div className="flex items-center justify-center text-purple-500 font-semibold text-lg">
                Start Creating <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </button>
        </div>

        <div className="text-center">
          <button
            onClick={() => setHistoryView(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-surface text-text-primary rounded-lg hover:bg-surface/80 transition-colors"
          >
            <History className="w-5 h-5" />
            View Generation History
          </button>
        </div>
      </div>
    </div>
  )
}
