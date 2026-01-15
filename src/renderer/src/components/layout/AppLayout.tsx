import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export const AppLayout = () => {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-text-primary">
      <Sidebar />
      <main className="flex-1 overflow-auto relative">
        <header className="absolute top-0 right-0 p-4 z-10">
          {/* Header Controls (Minimize, Close) if needed, or user profile */}
        </header>
        <div className="p-8 min-h-full">
           <Outlet />
        </div>
      </main>
    </div>
  );
};
