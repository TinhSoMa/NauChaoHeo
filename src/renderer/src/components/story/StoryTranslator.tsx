import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chapter, ParseStoryResult, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import { TranslationProject, ChapterTranslation } from '@shared/types/project';
import { GEMINI_MODEL_LIST } from '@shared/constants';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { BookOpen, FileText, CheckSquare, Square, Check, StopCircle, Download, Loader, Clock } from 'lucide-react';

export function StoryTranslator() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  
  const [currentProject, setCurrentProject] = useState<TranslationProject | null>(null);
  const [filePath, setFilePath] = useState('');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [model, setModel] = useState('gemini-3-flash-preview');
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
  const [shouldStop, setShouldStop] = useState(false);
  // Export ebook status
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting'>('idle');
  // Reading settings
  const [fontSize, setFontSize] = useState<number>(18);
  const [lineHeight, setLineHeight] = useState<number>(1.8);
  // Chapter processing tracking
  const [processingChapters, setProcessingChapters] = useState<Map<string, { startTime: number; workerId: number }>>(new Map());
  const [, setTick] = useState(0); // Force re-render for elapsed time

  // Update elapsed time every second
  useEffect(() => {
    if (processingChapters.size === 0) return;
    
    const interval = setInterval(() => {
      setTick(prev => prev + 1); // Force re-render to update elapsed time
    }, 1000);
    
    return () => clearInterval(interval);
  }, [processingChapters.size]);

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
      setModel(project.settings.model || 'gemini-3-flash-preview');

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
      console.log('[StoryTranslator] Loading translations for project:', id);
      const transResult = await window.electronAPI.project.getTranslations(id);
      console.log('[StoryTranslator] Translations result:', transResult);
      if (transResult.success && transResult.data) {
        console.log('[StoryTranslator] Found translations:', transResult.data.length);
        const transMap = new Map<string, string>();
        transResult.data.forEach((t: ChapterTranslation) => {
          console.log('[StoryTranslator] Mapping chapter:', t.chapterId, t.chapterTitle);
          transMap.set(t.chapterId, t.translatedContent);
        });
        setTranslatedChapters(transMap);
        console.log('[StoryTranslator] translatedChapters Map size:', transMap.size);
      } else {
        console.log('[StoryTranslator] No translations or error:', transResult.error);
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

  // Debug logging
  console.log('[StoryTranslator] Render - translatedChapters.size:', translatedChapters.size);
  console.log('[StoryTranslator] Render - status:', status);
  console.log('[StoryTranslator] Render - currentProject:', currentProject?.name);
  console.log('[StoryTranslator] Render - chapters.length:', chapters.length);

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
        targetLang,
        model
      }) as PreparePromptResult;
      
      if (!prepareResult.success || !prepareResult.prompt) {
        throw new Error(prepareResult.error || 'Loi chuan bi prompt');
      }

      console.log('[StoryTranslator] Da chuan bi prompt, dang gui den Gemini...');
      
      // 2. Send to Gemini for Translation
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
        prompt: prepareResult.prompt,
        model: model
      }) as { success: boolean; data?: string; error?: string };

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

  const handleStopTranslation = () => {
    console.log('[StoryTranslator] Dừng dịch thủ công...');
    setShouldStop(true);
  };

  // Dịch tất cả các chương được chọn (continuous queue - gửi liên tục sau khi hoàn thành)
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
    setShouldStop(false); // Reset stop flag

    const MAX_CONCURRENT = 5; // Số lượng tối đa chạy song song
    const MIN_DELAY = 5000; // 5 giây
    const MAX_DELAY = 30000; // 30 giây
    let completed = 0;
    let currentIndex = 0;
    const results: Array<{ id: string; text: string } | null> = [];

    // Helper function để dịch 1 chapter
    const translateChapter = async (chapter: Chapter, index: number, workerId: number): Promise<{ id: string; text: string } | null> => {
      // Kiểm tra nếu người dùng đã nhấn Dừng
      if (shouldStop) {
        console.log(`[StoryTranslator] ⚠️ Bỏ qua chương ${chapter.title} - Đã dừng`);
        return null;
      }
      
      setSelectedChapterId(chapter.id);
      
      // Mark as processing
      setProcessingChapters(prev => {
        const next = new Map(prev);
        next.set(chapter.id, { startTime: Date.now(), workerId });
        return next;
      });
      
      try {
        console.log(`[StoryTranslator] 📖 Dịch chương ${index + 1}/${chaptersToTranslate.length}: ${chapter.title}`);
        
        // 1. Prepare Prompt
        const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
          chapterContent: chapter.content,
          sourceLang,
          targetLang,
          model
        }) as PreparePromptResult;
        
        if (!prepareResult.success || !prepareResult.prompt) {
          console.error(`Lỗi chuẩn bị prompt cho chương ${chapter.title}:`, prepareResult.error);
          return null;
        }

        // 2. Send to Gemini for Translation
        const translateResult = await window.electronAPI.invoke(
          STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, 
          {
            prompt: prepareResult.prompt,
            model: model
          }
        ) as { success: boolean; data?: string; error?: string };

        if (translateResult.success && translateResult.data) {
          // Cập nhật UI NGAY khi dịch xong
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

          console.log(`[StoryTranslator] ✅ Dịch xong: ${chapter.title}`);
          return { id: chapter.id, text: translateResult.data! };
        } else {
          console.error(`[StoryTranslator] ❌ Lỗi dịch chương ${chapter.title}:`, translateResult.error);
          return null;
        }
      } catch (error) {
        console.error(`[StoryTranslator] ❌ Exception khi dịch chương ${chapter.title}:`, error);
        return null;
      } finally {
        // Remove from processing
        setProcessingChapters(prev => {
          const next = new Map(prev);
          next.delete(chapter.id);
          return next;
        });
      }
    };

    // Worker function - xử lý từng chapter liên tục
    const worker = async (workerId: number) => {
      console.log(`[StoryTranslator] 🚀 Worker ${workerId} started`);
      
      while (currentIndex < chaptersToTranslate.length && !shouldStop) {
        const index = currentIndex++;
        const chapter = chaptersToTranslate[index];
        
        // CHỈ chapter đầu tiên (Ch1) gửi ngay, TẤT CẢ các chapter khác đều chờ random
        const isVeryFirstChapter = index === 0;
        if (!isVeryFirstChapter) {
          const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
          console.log(`[StoryTranslator] ⏳ Worker ${workerId} chờ ${Math.round(delay/1000)}s trước khi dịch chương ${index + 1}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.log(`[StoryTranslator] 🚀 Chương 1 gửi ngay lập tức (không delay)`);
        }
        
        // Kiểm tra lại shouldStop sau khi chờ
        if (shouldStop) {
          console.log(`[StoryTranslator] ⚠️ Worker ${workerId} stopped`);
          break;
        }
        
        const result = await translateChapter(chapter, index, workerId);
        results.push(result);
        
        completed++;
        setBatchProgress({ current: completed, total: chaptersToTranslate.length });
        
        console.log(`[StoryTranslator] 📊 Progress: ${completed}/${chaptersToTranslate.length} (Worker ${workerId})`);
      }
      
      console.log(`[StoryTranslator] ✓ Worker ${workerId} finished`);
    };

    // Khởi động MAX_CONCURRENT workers song song
    console.log(`[StoryTranslator] 🎯 Bắt đầu dịch ${chaptersToTranslate.length} chapters với ${MAX_CONCURRENT} workers song song`);
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, chaptersToTranslate.length) }, (_, i) => 
      worker(i + 1)
    );
    
    await Promise.all(workers);

    setStatus('idle');
    setBatchProgress(null);
    setViewMode('translated');
    
    if (shouldStop) {
      console.log(`[StoryTranslator] 🛑 Đã dừng: ${results.filter(r => r).length}/${chaptersToTranslate.length} chapters đã dịch`);
    } else {
      console.log(`[StoryTranslator] 🎉 Hoàn thành: ${results.filter(r => r).length}/${chaptersToTranslate.length} chapters`);
    }
  };

  const handleSavePrompt = async () => {
    if (!selectedChapterId) return;
    const chapter = chapters.find(c => c.id === selectedChapterId);
    if (!chapter) return;

    try {
       const result = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang,
        model
      }) as PreparePromptResult;

      if (result.success && result.prompt) {
         const promptString = JSON.stringify(result.prompt);
         await window.electronAPI.invoke(STORY_IPC_CHANNELS.SAVE_PROMPT, promptString);
      }
    } catch (e) {
      console.error('[StoryTranslator] Loi luu prompt:', e);
    }
  }

  // Export all translations to EPUB ebook
  const handleExportEbook = async () => {
    if (!currentProject) {
      alert('Vui lòng mở một dự án trước khi export!');
      return;
    }

    if (translatedChapters.size === 0) {
      alert('Chưa có chương nào được dịch để export!');
      return;
    }

    setExportStatus('exporting');

    try {
      console.log('[StoryTranslator] Bắt đầu export ebook...');
      
      // 1. Lấy tất cả bản dịch từ project (đảm bảo sync với DB)
      const transResult = await window.electronAPI.project.getTranslations(currentProject.id);
      
      if (!transResult.success || !transResult.data || transResult.data.length === 0) {
        alert('Không tìm thấy bản dịch nào để export!');
        setExportStatus('idle');
        return;
      }

      // 2. Sắp xếp chapters theo thứ tự (parse chapterId as number if possible)
      const sortedTranslations = [...transResult.data].sort((a: ChapterTranslation, b: ChapterTranslation) => {
        const numA = parseInt(a.chapterId);
        const numB = parseInt(b.chapterId);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return a.chapterId.localeCompare(b.chapterId);
      });

      // 3. Chuẩn bị chapters data cho ebook
      const ebookChapters = sortedTranslations.map((t: ChapterTranslation) => ({
        title: t.chapterTitle,
        content: t.translatedContent
      }));

      console.log(`[StoryTranslator] Đóng gói ${ebookChapters.length} chương...`);

      // 4. Gọi service tạo ebook - lưu vào thư mục project
      const result = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.CREATE_EBOOK,
        {
          chapters: ebookChapters,
          title: currentProject.name,
          author: 'AI Translator',
          filename: `${currentProject.name}_${sourceLang}-${targetLang}`,
          outputDir: currentProject.projectFolderPath // Lưu trong thư mục project
        }
      ) as { success: boolean; filePath?: string; error?: string };

      if (result.success && result.filePath) {
        console.log('[StoryTranslator] Export thành công:', result.filePath);
        
        // 5. Cập nhật outputFilePath trong project
        await window.electronAPI.project.update(currentProject.id, {
          outputFilePath: result.filePath
        });

        alert(`✅ Đã export thành công!\n\nFile: ${result.filePath}\n\nSố chương: ${ebookChapters.length}`);
      } else {
        throw new Error(result.error || 'Export thất bại');
      }

    } catch (error) {
      console.error('[StoryTranslator] Lỗi export ebook:', error);
      alert(`❌ Lỗi export ebook: ${error}`);
    } finally {
      setExportStatus('idle');
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
          <div className="flex items-center gap-3">
            <span className="text-sm px-3 py-1 bg-primary/10 text-primary rounded-full">
              Đã dịch: {translatedChapters.size}/{chapters.length} chương
            </span>
            {translatedChapters.size > 0 && (
              <Button 
                onClick={handleExportEbook}
                variant="primary"
                disabled={exportStatus === 'exporting'}
                className="h-8 px-4 text-sm"
              >
                <Download size={16} />
                {exportStatus === 'exporting' ? 'Đang export...' : 'Export EPUB'}
              </Button>
            )}
          </div>
        )}
      </div>
      
      {/* Configuration Section */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 bg-card border border-border rounded-xl">
        <div className="md:col-span-3 flex flex-col gap-2">
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

        <div className="md:col-span-2">
          <Select
            label="Ngôn ngữ gốc"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            options={LANG_OPTIONS}
          />
        </div>

        <div className="md:col-span-2">
           <Select
            label="Ngôn ngữ đích"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            options={LANG_OPTIONS}
          />
        </div>

        <div className="md:col-span-3">
          <Select
            label="Model AI"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            options={GEMINI_MODEL_LIST.map(m => ({
              value: m.id,
              label: m.label
            }))}
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
          {status === 'running' && batchProgress ? (
            <Button 
              onClick={handleStopTranslation}
              variant="secondary"
              className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
              title="Dừng dịch batch hiện tại"
            >
              <StopCircle size={16} />
              Dừng ({batchProgress.current}/{batchProgress.total})
            </Button>
          ) : (
            <Button 
              onClick={handleTranslateAll} 
              variant="primary" 
              disabled={!filePath || status === 'running' || selectedChapterCount === 0}
              className="flex-1"
              title="Dịch tất cả chương được chọn"
            >
              <BookOpen size={16} />
              Dịch {selectedChapterCount}
            </Button>
          )}
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
            {chapters.map((chapter) => {
              const isProcessing = processingChapters.has(chapter.id);
              const processingInfo = processingChapters.get(chapter.id);
              const elapsedTime = isProcessing && processingInfo 
                ? Math.floor((Date.now() - processingInfo.startTime) / 1000)
                : 0;
              
              return (
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
                  
                  {/* Processing Indicator */}
                  {isProcessing && processingInfo && (
                    <span className={`flex items-center gap-1 shrink-0 text-xs ${
                      selectedChapterId === chapter.id ? 'text-yellow-300' : 'text-yellow-500'
                    }`}>
                      <Loader size={12} className="animate-spin" />
                      <span className="font-mono">W{processingInfo.workerId}</span>
                      <Clock size={10} />
                      <span className="font-mono">{elapsedTime}s</span>
                    </span>
                  )}
                  
                  {/* Hiển thị icon nếu chương đã dịch */}
                  {!isProcessing && translatedChapters.has(chapter.id) && (
                    <Check size={14} className={`shrink-0 ${
                      selectedChapterId === chapter.id ? 'text-green-300' : 'text-green-500'
                    }`} />
                  )}
                </button>
              </div>
            )})}
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
              
              {/* Reading Controls */}
              {selectedChapterId && (
                <div className="flex items-center gap-3 ml-2 pl-3 border-l border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">Cỡ chữ:</span>
                    <button 
                      onClick={() => setFontSize(prev => Math.max(12, prev - 2))}
                      className="w-6 h-6 rounded bg-surface hover:bg-surface/80 text-text-primary flex items-center justify-center text-sm"
                    >
                      -
                    </button>
                    <span className="text-xs text-text-secondary min-w-[2rem] text-center">{fontSize}px</span>
                    <button 
                      onClick={() => setFontSize(prev => Math.min(32, prev + 2))}
                      className="w-6 h-6 rounded bg-surface hover:bg-surface/80 text-text-primary flex items-center justify-center text-sm"
                    >
                      +
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">Giãn dòng:</span>
                    <button 
                      onClick={() => setLineHeight(prev => Math.max(1.2, prev - 0.2))}
                      className="w-6 h-6 rounded bg-surface hover:bg-surface/80 text-text-primary flex items-center justify-center text-sm"
                    >
                      -
                    </button>
                    <span className="text-xs text-text-secondary min-w-[2rem] text-center">{lineHeight.toFixed(1)}</span>
                    <button 
                      onClick={() => setLineHeight(prev => Math.min(3, prev + 0.2))}
                      className="w-6 h-6 rounded bg-surface hover:bg-surface/80 text-text-primary flex items-center justify-center text-sm"
                    >
                      +
                    </button>
                  </div>
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
          <div 
            className="flex-1 overflow-y-auto px-8 py-6 text-text-primary"
            style={{
              fontSize: `${fontSize}px`,
              lineHeight: lineHeight,
              fontFamily: "'Noto Sans', 'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif",
              letterSpacing: '0.01em',
              wordSpacing: '0.05em'
            }}
          >
            <div className="max-w-4xl mx-auto">
              {selectedChapterId ? (
                viewMode === 'original' ? (
                  <div className="whitespace-pre-wrap break-words">
                    {chapters.find(c => c.id === selectedChapterId)?.content}
                  </div>
                ) : (
                  translatedChapters.get(selectedChapterId) ? (
                    <div className="whitespace-pre-wrap break-words">
                      {translatedChapters.get(selectedChapterId)}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                      <BookOpen size={48} className="mb-4" />
                      <p className="text-base">Chưa có bản dịch. Nhấn "Dịch 1" hoặc "Dịch All" để bắt đầu.</p>
                    </div>
                  )
                )
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                  <BookOpen size={48} className="mb-4" />
                  <p className="text-base">Chọn một chương để xem nội dung</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

