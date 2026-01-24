/**
 * useActiveProject - Hook quản lý project đang được chọn
 * Sử dụng Zustand để lưu trữ và đồng bộ với AppSettings
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { TranslationProject } from '@shared/types/project';

interface ActiveProjectState {
  activeProject: TranslationProject | null;
  isLoading: boolean;
  
  // Actions
  setActiveProject: (project: TranslationProject | null) => void;
  loadActiveProject: () => Promise<void>;
  clearActiveProject: () => void;
}

export const useActiveProject = create<ActiveProjectState>()(
  persist(
    (set) => ({
      activeProject: null,
      isLoading: true,

      setActiveProject: (project) => {
        set({ activeProject: project });
        
        // Sync with backend
        if (project) {
          window.electronAPI.appSettings.addRecentProject(project.id);
        }
      },

      loadActiveProject: async () => {
        set({ isLoading: true });
        try {
          // Get last active project ID from settings
          const result = await window.electronAPI.appSettings.getLastActiveProjectId();
          if (result.success && result.data) {
            // Load project details
            const projectResult = await window.electronAPI.project.getById(result.data);
            if (projectResult.success && projectResult.data) {
              set({ activeProject: projectResult.data, isLoading: false });
              return;
            }
          }
          set({ activeProject: null, isLoading: false });
        } catch (error) {
          console.error('[useActiveProject] Error loading active project:', error);
          set({ activeProject: null, isLoading: false });
        }
      },

      clearActiveProject: () => {
        set({ activeProject: null });
        window.electronAPI.appSettings.removeFromRecent('');
      },
    }),
    {
      name: 'active-project-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        // Only persist project ID, reload full project on app start
        activeProjectId: state.activeProject?.id 
      }),
    }
  )
);

// Helper hook to check if project is required
export const useRequireProject = () => {
  const { activeProject, isLoading } = useActiveProject();
  
  return {
    hasProject: !!activeProject,
    isLoading,
    project: activeProject,
  };
};
