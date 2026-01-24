/**
 * useProjectOutput - Hook để lấy đường dẫn lưu file trong project đang active
 * Tất cả các feature sử dụng hook này để đảm bảo output được lưu vào project folder
 */

import { useActiveProject } from './useActiveProject';
import { useCallback, useMemo } from 'react';

export interface ProjectOutputPaths {
  // Có project active hay không
  hasProject: boolean;
  
  // Thư mục gốc của project
  projectFolder: string | null;
  
  // Các thư mục con theo chức năng
  captionFolder: string | null;      // /caption - Lưu file SRT, audio
  storyFolder: string | null;        // /story - Lưu bản dịch truyện
  promptFolder: string | null;       // /prompts - Lưu prompt debug
  exportFolder: string | null;       // /export - Lưu file xuất khẩu
  tempFolder: string | null;         // /temp - File tạm
}

export interface UseProjectOutputReturn extends ProjectOutputPaths {
  // Tạo đường dẫn file trong project
  getFilePath: (folder: keyof Omit<ProjectOutputPaths, 'hasProject' | 'projectFolder'>, filename: string) => string | null;
  
  // Lấy project ID
  projectId: string | null;
  
  // Tên project
  projectName: string | null;
  
  // Loading state
  isLoading: boolean;
}

export function useProjectOutput(): UseProjectOutputReturn {
  const { activeProject, isLoading } = useActiveProject();
  
  const paths = useMemo<ProjectOutputPaths>(() => {
    if (!activeProject) {
      return {
        hasProject: false,
        projectFolder: null,
        captionFolder: null,
        storyFolder: null,
        promptFolder: null,
        exportFolder: null,
        tempFolder: null,
      };
    }
    
    const base = activeProject.projectFolderPath;
    return {
      hasProject: true,
      projectFolder: base,
      captionFolder: `${base}/caption`,
      storyFolder: `${base}/story`,
      promptFolder: `${base}/prompts`,
      exportFolder: `${base}/export`,
      tempFolder: `${base}/temp`,
    };
  }, [activeProject]);
  
  const getFilePath = useCallback((
    folder: keyof Omit<ProjectOutputPaths, 'hasProject' | 'projectFolder'>, 
    filename: string
  ): string | null => {
    const folderPath = paths[folder];
    if (!folderPath) return null;
    return `${folderPath}/${filename}`;
  }, [paths]);
  
  return {
    ...paths,
    getFilePath,
    projectId: activeProject?.id ?? null,
    projectName: activeProject?.name ?? null,
    isLoading,
  };
}

/**
 * Các subfolder chuẩn trong project:
 * 
 * /caption
 *   - audio/          Audio files TTS
 *   - srt/            File SRT đã dịch
 *   - text/           File text đã split
 * 
 * /story
 *   - chapters/       Các chương đã dịch
 *   - export/         File xuất (epub, txt)
 * 
 * /prompts
 *   - debug/          Prompt debug files
 * 
 * /export
 *   - Các file xuất cuối cùng
 * 
 * /temp
 *   - File tạm trong quá trình xử lý
 */
