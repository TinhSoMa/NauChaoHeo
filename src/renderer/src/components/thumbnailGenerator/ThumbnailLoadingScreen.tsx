import { Sparkles } from 'lucide-react'

export function ThumbnailLoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="relative">
        <div className="w-20 h-20 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-primary" />
      </div>
      <h2 className="text-2xl font-bold text-text-primary">Generating Your Thumbnails...</h2>
      <p className="text-text-secondary text-lg">This may take 30-60 seconds</p>
      <div className="flex gap-2 mt-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  )
}
