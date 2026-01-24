/**
 * RequireProject - Component yêu cầu chọn project trước khi sử dụng feature
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, ArrowRight } from 'lucide-react';
import { useActiveProject } from '../../hooks/useActiveProject';
import { Button } from './Button';

interface RequireProjectProps {
  children: React.ReactNode;
  featureName?: string;
}

export function RequireProject({ children, featureName = 'tính năng này' }: RequireProjectProps) {
  const navigate = useNavigate();
  const { activeProject, isLoading, loadActiveProject } = useActiveProject();

  // Load active project on mount
  useEffect(() => {
    loadActiveProject();
  }, [loadActiveProject]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // No project selected - show prompt
  if (!activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="max-w-md text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
            <FolderOpen size={40} className="text-primary" />
          </div>
          
          <h2 className="text-2xl font-bold text-text-primary mb-3">
            Cần chọn Project
          </h2>
          
          <p className="text-text-secondary mb-6">
            Bạn cần tạo hoặc chọn một project trước khi sử dụng {featureName}. 
            Tất cả các file sẽ được lưu trong thư mục project để dễ quản lý.
          </p>

          <div className="flex flex-col gap-3">
            <Button 
              onClick={() => navigate('/projects')} 
              variant="primary"
              className="w-full justify-center"
            >
              <FolderOpen size={18} />
              Đi đến Projects
              <ArrowRight size={18} />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Has project - render children
  return <>{children}</>;
}
