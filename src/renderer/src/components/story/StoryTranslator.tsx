import { useState, useEffect, useRef } from 'react';
import { Chapter, ParseStoryResult, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
// import { TranslationProject, ChapterTranslation } from '@shared/types/project';
import { GEMINI_MODEL_LIST } from '@shared/constants';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { BookOpen, FileText, CheckSquare, Square, StopCircle, Download, Loader, Clock } from 'lucide-react';
import { useProjectContext } from '../../context/ProjectContext';

export function StoryTranslator() {
  const { projectId, paths } = useProjectContext();
  const hasLoadedRef = useRef(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const [filePath, setFilePath] = useState('');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [model, setModel] = useState('gemini-3-flash-preview');
  const [translateMode, setTranslateMode] = useState<'api' | 'token' | 'both'>('api');
  const [status, setStatus] = useState('idle');
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Map lưu trữ bản dịch theo chapterId
  const [translatedChapters, setTranslatedChapters] = useState<Map<string, string>>(new Map());
  const [chapterModels, setChapterModels] = useState<Map<string, string>>(new Map());
  const [chapterMethods, setChapterMethods] = useState<Map<string, 'api' | 'token'>>(new Map());
  const [translatedTitles, setTranslatedTitles] = useState<Map<string, string>>(new Map());
  const [tokenConfigId, setTokenConfigId] = useState<string | null>(null);
  const [tokenContext, setTokenContext] = useState<{ conversationId: string; responseId: string; choiceId: string } | null>(null);
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
  const [processingChapters, setProcessingChapters] = useState<
    Map<string, { startTime: number; workerId: number; channel: 'api' | 'token' }>
  >(new Map());
  const [, setTick] = useState(0); // Force re-render for elapsed time

  const extractTranslatedTitle = (text: string, fallbackId: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines[0] || `Chương ${fallbackId}`;
  };

  // Update elapsed time every second
  useEffect(() => {
    if (processingChapters.size === 0) return;
    
    const interval = setInterval(() => {
      setTick(prev => prev + 1); // Force re-render to update elapsed time
    }, 1000);
    
    return () => clearInterval(interval);
  }, [processingChapters.size]);

  const STORY_STATE_FILE = 'story-translator.json';

  const loadConfigurations = async () => {
    try {
      const configsResult = await window.electronAPI.geminiChat.getAll();
      if (configsResult.success && configsResult.data) {
        const configs = configsResult.data;
        const activeConfig = configs.find(c => c.isActive);
        const fallbackConfig = configs[0];
        const nextId = tokenConfigId || activeConfig?.id || fallbackConfig?.id || null;
        if (nextId && nextId !== tokenConfigId) {
          setTokenConfigId(nextId);
        }
      }
    } catch (e) {
      console.error('[StoryTranslator] Error loading config:', e);
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

  const getWorkerChannel = (workerId: number): 'api' | 'token' => {
    if (translateMode === 'api') return 'api';
    if (translateMode === 'token') return 'token';
    return workerId === 1 ? 'token' : 'api';
  };

  // Debug logging
  console.log('[StoryTranslator] Render - translatedChapters.size:', translatedChapters.size);
  console.log('[StoryTranslator] Render - status:', status);
  console.log('[StoryTranslator] Render - chapters.length:', chapters.length);

  const handleBrowse = async () => {
    const result = await window.electronAPI.invoke('dialog:openFile', {
      filters: [{ name: 'Text/Epub', extensions: ['txt', 'epub'] }]
    }) as { canceled: boolean; filePaths: string[] };

    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0];
      setFilePath(path);
      parseFile(path);
    }
  };

  const parseFile = async (
    path: string,
    options?: { keepTranslations?: boolean; keepSelection?: boolean }
  ): Promise<boolean> => {
      // Parse file truyen
      setStatus('running');
      try {
        const parseResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PARSE, path) as ParseStoryResult;
        if (parseResult.success && parseResult.chapters) {
          setChapters(parseResult.chapters);
          // Mac dinh chon tat ca cac chuong
          setExcludedChapterIds(new Set());
          if (parseResult.chapters.length > 0) {
             if (!options?.keepSelection) {
               setSelectedChapterId(parseResult.chapters[0].id);
             }
             if (!options?.keepTranslations) {
               setTranslatedChapters(new Map());
               setViewMode('original');
             }
          }
          return true;
        } else {
          console.error('[StoryTranslator] Loi parse file:', parseResult.error);
          return false;
        }
      } catch (error) {
         console.error('[StoryTranslator] Loi invoke story:parse:', error);
         return false;
      } finally {
        setStatus('idle');
      }
  }

  const loadStoryState = async () => {
    if (!projectId) return;

    try {
      const res = await window.electronAPI.project.readFeatureFile({
        projectId,
        feature: 'story',
        fileName: STORY_STATE_FILE
      });

      if (res?.success && res.data) {
        const saved = JSON.parse(res.data) as {
          filePath?: string;
          sourceLang?: string;
          targetLang?: string;
          model?: string;
          translateMode?: 'api' | 'token' | 'both';
          translatedEntries?: Array<[string, string]>;
          chapterModels?: Array<[string, string]>;
          chapterMethods?: Array<[string, 'api' | 'token']>;
          translatedTitles?: Array<{ id: string; title: string }>;
          tokenConfigId?: string | null;
          tokenContext?: { conversationId: string; responseId: string; choiceId: string } | null;
          viewMode?: 'original' | 'translated';
          excludedChapterIds?: string[];
          selectedChapterId?: string | null;
        };

        if (saved.sourceLang) setSourceLang(saved.sourceLang);
        if (saved.targetLang) setTargetLang(saved.targetLang);
        if (saved.model) setModel(saved.model);
        if (saved.translateMode) setTranslateMode(saved.translateMode);
        if (saved.translatedEntries) setTranslatedChapters(new Map(saved.translatedEntries));
        if (saved.chapterModels) setChapterModels(new Map(saved.chapterModels));
        if (saved.chapterMethods) setChapterMethods(new Map(saved.chapterMethods));
        if (saved.translatedTitles) {
          setTranslatedTitles(new Map(saved.translatedTitles.map((t) => [t.id, t.title] as [string, string])));
        }
        if (typeof saved.tokenConfigId !== 'undefined') {
          setTokenConfigId(saved.tokenConfigId || null);
        }
        if (typeof saved.tokenContext !== 'undefined') {
          setTokenContext(saved.tokenContext || null);
        }

        let parsedOk = false;
        if (saved.filePath) {
          setFilePath(saved.filePath);
          parsedOk = await parseFile(saved.filePath, { keepTranslations: true, keepSelection: true });
        }

        if (!parsedOk && saved.translatedTitles && saved.translatedTitles.length > 0) {
          setChapters(saved.translatedTitles.map((c) => ({ id: c.id, title: c.title, content: '' })));
        }

        if (saved.viewMode) setViewMode(saved.viewMode);
        if (saved.excludedChapterIds) setExcludedChapterIds(new Set(saved.excludedChapterIds));
        if (typeof saved.selectedChapterId !== 'undefined') setSelectedChapterId(saved.selectedChapterId);
      }
    } catch (error) {
      console.error('[StoryTranslator] Loi khi tai du lieu project:', error);
    } finally {
      hasLoadedRef.current = true;
    }
  };

  const saveStoryState = async () => {
    if (!projectId) return;

    // Các thuộc tính được lưu vào project/story/story-translator.json:
    // - filePath: đường dẫn file input gốc (không lưu text gốc)
    // - sourceLang/targetLang: cặp ngôn ngữ dịch
    // - model: model mặc định đang chọn
    // - translatedEntries: map chapterId -> nội dung đã dịch
    // - chapterModels: map chapterId -> model đã dùng cho chương đó
    // - translatedTitles: danh sách (id, title) của chương đã dịch để hiển thị khi không parse lại được input
    // - viewMode: chế độ xem (original/translated)
    // - excludedChapterIds: các chương bị loại trừ
    // - selectedChapterId: chương đang chọn
    const orderedTranslatedEntries = chapters
      .filter((c) => translatedChapters.has(c.id))
      .map((c) => [c.id, translatedChapters.get(c.id)!] as [string, string]);

    const orderedChapterModels = orderedTranslatedEntries.map(([chapterId]) => {
      const usedModel = chapterModels.get(chapterId) || model;
      return [chapterId, usedModel] as [string, string];
    });

    const orderedChapterMethods = orderedTranslatedEntries.map(([chapterId]) => {
      const usedMethod = chapterMethods.get(chapterId) || (translateMode === 'token' ? 'token' : 'api');
      return [chapterId, usedMethod] as [string, 'api' | 'token'];
    });

    const translatedTitles = orderedTranslatedEntries.map(([chapterId, content]) => ({
      id: chapterId,
      title: extractTranslatedTitle(content, chapterId)
    }));

    const payload = {
      filePath,
      sourceLang,
      targetLang,
      model,
      translateMode,
      translatedEntries: orderedTranslatedEntries,
      chapterModels: orderedChapterModels,
      chapterMethods: orderedChapterMethods,
      translatedTitles,
      tokenConfigId,
      tokenContext,
      viewMode,
      excludedChapterIds: Array.from(excludedChapterIds.values()),
      selectedChapterId
    };

    await window.electronAPI.project.writeFeatureFile({
      projectId,
      feature: 'story',
      fileName: STORY_STATE_FILE,
      content: payload
    });
  };

  useEffect(() => {
    if (!projectId || !paths) return;
    loadStoryState();
  }, [projectId, paths]);

  useEffect(() => {
    loadConfigurations();
  }, []);

  useEffect(() => {
    if (translateMode === 'token' || translateMode === 'both') {
      if (!tokenConfigId) {
        loadConfigurations();
      }
    }
  }, [translateMode, tokenConfigId]);

  useEffect(() => {
    if (!projectId || !paths || !hasLoadedRef.current) return;

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      saveStoryState();
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    projectId,
    paths,
    filePath,
    sourceLang,
    targetLang,
    model,
    translateMode,
    chapters,
    translatedChapters,
    chapterModels,
    chapterMethods,
    translatedTitles,
    tokenConfigId,
    tokenContext,
    viewMode,
    excludedChapterIds,
    selectedChapterId
  ]);

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
      
      const method = translateMode === 'token' ? 'WEB' : 'API';
      const methodKey: 'api' | 'token' = method === 'WEB' ? 'token' : 'api';

      if (method === 'WEB' && !tokenConfigId) {
        await loadConfigurations();
        if (!tokenConfigId) {
          alert('Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return;
        }
      }

      // 2. Send to Gemini for Translation
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
        prompt: prepareResult.prompt,
        model: model,
        method,
        context: method === 'WEB' ? tokenContext : undefined,
        webConfigId: method === 'WEB' ? tokenConfigId || undefined : undefined,
        useProxy: method === 'WEB'
      }) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string };

      if (translateResult.success && translateResult.data) {
        // Lưu bản dịch vào Map cache
        setTranslatedChapters(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, translateResult.data!);
          return next;
        });

        setTranslatedTitles(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, extractTranslatedTitle(translateResult.data!, selectedChapterId));
          return next;
        });

        setChapterModels(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, model);
          return next;
        });

        setChapterMethods(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, methodKey);
          return next;
        });

        if (translateResult.context && translateResult.context.conversationId) {
          setTokenContext(translateResult.context);
        }
        if (translateResult.configId) {
          setTokenConfigId(translateResult.configId);
        }

        // REMOVED: Saving to Project DB

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

    const MAX_CONCURRENT = translateMode === 'both' ? 6 : translateMode === 'token' ? 1 : 5; // token chạy 1 worker, api chạy 5, both: 5 API + 1 Token
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
      
      const channel = getWorkerChannel(workerId);

      // Mark as processing
      setProcessingChapters(prev => {
        const next = new Map(prev);
        next.set(chapter.id, { startTime: Date.now(), workerId, channel });
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

        const method = channel === 'token' ? 'WEB' : 'API';

        if (method === 'WEB' && !tokenConfigId) {
          await loadConfigurations();
          if (!tokenConfigId) {
            console.error('[StoryTranslator] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
            return null;
          }
        }

        // 2. Send to Gemini for Translation
        const translateResult = await window.electronAPI.invoke(
          STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, 
          {
            prompt: prepareResult.prompt,
            model: model,
            method,
            context: method === 'WEB' ? tokenContext : undefined,
            webConfigId: method === 'WEB' ? tokenConfigId || undefined : undefined,
            useProxy: method === 'WEB'
          }
        ) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string };

        if (translateResult.success && translateResult.data) {
          // Cập nhật UI NGAY khi dịch xong
          setTranslatedChapters(prev => {
            const next = new Map(prev);
            next.set(chapter.id, translateResult.data!);
            return next;
          });

          setTranslatedTitles(prev => {
            const next = new Map(prev);
            next.set(chapter.id, extractTranslatedTitle(translateResult.data!, chapter.id));
            return next;
          });

          setChapterModels(prev => {
            const next = new Map(prev);
            next.set(chapter.id, model);
            return next;
          });

          setChapterMethods(prev => {
            const next = new Map(prev);
            next.set(chapter.id, channel);
            return next;
          });

          if (translateResult.context && translateResult.context.conversationId) {
            setTokenContext(translateResult.context);
          }
          if (translateResult.configId) {
            setTokenConfigId(translateResult.configId);
          }

          // REMOVED: Saving to Project DB

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
    // REMOVED check project
    if (translatedChapters.size === 0) {
      alert('Chưa có chương nào được dịch để export!');
      return;
    }

    setExportStatus('exporting');

    try {
      console.log('[StoryTranslator] Bắt đầu export ebook...');
      
      // 1. Ask user for save location
      const saveDialogResult = await window.electronAPI.invoke('dialog:showSaveDialog', {
          title: 'Lưu Ebook EPUB',
          defaultPath: `output_${sourceLang}-${targetLang}.epub`,
          filters: [{ name: 'EPUB Ebook', extensions: ['epub'] }]
      }) as { canceled: boolean; filePath?: string };

      if (saveDialogResult.canceled || !saveDialogResult.filePath) {
          setExportStatus('idle');
          return;
      }

      // 2. Prepare chapters using stored translated entries order
      const ebookChapters: { title: string; content: string }[] = [];
      const titleMap = new Map(
        chapters.map((c) => [c.id, c.title] as [string, string])
      );
      const translatedTitleMap = new Map(
        chapters
          .filter((c) => translatedChapters.has(c.id))
          .map((c) => [c.id, c.title] as [string, string])
      );

      const orderedTranslatedEntries = chapters.length > 0
        ? chapters
            .filter((c) => translatedChapters.has(c.id))
            .map((c) => [c.id, translatedChapters.get(c.id)!] as [string, string])
        : Array.from(translatedChapters.entries());

      for (const [chapterId, content] of orderedTranslatedEntries) {
        const title =
          translatedTitleMap.get(chapterId) ||
          titleMap.get(chapterId) ||
          `Chương ${chapterId}`;
        ebookChapters.push({ title, content });
      }

        if (ebookChapters.length === 0) {
          alert('Lỗi: Không tìm thấy nội dung đã dịch khớp với các chương hiện có.');
          setExportStatus('idle');
          return;
      }

      console.log(`[StoryTranslator] Đóng gói ${ebookChapters.length} chương...`);
      const outputDir = saveDialogResult.filePath.substring(0, saveDialogResult.filePath.lastIndexOf('\\')); // simplistic dirname for windows
      const filename = saveDialogResult.filePath.substring(saveDialogResult.filePath.lastIndexOf('\\') + 1).replace('.epub', '');

      // 4. Gọi service tạo ebook
      // Note: We need to adjust how we pass outputDir/filename because `createEbook` logic in backend might be rigid about `outputDir` + `filename`.
      // Or we can modify backend `createEbook` to accept exact `outputPath`.
      // Current: `outputDir`, `filename`. 
      // Let's rely on `outputDir` being the folder and `filename` being the name.
      
      const result = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.CREATE_EBOOK,
        {
          chapters: ebookChapters,
          title: filename, // Use filename as title for now
          author: 'AI Translator',
          filename: filename,
          outputDir: outputDir 
        }
      ) as { success: boolean; filePath?: string; error?: string };

      if (result.success && result.filePath) {
        console.log('[StoryTranslator] Export thành công:', result.filePath);
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
          Dịch Truyện AI
        </h1>
        {chapters.length > 0 && (
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
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 bg-card border border-border rounded-xl">
        <div className="md:col-span-3 flex flex-col gap-1">
           <label className="text-sm font-medium text-text-secondary">File Truyện</label>
           <div className="flex gap-2">
             <Input 
               placeholder="Chọn file..." 
               value={filePath}
               onChange={(e) => setFilePath(e.target.value)}
               containerClassName="flex-1"
             />
             <Button onClick={handleBrowse} variant="secondary" className="shrink-0 h-9 px-3">
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

        <div className="md:col-span-2">
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

        <div className="md:col-span-1">
          <Select
            label="Chế độ dịch"
            value={translateMode}
            onChange={(e) => setTranslateMode(e.target.value as 'api' | 'token' | 'both')}
            options={[
              { value: 'api', label: 'API' },
              { value: 'token', label: 'Token' },
              { value: 'both', label: 'Kết hợp (API + Token)' }
            ]}
          />
        </div>

        <div className="md:col-span-2 flex items-end gap-2">
          <Button 
            onClick={handleTranslate} 
            variant="secondary" 
            disabled={!filePath || status === 'running' || !selectedChapterId}
            className="flex-1 h-9 px-3"
            title="Dịch chương đang chọn"
          >
            <BookOpen size={16} />
            Dịch 1
          </Button>
          {status === 'running' && batchProgress ? (
            <Button 
              onClick={handleStopTranslation}
              variant="secondary"
              className="flex-1 h-9 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
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
              className="flex-1 h-9 px-3"
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
              const hasTranslatedTitle = translatedTitles.has(chapter.id) || translatedChapters.has(chapter.id);
              
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
                  <span className={hasTranslatedTitle ? 'text-emerald-500' : 'text-text-secondary'}>
                    {translatedTitles.get(chapter.id)
                      || (translatedChapters.has(chapter.id)
                        ? extractTranslatedTitle(translatedChapters.get(chapter.id) || '', chapter.id)
                        : chapter.title)}
                  </span>
                  
                  {/* Processing Indicator */}
                  {isProcessing && processingInfo && (
                    <span className={`flex items-center gap-1 shrink-0 text-xs ${
                      selectedChapterId === chapter.id ? 'text-yellow-300' : 'text-yellow-500'
                    }`}>
                      <span className={`px-1.5 py-0.5 rounded border ${
                        selectedChapterId === chapter.id
                          ? 'border-yellow-300/60 bg-yellow-300/10'
                          : 'border-yellow-500/60 bg-yellow-500/10'
                      }`}>
                        {processingInfo.channel === 'api' ? 'API' : 'TOKEN'}
                      </span>
                      <Loader size={12} className="animate-spin" />
                      <span className="font-mono">W{processingInfo.workerId}</span>
                      <Clock size={10} />
                      <span className="font-mono">{elapsedTime}s</span>
                    </span>
                  )}
                  
                  {/* Hiển thị tên chương đã dịch thay vì dấu tích */}
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
                    <span className="text-xs text-text-secondary min-w-8 text-center">{fontSize}px</span>
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
                    <span className="text-xs text-text-secondary min-w-8 text-center">{lineHeight.toFixed(1)}</span>
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
                  <div className="whitespace-pre-wrap wrap-break-word">
                    {chapters.find(c => c.id === selectedChapterId)?.content}
                  </div>
                ) : (
                  translatedChapters.get(selectedChapterId) ? (
                    <div className="whitespace-pre-wrap wrap-break-word">
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

