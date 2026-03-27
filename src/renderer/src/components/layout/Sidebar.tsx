import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Video, Settings, ChevronsLeft, ChevronsRight, Subtitles, MessageCircle, FileText, Scissors, Download, X, PanelLeftOpen } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}



export const Sidebar = () => {
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      const saved = window.localStorage.getItem('ai-toolkit.sidebar.hidden');
      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {
      // Ignore localStorage errors.
    }
    return false;
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    try {
      const saved = window.localStorage.getItem('ai-toolkit.sidebar.collapsed');
      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {
      // Ignore localStorage errors and keep compact default.
    }
    return true;
  });
  const location = useLocation();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem('ai-toolkit.sidebar.collapsed', String(collapsed));
      window.localStorage.setItem('ai-toolkit.sidebar.hidden', String(hidden));
    } catch {
      // Ignore persistence error in renderer.
    }
  }, [collapsed, hidden]);

  // Preserve query parameters (especially projectId) when navigating
  const getNavPath = (path: string) => {
    const searchParams = new URLSearchParams(location.search);
    const queryString = searchParams.toString();
    return queryString ? `${path}?${queryString}` : path;
  };

  const navItems = [
    { icon: Subtitles, label: 'Dich Caption', path: '/translator' },
    { icon: Scissors, label: 'Cut Video', path: '/cut-video' },
    { icon: BookOpen, label: 'Dich Truyen AI', path: '/story-translator' },
    { icon: FileText, label: 'Tom Tat Truyen AI', path: '/story-summary' },
    { icon: MessageCircle, label: 'Dich Truyen (Web)', path: '/story-web' },
    { icon: MessageCircle, label: 'Chat Gemini', path: '/gemini-chat' },
    { icon: Video, label: 'Veo3 AI Prompt', path: '/veo3' },
    { icon: Download, label: 'Downloader', path: '/downloader' },
  ];

  const bottomItems = [
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  const effectiveCollapsed = collapsed;

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        title="Hiện menu"
        aria-label="Hiện menu"
        className="group fixed left-0 top-2 z-50 flex h-16 w-2 items-center justify-center overflow-hidden rounded-r-full bg-linear-to-b from-border/80 to-border/30 transition-all duration-200 hover:w-4 hover:bg-linear-to-b hover:from-primary/40 hover:to-primary/20 hover:shadow-md hover:shadow-primary/30"
      >
        <span className="h-10 w-0.5 rounded-full bg-border/70 transition-all duration-200 group-hover:w-1 group-hover:bg-primary/60" />
      </button>
    );
  }

  return (
    <aside 
      className={cn(
        "h-screen bg-sidebar border-r border-border flex flex-col transition-all duration-300 relative",
        effectiveCollapsed ? "w-20" : "w-64"
      )}
    >
      <div className="p-4 flex items-center justify-between border-b border-border h-16">
        {!effectiveCollapsed && (
          <h1 className="font-bold text-xl bg-linear-to-r from-primary to-primary-light bg-clip-text text-transparent truncate">
            AI Toolkit
          </h1>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {!effectiveCollapsed && !hidden && (
            <button 
              onClick={() => setHidden(true)}
              className="p-2 hover:bg-surface text-text-secondary hover:text-text-primary rounded-lg transition-colors"
              title="Ẩn menu"
            >
              <X size={18} />
            </button>
          )}
          {!hidden && (
            <button 
              onClick={() => setCollapsed(!collapsed)}
              className="p-2 hover:bg-surface text-text-secondary hover:text-text-primary rounded-lg transition-colors"
            >
              {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-2 mt-4">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={getNavPath(item.path)}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-3 rounded-xl transition-all group",
              isActive 
                ? "bg-primary text-text-invert shadow-lg shadow-primary/25" 
                : "text-text-secondary hover:bg-surface hover:text-text-primary"
            )}
          >
            <item.icon size={22} className={cn("min-w-5.5", effectiveCollapsed && "mx-auto")} />
            {!effectiveCollapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
            
            {/* Tooltip for collapsed state */}
            {effectiveCollapsed && (
              <div className="absolute left-full top-0 ml-2 px-2 py-1 bg-card border border-border text-text-primary rounded-md text-sm opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
                {item.label}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-2 border-t border-border space-y-2">
        {bottomItems.map((item) => (
          <NavLink
            key={item.path}
            to={getNavPath(item.path)}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-3 rounded-xl transition-all group",
              isActive 
                ? "bg-surface text-text-primary" 
                : "text-text-secondary hover:bg-surface hover:text-text-primary"
            )}
          >
            <item.icon size={22} className={cn("min-w-5.5", effectiveCollapsed && "mx-auto")} />
            {!effectiveCollapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
          </NavLink>
        ))}
      </div>
    </aside>
  );
};
