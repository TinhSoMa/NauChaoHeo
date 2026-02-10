import { useState, useEffect, useRef } from 'react';
import { Chapter, ParseStoryResult, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
// import { TranslationProject, ChapterTranslation } from '@shared/types/project';
import { GEMINI_MODEL_LIST } from '@shared/constants';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { BookOpen, FileText, CheckSquare, Square, StopCircle, Download, Loader, Clock } from 'lucide-react';
import { useProjectFeatureState } from '../../hooks/useProjectFeatureState';

interface GeminiChatConfigLite {
  id: string;
  cookie: string;
  atToken: string;
  isActive: boolean;
  isError?: boolean;
  email?: string;
}

type TokenContext = { conversationId: string; responseId: string; choiceId: string };

const extractCookieKey = (cookie: string): string => {
  const trimmed = cookie.trim();
  const psid1 = trimmed.match(/__Secure-1PSID=([^;\s]+)/)?.[1] || '';
  const psid3 = trimmed.match(/__Secure-3PSID=([^;\s]+)/)?.[1] || '';
  const combined = [psid1, psid3].filter(Boolean).join('|');
  return combined || trimmed;
};

const buildTokenKey = (config: GeminiChatConfigLite): string => {
  return `${extractCookieKey(config.cookie || '')}|${(config.atToken || '').trim()}`;
};

export function StoryTranslator() {
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
  const [tokenConfigs, setTokenConfigs] = useState<GeminiChatConfigLite[]>([]);
  const [tokenContexts, setTokenContexts] = useState<Map<string, TokenContext>>(new Map());
  const [summaries, setSummaries] = useState<Map<string, string>>(new Map());
  const [summaryTitles, setSummaryTitles] = useState<Map<string, string>>(new Map());
  const [viewMode, setViewMode] = useState<'original' | 'translated' | 'summary'>('original');
  // Danh sach cac chuong bi loai tru khoi dich thuat
  const [excludedChapterIds, setExcludedChapterIds] = useState<Set<string>>(new Set());
  // Last clicked chapter for Shift+Click selection
  const [lastClickedChapterId, setLastClickedChapterId] = useState<string | null>(null);
  // Progress cho batch translation
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [, setShouldStop] = useState(false);
  const shouldStopRef = useRef(false);
  
  // Batch translation state
  const batchStateRef = useRef<{
    chapters: Chapter[];
    currentIndex: number;
    completed: number;
    activeWorkerConfigIds: Set<string>;
    isFirstChapterTaken: boolean;
  }>({
    chapters: [],
    currentIndex: 0,
    completed: 0,
    activeWorkerConfigIds: new Set(),
    isFirstChapterTaken: false
  });
  const workerIdRef = useRef(0);
  const MIN_DELAY = 5000;
  const MAX_DELAY = 30000;
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
  const [useProxy, setUseProxy] = useState(true);
  const [retranslateExisting, setRetranslateExisting] = useState(false);

  const loadProxySetting = async () => {
    try {
      const result = await window.electronAPI.appSettings.getAll();
      if (result.success && result.data) {
        setUseProxy(result.data.useProxy);
      }
    } catch (error) {
      console.error('[StoryTranslator] Error loading proxy setting:', error);
    }
  };

  const extractTranslatedTitle = (text: string, fallbackId: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines[0] || `Chương ${fallbackId}`;
  };

  // Kiểm tra xem bản dịch có marker kết thúc hay không
  const hasEndMarker = (text: string): boolean => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    
    if (lines.length === 0) return false;
    
    const lastLine = lines[lines.length - 1];
    // Check các biến thể của "Hết chương"
    return /hết\s+chương|end\s+of\s+chapter|---\s*hết\s*---/i.test(lastLine);
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
        const configs = configsResult.data as GeminiChatConfigLite[];
        setTokenConfigs(configs);

        const activeConfigs = configs.filter(c => c.isActive && !c.isError);
        const uniqueActive = activeConfigs.filter((config, index) => {
          const key = buildTokenKey(config);
          return activeConfigs.findIndex(c => buildTokenKey(c) === key) === index;
        });

        const fallbackConfig = uniqueActive[0] || configs[0];
        const nextId = tokenConfigId || fallbackConfig?.id || null;
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

  // Toggle trang thai loai tru cua mot chuong (với hỗ trợ Shift+Click)
  const toggleChapterExclusion = (chapterId: string, shiftKey?: boolean) => {
    // Shift+Click: Chọn/bỏ chọn khoảng từ lastClickedChapterId đến chapterId
    if (shiftKey && lastClickedChapterId && lastClickedChapterId !== chapterId) {
      const lastIndex = chapters.findIndex(c => c.id === lastClickedChapterId);
      const currentIndex = chapters.findIndex(c => c.id === chapterId);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeChapters = chapters.slice(start, end + 1);
        
        // Xác định hành động: nếu chương hiện tại đang excluded thì include range, ngược lại exclude range
        const shouldInclude = excludedChapterIds.has(chapterId);
        
        setExcludedChapterIds(prev => {
          const next = new Set(prev);
          rangeChapters.forEach(c => {
            if (shouldInclude) {
              next.delete(c.id);
            } else {
              next.add(c.id);
            }
          });
          return next;
        });
      }
    } else {
      // Click thường: Toggle một chương
      setExcludedChapterIds(prev => {
        const next = new Set(prev);
        if (next.has(chapterId)) {
          next.delete(chapterId);
        } else {
          next.add(chapterId);
        }
        return next;
      });
    }
    
    // Cập nhật chương được click cuối cùng
    setLastClickedChapterId(chapterId);
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

  const getDistinctActiveTokenConfigs = (configs: GeminiChatConfigLite[]) => {
    const activeConfigs = configs.filter(c => c.isActive && !c.isError);
    const seenKeys = new Set<string>();
    const distinct: GeminiChatConfigLite[] = [];
    for (const config of activeConfigs) {
      const key = buildTokenKey(config);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      distinct.push(config);
    }
    return distinct;
  };

  const getTokenConfigById = (id: string | null): GeminiChatConfigLite | null => {
    if (!id) return null;
    return tokenConfigs.find(c => c.id === id) || null;
  };

  const getPreferredTokenConfig = (): GeminiChatConfigLite | null => {
    const direct = getTokenConfigById(tokenConfigId);
    if (direct) return direct;

    const distinctActive = getDistinctActiveTokenConfigs(tokenConfigs);
    if (distinctActive.length === 0) return null;

    const fallback = distinctActive[0];
    if (fallback && fallback.id !== tokenConfigId) {
      setTokenConfigId(fallback.id);
    }
    return fallback;
  };

  const migrateTokenContextsToTokenKey = (
    configs: GeminiChatConfigLite[],
    contexts: Map<string, TokenContext>
  ): { map: Map<string, TokenContext>; changed: boolean } => {
    if (configs.length === 0 || contexts.size === 0) {
      return { map: contexts, changed: false };
    }

    const idToTokenKey = new Map(configs.map(c => [c.id, buildTokenKey(c)] as [string, string]));
    let changed = false;
    const next = new Map(contexts);

    for (const [key, ctx] of contexts.entries()) {
      const tokenKey = idToTokenKey.get(key);
      if (!tokenKey || tokenKey === key) continue;
      if (!next.has(tokenKey)) {
        next.set(tokenKey, ctx);
      }
      if (next.has(key)) {
        next.delete(key);
      }
      changed = true;
    }

    return { map: changed ? next : contexts, changed };
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

  // === useProjectFeatureState: auto load/save project state ===
  const { projectId } = useProjectFeatureState<{
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
    tokenContext?: TokenContext | null;
    tokenContexts?: Array<[string, TokenContext]>;
    viewMode?: 'original' | 'translated' | 'summary';
    excludedChapterIds?: string[];
    selectedChapterId?: string | null;
    summaries?: Array<[string, string]>;
    summaryTitles?: Array<[string, string]>;
  }>({
    feature: 'story',
    fileName: STORY_STATE_FILE,
    serialize: () => {
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

      const serializedTitles = orderedTranslatedEntries.map(([chapterId, content]) => ({
        id: chapterId,
        title: extractTranslatedTitle(content, chapterId)
      }));

      // Summaries
      const serializedSummaries = Array.from(summaries.entries());
      const serializedSummaryTitles = Array.from(summaryTitles.entries());

      return {
        filePath,
        sourceLang,
        targetLang,
        model,
        translateMode,
        translatedEntries: orderedTranslatedEntries,
        chapterModels: orderedChapterModels,
        chapterMethods: orderedChapterMethods,
        translatedTitles: serializedTitles,
        tokenConfigId,
        tokenContexts: Array.from(tokenContexts.entries()),
        viewMode: viewMode as 'original' | 'translated' | 'summary',
        excludedChapterIds: Array.from(excludedChapterIds.values()),
        selectedChapterId,
        summaries: serializedSummaries,
        summaryTitles: serializedSummaryTitles
      };
    },
    deserialize: async (saved: any) => {
      if (saved.sourceLang) setSourceLang(saved.sourceLang);
      if (saved.targetLang) setTargetLang(saved.targetLang);
      if (saved.model) setModel(saved.model);
      if (saved.translateMode) setTranslateMode(saved.translateMode);
      if (saved.translatedEntries) setTranslatedChapters(new Map(saved.translatedEntries));
      if (saved.chapterModels) setChapterModels(new Map(saved.chapterModels));
      if (saved.chapterMethods) setChapterMethods(new Map(saved.chapterMethods));
      if (saved.translatedTitles) {
        setTranslatedTitles(new Map(saved.translatedTitles.map((t: any) => [t.id, t.title] as [string, string])));
      }
      if (typeof saved.tokenConfigId !== 'undefined') {
        setTokenConfigId(saved.tokenConfigId || null);
      }
      if (saved.tokenContexts && saved.tokenContexts.length > 0) {
        setTokenContexts(new Map(saved.tokenContexts));
      } else if (saved.tokenContext && saved.tokenConfigId) {
        setTokenContexts(new Map([[saved.tokenConfigId, saved.tokenContext]]));
      }
      
      if (saved.summaries) setSummaries(new Map(saved.summaries));
      if (saved.summaryTitles) setSummaryTitles(new Map(saved.summaryTitles));

      let parsedOk = false;
      if (saved.filePath) {
        setFilePath(saved.filePath);
        parsedOk = await parseFile(saved.filePath, { keepTranslations: true, keepSelection: true });
      }

      if (!parsedOk && saved.translatedTitles && saved.translatedTitles.length > 0) {
        setChapters(saved.translatedTitles.map((c: any) => ({ id: c.id, title: c.title, content: '' })));
      }

      if (saved.viewMode) setViewMode(saved.viewMode);
      if (saved.excludedChapterIds) setExcludedChapterIds(new Set(saved.excludedChapterIds));
      if (typeof saved.selectedChapterId !== 'undefined') setSelectedChapterId(saved.selectedChapterId);
    },
    deps: [
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
      tokenContexts,
      viewMode,
      excludedChapterIds,
      selectedChapterId
    ],
  });

  useEffect(() => {
    loadConfigurations();
    loadProxySetting();

    const removeListener = window.electronAPI.onMessage('geminiChat:configChanged', () => {
      console.log('[StoryTranslator] Config changed, reloading...');
      loadConfigurations();
      loadProxySetting();
    });

    return () => {
      removeListener();
    };
  }, []);

  // Dynamic Worker Scaling: Watch for new token configs and spawn workers if batch is running
  useEffect(() => {
    if (status !== 'running' || (translateMode !== 'token' && translateMode !== 'both')) return;

    const checkAndSpawnWorkers = async () => {
       // 1. Check max browsers
       let maxImpitBrowsers = Infinity;
       try {
          const browserResult = await window.electronAPI.geminiChat.getMaxImpitBrowsers();
          if (browserResult.success && browserResult.data) {
             maxImpitBrowsers = browserResult.data;
          }
       } catch (e) { 
           console.error('[StoryTranslator] Lỗi lấy giới hạn impit:', e);
       }

       // 2. Filter out already running configs (AFTER await to avoid race condition)
       const activeConfigs = getDistinctActiveTokenConfigs(tokenConfigs);
       const runningConfigIds = batchStateRef.current.activeWorkerConfigIds;
       const newConfigs = activeConfigs.filter(c => !runningConfigIds.has(c.id));

       if (newConfigs.length === 0) return;

       const currentTokenWorkerCount = runningConfigIds.size;
       const availableSlots = maxImpitBrowsers - currentTokenWorkerCount;
       
       if (availableSlots <= 0) return;

       const configsToStart = newConfigs.slice(0, availableSlots);
       console.log(`[StoryTranslator] 🆕 Tìm thấy ${newConfigs.length} cấu hình mới. Đang khởi động ${configsToStart.length} workers...`);

       for (const config of configsToStart) {
          startWorker('token', config);
       }
    };

    checkAndSpawnWorkers();
  }, [tokenConfigs, status, translateMode]);

  useEffect(() => {
    if (translateMode === 'token' || translateMode === 'both') {
      if (!tokenConfigId) {
        loadConfigurations();
      }
    }
  }, [translateMode, tokenConfigId]);

  useEffect(() => {
    if (tokenConfigs.length === 0 || tokenContexts.size === 0) return;
    const { map, changed } = migrateTokenContextsToTokenKey(tokenConfigs, tokenContexts);
    if (changed) {
      setTokenContexts(map);
    }
  }, [tokenConfigs, tokenContexts]);

  const handleTranslate = async () => {
    if (!selectedChapterId) return;
    
    // Kiem tra chuong hien tai co bi loai tru khong
    if (!isChapterIncluded(selectedChapterId)) {
      alert('Chuong nay da bi loai tru khoi danh sach dich. Vui long bo chon "Loai tru" hoac chon chuong khac.');
      return;
    }

    // Kiểm tra nếu chương đã dịch và checkbox chưa được tick
    if (translatedChapters.has(selectedChapterId) && !retranslateExisting) {
      alert('⚠️ Chương này đã được dịch rồi.\n\nNếu muốn dịch lại, vui lòng tick vào "Dịch lại các chương đã dịch" ở phần cấu hình.');
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
      
      const method = translateMode === 'token' ? 'IMPIT' : 'API';
      const methodKey: 'api' | 'token' = method === 'IMPIT' ? 'token' : 'api';

      let selectedTokenConfig = method === 'IMPIT' ? getPreferredTokenConfig() : null;
      if (method === 'IMPIT' && !selectedTokenConfig) {
        await loadConfigurations();
        selectedTokenConfig = getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          alert('Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return;
        }
      }

      const tokenKey = method === 'IMPIT' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

      // 2. Send to Gemini for Translation
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
        prompt: prepareResult.prompt,
        model: model,
        method,
        webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
        useProxy: method === 'IMPIT' && useProxy,
        metadata: { chapterId: selectedChapterId }
      }) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };

      if (translateResult.success && translateResult.data) {
        // Validate metadata to prevent race condition
        if (translateResult.metadata?.chapterId !== selectedChapterId) {
          console.error(`[StoryTranslator] ⚠️ RACE CONDITION DETECTED! Response chapterId (${translateResult.metadata?.chapterId}) !== selected (${selectedChapterId})`);
          throw new Error('Metadata validation failed - race condition detected');
        }
        
        // Kiểm tra marker kết thúc
        if (!hasEndMarker(translateResult.data)) {
          console.warn('[StoryTranslator] ⚠️ Bản dịch không có "Hết chương", đang retry...');
          
          // Retry 1 lần
          const retryResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
            prompt: prepareResult.prompt,
            model: model,
            method,
            webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
            useProxy: method === 'IMPIT' && useProxy,
            metadata: { chapterId: selectedChapterId }
          }) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };
          
          if (retryResult.success && retryResult.data && hasEndMarker(retryResult.data)) {
            console.log('[StoryTranslator] ✅ Retry thành công, bản dịch đã có "Hết chương"');
            translateResult.data = retryResult.data;
            if (retryResult.context) translateResult.context = retryResult.context;
          } else {
            console.warn('[StoryTranslator] ⚠️ Retry vẫn không có "Hết chương", sử dụng bản dịch gốc');
          }
        }
        
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

        if (translateResult.context && translateResult.context.conversationId && tokenKey) {
          setTokenContexts(prev => {
            const next = new Map(prev);
            next.set(tokenKey, translateResult.context!);
            return next;
          });
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
    shouldStopRef.current = true;
    setShouldStop(true);
  };

  // Helper: Process a chapter (Moved out of handleTranslateAll)
  const processChapter = async (
    chapter: Chapter,
    index: number,
    workerId: number,
    channel: 'api' | 'token',
    tokenConfig: GeminiChatConfigLite | null
  ): Promise<{ id: string; text: string } | { retryable: boolean } | null> => {
    if (shouldStopRef.current) return null;

    // Mark as processing
    setProcessingChapters(prev => {
      const next = new Map(prev);
      next.set(chapter.id, { startTime: Date.now(), workerId, channel });
      return next;
    });

    try {
      console.log(`[StoryTranslator] 📖 Dịch chương ${index + 1}/${batchStateRef.current.chapters.length}: ${chapter.title} (Token: ${tokenConfig?.email || tokenConfig?.id || 'API'})`);

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

      const method = channel === 'token' ? 'IMPIT' : 'API';
      let selectedTokenConfig = method === 'IMPIT'
        ? (tokenConfig || getPreferredTokenConfig())
        : null;

      if (method === 'IMPIT' && !selectedTokenConfig) {
        // Try reload?
        selectedTokenConfig = tokenConfig || getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          console.error('[StoryTranslator] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return null;
        }
      }

      const tokenKey = method === 'IMPIT' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

      // 2. Send to Gemini
      const translateResult = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.TRANSLATE_CHAPTER,
        {
          prompt: prepareResult.prompt,
          model: model,
          method,
          webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
          useProxy: method === 'IMPIT' && useProxy,
          metadata: { 
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              tokenInfo: tokenConfig ? (tokenConfig.email || tokenConfig.id) : 'API'
          }
        }
      ) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string }; retryable?: boolean };

      if (translateResult.success && translateResult.data) {
        if (translateResult.metadata?.chapterId !== chapter.id) {
            console.error(`[StoryTranslator] ⚠️ RACE CONDITION: ${translateResult.metadata?.chapterId} !== ${chapter.id}`);
            return null;
        }

        // Check end marker
        if (!hasEndMarker(translateResult.data)) {
            console.warn(`[StoryTranslator] ⚠️ Chương ${chapter.title} thiếu end marker, retry...`);
            const retryResult = await window.electronAPI.invoke(
                STORY_IPC_CHANNELS.TRANSLATE_CHAPTER,
                {
                    prompt: prepareResult.prompt,
                    model: model,
                    method,
                    webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
                    useProxy: method === 'IMPIT' && useProxy,
                    metadata: { chapterId: chapter.id }
                }
            ) as any;
            if (retryResult.success && retryResult.data && hasEndMarker(retryResult.data)) {
                translateResult.data = retryResult.data;
                if (retryResult.context) translateResult.context = retryResult.context;
            }
        }

        // Update UI hooks
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
        setChapterModels(prev => new Map(prev).set(chapter.id, model));
        setChapterMethods(prev => new Map(prev).set(chapter.id, channel));

        if (translateResult.context && tokenKey) {
            setTokenContexts(prev => new Map(prev).set(tokenKey, translateResult.context!));
        }

        return { id: chapter.id, text: translateResult.data! };
      } else {
        console.error(`[StoryTranslator] ❌ Lỗi dịch chương ${chapter.title}:`, translateResult.error);
        return { retryable: translateResult.retryable ?? false };
      }
    } catch (error) {
       console.error(`[StoryTranslator] ❌ Exception chương ${chapter.title}:`, error);
       return null;
    } finally {
       setProcessingChapters(prev => {
           const next = new Map(prev);
           next.delete(chapter.id);
           return next;
       });
    }
  };

  const startWorker = async (channel: 'api' | 'token', tokenConfig?: GeminiChatConfigLite | null) => {
    const workerId = ++workerIdRef.current;
    console.log(`[StoryTranslator] 🚀 Worker ${workerId} started (${channel})`);

    if (channel === 'token' && tokenConfig) {
        batchStateRef.current.activeWorkerConfigIds.add(tokenConfig.id);
    }

    try {
        while (!shouldStopRef.current) {
            // Delay logic
            if (batchStateRef.current.isFirstChapterTaken) {
                const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            if (shouldStopRef.current) break;
            
            // Check availability
            if (batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length) break;

            const index = batchStateRef.current.currentIndex++;
            const chapter = batchStateRef.current.chapters[index];

            if (!batchStateRef.current.isFirstChapterTaken) {
                batchStateRef.current.isFirstChapterTaken = true;
                console.log(`[StoryTranslator] 🚀 Worker ${workerId} lấy chương đầu tiên`);
            } else {
                console.log(`[StoryTranslator] 📖 Worker ${workerId} lấy chương ${index + 1}`);
            }

            let result: { id: string; text: string } | { retryable: boolean } | null = null;
            let retryCount = 0;
            const MAX_RETRIES = 3;

            while (retryCount <= MAX_RETRIES) {
                if (retryCount > 0) {
                     console.log(`[StoryTranslator] ⚠️ Worker ${workerId} Retrying chapter ${index + 1} (${retryCount}/${MAX_RETRIES})...`);
                     await new Promise(r => setTimeout(r, 2000 * retryCount));
                }
                
                result = await processChapter(chapter, index, workerId, channel, tokenConfig || null);

                if (result && 'retryable' in result && result.retryable) {
                    retryCount++;
                    if (retryCount > MAX_RETRIES) {
                        console.error(`[StoryTranslator] ❌ Worker ${workerId} Failed chapter ${index + 1} after ${MAX_RETRIES} retries.`);
                        break;
                    }
                    continue; 
                }
                break;
            }

            if (result && !('retryable' in result) && result !== null) {
                 batchStateRef.current.completed++;
                 setBatchProgress({ current: batchStateRef.current.completed, total: batchStateRef.current.chapters.length });
            }
        }
    } finally {
        if (channel === 'token' && tokenConfig) {
            batchStateRef.current.activeWorkerConfigIds.delete(tokenConfig.id);
        }
        console.log(`[StoryTranslator] ✓ Worker ${workerId} finished`);
        
        // Check completion
        // if (batchStateRef.current.completed >= batchStateRef.current.chapters.length && !shouldStopRef.current) {
        //      setStatus('idle');
        //      setBatchProgress(null);
        //      alert('Đã dịch xong tất cả các chương!');
        // }
    }
  };

  // Dịch tất cả các chương được chọn (continuous queue - gửi liên tục sau khi hoàn thành)
  const handleTranslateAll = async () => {
    // 1. Lấy danh sách các chương cần dịch
    const chaptersToTranslate = chapters.filter(
      c => isChapterIncluded(c.id) && (retranslateExisting || !translatedChapters.has(c.id))
    );
    
    if (chaptersToTranslate.length === 0) {
      alert('Đã dịch xong tất cả các chương được chọn!');
      return;
    }

    // 2. Prepare Configs (Sync from State)
    let tokenConfigsForRun: GeminiChatConfigLite[] = [];
    if (translateMode === 'token' || translateMode === 'both') {
       tokenConfigsForRun = getDistinctActiveTokenConfigs(tokenConfigs);
       if (tokenConfigsForRun.length === 0) {
          console.error('[StoryTranslator] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return;
       }
    }

    // 3. Initialize Batch State (WITH INTENDED WORKERS to block useEffect race condition)
    // We pre-populate activeWorkerConfigIds so useEffect sees them as "already running"
    // immediately when we set status to running.
    const initialWorkerIds = new Set(tokenConfigsForRun.map(c => c.id));
    
    batchStateRef.current = {
        chapters: chaptersToTranslate,
        currentIndex: 0,
        completed: 0,
        activeWorkerConfigIds: initialWorkerIds,
        isFirstChapterTaken: false
    };
    workerIdRef.current = 0;

    // 4. Set Status (Triggers useEffect state change)
    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });
    shouldStopRef.current = false;
    setShouldStop(false);

    // 5. Async Checks (Max Browsers)
    let maxImpitBrowsers = Infinity;
    if (translateMode === 'token' || translateMode === 'both') {
      try {
        await window.electronAPI.geminiChat.releaseAllImpitBrowsers();
        const browserResult = await window.electronAPI.geminiChat.getMaxImpitBrowsers();
        if (browserResult.success && browserResult.data) {
          maxImpitBrowsers = browserResult.data;
        }
      } catch (e) {
        console.error('[StoryTranslator] Lỗi lấy số trình duyệt impit:', e);
      }
    }

    const apiWorkerCount = translateMode === 'api' ? 5 : translateMode === 'both' ? 5 : 0;
    let tokenWorkerCount = tokenConfigsForRun.length;
    
    if (tokenWorkerCount > maxImpitBrowsers) {
      console.warn(`[StoryTranslator] Impit: Giới hạn token workers xuống ${maxImpitBrowsers}`);
      tokenWorkerCount = maxImpitBrowsers;
    }
    
    // Sync batchStateRef with actual count after pruning
    const finalConfigsToUse = tokenConfigsForRun.slice(0, tokenWorkerCount);
    // Remove pruned IDs from the Set
    const finalIds = new Set(finalConfigsToUse.map(c => c.id));
    batchStateRef.current.activeWorkerConfigIds = finalIds;

    const totalWorkers = apiWorkerCount + tokenWorkerCount;
    console.log(`[StoryTranslator] 🎯 Bắt đầu dịch ${chaptersToTranslate.length} chapters với ${totalWorkers} workers`);

    // Start API workers
    for (let i = 0; i < apiWorkerCount; i += 1) {
      startWorker('api');
    }

    // Start Token workers
    for (const config of finalConfigsToUse) {
      startWorker('token', config);
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

    // Ask user for export mode
    const exportMode = await new Promise<'translation' | 'summary' | 'combined' | null>((resolve) => {
      const userChoice = window.confirm(
        '📚 Chọn loại nội dung đóng gói:\n\n' +
        '✅ OK = Bản dịch + Tóm tắt (Kết hợp)\n' +
        '❌ Cancel = Chỉ bản dịch\n\n' +
        '(Để chọn "Chỉ tóm tắt", nhấn Cancel rồi chọn lại)'
      );
      
      if (userChoice) {
        resolve('combined');
      } else {
        // Second prompt for translation vs summary
        const summaryOnly = window.confirm(
          '📚 Bạn đã chọn không kết hợp.\n\n' +
          '✅ OK = Chỉ tóm tắt\n' +
          '❌ Cancel = Chỉ bản dịch'
        );
        resolve(summaryOnly ? 'summary' : 'translation');
      }
    });

    if (!exportMode) {
      return;
    }

    setExportStatus('exporting');

    try {
      console.log('[StoryTranslator] Bắt đầu export ebook...', { exportMode });
      
      // Load summary data if needed
      let summaries = new Map<string, string>();
      let summaryTitles = new Map<string, string>();
      
      if (exportMode === 'summary' || exportMode === 'combined') {
        if (!projectId) {
          alert('⚠️ Cần mở project để export tóm tắt!');
          setExportStatus('idle');
          return;
        }
        
        try {
          const summaryRes = await window.electronAPI.project.readFeatureFile({
            projectId,
            feature: 'story',
            fileName: 'story-summary.json'
          });
          
          if (summaryRes?.success && summaryRes.data) {
            const summaryData = JSON.parse(summaryRes.data) as {
              summaries?: Array<[string, string]>;
              summaryTitles?: Array<[string, string]>;
            };
            
            if (summaryData.summaries) {
              summaries = new Map(summaryData.summaries);
            }
            if (summaryData.summaryTitles) {
              summaryTitles = new Map(summaryData.summaryTitles);
            }
            
            console.log(`[StoryTranslator] Đã load ${summaries.size} tóm tắt`);
          }
        } catch (err) {
          console.error('[StoryTranslator] Lỗi load summary data:', err);
        }
        
        if (summaries.size === 0) {
          alert('⚠️ Chưa có tóm tắt nào! Vui lòng tóm tắt truyện trước.');
          setExportStatus('idle');
          return;
        }
      }
      
      // 1. Ask user for save location
      const defaultName = exportMode === 'translation' 
        ? `translation_${sourceLang}-${targetLang}.epub`
        : exportMode === 'summary'
          ? `summary_${targetLang}.epub`
          : `combined_${sourceLang}-${targetLang}.epub`;
      
      const saveDialogResult = await window.electronAPI.invoke('dialog:showSaveDialog', {
          title: 'Lưu Ebook EPUB',
          defaultPath: defaultName,
          filters: [{ name: 'EPUB Ebook', extensions: ['epub'] }]
      }) as { canceled: boolean; filePath?: string };

      if (saveDialogResult.canceled || !saveDialogResult.filePath) {
          setExportStatus('idle');
          return;
      }

      // 2. Prepare chapters based on export mode
      const ebookChapters: { title: string; content: string }[] = [];
      const titleMap = new Map(
        chapters.map((c) => [c.id, c.title] as [string, string])
      );
      const orderedTranslatedEntries = chapters.length > 0
        ? chapters
            .filter((c) => translatedChapters.has(c.id))
            .map((c) => [c.id, translatedChapters.get(c.id)!] as [string, string])
        : Array.from(translatedChapters.entries());

      if (exportMode === 'translation') {
        // Chỉ bản dịch
        for (const [chapterId, content] of orderedTranslatedEntries) {
          const title =
            translatedTitles.get(chapterId) ||
            titleMap.get(chapterId) ||
            `Chương ${chapterId}`;
          ebookChapters.push({ title, content });
        }
      } else if (exportMode === 'summary') {
        // Chỉ tóm tắt
        for (const [chapterId] of orderedTranslatedEntries) {
          const summaryContent = summaries.get(chapterId);
          if (summaryContent) {
            const title = summaryTitles.get(chapterId) ||
              translatedTitles.get(chapterId) ||
              titleMap.get(chapterId) ||
              `Tóm tắt ${chapterId}`;
            ebookChapters.push({ 
              title: `[Tóm tắt] ${title}`, 
              content: summaryContent 
            });
          }
        }
      } else {
        // Kết hợp: Chương 1 -> Tóm tắt 1 -> Chương 2 -> Tóm tắt 2...
        for (const [chapterId, translationContent] of orderedTranslatedEntries) {
          const chapterTitle =
            translatedTitles.get(chapterId) ||
            titleMap.get(chapterId) ||
            `Chương ${chapterId}`;
          
          // Add translation
          ebookChapters.push({ 
            title: chapterTitle, 
            content: translationContent 
          });
          
          // Add summary if available
          const summaryContent = summaries.get(chapterId);
          if (summaryContent) {
            ebookChapters.push({ 
              title: `📝 Tóm tắt: ${chapterTitle}`, 
              content: summaryContent 
            });
          }
        }
      }

      if (ebookChapters.length === 0) {
        alert('Lỗi: Không tìm thấy nội dung để đóng gói.');
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
              Dịch {retranslateExisting ? 'lại ' : ''}{selectedChapterCount}
            </Button>
          )}
        </div>

        <div className="md:col-span-12 flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer hover:text-primary">
            <input
              type="checkbox"
              checked={retranslateExisting}
              onChange={(e) => setRetranslateExisting(e.target.checked)}
              className="w-4 h-4 rounded border-border cursor-pointer"
            />
            <span>Dịch lại các chương đã dịch</span>
          </label>
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
          <div className="flex-1 flex flex-col-reverse overflow-hidden">
            <div className="flex-1 overflow-y-auto overflow-x-auto p-2 space-y-1">
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
                className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${
                  selectedChapterId === chapter.id
                    ? 'bg-primary text-text-invert'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleChapterExclusion(chapter.id, e.shiftKey);
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
                  className="min-w-0 flex-1 text-left flex items-center gap-2"
                >
                  <span className={`truncate ${
                    !isChapterIncluded(chapter.id)
                      ? selectedChapterId === chapter.id
                        ? 'text-white/60 italic'
                        : 'text-text-secondary/40 italic'
                      : hasTranslatedTitle
                        ? 'text-emerald-500 font-medium'
                        : selectedChapterId === chapter.id
                          ? 'text-white'
                          : 'text-text-secondary'
                  }`}>
                    {translatedTitles.get(chapter.id)
                      || (translatedChapters.has(chapter.id)
                        ? extractTranslatedTitle(translatedChapters.get(chapter.id) || '', chapter.id)
                        : chapter.title)}
                  </span>
                </button>

                {/* Processing Indicator - outside button to prevent truncation */}
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
              </div>
            )})}
            </div>
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
                  <button 
                    onClick={() => setViewMode('summary')}
                    disabled={!selectedChapterId || !summaries.has(selectedChapterId)}
                    className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'summary' ? 'bg-primary text-white shadow' : 'text-text-secondary hover:text-text-primary disabled:opacity-50'}`}
                  >
                    Tóm tắt
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
                ) : viewMode === 'translated' ? (
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
                ) : (
                  // Summary View
                  summaries.get(selectedChapterId) ? (
                    <div className="whitespace-pre-wrap wrap-break-word">
                       {summaryTitles.get(selectedChapterId) && (
                          <h3 className="text-lg font-bold mb-4 text-primary">{summaryTitles.get(selectedChapterId)}</h3>
                       )}
                       {summaries.get(selectedChapterId)}
                    </div>
                  ) : (
                     <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                       <FileText size={48} className="mb-4" />
                       <p className="text-base">Chưa có tóm tắt cho chương này.</p>
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

