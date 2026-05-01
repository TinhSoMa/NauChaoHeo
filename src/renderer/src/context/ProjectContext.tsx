import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ProjectResolvedPaths } from '@shared/types/project'

interface ProjectContextValue {
  projectId: string | null
  paths: ProjectResolvedPaths | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined)

interface ProjectProviderProps {
  projectId: string | null
  children: React.ReactNode
}

export function ProjectProvider({ projectId, children }: ProjectProviderProps) {
  const [paths, setPaths] = useState<ProjectResolvedPaths | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) {
      setPaths(null)
      setError('Thiếu projectId')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await window.electronAPI.project.getResolvedPaths(projectId)
      if (res?.success) {
        setPaths(res.data ?? null)
      } else {
        setPaths(null)
        setError(res?.error || 'Không thể tải project paths')
      }
    } catch (err) {
      setPaths(null)
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const value = useMemo<ProjectContextValue>(
    () => ({ projectId, paths, loading, error, refresh: load }),
    [projectId, paths, loading, error, load]
  )

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext)
  if (!ctx) {
    throw new Error('useProjectContext must be used within ProjectProvider')
  }
  return ctx
}
