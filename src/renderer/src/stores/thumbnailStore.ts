import { create } from 'zustand'

export interface ThumbnailAnswers {
  category: string
  mood: string
  theme: string
  primaryColor: string
  includeText: string
  textStyle: string
  thumbnailStyle: string
  customPrompt: string
  imageCount: string
}

export interface ThumbnailStore {
  // Flow
  currentStep: 'selection' | 'input' | 'questions' | 'loading' | 'results'
  generationMode: 'prompt' | 'image' | null
  isHistoryView: boolean

  // Inputs
  prompt: string
  uploadedImagePath: string | null
  imageDescription: string
  enhancePrompt: boolean

  // Questions
  currentQuestionIndex: number
  answers: ThumbnailAnswers
  questions: QuestionDef[]

  // Results
  generatedImages: string[]
  isGenerating: boolean
  error: string | null
  finalPrompt: string
  isEnhanced: boolean

  // History
  history: any[]
  totalHistory: number
  hasMoreHistory: boolean
  historyPage: number
  itemsPerPage: number
  sortBy: 'newest' | 'oldest'
  selectedIds: Set<string>
  isSelectMode: boolean
  isDownloadingZip: boolean

  // Settings
  outputDir: string

  // Actions
  setCurrentStep: (step: ThumbnailStore['currentStep']) => void
  setGenerationMode: (mode: ThumbnailStore['generationMode']) => void
  setPrompt: (prompt: string) => void
  setUploadedImagePath: (path: string | null) => void
  setImageDescription: (desc: string) => void
  setEnhancePrompt: (enhance: boolean) => void
  setAnswer: (key: string, value: string) => void
  removeAnswer: (key: string) => void
  nextQuestion: () => void
  previousQuestion: () => void
  skipQuestion: () => void
  resetFlow: () => void
  setHistoryView: (view: boolean) => void

  generateThumbnails: () => Promise<void>
  downloadImage: (filePath: string) => Promise<void>
  downloadAll: () => Promise<void>
  fetchHistory: (page?: number) => Promise<void>
  deleteHistoryEntry: (id: string) => Promise<void>
  clearHistory: () => Promise<void>
  loadSettings: () => Promise<void>
  updateSettings: (outputDir: string) => Promise<void>

  // History selection
  toggleSelectId: (id: string) => void
  toggleSelectAll: () => void
  clearSelection: () => void
  setSortBy: (sort: 'newest' | 'oldest') => void
  setItemsPerPage: (n: number) => void
  setHistoryPage: (page: number) => void
  bulkExportSelected: () => Promise<void>
}

interface QuestionDef {
  key: string
  title: string
  options?: string[]
  isTextInput?: boolean
  placeholder?: string
}

const DEFAULT_ANSWERS: ThumbnailAnswers = {
  category: '',
  mood: '',
  theme: '',
  primaryColor: '',
  includeText: '',
  textStyle: '',
  thumbnailStyle: '',
  customPrompt: '',
  imageCount: '1',
}

const DEFAULT_QUESTIONS: QuestionDef[] = [
  { key: 'category', title: 'Thể loại nội dung của bạn là gì?', options: ['Công Nghệ', 'Game', 'Vlog', 'Hướng Dẫn', 'Giải Trí', 'Tin Tức'] },
  { key: 'mood', title: 'Bạn muốn truyền tải tâm trạng gì?', options: ['Phấn Khích', 'Nghiêm Túc', 'Vui Vẻ', 'Chuyên Nghiệp', 'Bí Ẩn', 'Năng Động'] },
  { key: 'theme', title: 'Bạn thích chủ đề nào?', options: ['Sáng Sủa', 'Tối', 'Nhiều Màu', 'Tối Giản', 'Chuyển Màu', 'Neon'] },
  { key: 'primaryColor', title: 'Chọn màu chủ đạo', options: ['Đỏ', 'Xanh Dương', 'Xanh Lá', 'Tím', 'Cam', 'Vàng', 'Hồng', 'Xanh Cyan'] },
  { key: 'includeText', title: 'Có chữ trong thumbnail không?', options: ['Có', 'Không'] },
  { key: 'textStyle', title: 'Bạn thích kiểu chữ nào?', options: ['Đậm', 'Tối Giản', 'Cầu Kỳ', 'Viền', 'Đổ Bóng', 'Chuyển Màu'] },
  { key: 'thumbnailStyle', title: 'Bạn muốn phong cách thumbnail nào?', options: ['Siêu Thực', 'Hoạt Hình', 'Tối Giản', 'Nghệ Thuật', 'Hiện Đại', 'Cổ Điển'] },
  { key: 'customPrompt', title: 'Có yêu cầu bổ sung nào không?', isTextInput: true, placeholder: 'Tùy chọn: Thêm chi tiết hoặc yêu cầu cụ thể...' },
  { key: 'imageCount', title: 'Bạn muốn tạo bao nhiêu thumbnail?', options: ['1', '2'] },
]

