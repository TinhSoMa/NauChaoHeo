import { useEffect, useRef, useState } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { Loader2, Info } from 'lucide-react'

const LOADING_STEPS = [
  'Đang phân tích prompt của bạn...',
  'Đang tạo ý tưởng sáng tạo...',
  'Đang áp dụng tùy chọn phong cách...',
  'Đang render thumbnail...',
  'Đang tối ưu cho YouTube...',
  'Đang hoàn thiện thumbnail...',
]

const FUN_FACTS = [
  'Thumbnail có khuôn mặt thường được click nhiều hơn 30%',
  'Màu sắc tươi sáng hoạt động tốt hơn màu tối trên YouTube',
  'Chữ nên dễ đọc ngay cả ở kích thước nhỏ',
  'Thumbnail tốt nhất kể một câu chuyện chỉ trong một cái nhìn',
]

export function ThumbnailLoadingScreen() {
  const { answers, generateThumbnails } = useThumbnailStore()
  const [loadingText, setLoadingText] = useState(LOADING_STEPS[0])
  const [progress, setProgress] = useState(0)
  const [isTextVisible, setIsTextVisible] = useState(true)
  const [funFact] = useState(() => FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)])
  const hasGenerated = useRef(false)

  useEffect(() => {
    let step = 0
    const interval = setInterval(() => {
      if (step < LOADING_STEPS.length - 1) {
        setIsTextVisible(false)
        setTimeout(() => {
          step++
          setLoadingText(LOADING_STEPS[step])
          setProgress((step / (LOADING_STEPS.length - 1)) * 90)
          setIsTextVisible(true)
          if (step >= LOADING_STEPS.length - 1) clearInterval(interval)
        }, 150)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (hasGenerated.current) return
    hasGenerated.current = true
    generateThumbnails()
  }, [generateThumbnails])

  const imageCount = parseInt(answers.imageCount) || 4

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-text-primary mb-2">Đang Tạo Thumbnail</h2>
        <p className="text-sm text-text-secondary">AI đang làm việc để tạo những thumbnail ấn tượng cho bạn</p>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-6 mb-6">
        <div className="flex flex-col items-center mb-4">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-3">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
          <p className={`text-base font-semibold text-text-primary mb-2 transition-opacity duration-150 ${isTextVisible ? 'opacity-100' : 'opacity-0'}`}>
            {loadingText}
          </p>
          <div className="w-full max-w-md bg-gray-200 rounded-full h-2 mb-2">
            <div className="bg-primary h-2 rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-text-muted">{Math.round(progress)}% hoàn thành &middot; thường mất 30-60 giây</p>
        </div>
      </div>

      <div className={`grid gap-4 ${
        imageCount === 1 ? 'grid-cols-1 max-w-md mx-auto' :
        imageCount === 2 ? 'grid-cols-2' :
        'grid-cols-2 lg:grid-cols-3'
      }`}>
        {Array.from({ length: imageCount }, (_, i) => i + 1).map((i) => (
          <div key={i} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <div className="w-full aspect-video bg-surface animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-3 bg-surface rounded animate-pulse w-3/4" />
              <div className="h-2.5 bg-surface rounded animate-pulse w-1/2" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-surface rounded-lg p-4">
        <h3 className="font-semibold text-sm text-text-primary mb-2 flex items-center justify-center gap-1.5">
          <Info className="w-4 h-4 text-primary" />
          Bạn có biết?
        </h3>
        <p className="text-xs text-text-secondary text-center">{funFact}</p>
      </div>
    </div>
  )
}
