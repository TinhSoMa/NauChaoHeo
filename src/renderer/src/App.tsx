import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useThemeEffect } from './hooks/useTheme';
import { AppLayout } from './components/layout/AppLayout';

// Placeholder Pages
const TranslatorPage = () => (
  <div className="space-y-6">
    <h1 className="text-3xl font-bold">Story Translator</h1>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="p-6 rounded-2xl bg-card border border-white/10">
        <h3 className="text-xl font-semibold mb-2">New Project</h3>
        <p className="text-gray-400">Start translating a new story chapter.</p>
      </div>
      <div className="p-6 rounded-2xl bg-card border border-white/10">
        <h3 className="text-xl font-semibold mb-2">Recent Translations</h3>
        <p className="text-gray-400">Continue where you left off.</p>
      </div>
    </div>
  </div>
);

const Veo3Page = () => (
  <div className="space-y-6">
    <h1 className="text-3xl font-bold group flex items-center gap-3">
      <span className="bg-clip-text text-transparent bg-gradient-to-r from-pink-500 to-violet-500">
        Veo3 Prompt Builder
      </span>
    </h1>
    <div className="p-8 rounded-2xl bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-white/10">
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
          <Route path="/translator" element={<TranslatorPage />} />
          <Route path="/veo3" element={<Veo3Page />} />
          <Route path="*" element={<div>404: Page Not Found</div>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