export const useThumbnailStore = create<ThumbnailStore>((set, get) => ({
  currentStep: 'selection',
  generationMode: null,
  isHistoryView: false,

  prompt: '',
  uploadedImagePath: null,
  imageDescription: '',
  enhancePrompt: false,

  currentQuestionIndex: 0,
  answers: { ...DEFAULT_ANSWERS },
  questions: DEFAULT_QUESTIONS,

  generatedImages: [],
  isGenerating: false,
  error: null,
  finalPrompt: '',
  isEnhanced: false,

  history: [],
  totalHistory: 0,
  hasMoreHistory: false,
  historyPage: 0,
  itemsPerPage: 12,
  sortBy: 'newest',
  selectedIds: new Set<string>(),
  isSelectMode: false,
  isDownloadingZip: false,

  outputDir: '',

  setCurrentStep: (step) => set({ currentStep: step }),
  setGenerationMode: (mode) => set({ generationMode: mode }),
  setPrompt: (prompt) => set({ prompt }),
  setUploadedImagePath: (path) => set({ uploadedImagePath: path }),
  setImageDescription: (desc) => set({ imageDescription: desc }),
  setEnhancePrompt: (enhance) => set({ enhancePrompt: enhance }),

  setAnswer: (key, value) => set((state) => ({
    answers: { ...state.answers, [key]: value },
  })),

  removeAnswer: (key) => set((state) => ({
    answers: { ...state.answers, [key]: '' },
  })),

  nextQuestion: () => {
    const state = get()
    let nextIndex = state.currentQuestionIndex + 1
    const questions = state.questions
    if (nextIndex < questions.length && questions[nextIndex].key === 'textStyle' && state.answers.includeText === 'No') {
      nextIndex += 1
    }
    set({ currentQuestionIndex: Math.min(nextIndex, questions.length - 1) })
  },

  previousQuestion: () => {
    const state = get()
    let prevIndex = state.currentQuestionIndex - 1
    const questions = state.questions
    if (prevIndex >= 0 && questions[prevIndex].key === 'textStyle' && state.answers.includeText === 'No') {
      prevIndex -= 1
    }
    set({ currentQuestionIndex: Math.max(prevIndex, 0) })
  },

  skipQuestion: () => {
    const state = get()
    if (state.currentQuestionIndex < state.questions.length - 1) {
      set({ currentQuestionIndex: state.currentQuestionIndex + 1 })
    } else {
      set({ currentStep: 'loading' })
    }
  },

  resetFlow: () => set({
    currentStep: 'selection',
    generationMode: null,
    prompt: '',
    uploadedImagePath: null,
    imageDescription: '',
    enhancePrompt: false,
    currentQuestionIndex: 0,
    answers: { ...DEFAULT_ANSWERS },
    generatedImages: [],
    isGenerating: false,
    error: null,
    finalPrompt: '',
    isEnhanced: false,
  }),

  setHistoryView: (view) => set({ isHistoryView: view }),

  generateThumbnails: async () => {
    const state = get()
    set({ isGenerating: true, error: null, currentStep: 'loading' })

    const options: any = {
      prompt: state.generationMode === 'image' ? state.imageDescription : state.prompt,
      enhancePrompt: state.enhancePrompt,
      imageCount: parseInt(state.answers.imageCount) || 1,
      category: state.answers.category || undefined,
      mood: state.answers.mood || undefined,
      theme: state.answers.theme || undefined,
      primaryColor: state.answers.primaryColor || undefined,
      includeText: state.answers.includeText === 'Yes' || undefined,
      textStyle: state.answers.textStyle || undefined,
      thumbnailStyle: state.answers.thumbnailStyle || undefined,
      customPrompt: state.answers.customPrompt || undefined,
    }

    try {
      let result
      if (state.generationMode === 'image' && state.uploadedImagePath) {
        result = await window.electronAPI.thumbnailGenerator.generateFromImage(state.uploadedImagePath, options)
      } else {
        result = await window.electronAPI.thumbnailGenerator.generate(options)
      }

      const finalPrompt = result.data?.finalPrompt || ''
      const enhanced = result.data?.enhanced || false

      if (result.success && result.data) {
        set({
          generatedImages: result.data.imagePaths,
          finalPrompt,
          isEnhanced: enhanced,
          isGenerating: false,
          currentStep: 'results',
        })
      } else {
        set({
          finalPrompt,
          isEnhanced: enhanced,
          isGenerating: false,
          error: result.error || 'Tạo thất bại',
          currentStep: 'results',
        })
      }
    } catch (err: any) {
      set({ isGenerating: false, finalPrompt: '', isEnhanced: false, error: err.message || 'Tạo thất bại', currentStep: 'results' })
    }
  },

  downloadImage: async (filePath: string) => {
    try {
      await window.electronAPI.dialog.showOpenDialog({
        defaultPath: filePath,
        properties: ['openFile'],
      })
    } catch (err) {
      console.error('Download failed:', err)
    }
  },

  downloadAll: async () => {
    // No-op for now; individual downloads via file explorer
  },

  fetchHistory: async (page = 0) => {
    try {
      const limit = get().itemsPerPage
      const offset = page * limit
      const result = await window.electronAPI.thumbnailGenerator.getHistory(limit, offset)
      if (result.success && result.data) {
        set({
          history: result.data.entries,
          totalHistory: result.data.total,
          hasMoreHistory: result.data.hasMore,
          historyPage: page,
        })
      }
    } catch (err) {
      console.error('Fetch history failed:', err)
    }
  },

  deleteHistoryEntry: async (id: string) => {
    try {
      await window.electronAPI.thumbnailGenerator.deleteHistoryEntry(id)
      get().fetchHistory(get().historyPage)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  },

  clearHistory: async () => {
    try {
      await window.electronAPI.thumbnailGenerator.clearHistory()
      set({ history: [], totalHistory: 0, hasMoreHistory: false, historyPage: 0, selectedIds: new Set() })
    } catch (err) {
      console.error('Clear history failed:', err)
    }
  },

  toggleSelectId: (id) => set((state) => {
    const next = new Set(state.selectedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    return { selectedIds: next, isSelectMode: next.size > 0 }
  }),

  toggleSelectAll: () => set((state) => {
    const allSelected = state.history.length > 0 && state.history.every((e: any) => state.selectedIds.has(e.id))
    if (allSelected) return { selectedIds: new Set(), isSelectMode: false }
    return { selectedIds: new Set(state.history.map((e: any) => e.id)), isSelectMode: true }
  }),

  clearSelection: () => set({ selectedIds: new Set(), isSelectMode: false }),

  setSortBy: (sort) => set({ sortBy: sort }),
  setItemsPerPage: (n) => { set({ itemsPerPage: n, historyPage: 0 }); get().fetchHistory(0) },
  setHistoryPage: (page) => { set({ historyPage: page }); get().fetchHistory(page) },

  bulkExportSelected: async () => {
    const { selectedIds, history } = get()
    const selectedEntries = history.filter((e: any) => selectedIds.has(e.id))
    const allPaths = selectedEntries.flatMap((e: any) => e.imagePaths || [])
    if (allPaths.length === 0) return

    set({ isDownloadingZip: true })
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      await Promise.all(allPaths.map(async (path: string) => {
        try {
          const resp = await fetch(path.startsWith('file://') ? path : `file://${path}`)
          const blob = await resp.blob()
          zip.file(path.split(/[\\/]/).pop() || `thumb-${Date.now()}.png`, blob)
        } catch { /* skip failed */ }
      }))
      const blob = await zip.generateAsync({ type: 'blob' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `selected-thumbnails-${Date.now()}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)
    } catch (err) {
      console.error('Bulk export failed:', err)
    } finally {
      set({ isDownloadingZip: false })
    }
  },

  loadSettings: async () => {
    try {
      const result = await window.electronAPI.thumbnailGenerator.getSettings()
      if (result.success && result.data) {
        set({ outputDir: result.data.outputDir })
      }
    } catch (err) {
      console.error('Load settings failed:', err)
    }
  },

  updateSettings: async (outputDir: string) => {
    try {
      await window.electronAPI.thumbnailGenerator.updateSettings({ outputDir })
      set({ outputDir })
    } catch (err) {
      console.error('Update settings failed:', err)
    }
  },
}))
