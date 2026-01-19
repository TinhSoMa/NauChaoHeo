import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useThemeEffect } from './hooks/useTheme';
import { AppLayout } from './components/layout/AppLayout';
import { CaptionTranslator } from './components/caption';
import { StoryTranslator } from './components/story';
import { Settings } from './components/settings/Settings';

// Placeholder Pages
const Veo3Page = () => (
  <div className="space-y-6">
    <h1 className="text-3xl font-bold group flex items-center gap-3">
      <span className="bg-clip-text text-transparent bg-linear-to-r from-pink-500 to-violet-500">
        Veo3 Prompt Builder
      </span>
    </h1>
    <div className="p-8 rounded-2xl bg-linear-to-br from-purple-900/20 to-blue-900/20 border border-white/10">
      <p className="text-lg text-gray-300">Create structured JSON prompts for Veo 3 video generation.</p>
    </div>
  </div>
);

function App() {
  useThemeEffect();

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/translator" replace />} />
          <Route path="/translator" element={<CaptionTranslator />} />
          <Route path="/story-translator" element={<StoryTranslator />} />
          <Route path="/veo3" element={<Veo3Page />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div>404: Page Not Found</div>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;

