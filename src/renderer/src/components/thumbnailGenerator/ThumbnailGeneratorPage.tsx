import { useEffect } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { ThumbnailLanding } from './ThumbnailLanding'
import { ThumbnailPromptInput } from './ThumbnailPromptInput'
import { ThumbnailQuestionFlow } from './ThumbnailQuestionFlow'
import { ThumbnailLoadingScreen } from './ThumbnailLoadingScreen'
import { ThumbnailResultsGrid } from './ThumbnailResultsGrid'
import { ThumbnailHistory } from './ThumbnailHistory'

export function ThumbnailGeneratorPage() {
  const { currentStep, isHistoryView, loadSettings, resetFlow } = useThumbnailStore()

  useEffect(() => {
    loadSettings()
    return () => { resetFlow() }
  }, [loadSettings, resetFlow])

  if (isHistoryView) {
    return (
      <div className="min-h-full p-8">
        <ThumbnailHistory />
      </div>
    )
  }

  const renderStep = () => {
    switch (currentStep) {
      case 'selection': return <ThumbnailLanding />
      case 'input': return <ThumbnailPromptInput />
      case 'questions': return <ThumbnailQuestionFlow />
      case 'loading': return <ThumbnailLoadingScreen />
      case 'results': return <ThumbnailResultsGrid />
      default: return <ThumbnailLanding />
    }
  }

  return (
    <div className="min-h-full p-8">
      {renderStep()}
    </div>
  )
}
