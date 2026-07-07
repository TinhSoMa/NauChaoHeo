import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TabHost } from './TabHost'
import { useTabManager, TabId } from '../../context/TabContext'
import { ProjectProvider } from '../../context/ProjectContext'

const TAB_BY_PATH: Record<string, TabId> = {
  '/project-home': 'home',
  '/translator': 'translator',
  '/cut-video': 'cutVideo',
  '/story-translator': 'story',
  '/story-summary': 'storySummary',
  '/story-web': 'storyWeb',
  '/gemini-chat': 'gemini',
  '/veo3': 'veo3',
  '/downloader': 'downloader',
  '/thumbnail-generator': 'thumbnail',
  '/settings': 'settings'
}

export const AppLayout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { setActiveTab } = useTabManager()
  const searchParams = new URLSearchParams(location.search)
  const projectId = searchParams.get('projectId')
  const isStoryTranslatorRoute = location.pathname === '/story-translator'

  useEffect(() => {
    const nextTab = TAB_BY_PATH[location.pathname] ?? 'home'
    setActiveTab(nextTab)
  }, [location.pathname, setActiveTab])

  // Tự động mở project cuối cùng nếu chưa có projectId
  useEffect(() => {
    if (projectId) return;
    (async () => {
      try {
        const res = await window.electronAPI.appSettings.getLastActiveProjectId()
        if (res?.success && res.data) {
          navigate(`${location.pathname}?projectId=${encodeURIComponent(res.data)}`, { replace: true })
        }
      } catch {
        // ignore
      }
    })()
  }, []) // chỉ chạy 1 lần lúc mount

  return (
    <ProjectProvider projectId={projectId}>
      <div className="appShell flex h-screen w-screen overflow-hidden text-text-primary">
        <Sidebar />
        <main className="flex-1 overflow-hidden relative">
          <header className="absolute top-0 right-0 p-4 z-10">
            {/* Header Controls (Minimize, Close) if needed, or user profile */}
          </header>
          <div className={`h-full min-h-0 ${isStoryTranslatorRoute ? 'p-0 overflow-hidden' : 'p-8 overflow-auto'}`}>
            <TabHost />
          </div>
        </main>
      </div>
    </ProjectProvider>
  )
}
