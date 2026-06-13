import { ArrowLeft } from 'lucide-react'

interface BackButtonProps {
  onClick: () => void
  title?: string
}

export function BackButton({ onClick, title = 'Quay lại' }: BackButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 left-6 z-[100] flex items-center justify-center w-10 h-10 rounded-full bg-card border border-border text-text-secondary shadow-xl hover:bg-surface transition-colors"
      title={title}
    >
      <ArrowLeft size={20} />
    </button>
  )
}
