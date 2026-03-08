import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useThemeEffect } from './hooks/useTheme'
import { AppLayout } from './components/layout/AppLayout'
import { ProjectDashboard } from './components/project/ProjectDashboard'
import { SettingsStandalone } from './components/project/SettingsStandalone'
import { TabProvider } from './context/TabContext'

function App() {
  useThemeEffect()

  return (
    <TabProvider>
      <HashRouter>
        <Routes>
          {/* Dashboard độc lập, không dùng AppLayout */}
          <Route path="/projects" element={<ProjectDashboard />} />
          <Route path="/settings-standalone" element={<SettingsStandalone />} />

          {/* Điều hướng mặc định */}
          <Route path="/" element={<Navigate to="/story-translator" replace />} />

          {/* Editor sử dụng layout chính (keep-alive tabs) */}
          <Route path="/*" element={<AppLayout />} />
        </Routes>
      </HashRouter>
    </TabProvider>
  )
}

export default App;
