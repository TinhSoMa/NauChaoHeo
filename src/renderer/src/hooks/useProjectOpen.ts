import { useCallback } from 'react'

export function useProjectOpen() {
  const openProject = useCallback(async (projectId: string) => {
    console.log('[UI] Đang yêu cầu mở project:', projectId)
    return window.electronAPI.project.openProject(projectId)
  }, [])

  const createAndOpenProject = useCallback(
    async (payload: { projectId?: string; id?: string }) => {
      console.log('[UI] Đang yêu cầu tạo và mở project:', payload?.projectId ?? payload?.id)
      return window.electronAPI.project.createAndOpen(payload)
    },
    []
  )

  return { openProject, createAndOpenProject }
}
