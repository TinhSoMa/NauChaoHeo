import type { ReactNode } from 'react'
import { CaptionTranslator, CaptionVideo } from '../caption'
import { StoryTranslator, StorySummary } from '../story'
import { StoryTranslatorWeb } from '../story/StoryTranslatorWeb'
import { GeminiChat } from '../gemini'
import { Settings } from '../settings/Settings'
import { Veo3Page } from '../veo3/Veo3Page'
import { useTabManager, TabId } from '../../context/TabContext'

interface TabEntry {
  id: TabId
  element: ReactNode
}

const TAB_ENTRIES: TabEntry[] = [
  { id: 'translator', element: <CaptionTranslator /> },
  { id: 'captionVideo', element: <CaptionVideo /> },
  { id: 'story', element: <StoryTranslator /> },
  { id: 'storySummary', element: <StorySummary /> },
  { id: 'storyWeb', element: <StoryTranslatorWeb /> },
  { id: 'gemini', element: <GeminiChat /> },
  { id: 'veo3', element: <Veo3Page /> },
  { id: 'settings', element: <Settings /> }
]

export function TabHost() {
  const { activeTabId, openedTabs } = useTabManager()

  return (
    <div className="min-h-full">
      {TAB_ENTRIES.map((tab) => {
        if (!openedTabs.includes(tab.id)) return null
        const isActive = tab.id === activeTabId
        return (
          <div key={tab.id} className={isActive ? 'block' : 'hidden'}>
            {tab.element}
          </div>
        )
      })}
    </div>
  )
}
