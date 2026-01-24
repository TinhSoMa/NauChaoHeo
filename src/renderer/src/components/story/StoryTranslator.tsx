import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chapter, ParseStoryResult, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import { TranslationProject, ChapterTranslation } from '@shared/types/project';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { BookOpen, FileText, CheckSquare, Square, Check } from 'lucide-react';

export function StoryTranslator() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  
  const [currentProject, setCurrentProject] = useState<TranslationProject | null>(null);
  const [filePath, setFilePath] = useState('');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [status, setStatus] = useState('idle');
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Map lưu trữ bản dịch theo chapterId
  const [translatedChapters, setTranslatedChapters] = useState<Map<string, string>>(new Map());
  const [viewMode, setViewMode] = useState<'original' | 'translated'>('original');
  // Danh sach cac chuong bi loai tru khoi dich thuat
  const [excludedChapterIds, setExcludedChapterIds] = useState<Set<string>>(new Set());
  // Progress cho batch translation
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // Load project if ID is present
  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
    }
  }, [projectId]);

  const loadProject = async (id: string) => {
    try {
      setStatus('running');
      console.log('Loading project:', id);
      
      // 1. Get Project Details
      const projectResult = await window.electronAPI.project.getById(id);
      if (!projectResult.success || !projectResult.data) {
        alert('Không tìm thấy dự án!');
        return;
      }
      const project = projectResult.data;
      setCurrentProject(project);
      setFilePath(project.sourceFilePath || '');
      setSourceLang(project.settings.sourceLang);
      setTargetLang(project.settings.targetLang);

      // 2. Parse Story File (only if exists)
      if (project.sourceFilePath) {
        const parseResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PARSE, project.sourceFilePath) as ParseStoryResult;
        if (parseResult.success && parseResult.chapters) {
          setChapters(parseResult.chapters);
          if (parseResult.chapters.length > 0) {
             setSelectedChapterId(parseResult.chapters[0].id);
          }
        }
      } else {
        setChapters([]);
        setTranslatedChapters(new Map());
      }

      // 3. Load Translations
      const transResult = await window.electronAPI.project.getTranslations(id);
      if (transResult.success && transResult.data) {
        const transMap = new Map<string, string>();
        transResult.data.forEach((t: ChapterTranslation) => {
          transMap.set(t.chapterId, t.translatedContent);
        });
        setTranslatedChapters(transMap);
      }

    } catch (error) {
      console.error('Error loading project:', error);
      alert('Lỗi tải dự án!');
    } finally {
      setStatus('idle');
    }
  };

  // Kiem tra chuong co duoc chon de dich khong
  const isChapterIncluded = (chapterId: string) => !excludedChapterIds.has(chapterId);

  // Toggle trang thai loai tru cua mot chuong
  const toggleChapterExclusion = (chapterId: string) => {
    setExcludedChapterIds(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  // Chon tat ca cac chuong de dich
  const selectAllChapters = () => {
    setExcludedChapterIds(new Set());
  };

  // Bo chon tat ca cac chuong
  const deselectAllChapters = () => {
    setExcludedChapterIds(new Set(chapters.map(c => c.id)));
  };

  // Dem so chuong duoc chon
  const selectedChapterCount = chapters.length - excludedChapterIds.size;

  const handleBrowse = async () => {
    const result = await window.electronAPI.invoke('dialog:openFile', {
      filters: [{ name: 'Text/Epub', extensions: ['txt', 'epub'] }]
    }) as { canceled: boolean; filePaths: string[] };

    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0];
      setFilePath(path);
      
      // Update Project if active - lưu đường dẫn file vào project
      if (currentProject) {
        try {
          const updateResult = await window.electronAPI.project.update(currentProject.id, {
            sourceFilePath: path,
            totalChapters: 0, // Will be updated after parsing
          });
          if (updateResult.success && updateResult.data) {
            setCurrentProject(updateResult.data);
            console.log('[StoryTranslator] Đã lưu đường dẫn file vào project:', path);
          }
        } catch (e) {
          console.error('[StoryTranslator] Lỗi lưu đường dẫn file:', e);
        }
      }

      parseFile(path);
    }
  };

  const parseFile = async (path: string) => {
      // Parse file truyen
      setStatus('running');
      try {
        const parseResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PARSE, path) as ParseStoryResult;
        if (parseResult.success && parseResult.chapters) {
          setChapters(parseResult.chapters);
          // Mac dinh chon tat ca cac chuong
          setExcludedChapterIds(new Set());
          if (parseResult.chapters.length > 0) {
             setSelectedChapterId(parseResult.chapters[0].id);
             // Không reset translatedChapters để giữ cache nếu cùng file
             setViewMode('original');
          }
          
          // Cập nhật số chương cho project
          if (currentProject) {
            await window.electronAPI.project.update(currentProject.id, {
              totalChapters: parseResult.chapters.length,
            });
          }
        } else {
          console.error('[StoryTranslator] Loi parse file:', parseResult.error);
        }
      } catch (error) {
         console.error('[StoryTranslator] Loi invoke story:parse:', error);
      } finally {
        setStatus('idle');
      }
  }

  const handleTranslate = async () => {
    if (!selectedChapterId) return;
    
    // Kiem tra chuong hien tai co bi loai tru khong
    if (!isChapterIncluded(selectedChapterId)) {
      alert('Chuong nay da bi loai tru khoi danh sach dich. Vui long bo chon "Loai tru" hoac chon chuong khac.');
      return;
    }
    
    const chapter = chapters.find(c => c.id === selectedChapterId);
    if (!chapter) return;

    setStatus('running');
    // Không cần reset translatedContent vì dùng Map cache
    
    try {
      console.log('[StoryTranslator] Dang chuan bi prompt...');
      // 1. Prepare Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang
      }) as PreparePromptResult;
      
      if (!prepareResult.success || !prepareResult.prompt) {
        throw new Error(prepareResult.error || 'Loi chuan bi prompt');
      }

      console.log('[StoryTranslator] Da chuan bi prompt, dang gui den Gemini...');
      
      // 2. Send to Gemini for Translation
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, prepareResult.prompt) as { success: boolean; data?: string; error?: string };

      if (translateResult.success && translateResult.data) {
        // Lưu bản dịch vào Map cache
        setTranslatedChapters(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, translateResult.data!);
          return next;
        });

        // Nếu đang trong Project, lưu vào DB
        if (currentProject) {
          await window.electronAPI.project.saveTranslation({
            projectId: currentProject.id,
            chapterId: selectedChapterId,
            chapterTitle: chapter.title,
            originalContent: chapter.content,
            translatedContent: translateResult.data!
          });
        }

        setViewMode('translated');
        console.log('[StoryTranslator] Dich thanh cong!');
      } else {
        throw new Error(translateResult.error || 'Dich that bai');
      }

    } catch (error) {
      console.error('[StoryTranslator] Loi trong qua trinh dich:', error);
      alert(`Loi dich thuat: ${error}`);
    } finally {
      setStatus('idle');
    }
  };

  // Dịch tất cả các chương được chọn (batch translation)
  const handleTranslateAll = async () => {
    // Lấy danh sách các chương cần dịch (chưa dịch và không bị loại trừ)
    const chaptersToTranslate = chapters.filter(
      c => isChapterIncluded(c.id) && !translatedChapters.has(c.id)
    );
    
    if (chaptersToTranslate.length === 0) {
      alert('Đã dịch xong tất cả các chương được chọn!');
      return;
    }

    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });

    for (let i = 0; i < chaptersToTranslate.length; i++) {
      const chapter = chaptersToTranslate[i];
      setBatchProgress({ current: i + 1, total: chaptersToTranslate.length });
      setSelectedChapterId(chapter.id);

      try {
        console.log(`[StoryTranslator] Dịch chương ${i + 1}/${chaptersToTranslate.length}: ${chapter.title}`);
        
        // 1. Prepare Prompt
        const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
          chapterContent: chapter.content,
          sourceLang,
          targetLang
        }) as PreparePromptResult;
        
        if (!prepareResult.success || !prepareResult.prompt) {
          console.error(`Lỗi chuẩn bị prompt cho chương ${chapter.title}:`, prepareResult.error);
          continue; // Bỏ qua chương lỗi, tiếp tục chương khác
        }

        // 2. Send to Gemini for Translation
        const translateResult = await window.electronAPI.invoke(
          STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, 
          prepareResult.prompt
        ) as { success: boolean; data?: string; error?: string };

        if (translateResult.success && translateResult.data) {
          setTranslatedChapters(prev => {
            const next = new Map(prev);
            next.set(chapter.id, translateResult.data!);
            return next;
          });

          // Nếu đang trong Project, lưu vào DB
          if (currentProject) {
            await window.electronAPI.project.saveTranslation({
              projectId: currentProject.id,
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              originalContent: chapter.content,
              translatedContent: translateResult.data!
            });
          }

          console.log(`[StoryTranslator] Dịch xong: ${chapter.title}`);
        } else {
          console.error(`Lỗi dịch chương ${chapter.title}:`, translateResult.error);
        }

        // Delay giữa các chương để tránh rate limit
        if (i < chaptersToTranslate.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Lỗi dịch chương ${chapter.title}:`, error);
      }
    }

    setStatus('idle');
    setBatchProgress(null);
    setViewMode('translated');
    console.log('[StoryTranslator] Hoàn thành dịch tất cả!');
  };

  const handleSavePrompt = async () => {
    if (!selectedChapterId) return;
    const chapter = chapters.find(c => c.id === selectedChapterId);
    if (!chapter) return;

    try {
       const result = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang
      }) as PreparePromptResult;

      if (result.success && result.prompt) {
         const promptString = JSON.stringify(result.prompt);
         await window.electronAPI.invoke(STORY_IPC_CHANNELS.SAVE_PROMPT, promptString);
      }
    } catch (e) {
      console.error('[StoryTranslator] Loi luu prompt:', e);
    }
  }


  const LANG_OPTIONS = [
    { value: 'auto', label: 'Tự động phát hiện' },
    { value: 'en', label: 'Tiếng Anh (English)' },
    { value: 'vi', label: 'Tiếng Việt (Vietnamese)' },
    { value: 'zh', label: 'Tiếng Trung (Chinese)' },
    { value: 'ja', label: 'Tiếng Nhật (Japanese)' },
    { value: 'ko', label: 'Tiếng Hàn (Korean)' },
  ];

  return (
    <div className="flex flex-col h-screen p-6 gap-4 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-primary">
          {currentProject ? `Dự Án: ${currentProject.name}` : 'Dịch Truyện AI'}
        </h1>
        {currentProject && (
          <span className="text-sm px-3 py-1 bg-primary/10 text-primary rounded-full">
            Đã dịch: {translatedChapters.size}/{chapters.length} chương
          </span>
        )}
      </div>
      
      {/* Configuration Section */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 bg-card border border-border rounded-xl">
        <div className="md:col-span-4 flex flex-col gap-2">
           <label className="text-sm font-medium text-text-secondary">File Truyện</label>
           <div className="flex gap-2">
             <Input 
               placeholder="Chọn file..." 
               value={filePath}
               onChange={(e) => setFilePath(e.target.value)}
               containerClassName="flex-1"
               readOnly={!!currentProject} // Lock text input if in project to avoid confusion? Or allow edit?
             />
             <Button onClick={handleBrowse} variant="secondary" className="shrink-0">
               <FileText size={16} />
             </Button>
           </div>
        </div>

        <div className="md:col-span-3">
          <Select
            label="Ngôn ngữ gốc"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            options={LANG_OPTIONS}
          />
        </div>

        <div className="md:col-span-3">
           <Select
            label="Ngôn ngữ đích"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            options={LANG_OPTIONS}
          />
        </div>

        <div className="md:col-span-2 flex items-end gap-2">
          <Button 
            onClick={handleTranslate} 
            variant="secondary" 
            disabled={!filePath || status === 'running' || !selectedChapterId}
            className="flex-1"
            title="Dịch chương đang chọn"
          >
            <BookOpen size={16} />
            Dịch 1
          </Button>
          <Button 
            onClick={handleTranslateAll} 
            variant="primary" 
            disabled={!filePath || status === 'running' || selectedChapterCount === 0}
            className="flex-1"
            title="Dịch tất cả chương được chọn"
          >
            <BookOpen size={16} />
            {status === 'running' && batchProgress 
              ? `${batchProgress.current}/${batchProgress.total}` 
              : `Dịch ${selectedChapterCount}`}
          </Button>
        </div>
      </div>

      {/* Main Split View */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left Panel: Chapter List */}
        <div className="w-1/4 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
          {/* Header voi toggle buttons */}
          <div className="p-3 border-b border-border bg-surface/50">
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-text-primary">Danh sách chương</span>
              <span className="text-xs text-text-secondary bg-surface px-2 py-1 rounded">
                {selectedChapterCount}/{chapters.length}
              </span>
            </div>
            {chapters.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={selectAllChapters}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center justify-center gap-1"
                >
                  <CheckSquare size={12} />
                  Chọn tất cả
                </button>
                <button
                  onClick={deselectAllChapters}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-surface text-text-secondary hover:bg-surface/80 transition-colors flex items-center justify-center gap-1"
                >
                  <Square size={12} />
                  Bỏ chọn
                </button>
              </div>
            )}
          </div>
          
          {/* Chapter list voi checkboxes */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {chapters.map((chapter) => (
              <div
                key={chapter.id}
                className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
                  selectedChapterId === chapter.id
                    ? 'bg-primary text-text-invert'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleChapterExclusion(chapter.id);
                  }}
                  className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    isChapterIncluded(chapter.id)
                      ? selectedChapterId === chapter.id
                        ? 'bg-white border-white text-primary'
                        : 'bg-primary border-primary text-white'
                      : selectedChapterId === chapter.id
                        ? 'border-white/50'
                        : 'border-border'
                  }`}
                >
                  {isChapterIncluded(chapter.id) && (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                
                {/* Chapter title */}
                <button
                  onClick={() => {
                    setSelectedChapterId(chapter.id);
                    // Tự động chuyển sang view translated nếu đã có bản dịch
                    if (translatedChapters.has(chapter.id)) {
                      setViewMode('translated');
                    } else {
                      setViewMode('original');
                    }
                  }}
                  className={`flex-1 text-left truncate flex items-center gap-2 ${
                    !isChapterIncluded(chapter.id) ? 'opacity-50 line-through' : ''
                  }`}
                >
                  {chapter.title}
                  {/* Hiển thị icon nếu chương đã dịch */}
                  {translatedChapters.has(chapter.id) && (
                    <Check size={14} className={`shrink-0 ${
                      selectedChapterId === chapter.id ? 'text-green-300' : 'text-green-500'
                    }`} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel: Content */}
        <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
           <div className="p-3 border-b border-border font-semibold text-text-primary bg-surface/50 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <span>Nội dung</span>
              {selectedChapterId && (
                <div className="flex gap-1 bg-surface rounded p-1">
                  <button 
                    onClick={() => setViewMode('original')}
                    className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'original' ? 'bg-primary text-white shadow' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    Gốc
                  </button>
                  <button 
                    onClick={() => setViewMode('translated')}
                    disabled={!selectedChapterId || !translatedChapters.has(selectedChapterId)}
                    className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'translated' ? 'bg-primary text-white shadow' : 'text-text-secondary hover:text-text-primary disabled:opacity-50'}`}
                  >
                    Bản dịch
                  </button>
                </div>
              )}
            </div>
            {selectedChapterId && (
              <div className="flex gap-2 items-center">
                 {/* Hien thi trang thai loai tru */}
                 {!isChapterIncluded(selectedChapterId) && (
                   <span className="text-xs text-orange-500 bg-orange-500/10 px-2 py-1 rounded">
                     Đã loại trừ
                   </span>
                 )}
                 <Button onClick={handleSavePrompt} variant="secondary" className="text-xs h-8 px-2">
                   Lưu Prompt
                 </Button>
                 <span className="text-xs text-text-secondary px-2 py-1 bg-surface rounded border border-border">
                   {chapters.find(c => c.id === selectedChapterId)?.title}
                 </span>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-6 text-text-primary leading-relaxed whitespace-pre-wrap font-serif text-lg">
            {selectedChapterId ? (
              viewMode === 'original' ? (
                chapters.find(c => c.id === selectedChapterId)?.content
              ) : (
                translatedChapters.get(selectedChapterId) || <span className="text-text-secondary italic">Chưa có bản dịch. Nhấn "Dịch Ngay" để bắt đầu.</span>
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                <BookOpen size={48} className="mb-4" />
                <p>Chọn một chương để xem nội dung</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

