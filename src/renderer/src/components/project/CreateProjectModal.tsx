import { useState, useEffect } from 'react';
import { X, FolderPlus } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { CreateProjectDTO } from '@shared/types/project';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: CreateProjectDTO) => Promise<void>;
}

export function CreateProjectModal({ isOpen, onClose, onCreate }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      setName('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setIsSubmitting(true);
    try {
      await onCreate({
        name,
        // Description could be added to DTO later, for now just name and settings
        // settings will fallback to defaults in backend
      });
      onClose();
    } catch (error) {
      console.error('Error creating project:', error);
      // Handle error (maybe show toast)
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div 
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-border bg-surface/50">
          <h2 className="text-lg font-semibold text-text-primary">Tạo Dự Án Mới</h2>
          <button 
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors p-1 rounded-md hover:bg-surface"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          
          {/* File Selection */}
          <div className="flex flex-col items-center justify-center p-4 bg-primary/5 rounded-lg border border-primary/20 mb-4">
             <FolderPlus size={32} className="text-primary mb-2" />
             <p className="text-sm text-center text-text-secondary">
               Tạo một không gian dự án mới để quản lý các bản dịch, ghi chú và tài liệu của bạn.
             </p>
          </div>

          {/* Project Name */}
          <Input
            label="Tên Dự Án"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nhập tên dự án..."
            required
            autoFocus
          />

          <div className="pt-2 flex gap-3">
             <Button 
                type="button" 
                onClick={onClose} 
                variant="secondary" 
                className="flex-1"
                disabled={isSubmitting}
              >
                Hủy
              </Button>
             <Button 
                type="submit" 
                variant="primary" 
                className="flex-1"
                disabled={!name || isSubmitting}
              >
                {isSubmitting ? 'Đang tạo...' : 'Tạo Dự Án'}
              </Button>
          </div>

        </form>
      </div>
    </div>
  );
}
