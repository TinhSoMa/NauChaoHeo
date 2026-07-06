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
    <div className="max-w-3xl mx-auto">
      <div className="mb-3">
        <button onClick={resetFlow} disabled={isGenerating} className="inline-flex items-center text-text-secondary hover:text-text-primary disabled:opacity-50 text-sm transition-colors">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Hủy
        </button>
      </div>

      <div className="mb-4">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs font-medium text-text-primary">Câu hỏi {currentQuestionIndex + 1} / {questions.length}</span>
          <span className="text-xs text-text-secondary">{Math.round(progress)}% hoàn thành</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-6 mb-4">
        <h2 className="text-lg font-semibold text-text-primary mb-4">{currentQuestion.title}</h2>

        {currentQuestion.isTextInput ? (
          <textarea
            value={currentAnswer || ''}
            onChange={(e) => handleAnswerSelect(e.target.value)}
            className="w-full h-20 px-4 py-3 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
            placeholder={currentQuestion.placeholder}
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {currentQuestion.options?.map((option) => (
              <button
                key={option}
                onClick={() => handleAnswerSelect(option)}
                className={`p-3 rounded-lg border-2 transition-all text-sm ${
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
        <div>
          {currentQuestionIndex > 0 && (
            <button onClick={previousQuestion} disabled={isGenerating} className="flex items-center text-text-secondary hover:text-text-primary text-sm font-medium px-3 py-2 disabled:opacity-50 transition-colors">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Quay Lại
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
            <button onClick={handleSkipAndGenerate} disabled={isGenerating} className="text-xs text-text-secondary hover:text-text-primary font-medium px-3 py-2 disabled:opacity-50 transition-colors">
            Bỏ Qua & Tạo
          </button>
          {currentAnswer ? (
            <button onClick={handleNext} disabled={isGenerating} className="bg-primary hover:bg-primary/90 text-white text-sm font-medium px-5 py-2.5 rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors">
              {isGenerating ? (
                <><Loader2 className="animate-spin h-4 w-4" /> Đang tạo...</>
              ) : isLastQuestion ? (
                <><Zap className="w-4 h-4" /> Tạo Thumbnail</>
              ) : (
                <>Tiếp <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          ) : (
            <button onClick={() => skipQuestion()} className="bg-gray-300 hover:bg-gray-400 text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
              Bỏ Qua
            </button>
          )}
        </div>
      </div>

      {Object.values(answers).some(a => a) && (
        <div className="mt-6 bg-surface rounded-lg p-4">
          <h3 className="font-semibold text-base text-text-primary flex items-center justify-center mb-4">
            <CheckCircle className="w-4 h-4 mr-1.5 text-primary" />
            Lựa Chọn Của Bạn
          </h3>
          <div className="flex flex-wrap justify-center gap-2">
            {questions.map((q) => {
              const answer = answers[q.key as keyof typeof answers]
              if (!answer) return null
              const labelMap: Record<string, string> = {
                category: 'Thể Loại', mood: 'Tâm Trạng', theme: 'Chủ Đề',
                primaryColor: 'Màu Sắc', includeText: 'Chữ', textStyle: 'Kiểu Chữ',
                thumbnailStyle: 'Phong Cách', customPrompt: 'Yêu Cầu', imageCount: 'Số Lượng',
              }
              const label = labelMap[q.key] || q.key
              return (
                <div key={q.key} className="inline-flex items-center bg-card border border-border rounded-md px-3 py-1.5 shadow-sm group">
                  <CheckCircle className="w-3.5 h-3.5 mr-1.5 text-primary" />
                  <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wide mr-1.5">{label}</span>
                  <span className="text-xs font-medium ml-1 bg-primary/10 text-primary px-2.5 py-0.5 rounded-md">{answer.length > 15 ? `${answer.substring(0, 15)}...` : answer}</span>
                  <button onClick={() => removeAnswer(q.key)} className="ml-1.5 text-text-secondary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                    <X className="w-3.5 h-3.5" />
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
