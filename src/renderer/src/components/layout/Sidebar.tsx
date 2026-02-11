import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Video, Settings, ChevronsLeft, ChevronsRight, Subtitles, MessageCircle, FileText, Film } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}



export const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  
  // Preserve query parameters (especially projectId) when navigating
  const getNavPath = (path: string) => {
    const searchParams = new URLSearchParams(location.search);
    const queryString = searchParams.toString();
    return queryString ? `${path}?${queryString}` : path;
  };

  const navItems = [
    { icon: Subtitles, label: 'Dich Caption', path: '/translator' },
    { icon: Film, label: 'Caption Video', path: '/caption-video' },
    { icon: BookOpen, label: 'Dich Truyen AI', path: '/story-translator' },
    { icon: FileText, label: 'Tom Tat Truyen AI', path: '/story-summary' },
    { icon: MessageCircle, label: 'Dich Truyen (Web)', path: '/story-web' },
    { icon: MessageCircle, label: 'Chat Gemini', path: '/gemini-chat' },
    { icon: Video, label: 'Veo3 AI Prompt', path: '/veo3' },
  ];

  const bottomItems = [
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <aside 
      className={cn(
        "h-screen bg-sidebar border-r border-border flex flex-col transition-all duration-300 relative",
        collapsed ? "w-20" : "w-64"
      )}
    >
      <div className="p-4 flex items-center justify-between border-b border-border h-16">
        {!collapsed && (
          <h1 className="font-bold text-xl bg-linear-to-r from-primary to-primary-light bg-clip-text text-transparent truncate">
            AI Toolkit
          </h1>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <button 
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 hover:bg-surface text-text-secondary hover:text-text-primary rounded-lg transition-colors"
          >
            {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          </button>
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
            <item.icon size={22} className={cn("min-w-5.5", collapsed && "mx-auto")} />
            {!collapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
            
            {/* Tooltip for collapsed state */}
            {collapsed && (
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
            <item.icon size={22} className={cn("min-w-5.5", collapsed && "mx-auto")} />
            {!collapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
          </NavLink>
        ))}
      </div>
    </aside>
  );
};
