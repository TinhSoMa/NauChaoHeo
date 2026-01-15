import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { BookOpen, Video, Settings, FolderClosed, Menu, ChevronsLeft, ChevronsRight, Sun, Moon } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useThemeStore } from '../../hooks/useTheme';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}



export const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggleTheme } = useThemeStore();

  const navItems = [
    { icon: BookOpen, label: 'Story Translator', path: '/translator' },
    { icon: Video, label: 'Veo3 AI Prompt', path: '/veo3' },
  ];

  const bottomItems = [
    { icon: FolderClosed, label: 'Projects', path: '/projects' },
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
          <h1 className="font-bold text-xl bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent truncate">
            AI Toolkit
          </h1>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={toggleTheme}
            className="p-2 hover:bg-surface text-text-secondary hover:text-text-primary rounded-lg transition-colors"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
           {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
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
            to={item.path}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-3 rounded-xl transition-all group",
              isActive 
                ? "bg-primary text-text-invert shadow-lg shadow-primary/25" 
                : "text-text-secondary hover:bg-surface hover:text-text-primary"
            )}
          >
            <item.icon size={22} className={cn("min-w-[22px]", collapsed && "mx-auto")} />
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
            to={item.path}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-3 rounded-xl transition-all group",
              isActive 
                ? "bg-surface text-text-primary" 
                : "text-text-secondary hover:bg-surface hover:text-text-primary"
            )}
          >
            <item.icon size={22} className={cn("min-w-[22px]", collapsed && "mx-auto")} />
            {!collapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
          </NavLink>
        ))}
      </div>
    </aside>
  );
};
