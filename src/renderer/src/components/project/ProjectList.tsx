/**
 * Project List - Danh sách dự án dịch truyện
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FolderOpen, 
  Plus, 
  Trash2, 
  BookOpen, 
  Clock, 
  CheckCircle,
  PlayCircle,
  PauseCircle
} from 'lucide-react';
import { Button } from '../common/Button';
import { TranslationProject, CreateProjectDTO } from '@shared/types/project';
import { CreateProjectModal } from './CreateProjectModal';
import { useActiveProject } from '../../hooks/useActiveProject';

export function ProjectList() {
  const navigate = useNavigate();
  const { setActiveProject } = useActiveProject();
  const [projects, setProjects] = useState<TranslationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const result = await window.electronAPI.project.getAll();
      if (result.success && result.data) {
        setProjects(result.data);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProjectClick = () => {
    setShowCreateModal(true);
  };

  const handleCreateProjectSubmit = async (data: CreateProjectDTO) => {
    try {
      const createResult = await window.electronAPI.project.create(data);
      if (createResult.success) {
         // Reload danh sách
        loadProjects();
        // Set as active project
        setActiveProject(createResult.data);
        // Điều hướng đến story translator với project mới
        navigate(`/story-translator?projectId=${createResult.data.id}`);
      } else {
        alert(`Lỗi tạo dự án: ${createResult.error}`);
      }
    } catch (e) {
      console.error(e);
      alert('Có lỗi xảy ra khi tạo dự án');
    }
  };

  const handleOpenProject = async (projectId: string) => {
    // Load full project data and set as active
    const result = await window.electronAPI.project.getById(projectId);
    if (result.success && result.data) {
      setActiveProject(result.data);
    }
    navigate(`/story-translator?projectId=${projectId}`);
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Bạn có chắc muốn xóa dự án này? Tất cả bản dịch sẽ bị mất!')) {
      const result = await window.electronAPI.project.delete(projectId);
      if (result.success) {
        loadProjects();
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={18} />;
      case 'paused':
        return <PauseCircle className="text-yellow-500" size={18} />;
      default:
        return <PlayCircle className="text-blue-500" size={18} />;
    }
  };

  const getProgressPercent = (project: TranslationProject) => {
    if (project.totalChapters === 0) return 0;
    return Math.round((project.translatedChapters / project.totalChapters) * 100);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-primary">Dự Án Dịch Truyện</h1>
        <Button onClick={handleCreateProjectClick} variant="primary">
          <Plus size={18} />
          Tạo Dự Án Mới
        </Button>
      </div>

      {/* Project Grid */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
          <FolderOpen size={64} className="mb-4 opacity-30" />
          <p className="text-lg mb-2">Chưa có dự án nào</p>
          <p className="text-sm opacity-70">Bấm "Tạo Dự Án Mới" để bắt đầu</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => handleOpenProject(project.id)}
              className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/50 transition-all hover:shadow-lg group"
            >
              {/* Header */}
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  {getStatusIcon(project.status)}
                  <h3 className="font-semibold text-text-primary group-hover:text-primary transition-colors truncate max-w-45">
                    {project.name}
                  </h3>
                </div>
                <button
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 text-red-500 transition-all"
                  title="Xóa dự án"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Progress */}
              <div className="mb-3">
                <div className="flex justify-between text-sm text-text-secondary mb-1">
                  <span>{project.translatedChapters}/{project.totalChapters} chương</span>
                  <span>{getProgressPercent(project)}%</span>
                </div>
                <div className="h-2 bg-surface rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${getProgressPercent(project)}%` }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 text-xs text-text-secondary">
                <div className="flex items-center gap-1">
                  <BookOpen size={12} />
                  <span>{project.settings.sourceLang} → {project.settings.targetLang}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={12} />
                  <span>{formatDate(project.updatedAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      
      <CreateProjectModal 
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateProjectSubmit}
      />
    </div>
  );
}
