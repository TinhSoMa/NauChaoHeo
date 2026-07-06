import { useState } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { ArrowLeft, ArrowRight, Zap, Upload } from 'lucide-react'

export function ThumbnailPromptInput() {
  const {
    generationMode, prompt, setPrompt, setCurrentStep, resetFlow,
    uploadedImagePath, setUploadedImagePath, imageDescription, setImageDescription,
    enhancePrompt, setEnhancePrompt,
  } = useThumbnailStore()
  const [error, setError] = useState('')

  const handleNext = () => {
    if (generationMode === 'prompt' && !prompt.trim()) {
      setError('Please enter a prompt to generate your thumbnail')
      return
    }
    if (generationMode === 'image' && !uploadedImagePath) {
      setError('Please select an image to continue')
      return
    }
    if (generationMode === 'image' && !imageDescription.trim()) {
      setError('Please provide a description for your thumbnail')
      return
    }
    setError('')
    setCurrentStep('questions')
  }

  const handleSkipToGenerate = () => {
    if (generationMode === 'prompt' && !prompt.trim()) {
      setError('Please enter a prompt')
      return
    }
    if (generationMode === 'image' && !uploadedImagePath) {
      setError('Please select an image')
      return
    }
    if (generationMode === 'image' && !imageDescription.trim()) {
      setError('Please provide a description')
      return
    }
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
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <button
          onClick={resetFlow}
          className="flex items-center text-text-secondary hover:text-text-primary mb-6 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Options
        </button>
        <h2 className="text-3xl font-bold text-text-primary mb-4">
          {generationMode === 'prompt' ? 'Describe Your Thumbnail' : 'Upload Your Image'}
        </h2>
        <p className="text-lg text-text-secondary">
          {generationMode === 'prompt'
            ? 'Tell us what kind of thumbnail you want to create'
            : 'Select an image to use as the base for your thumbnail'}
        </p>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-8">
        {generationMode === 'prompt' ? (
          <div>
            <label className="block text-sm font-medium text-text-primary mb-3">Thumbnail Description</label>
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setError('') }}
              className="w-full h-32 px-4 py-3 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              placeholder="Describe your thumbnail idea... (e.g., 'A futuristic tech thumbnail with neon blue colors')"
            />
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Zap className="w-5 h-5 text-blue-600 mr-2" />
                  <div>
                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-200">AI Prompt Enhancement</h4>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">Let OpenAI improve your prompt for better results</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={enhancePrompt} onChange={(e) => setEnhancePrompt(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex flex-col items-center gap-4 p-8 border-2 border-dashed border-border rounded-lg">
              {uploadedImagePath ? (
                <div className="text-center">
                  <img src={`file://${uploadedImagePath}`} alt="Uploaded" className="max-h-64 rounded-lg mb-4" />
                  <button onClick={() => setUploadedImagePath(null)} className="text-sm text-red-500 hover:underline">Remove</button>
                </div>
              ) : (
                <button onClick={handleSelectImage} className="flex flex-col items-center gap-3 text-text-secondary hover:text-text-primary">
                  <Upload className="w-12 h-12" />
                  <span>Click to select an image</span>
                </button>
              )}
            </div>

            {uploadedImagePath && (
              <div className="mt-6">
                <label className="block text-sm font-medium text-text-primary mb-3">Thumbnail Description</label>
                <textarea
                  value={imageDescription}
                  onChange={(e) => { setImageDescription(e.target.value); setError('') }}
                  className="w-full h-32 px-4 py-3 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="Describe how you want to enhance this image..."
                />
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">{error}</div>}

        <div className="flex items-center justify-between mt-8">
          <button onClick={handleSkipToGenerate} className="text-text-secondary hover:text-text-primary font-medium px-4 py-2 transition-colors">
            Skip Questions & Generate Now
          </button>
          <button
            onClick={handleNext}
            className="bg-primary hover:bg-primary/90 text-white font-medium px-8 py-3 rounded-lg flex items-center transition-colors"
          >
            Next: Customize Style <ArrowRight className="w-5 h-5 ml-2" />
          </button>
        </div>
      </div>
    </div>
  )
}
