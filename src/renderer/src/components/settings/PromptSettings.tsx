/**
 * PromptSettings - Cấu hình prompt cho dịch truyện và tóm tắt
 */

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Save, BookOpen, Sparkles, Eye, RefreshCw, Check, AlertCircle, Plus, Edit2, X, Trash2, Settings } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './Settings.module.css';

interface PromptSettingsProps {
  onBack: () => void;
}

interface Prompt {
  id: string;
  name: string;
  description?: string;
  sourceLang: string;
  targetLang: string;
  content?: string;
  isDefault?: boolean;
}

interface PromptFormData {
  name: string;
  description: string;
  sourceLang: string;
  targetLang: string;
  content: string;
}

type ToastType = 'success' | 'error' | 'info';
type ModalMode = 'create' | 'edit' | null;
type TabView = 'config' | 'manage';

export function PromptSettings({ onBack }: PromptSettingsProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [translationPromptId, setTranslationPromptId] = useState<string>('');
  const [summaryPromptId, setSummaryPromptId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [previewPromptId, setPreviewPromptId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<Prompt | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [activeTab, setActiveTab] = useState<TabView>('config');
  
  // Modal states
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PromptFormData>({
    name: '',
    description: '',
    sourceLang: 'zh',
    targetLang: 'vi',
    content: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const promptsResult: any = await window.electronAPI.invoke('prompt:getAll');
      if (Array.isArray(promptsResult)) {
        setPrompts(promptsResult.map((p: any) => {
          let content = p.content;
          
          // Parse JSON if needed (backward compatibility)
          try {
            if (typeof p.content === 'string' && p.content.trim().startsWith('{')) {
              const parsed = JSON.parse(p.content);
              // Extract content from old JSON format
              if (parsed && typeof parsed === 'object') {
                // Prefer content field, fallback to systemInstruction, then original
                content = parsed.content || parsed.systemInstruction || p.content;
              }
            }
          } catch (e) {
            // Keep original if parse fails
            content = p.content;
          }

          return {
            id: p.id,
            name: p.name,
            description: p.description,
            sourceLang: p.sourceLang,
            targetLang: p.targetLang,
            content,
            isDefault: p.isDefault
          };
        }));
      }

      const settingsResult = await window.electronAPI.appSettings.getAll();
      if (settingsResult.success && settingsResult.data) {
        setTranslationPromptId(settingsResult.data.translationPromptId || '');
        setSummaryPromptId(settingsResult.data.summaryPromptId || '');
      }
      setHasChanges(false);
    } catch (error) {
      console.error('[PromptSettings] Error loading data:', error);
      showToast('Lỗi khi tải dữ liệu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const openCreateModal = () => {
    setFormData({
      name: '',
      description: '',
      sourceLang: 'zh',
      targetLang: 'vi',
      content: ''
    });
    setEditingPromptId(null);
    setModalMode('create');
  };

  const openEditModal = (prompt: Prompt) => {
    setFormData({
      name: prompt.name,
      description: prompt.description || '',
      sourceLang: prompt.sourceLang,
      targetLang: prompt.targetLang,
      content: prompt.content || ''
    });
    setEditingPromptId(prompt.id);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingPromptId(null);
  };

  const handleFormChange = (field: keyof PromptFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmitForm = async () => {
    if (!formData.name.trim()) {
      showToast('Vui lòng nhập tên prompt', 'error');
      return;
    }

    try {
      const data = {
        name: formData.name,
        description: formData.description,
        sourceLang: formData.sourceLang,
        targetLang: formData.targetLang,
        content: formData.content
      };

      if (modalMode === 'create') {
        await window.electronAPI.prompt.create(data);
        showToast('✅ Đã tạo prompt mới!', 'success');
      } else if (modalMode === 'edit' && editingPromptId) {
        await window.electronAPI.prompt.update(editingPromptId, data);
        showToast('✅ Đã cập nhật prompt!', 'success');
      }

      closeModal();
      loadData();
    } catch (error) {
      console.error('[PromptSettings] Error saving prompt:', error);
      showToast('❌ Lỗi khi lưu prompt', 'error');
    }
  };

  const handleDeletePrompt = async (promptId: string, promptName: string) => {
    if (!confirm(`Bạn có chắc muốn xóa prompt "${promptName}"?`)) {
      return;
    }

    try {
      await window.electronAPI.prompt.delete(promptId);
      showToast('✅ Đã xóa prompt!', 'success');
      loadData();
    } catch (error) {
      console.error('[PromptSettings] Error deleting prompt:', error);
      showToast('❌ Lỗi khi xóa prompt', 'error');
    }
  };

  const handleTranslationPromptChange = (value: string) => {
    setTranslationPromptId(value);
    setHasChanges(true);
  };

  const handleSummaryPromptChange = (value: string) => {
    setSummaryPromptId(value);
    setHasChanges(true);
  };

  const handlePreview = async (promptId: string) => {
    if (previewPromptId === promptId) {
      setPreviewPromptId(null);
      setPreviewContent(null);
      return;
    }

    try {
      setPreviewPromptId(promptId);
      const prompt = prompts.find(p => p.id === promptId);
      if (prompt) {
        setPreviewContent(prompt);
      }
    } catch (error) {
      console.error('[PromptSettings] Error loading preview:', error);
      showToast('Lỗi khi tải preview', 'error');
    }
  };

  const handleSave = useCallback(async () => {
    try {
      const result = await window.electronAPI.appSettings.update({
        translationPromptId: translationPromptId || null,
        summaryPromptId: summaryPromptId || null
      });

      if (result.success) {
        setHasChanges(false);
        showToast('✅ Đã lưu cài đặt prompt!', 'success');
      } else {
        showToast('❌ Lỗi khi lưu: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      console.error('[PromptSettings] Error saving:', error);
      showToast('❌ Lỗi khi lưu cài đặt', 'error');
    }
  }, [translationPromptId, summaryPromptId]);

  if (loading) {
    return (
      <div className={styles.detailContainer}>
        <div className={styles.detailContent}>
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <RefreshCw size={32} className={styles.spinning} style={{ margin: '0 auto 1rem' }} />
            <p>Đang tải...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.detailContainer}>
      {/* Header */}
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Quản lý Prompts</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem' }}>
          {activeTab === 'manage' && (
            <Button variant="primary" onClick={openCreateModal}>
              <Plus size={16} />
              Thêm mới
            </Button>
          )}
          <Button variant="secondary" iconOnly onClick={loadData} title="Làm mới">
            <RefreshCw size={16} />
          </Button>
        </div>
      </div>
      
      {/* Tabs */}
      <div style={{
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-card)',
        padding: '0 2rem',
        display: 'flex',
        gap: '2rem'
      }}>
        <button
          onClick={() => setActiveTab('config')}
          style={{
            padding: '1rem 0',
            border: 'none',
            background: 'none',
            color: activeTab === 'config' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            fontWeight: activeTab === 'config' ? 600 : 400,
            borderBottom: activeTab === 'config' ? '2px solid var(--color-primary)' : '2px solid transparent',
            cursor: 'pointer',
            fontSize: '0.95rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s'
          }}
        >
          <Settings size={18} />
          Cấu hình sử dụng
        </button>
        <button
          onClick={() => setActiveTab('manage')}
          style={{
            padding: '1rem 0',
            border: 'none',
            background: 'none',
            color: activeTab === 'manage' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            fontWeight: activeTab === 'manage' ? 600 : 400,
            borderBottom: activeTab === 'manage' ? '2px solid var(--color-primary)' : '2px solid transparent',
            cursor: 'pointer',
            fontSize: '0.95rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s'
          }}
        >
          <BookOpen size={18} />
          Danh sách ({prompts.length})
        </button>
      </div>

      <div className={styles.detailContent}>
        {activeTab === 'config' && (
          <ConfigTab
            prompts={prompts}
            translationPromptId={translationPromptId}
            summaryPromptId={summaryPromptId}
            previewPromptId={previewPromptId}
            previewContent={previewContent}
            hasChanges={hasChanges}
            onTranslationPromptChange={handleTranslationPromptChange}
            onSummaryPromptChange={handleSummaryPromptChange}
            onPreview={handlePreview}
            onSave={handleSave}
          />
        )}

        {activeTab === 'manage' && (
          <ManageTab
            prompts={prompts}
            onEdit={openEditModal}
            onDelete={handleDeletePrompt}
          />
        )}
      </div>

      {/* Modal Form */}
      {modalMode && (
        <PromptFormModal
          mode={modalMode}
          formData={formData}
          onFormChange={handleFormChange}
          onSubmit={handleSubmitForm}
          onClose={closeModal}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

// Config Tab Component
function ConfigTab({ 
  prompts, 
  translationPromptId, 
  summaryPromptId,
  previewPromptId,
  previewContent,
  hasChanges,
  onTranslationPromptChange,
  onSummaryPromptChange,
  onPreview,
  onSave
}: any) {
  return (
    <>
      <div style={{ 
        backgroundColor: 'var(--color-card)',
        borderRadius: '12px',
        padding: '1.5rem',
        border: '1px solid var(--color-border)',
        marginBottom: '1.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ 
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: 'var(--color-primary)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <BookOpen size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>
              Prompt dịch truyện
            </h3>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              Sử dụng khi dịch các chương truyện
            </p>
          </div>
        </div>

        <select
          value={translationPromptId}
          onChange={(e) => onTranslationPromptChange(e.target.value)}
          className={styles.select}
          style={{ width: '100%', marginBottom: translationPromptId ? '1rem' : 0 }}
        >
          <option value="">🔍 Tự động (theo ngôn ngữ)</option>
          {prompts.map((p: Prompt) => (
            <option key={p.id} value={p.id}>
              {p.name} • {p.sourceLang} → {p.targetLang}
            </option>
          ))}
        </select>

        {translationPromptId && (
          <Button variant="secondary" onClick={() => onPreview(translationPromptId)}>
            <Eye size={14} />
            {previewPromptId === translationPromptId ? 'Ẩn' : 'Xem'} chi tiết
          </Button>
        )}
      </div>

      <div style={{ 
        backgroundColor: 'var(--color-card)',
        borderRadius: '12px',
        padding: '1.5rem',
        border: '1px solid var(--color-border)',
        marginBottom: '1.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ 
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: '#8b5cf6',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Sparkles size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>
              Prompt tóm tắt truyện
            </h3>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              Sử dụng khi tạo tóm tắt chương
            </p>
          </div>
        </div>

        <select
          value={summaryPromptId}
          onChange={(e) => onSummaryPromptChange(e.target.value)}
          className={styles.select}
          style={{ width: '100%', marginBottom: summaryPromptId ? '1rem' : 0 }}
        >
          <option value="">🔍 Tự động (tìm prompt summary)</option>
          {prompts.map((p: Prompt) => (
            <option key={p.id} value={p.id}>
              {p.name} • {p.sourceLang} → {p.targetLang}
            </option>
          ))}
        </select>

        {summaryPromptId && (
          <Button variant="secondary" onClick={() => onPreview(summaryPromptId)}>
            <Eye size={14} />
            {previewPromptId === summaryPromptId ? 'Ẩn' : 'Xem'} chi tiết
          </Button>
        )}
      </div>

      {/* Preview */}
      {previewPromptId && previewContent && (
        <div style={{ 
          backgroundColor: 'var(--color-card)',
          borderRadius: '12px',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          marginBottom: '1.5rem'
        }}>
          <div style={{ 
            padding: '1rem 1.5rem',
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            fontWeight: 600,
            fontSize: '0.95rem'
          }}>
            Chi tiết: {previewContent.name}
          </div>
          <div style={{ padding: '1.5rem' }}>
            {previewContent.content ? (
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-primary)' }}>
                  Nội dung Prompt
                </div>
                <pre style={{ 
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.85rem',
                  backgroundColor: 'var(--color-surface)',
                  padding: '1rem',
                  borderRadius: '8px',
                  maxHeight: '400px',
                  overflow: 'auto',
                  margin: 0,
                  border: '1px solid var(--color-border)',
                  lineHeight: '1.6'
                }}>
                  {previewContent.content}
                </pre>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)' }}>
                Prompt này chưa có nội dung
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Bar */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        backgroundColor: 'var(--color-card)',
        borderTop: '1px solid var(--color-border)',
        padding: '1.25rem',
        borderRadius: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          {hasChanges && (
            <span style={{ fontSize: '0.875rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={16} />
              Có thay đổi chưa lưu
            </span>
          )}
        </div>
        <Button onClick={onSave} variant="primary" disabled={!hasChanges}>
          <Save size={16} />
          Lưu cài đặt
        </Button>
      </div>
    </>
  );
}

// Manage Tab Component
function ManageTab({ prompts, onEdit, onDelete }: any) {
  if (prompts.length === 0) {
    return (
      <div style={{ 
        textAlign: 'center', 
        padding: '4rem 2rem',
        backgroundColor: 'var(--color-card)',
        borderRadius: '12px',
        border: '1px dashed var(--color-border)'
      }}>
        <BookOpen size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
        <p style={{ fontSize: '1.05rem', fontWeight: 500, marginBottom: '0.5rem' }}>
          Chưa có prompt nào
        </p>
        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
          Nhấn nút "Thêm mới" để tạo prompt đầu tiên
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {prompts.map((prompt: Prompt) => (
        <div
          key={prompt.id}
          style={{
            backgroundColor: 'var(--color-card)',
            borderRadius: '12px',
            padding: '1.25rem',
            border: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem',
            transition: 'all 0.2s',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-primary)';
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '1rem' }}>{prompt.name}</strong>
              {prompt.isDefault && (
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.2rem 0.6rem',
                  backgroundColor: 'var(--color-primary)',
                  color: 'white',
                  borderRadius: '6px',
                  fontWeight: 600,
                  letterSpacing: '0.5px'
                }}>
                  MẶC ĐỊNH
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              {prompt.sourceLang} → {prompt.targetLang}
              {prompt.description && ` • ${prompt.description}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button
              variant="secondary"
              iconOnly
              onClick={(e: any) => { e.stopPropagation(); onEdit(prompt); }}
              title="Chỉnh sửa"
            >
              <Edit2 size={16} />
            </Button>
            <Button
              variant="danger"
              iconOnly
              onClick={(e: any) => { e.stopPropagation(); onDelete(prompt.id, prompt.name); }}
              title="Xóa"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Prompt Form Modal Component
function PromptFormModal({ mode, formData, onFormChange, onSubmit, onClose }: any) {
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div 
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '2rem'
      }}
    >
      <div style={{
        backgroundColor: 'var(--color-card)',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '700px',
        maxHeight: '85vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem 2rem',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          backgroundColor: 'var(--color-card)',
          zIndex: 1,
          borderRadius: '16px 16px 0 0'
        }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            {mode === 'create' ? 'Tạo Prompt Mới' : 'Chỉnh Sửa Prompt'}
          </h2>
          <Button variant="secondary" iconOnly onClick={onClose}>
            <X size={20} />
          </Button>
        </div>

        {/* Body */}
        <div style={{ padding: '2rem' }}>
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {/* Name & Description */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
                  Tên <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => onFormChange('name', e.target.value)}
                  placeholder="Dịch truyện..."
                  className={styles.input}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
                  Mô tả
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => onFormChange('description', e.target.value)}
                  placeholder="Mô tả ngắn gọn..."
                  className={styles.input}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Languages */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
                  Từ ngôn ngữ
                </label>
                <select
                  value={formData.sourceLang}
                  onChange={(e) => onFormChange('sourceLang', e.target.value)}
                  className={styles.select}
                  style={{ width: '100%' }}
                >
                  <option value="zh">中文 (zh)</option>
                  <option value="en">English (en)</option>
                  <option value="ja">日本語 (ja)</option>
                  <option value="ko">한국어 (ko)</option>
                  <option value="vi">Tiếng Việt (vi)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
                  Sang ngôn ngữ
                </label>
                <select
                  value={formData.targetLang}
                  onChange={(e) => onFormChange('targetLang', e.target.value)}
                  className={styles.select}
                  style={{ width: '100%' }}
                >
                  <option value="vi">Tiếng Việt (vi)</option>
                  <option value="en">English (en)</option>
                  <option value="zh">中文 (zh)</option>
                  <option value="ja">日本語 (ja)</option>
                  <option value="ko">한국어 (ko)</option>
                </select>
              </div>
            </div>

            {/* Prompt Content */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
                Nội dung Prompt <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={formData.content}
                onChange={(e) => onFormChange('content', e.target.value)}
                placeholder="Nội dung prompt template..."
                className={styles.textarea}
                style={{ width: '100%', minHeight: '180px', fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.5rem', textAlign: 'right' }}>
                {formData.content.length} ký tự
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1.25rem 2rem',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          gap: '0.75rem',
          justifyContent: 'flex-end',
          position: 'sticky',
          bottom: 0,
          backgroundColor: 'var(--color-card)',
          borderRadius: '0 0 16px 16px'
        }}>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" onClick={onSubmit}>
            <Save size={16} />
            {mode === 'create' ? 'Tạo' : 'Lưu'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Toast Component
function Toast({ message, type }: { message: string; type: ToastType }) {
  const bgColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6';
  
  return (
    <div style={{
      position: 'fixed',
      bottom: '2rem',
      right: '2rem',
      padding: '1rem 1.5rem',
      backgroundColor: bgColor,
      color: 'white',
      borderRadius: '10px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
      zIndex: 1001,
      animation: 'slideIn 0.3s ease-out',
      fontSize: '0.9rem',
      fontWeight: 500
    }}>
      {type === 'success' && <Check size={18} />}
      {type === 'error' && <AlertCircle size={18} />}
      <span>{message}</span>
    </div>
  );
}
