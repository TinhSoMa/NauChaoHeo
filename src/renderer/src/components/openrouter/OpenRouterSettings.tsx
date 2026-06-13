import { useState } from 'react'
import { Settings as SettingsIcon, Key, MessageSquare } from 'lucide-react'
import { OpenRouterGeneralSettings } from './OpenRouterGeneralSettings'
import { OpenRouterApiKeys } from './OpenRouterApiKeys'
import { OpenRouterTestConsole } from './OpenRouterTestConsole'

type Tab = 'general' | 'keys' | 'test'

const TABS: { id: Tab; label: string; icon: typeof SettingsIcon }[] = [
  { id: 'general', label: 'Cấu hình chung', icon: SettingsIcon },
  { id: 'keys', label: 'API Keys', icon: Key },
  { id: 'test', label: 'Kiểm thử', icon: MessageSquare },
]

export function OpenRouterSettings() {
  const [activeTab, setActiveTab] = useState<Tab>('general')

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors rounded-t-lg border-b-2 ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="py-2">
        {activeTab === 'general' && <OpenRouterGeneralSettings />}
        {activeTab === 'keys' && <OpenRouterApiKeys />}
        {activeTab === 'test' && <OpenRouterTestConsole />}
      </div>
    </div>
  )
}
