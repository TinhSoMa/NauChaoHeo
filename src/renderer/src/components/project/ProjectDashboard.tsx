import { useEffect, useState } from 'react'
import { FolderOpen, Plus, Settings as SettingsIcon, RefreshCw, FolderCog } from 'lucide-react'
import { useThemeEffect } from '../../hooks/useTheme'

interface ProjectMetadata {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

// Dashboard chọn project - quét từ thư mục được cấu hình
export function ProjectDashboard() {
  useThemeEffect()
  
  const [projects, setProjects] = useState<ProjectMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [projectsPath, setProjectsPath] = useState<string | null>(null)

  const loadProjects = async () => {
    setLoading(true)
    setError(null)
    try {
      const [pathRes, projectsRes] = await Promise.all([
        window.electronAPI.project.getProjectsPath(),
        window.electronAPI.project.scanProjects()
      ])

      if (pathRes?.success) {
        setProjectsPath(pathRes.data ?? null)
      }

      if (projectsRes?.success && Array.isArray(projectsRes.data)) {
        setProjects(projectsRes.data)
      } else {
        setProjects([])
      }
    } catch (err) {
      console.error('[Lỗi] Không thể tải danh sách project:', err)
      setError('Không thể tải danh sách project')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  const handleOpen = async (projectId: string) => {
    try {
      console.log('[UI] Đang yêu cầu mở project:', projectId)
      await window.electronAPI.project.openProject(projectId)
    } catch (err) {
      console.error('[Lỗi] Không thể mở project:', err)
    }
  }

  const handleCreateAndOpen = async () => {
    const name = newName.trim()
    if (!name) {
      setError('Vui lòng nhập tên project')
      return
    }
    
    if (!projectsPath) {
      setError('Vui lòng cấu hình thư mục Projects trong Settings trước')
      return
    }
    
    try {
      setCreating(true)
      setError(null)
      console.log('[UI] Đang tạo và mở project:', name)
      const res = await window.electronAPI.project.createAndOpen(name)
      if (res?.success) {
        setNewName('')
      } else {
        setError(res?.error || 'Không thể tạo project')
      }
    } catch (err) {
      console.error('[Lỗi] Không thể tạo/mở project:', err)
      setError('Không thể tạo project. Vui lòng thử lại.')
    } finally {
      setCreating(false)
    }
  }

  const goSettings = () => {
    window.location.hash = '#/settings-standalone'
  }

  return (
    <div className="min-h-screen bg-background text-text-primary">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-text-invert">
              <FolderOpen size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold">Projects</h1>
              <p className="text-xs text-text-secondary">
                {projectsPath || 'Chưa cấu hình thư mục'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadProjects}
              className="p-2 rounded-lg border border-border hover:bg-surface transition-colors"
              title="Làm mới"
            >
              <RefreshCw size={18} />
            </button>
            <button
              onClick={goSettings}
              className="p-2 rounded-lg border border-border hover:bg-surface transition-colors"
              title="Cài đặt"
            >
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Chưa cấu hình thư mục */}
        {!projectsPath && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center space-y-4">
            <FolderCog size={48} className="mx-auto text-text-muted" />
            <div>
              <div className="text-lg font-semibold text-text-primary mb-1">
                Chưa cấu hình thư mục Projects
              </div>
              <div className="text-sm text-text-secondary">
                Vui lòng vào Settings để chọn thư mục lưu trữ projects
              </div>
            </div>
            <button
              onClick={goSettings}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-text-invert"
            >
              Mở Settings
            </button>
          </div>
        )}

        {/* Đã cấu hình thư mục */}
        {projectsPath && (
          <>
            {/* Tạo project mới */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex gap-3">
                <input
                  className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border outline-none focus:border-primary text-text-primary placeholder:text-text-muted"
                  placeholder="Tên project mới..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateAndOpen()}
                />
                <button
                  onClick={handleCreateAndOpen}
                  disabled={creating || !newName.trim()}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-text-invert disabled:opacity-50 flex items-center gap-2"
                >
                  {creating ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                  <span>{creating ? 'Đang tạo...' : 'Tạo'}</span>
                </button>
              </div>
              {error && (
                <div className="mt-2 text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
            </div>

            {/* Danh sách projects */}
            {loading && (
              <div className="flex items-center justify-center py-8 text-text-secondary">
                <RefreshCw size={20} className="animate-spin mr-2" />
                <span>Đang tải...</span>
              </div>
            )}

            {!loading && projects.length === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
                <div className="text-text-secondary">Chưa có project nào</div>
              </div>
            )}

            {!loading && projects.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleOpen(p.id)}
                    className="text-left rounded-xl border border-border bg-card hover:bg-surface p-4 transition-all hover:border-border-hover"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FolderOpen size={18} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-text-primary truncate">{p.name}</div>
                        <div className="text-xs text-text-muted truncate">{p.id}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
