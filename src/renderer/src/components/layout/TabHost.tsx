import React, { Component, Suspense, lazy, type ReactNode } from 'react'
import { useTabManager, TabId } from '../../context/TabContext'

interface TabEntry {
  id: TabId
  element: ReactNode
}

const ProjectHome = lazy(() =>
  import('../project/ProjectHome').then((m) => ({ default: m.ProjectHome }))
)
const CaptionTranslator = lazy(() =>
  import('../caption').then((m) => ({ default: m.CaptionTranslator }))
)
const CutVideo = lazy(() =>
  import('../cutvideo/CutVideo').then((m) => ({ default: m.CutVideo }))
)
const StoryTranslator = lazy(() =>
  import('../story').then((m) => ({ default: m.StoryTranslator }))
)
const StorySummary = lazy(() =>
  import('../story').then((m) => ({ default: m.StorySummary }))
)
const StoryTranslatorWeb = lazy(() =>
  import('../story/StoryTranslatorWeb').then((m) => ({ default: m.StoryTranslatorWeb }))
)
const GeminiChat = lazy(() =>
  import('../gemini').then((m) => ({ default: m.GeminiChat }))
)
const Settings = lazy(() =>
  import('../settings/Settings').then((m) => ({ default: m.Settings }))
)
const Veo3Page = lazy(() =>
  import('../veo3/Veo3Page').then((m) => ({ default: m.Veo3Page }))
)
const DownloaderPage = lazy(() =>
  import('../downloader/DownloaderPage').then((m) => ({ default: m.DownloaderPage }))
)

const TAB_ENTRIES: TabEntry[] = [
  { id: 'home', element: <ProjectHome /> },
  { id: 'translator', element: <CaptionTranslator /> },
  { id: 'cutVideo', element: <CutVideo /> },
  { id: 'story', element: <StoryTranslator /> },
  { id: 'storySummary', element: <StorySummary /> },
  { id: 'storyWeb', element: <StoryTranslatorWeb /> },
  { id: 'gemini', element: <GeminiChat /> },
  { id: 'veo3', element: <Veo3Page /> },
  { id: 'downloader', element: <DownloaderPage /> },
  { id: 'settings', element: <Settings /> }
]

type TabErrorBoundaryProps = {
  resetKey: string
  children: ReactNode
}

type TabErrorBoundaryState = {
  error: Error | null
}

class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  state: TabErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[TabHost] Render error:', error)
  }

  componentDidUpdate(prevProps: TabErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-border bg-card p-6 text-text-primary">
          <div className="text-lg font-semibold">Có lỗi khi hiển thị giao diện.</div>
          <div className="mt-2 text-sm text-text-secondary">
            Vui lòng mở lại tab hoặc khởi động lại ứng dụng.
          </div>
          <pre className="mt-3 max-h-60 overflow-auto rounded-lg bg-surface p-3 text-xs text-text-secondary">
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

export function TabHost() {
  const { activeTabId, openedTabs } = useTabManager()
  const visibleTabs = openedTabs.includes(activeTabId)
    ? openedTabs
    : [...openedTabs, activeTabId]

  return (
    <div className="min-h-full">
      {TAB_ENTRIES.map((tab) => {
        if (!visibleTabs.includes(tab.id)) return null
        const isActive = tab.id === activeTabId
        return (
          <div key={tab.id} className={isActive ? 'block' : 'hidden'}>
            <TabErrorBoundary resetKey={tab.id}>
              <Suspense
                fallback={
                  <div className="rounded-xl border border-border bg-card p-6 text-text-primary">
                    <div className="text-sm text-text-secondary">Đang tải giao diện...</div>
                  </div>
                }
              >
                {tab.element}
              </Suspense>
            </TabErrorBoundary>
          </div>
        )
      })}
    </div>
  )
}
