import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TabHost } from './TabHost'
import { useTabManager, TabId } from '../../context/TabContext'
import { ProjectProvider } from '../../context/ProjectContext'

const TAB_BY_PATH: Record<string, TabId> = {
  '/translator': 'translator',
  '/story-translator': 'story',
  '/story-web': 'storyWeb',
  '/gemini-chat': 'gemini',
  '/veo3': 'veo3',
  '/settings': 'settings'
}

export const AppLayout = () => {
  const location = useLocation()
  const { setActiveTab } = useTabManager()
  const searchParams = new URLSearchParams(location.search)
  const projectId = searchParams.get('projectId')

  useEffect(() => {
    const nextTab = TAB_BY_PATH[location.pathname] ?? 'story'
    setActiveTab(nextTab)
  }, [location.pathname, setActiveTab])

  return (
    <ProjectProvider projectId={projectId}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-text-primary">
        <Sidebar />
        <main className="flex-1 overflow-auto relative">
          <header className="absolute top-0 right-0 p-4 z-10">
            {/* Header Controls (Minimize, Close) if needed, or user profile */}
          </header>
          <div className="p-8 min-h-full">
            <TabHost />
          </div>
        </main>
      </div>
    </ProjectProvider>
  )
}
