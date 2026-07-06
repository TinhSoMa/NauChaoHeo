import { useState } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { ArrowLeft, ArrowRight, CheckCircle, Loader2, Zap, X } from 'lucide-react'

export function ThumbnailQuestionFlow() {
  const {
    currentQuestionIndex, questions, answers,
    setAnswer, removeAnswer, nextQuestion, previousQuestion, skipQuestion,
    resetFlow, generateThumbnails,
  } = useThumbnailStore()
  const [isGenerating, setIsGenerating] = useState(false)

  const currentQuestion = questions[currentQuestionIndex]
  const isLastQuestion = currentQuestionIndex === questions.length - 1
  const currentAnswer = answers[currentQuestion.key as keyof typeof answers]

  const handleAnswerSelect = (value: string) => {
    setAnswer(currentQuestion.key, value)
  }

  const handleNext = () => {
    if (isLastQuestion) {
      handleGenerate()
    } else {
      nextQuestion()
    }
  }

  const handleGenerate = async () => {
    setIsGenerating(true)
    await generateThumbnails()
    setIsGenerating(false)
  }

  const handleSkipAndGenerate = async () => {
    setIsGenerating(true)
    await generateThumbnails()
    setIsGenerating(false)
  }

  const progress = ((currentQuestionIndex + 1) / questions.length) * 100

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <button onClick={resetFlow} disabled={isGenerating} className="flex items-center text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
          <ArrowLeft className="w-5 h-5 mr-2" /> Cancel
        </button>
      </div>

      <div className="mb-8">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-text-primary">Question {currentQuestionIndex + 1} of {questions.length}</span>
          <span className="text-sm text-text-secondary">{Math.round(progress)}% complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-8 mb-6">
        <h2 className="text-xl font-semibold text-text-primary mb-6">{currentQuestion.title}</h2>

        {currentQuestion.isTextInput ? (
          <textarea
            value={currentAnswer || ''}
            onChange={(e) => handleAnswerSelect(e.target.value)}
            className="w-full h-24 px-4 py-3 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder={currentQuestion.placeholder}
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {currentQuestion.options?.map((option) => (
              <button
                key={option}
                onClick={() => handleAnswerSelect(option)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  currentAnswer === option
                    ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/50 hover:bg-surface/50 text-text-primary'
                }`}
              >
                <div className="font-medium text-center">{option}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center">
          {currentQuestionIndex > 0 && (
            <button onClick={previousQuestion} disabled={isGenerating} className="flex items-center text-text-secondary hover:text-text-primary font-medium px-4 py-2 disabled:opacity-50 transition-colors">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleSkipAndGenerate} disabled={isGenerating} className="text-text-secondary hover:text-text-primary font-medium px-4 py-2 disabled:opacity-50 transition-colors">
            Skip & Generate
          </button>
          {currentAnswer ? (
            <button onClick={handleNext} disabled={isGenerating} className="bg-primary hover:bg-primary/90 text-white font-medium px-6 py-3 rounded-lg flex items-center disabled:opacity-50 transition-colors">
              {isGenerating ? (
                <><Loader2 className="animate-spin mr-3 h-4 w-4" /> Generating...</>
              ) : isLastQuestion ? (
                <><Zap className="w-4 h-4 mr-2" /> Generate Thumbnails</>
              ) : (
                <>Next <ArrowRight className="w-4 h-4 ml-2" /></>
              )}
            </button>
          ) : (
            <button onClick={() => skipQuestion()} className="bg-gray-300 hover:bg-gray-400 text-gray-700 font-medium px-6 py-3 rounded-lg transition-colors">
              Skip
            </button>
          )}
        </div>
      </div>

      {Object.values(answers).some(a => a) && (
        <div className="my-8 bg-surface rounded-lg p-8">
          <h3 className="font-semibold text-2xl mb-8 text-text-primary flex items-center justify-center">
            <CheckCircle className="w-5 h-5 mr-2 text-primary" />
            Your Selections
          </h3>
          <div className="flex flex-wrap justify-center gap-4">
            {questions.map((q) => {
              const answer = answers[q.key as keyof typeof answers]
              if (!answer) return null
              const label = q.title.replace('?', '').replace('What ', '').replace('Choose ', '').replace('your ', '').trim()
              return (
                <div key={q.key} className="inline-flex items-center bg-card border border-border rounded-md px-4 py-2 shadow-sm group">
                  <CheckCircle className="w-4 h-4 mr-2 text-primary" />
                  <span className="text-xs font-medium text-text-secondary uppercase tracking-wide mr-2">{label}</span>
                  <span className="text-sm font-medium ml-2 bg-primary/10 text-primary px-4 py-1 rounded-md">{answer.length > 15 ? `${answer.substring(0, 15)}...` : answer}</span>
                  <button onClick={() => removeAnswer(q.key)} className="ml-2 text-text-secondary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
