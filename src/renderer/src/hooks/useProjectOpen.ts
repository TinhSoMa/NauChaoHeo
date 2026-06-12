import { useCallback } from 'react'

export function useProjectOpen() {
  const openProject = useCallback(async (projectId: string) => {
    console.log('[UI] Đang yêu cầu mở project:', projectId)
    return window.electronAPI.project.openProject(projectId)
  }, [])

  const createAndOpenProject = useCallback(
    async (projectName: string) => {
      console.log('[UI] Đang yêu cầu tạo và mở project:', projectName)
      return window.electronAPI.project.createAndOpen(projectName)
    },
    []
  )

  return { openProject, createAndOpenProject }
}
