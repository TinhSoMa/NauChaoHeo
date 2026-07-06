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

  // History
  history: any[]
  totalHistory: number
  hasMoreHistory: boolean
  historyPage: number

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
  { key: 'category', title: 'What category is your content?', options: ['Tech', 'Gaming', 'Vlog', 'Tutorial', 'Entertainment', 'News'] },
  { key: 'mood', title: 'What mood do you want to convey?', options: ['Excited', 'Serious', 'Fun', 'Professional', 'Mysterious', 'Energetic'] },
  { key: 'theme', title: 'What theme do you prefer?', options: ['Bright', 'Dark', 'Colorful', 'Minimalist', 'Gradient', 'Neon'] },
  { key: 'primaryColor', title: 'Choose a primary color', options: ['Red', 'Blue', 'Green', 'Purple', 'Orange', 'Yellow', 'Pink', 'Cyan'] },
  { key: 'includeText', title: 'Include text in thumbnail?', options: ['Yes', 'No'] },
  { key: 'textStyle', title: 'What text style do you prefer?', options: ['Bold', 'Minimal', 'Fancy', 'Outlined', 'Shadow', 'Gradient'] },
  { key: 'thumbnailStyle', title: 'What thumbnail style do you want?', options: ['Photo-realistic', 'Cartoonish', 'Minimalistic', 'Artistic', 'Modern', 'Vintage'] },
  { key: 'customPrompt', title: 'Any additional requirements?', isTextInput: true, placeholder: 'Optional: Add any specific details or requirements...' },
  { key: 'imageCount', title: 'How many thumbnails do you want?', options: ['1', '2'] },
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

  history: [],
  totalHistory: 0,
  hasMoreHistory: false,
  historyPage: 0,

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

      if (result.success && result.data) {
        set({
          generatedImages: result.data.imagePaths,
          isGenerating: false,
          currentStep: 'results',
        })
      } else {
        set({ isGenerating: false, error: result.error || 'Generation failed', currentStep: 'results' })
      }
    } catch (err: any) {
      set({ isGenerating: false, error: err.message || 'Generation failed', currentStep: 'results' })
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
      const limit = 20
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
      set({ history: [], totalHistory: 0, hasMoreHistory: false, historyPage: 0 })
    } catch (err) {
      console.error('Clear history failed:', err)
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
