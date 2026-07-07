import { useEffect, useState, useRef } from 'react'
import { useThumbnailStore } from '../../stores/thumbnailStore'
import { ArrowLeft, Download, Eye, Trash2, Search, Loader2, ChevronLeft, ChevronRight, CheckSquare, Square, DownloadCloud, Trash, X, Calendar } from 'lucide-react'

export function ThumbnailHistory() {
  const {
    history, totalHistory, hasMoreHistory, historyPage, selectedIds, isSelectMode, sortBy, itemsPerPage, isDownloadingZip,
    fetchHistory, deleteHistoryEntry, setHistoryView, downloadImage,
    toggleSelectId, toggleSelectAll, clearSelection, setSortBy, setItemsPerPage, setHistoryPage, bulkExportSelected,
  } = useThumbnailStore()

  const [filter, setFilter] = useState<'all' | 'text-to-image' | 'image-to-image'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, string>>({})

  useEffect(() => { fetchHistory(0) }, [fetchHistory])

  const totalPages = Math.max(1, Math.ceil(totalHistory / itemsPerPage))

  const filteredHistory = history.filter((item: any) => {
    if (filter !== 'all' && item.type !== filter) return false
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      return (item.originalPrompt || '').toLowerCase().includes(s) || (item.category || '').toLowerCase().includes(s) || (item.mood || '').toLowerCase().includes(s)
    }
    return true
  })

  const sortedHistory = [...filteredHistory].sort((a: any, b: any) =>
    sortBy === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
  )

  const loadedPathsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const allPaths = sortedHistory.flatMap((item: any) => item.imagePaths || [])
    allPaths.forEach(async (path: string) => {
      if (!path || loadedPathsRef.current.has(path)) return
      loadedPathsRef.current.add(path)
      try {
        const dataUrl = await window.electronAPI.dialog.getImageDataUrl(path)
        if (dataUrl) setImageDataUrls(prev => ({ ...prev, [path]: dataUrl }))
      } catch { /* skip */ }
    })
  }, [sortedHistory])

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString('vi-VN', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const previewImage = (path: string) => {
    const src = path.startsWith('file://') ? path : `file://${path}`
    window.open(src, '_blank')
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const totalImagesInView = history.reduce((sum: number, item: any) => sum + (item.imagePaths?.length || 0), 0)

  const pageNumbers: number[] = []
  const maxVisible = 5
  let start = Math.max(0, historyPage - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages, start + maxVisible)
  if (end - start < maxVisible) start = Math.max(0, end - maxVisible)
  for (let i = start; i < end; i++) pageNumbers.push(i)

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-4">
        <button onClick={() => setHistoryView(false)} className="flex items-center text-text-secondary hover:text-text-primary mb-3 transition-colors text-sm">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Quay Lại
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Lịch Sử Tạo</h1>
            <p className="text-xs text-text-secondary mt-0.5">Đã tạo {totalHistory} thumbnail</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
              className="text-xs border border-border rounded-lg bg-surface text-text-primary px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="newest">Mới Nhất</option>
              <option value="oldest">Cũ Nhất</option>
            </select>
            <select value={itemsPerPage} onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="text-xs border border-border rounded-lg bg-surface text-text-primary px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary">
              <option value={5}>5 / trang</option>
              <option value={10}>10 / trang</option>
              <option value={20}>20 / trang</option>
              <option value={50}>50 / trang</option>
            </select>
          </div>
        </div>
      </div>

      {totalHistory > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-card rounded-lg border border-border p-3">
            <p className="text-xs text-text-secondary">Tổng Phiên</p>
            <p className="text-lg font-bold text-text-primary">{totalHistory}</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-3">
            <p className="text-xs text-text-secondary">Hình Ảnh</p>
            <p className="text-lg font-bold text-text-primary">{totalImagesInView}</p>
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg border border-border p-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary w-3.5 h-3.5" />
            <input type="text" placeholder="Tìm kiếm prompt, thể loại, tâm trạng..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-8 py-2 text-sm border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary" />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)}
            className="text-xs border border-border rounded-lg bg-surface text-text-primary px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary min-w-[120px] appearance-none">
            <option value="all">Tất Cả</option>
            <option value="text-to-image">Từ Văn Bản</option>
            <option value="image-to-image">Từ Hình Ảnh</option>
          </select>
          <button onClick={() => isSelectMode ? clearSelection() : toggleSelectAll()}
            className="text-xs text-text-secondary hover:text-text-primary px-2.5 py-2 rounded-lg border border-border hover:bg-surface transition-colors flex items-center gap-1.5">
            {isSelectMode ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
            {isSelectMode ? 'Bỏ Chọn' : 'Chọn'}
          </button>
          {isSelectMode && (
            <>
              <button onClick={bulkExportSelected} disabled={selectedIds.size === 0 || isDownloadingZip}
                className="text-xs text-white bg-primary hover:bg-primary/90 disabled:bg-primary/50 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5">
                {isDownloadingZip ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DownloadCloud className="w-3.5 h-3.5" />}
                ZIP ({selectedIds.size})
              </button>
              <button onClick={async () => { if (confirm(`Xóa ${selectedIds.size} mục đã chọn?`)) { for (const id of selectedIds) await deleteHistoryEntry(id); clearSelection() } }}
                className="text-xs text-red-500 hover:text-red-700 border border-red-200 dark:border-red-900/30 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-1.5">
                <Trash className="w-3.5 h-3.5" /> Xóa
              </button>
            </>
          )}
        </div>
      </div>

      {sortedHistory.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <Eye className="w-5 h-5 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary mb-1">
            {searchTerm || filter !== 'all' ? 'Không tìm thấy kết quả' : 'Chưa có thumbnail nào'}
          </h3>
          <button onClick={() => setHistoryView(false)} className="bg-primary hover:bg-primary/90 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors mt-2">
            Tạo Thumbnail Đầu Tiên
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedHistory.map((item: any) => {
            const isSelected = selectedIds.has(item.id)
            const isExpanded = expandedIds.has(item.id)
            return (
              <div key={item.id} className={`bg-card rounded-lg border ${isSelected ? 'border-primary' : 'border-border'} overflow-hidden transition-colors`}>
                <div className="px-4 py-3 bg-surface/50 border-b border-border">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <button onClick={() => toggleSelectId(item.id)} className="shrink-0 text-text-secondary hover:text-text-primary transition-colors">
                        {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                      </button>
                      <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${item.type === 'image-to-image' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                        {item.type === 'image-to-image' ? 'Hình Ảnh' : 'Văn Bản'}
                      </span>
                      {item.enhancedPrompt && (
                        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gradient-to-r from-violet-100 to-purple-100 text-violet-800 dark:from-violet-900/30 dark:to-purple-900/30 dark:text-violet-300">
                          AI
                        </span>
                      )}
                      <div className="flex flex-col min-w-0">
                        <p className={`text-sm font-medium text-text-primary ${isExpanded ? '' : 'truncate'}`}>{item.originalPrompt}</p>
                        {item.originalPrompt && item.originalPrompt.length > 60 && (
                          <button onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id) }} className="text-[10px] text-primary hover:text-primary/80 mt-0.5 text-left">
                            {isExpanded ? 'Thu gọn' : 'Xem thêm'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-text-secondary flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(item.createdAt)}</span>
                      <button onClick={() => deleteHistoryEntry(item.id)} className="text-text-secondary hover:text-red-500 transition-colors p-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
                    {item.imagePaths?.map((path: string, idx: number) => {
                      const src = imageDataUrls[path] || ''
                      return (
                        <div key={idx} className="group relative bg-surface rounded-lg overflow-hidden border border-border">
                          <div className="aspect-video">
                            <img src={src} alt={`Thumbnail ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              onError={(e) => { e.currentTarget.src = '' }} />
                          </div>
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                              <span className="text-white text-[10px] font-medium bg-black/40 px-1.5 py-0.5 rounded">#{idx + 1}</span>
                              <div className="flex gap-1">
                                <button onClick={() => previewImage(path)} className="bg-white/90 hover:bg-white text-gray-900 p-1 rounded transition-transform hover:scale-110">
                                  <Eye className="w-3 h-3" />
                                </button>
                                <button onClick={() => downloadImage(path)} className="bg-primary hover:bg-primary/90 text-white p-1 rounded transition-transform hover:scale-110">
                                  <Download className="w-3 h-3" />
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
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <span className="text-[11px] text-text-secondary">
          {totalHistory > 0 ? `Trang ${historyPage + 1} / ${totalPages} (${totalHistory} tổng)` : 'Không có mục nào'}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setHistoryPage(0)} disabled={historyPage === 0}
            className="p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          {pageNumbers.map((n) => (
            <button key={n} onClick={() => setHistoryPage(n)}
              className={`min-w-[28px] h-7 text-xs font-medium rounded-md transition-colors ${n === historyPage ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-surface'}`}>
              {n + 1}
            </button>
          ))}
          <button onClick={() => hasMoreHistory && setHistoryPage(historyPage + 1)} disabled={!hasMoreHistory}
            className="p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
