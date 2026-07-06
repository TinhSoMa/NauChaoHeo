import { useEffect, useState } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { ArrowLeft, Download, Eye, Trash2, Calendar, Image, Type, Camera, Search, Filter } from 'lucide-react'

export function ThumbnailHistory() {
  const { history, hasMoreHistory, historyPage, fetchHistory, deleteHistoryEntry, setHistoryView, downloadImage } = useThumbnailStore()
  const [filter, setFilter] = useState<'all' | 'text-to-image' | 'image-to-image'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchHistory(0)
  }, [fetchHistory])

  const filteredHistory = history.filter((item) => {
    if (filter !== 'all' && item.type !== filter) return false
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      return (item.originalPrompt || '').toLowerCase().includes(s) || (item.category || '').toLowerCase().includes(s) || (item.mood || '').toLowerCase().includes(s)
    }
    return true
  })

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <button onClick={() => setHistoryView(false)} className="flex items-center text-text-secondary hover:text-text-primary mb-6 transition-colors">
          <ArrowLeft className="w-5 h-5 mr-2" /> Back to Generator
        </button>
        <h1 className="text-4xl font-bold text-text-primary mb-3">Generation History</h1>
        <p className="text-lg text-text-secondary">Manage your AI-generated thumbnails</p>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border p-6 mb-8">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary w-5 h-5" />
            <input type="text" placeholder="Search prompts, categories, moods..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary w-4 h-4" />
            <select value={filter} onChange={(e) => setFilter(e.target.value as any)}
              className="pl-10 pr-8 py-3 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary min-w-[160px] appearance-none">
              <option value="all">All Types</option>
              <option value="text-to-image">From Prompt</option>
              <option value="image-to-image">From Image</option>
            </select>
          </div>
        </div>
      </div>

      {filteredHistory.length === 0 ? (
        <div className="text-center py-16">
          <Image className="w-16 h-16 text-text-secondary mx-auto mb-4" />
          <h3 className="text-2xl font-semibold text-text-primary mb-3">No thumbnails generated yet</h3>
          <button onClick={() => setHistoryView(false)} className="bg-primary hover:bg-primary/90 text-white font-medium px-8 py-4 rounded-lg transition-colors text-lg">
            Generate Your First Thumbnail
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredHistory.map((item: any) => (
            <div key={item.id} className="bg-card rounded-2xl shadow-lg border border-border overflow-hidden">
              <div className="px-8 py-6 bg-gradient-to-r from-surface to-card border-b border-border">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold ${item.type === 'image-to-image' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                        {item.type === 'image-to-image' ? <><Camera className="w-4 h-4 mr-1.5" /> Image to Image</> : <><Type className="w-4 h-4 mr-1.5" /> Text to Image</>}
                      </span>
                      {item.enhancedPrompt && (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-gradient-to-r from-violet-100 to-purple-100 text-violet-800 dark:from-violet-900/30 dark:to-purple-900/30 dark:text-violet-300">
                          AI Enhanced
                        </span>
                      )}
                      <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                        {item.imagesGenerated} Generated
                      </span>
                    </div>
                    <p className="text-lg font-medium text-text-primary">{item.originalPrompt}</p>
                    <div className="flex items-center gap-4 text-sm text-text-secondary">
                      <span className="flex items-center"><Calendar className="w-4 h-4 mr-1.5" /> {formatDate(item.createdAt)}</span>
                    </div>
                  </div>
                  <button onClick={() => deleteHistoryEntry(item.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 p-2.5 rounded-lg transition-all">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="px-8 py-6">
                <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                  {item.imagePaths?.map((path: string, idx: number) => {
                    const src = path.startsWith('file://') ? path : `file://${path}`
                    return (
                      <div key={idx} className="group relative bg-surface rounded-xl overflow-hidden shadow-sm border border-border">
                        <div className="aspect-video">
                          <img src={src} alt={`Thumbnail ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            onError={(e) => { e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" fill="%236366f1"><rect width="400" height="225"/><text x="50%" y="50%" fill="white" text-anchor="middle" dy=".3em">Error</text></svg>' }} />
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                            <span className="text-white text-sm font-medium">#{idx + 1}</span>
                            <div className="flex gap-2">
                              <button onClick={() => window.open(src, '_blank')} className="bg-white/90 hover:bg-white text-gray-900 p-2 rounded-lg transition-transform hover:scale-110">
                                <Eye className="w-4 h-4" />
                              </button>
                              <button onClick={() => downloadImage(path)} className="bg-primary hover:bg-primary/90 text-white p-2 rounded-lg transition-transform hover:scale-110">
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMoreHistory && (
        <div className="text-center mt-8">
          <button onClick={() => fetchHistory(historyPage + 1)} className="bg-surface hover:bg-surface/80 text-text-primary font-medium px-6 py-3 rounded-lg transition-colors">
            Load More
          </button>
        </div>
      )}
    </div>
  )
}
