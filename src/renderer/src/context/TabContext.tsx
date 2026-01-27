import { createContext, useContext, useMemo, useState } from 'react'

export type TabId = 'translator' | 'story' | 'storyWeb' | 'gemini' | 'veo3' | 'settings'

interface TabContextValue {
  activeTabId: TabId
  openedTabs: TabId[]
  setActiveTab: (tabId: TabId) => void
}

const TabContext = createContext<TabContextValue | undefined>(undefined)

export function TabProvider({ children }: { children: React.ReactNode }) {
  const [activeTabId, setActiveTabId] = useState<TabId>('story')
  const [openedTabs, setOpenedTabs] = useState<TabId[]>(['story'])

  const setActiveTab = (tabId: TabId) => {
    setActiveTabId(tabId)
    setOpenedTabs((prev) => (prev.includes(tabId) ? prev : [...prev, tabId]))
  }

  const value = useMemo(
    () => ({ activeTabId, openedTabs, setActiveTab }),
    [activeTabId, openedTabs]
  )

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>
}

export function useTabManager() {
  const ctx = useContext(TabContext)
  if (!ctx) {
    throw new Error('useTabManager phải được dùng bên trong TabProvider')
  }
  return ctx
}
