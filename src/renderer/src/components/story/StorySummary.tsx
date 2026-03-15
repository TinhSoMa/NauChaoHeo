import { useState, useEffect, useRef } from 'react';
import { Chapter, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
// import { TranslationProject, ChapterTranslation } from '@shared/types/project';
import { GEMINI_MODEL_LIST } from '@shared/constants';
import { Button } from '../common/Button';
import { Select } from '../common/Select';
import { FileText, CheckSquare, Square, StopCircle, Loader, Clock, Sparkles, Download } from 'lucide-react';
import { useProjectFeatureState } from '../../hooks/useProjectFeatureState';

interface GeminiChatConfigLite {
  id: string;
  cookie: string;
  atToken: string;
  isActive: boolean;
  isError?: boolean;
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

export function StorySummary() {
  // Source data từ translator
  const [sourceLang, setSourceLang] = useState('vi'); // Đã dịch sang tiếng Việt
  const [targetLang, setTargetLang] = useState('vi'); // Tóm tắt cũng bằng tiếng Việt
  const [model, setModel] = useState('gemini-3-flash-preview');
  const [translateMode, setTranslateMode] = useState<'api' | 'token' | 'both'>('api');
  const [status, setStatus] = useState('idle');
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Map lưu trữ chapters đã dịch (source để tóm tắt)
  const [sourceChapters, setSourceChapters] = useState<Map<string, string>>(new Map());
  // Map lưu trữ summaries đã tạo
  const [summaries, setSummaries] = useState<Map<string, string>>(new Map());
  const [chapterModels, setChapterModels] = useState<Map<string, string>>(new Map());
  const [chapterMethods, setChapterMethods] = useState<Map<string, 'api' | 'token'>>(new Map());
  const [translatedTitles, setTranslatedTitles] = useState<Map<string, string>>(new Map());
  const [summaryTitles, setSummaryTitles] = useState<Map<string, string>>(new Map());
  const [tokenConfigId, setTokenConfigId] = useState<string | null>(null);
  const [tokenConfigs, setTokenConfigs] = useState<GeminiChatConfigLite[]>([]);
  const [tokenContexts, setTokenContexts] = useState<Map<string, TokenContext>>(new Map());
  const [viewMode, setViewMode] = useState<'original' | 'summary'>('original');
  // Danh sach cac chuong bi loai tru khoi tom tat
  const [excludedChapterIds, setExcludedChapterIds] = useState<Set<string>>(new Set());
  // Last clicked chapter for Shift+Click selection
  const [lastClickedChapterId, setLastClickedChapterId] = useState<string | null>(null);
  // Progress cho batch summarization
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [, setShouldStop] = useState(false);
  const shouldStopRef = useRef(false);
  // Reading settings
  const [fontSize, setFontSize] = useState<number>(18);
  const [lineHeight, setLineHeight] = useState<number>(1.8);
  // Chapter processing tracking
  const [processingChapters, setProcessingChapters] = useState<
    Map<string, { startTime: number; workerId: number; channel: 'api' | 'token' }>
  >(new Map());
  const [, setTick] = useState(0); // Force re-render for elapsed time
  const [useProxy, setUseProxy] = useState(true);
  const [useImpit, setUseImpit] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [retranslateSummary, setRetranslateSummary] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting'>('idle');

  const loadProxySetting = async () => {
    try {
      const result = await window.electronAPI.appSettings.getAll();
      if (result.success && result.data) {
        setUseProxy(result.data.useProxy);
      }
    } catch (error) {
      console.error('[StorySummary] Error loading proxy setting:', error);
    }
  };

  // Kiểm tra xem bản tóm tắt có marker kết thúc hay không
  const hasSummaryEndMarker = (text: string): boolean => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    
    if (lines.length === 0) return false;
    
    const lastLine = lines[lines.length - 1];
    // Check các biến thể của "Hết tóm tắt"
    return /hết\s+tóm\s+tắt|end\s+of\s+summary|---\s*hết\s*---/i.test(lastLine);
  };

  // Update elapsed time every second
  useEffect(() => {
    if (processingChapters.size === 0) return;
    
    const interval = setInterval(() => {
      setTick(prev => prev + 1); // Force re-render to update elapsed time
    }, 1000);
    
    return () => clearInterval(interval);
  }, [processingChapters.size]);

  const STORY_STATE_FILE = 'story-summary.json';
  const TRANSLATOR_FILE = 'story-translator.json';

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
      console.error('[StorySummary] Error loading config:', e);
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
  console.log('[StorySummary] Render - summaries.size:', summaries.size);
  console.log('[StorySummary] Render - status:', status);
  console.log('[StorySummary] Render - chapters.length:', chapters.length);
  console.log('[StorySummary] Render - sourceChapters.size:', sourceChapters.size);

  // === useProjectFeatureState: auto load/save project state ===
  // StorySummary dùng customLoad vì cần đọc 2 file: translator (source) + summary (state)
  const { projectId } = useProjectFeatureState({
    feature: 'story',
    fileName: STORY_STATE_FILE,
    serialize: () => {
      const orderedSummaries = chapters
        .filter((c) => summaries.has(c.id))
        .map((c) => [c.id, summaries.get(c.id)!] as [string, string]);

      const orderedChapterModels = orderedSummaries.map(([chapterId]) => {
        const usedModel = chapterModels.get(chapterId) || model;
        return [chapterId, usedModel] as [string, string];
      });

      const orderedChapterMethods = orderedSummaries.map(([chapterId]) => {
        const usedMethod = chapterMethods.get(chapterId) || (translateMode === 'token' ? 'token' : 'api');
        return [chapterId, usedMethod] as [string, 'api' | 'token'];
      });

      const orderedSummaryTitles = orderedSummaries.map(([chapterId]) => {
        const title = summaryTitles.get(chapterId) || translatedTitles.get(chapterId) || chapters.find(c => c.id === chapterId)?.title || '';
        return [chapterId, title] as [string, string];
      });

      return {
        model,
        translateMode,
        summaries: orderedSummaries,
        chapterModels: orderedChapterModels,
        chapterMethods: orderedChapterMethods,
        summaryTitles: orderedSummaryTitles,
        tokenConfigId,
        tokenContexts: Array.from(tokenContexts.entries()),
        viewMode,
        excludedChapterIds: Array.from(excludedChapterIds.values()),
        selectedChapterId
      };
    },
    deserialize: () => { /* not used - customLoad handles loading */ },
    customLoad: async () => {
      const pid = projectId;
      if (!pid) {
        console.log('[StorySummary] Không có projectId, bỏ qua load');
        return;
      }

      console.log('[StorySummary] Bắt đầu load dữ liệu...');

      // 1. Load translator data (source chapters - bản dịch dùng để tóm tắt)
      const translatorRes = await window.electronAPI.project.readFeatureFile({
        projectId: pid,
        feature: 'story',
        fileName: TRANSLATOR_FILE
      });

      console.log('[StorySummary] Translator file response:', translatorRes?.success);

      if (translatorRes?.success && translatorRes.data) {
        const translatorData = JSON.parse(translatorRes.data) as {
          sourceLang?: string;
          targetLang?: string;
          translatedEntries?: Array<[string, string]>;
          translatedTitles?: Array<{ id: string; title: string }>;
        };

        console.log('[StorySummary] Translator data parsed:', {
          hasSourceLang: !!translatorData.sourceLang,
          hasTargetLang: !!translatorData.targetLang,
          translatedEntriesCount: translatorData.translatedEntries?.length || 0,
          translatedTitlesCount: translatorData.translatedTitles?.length || 0
        });

        if (translatorData.sourceLang) setSourceLang(translatorData.targetLang || 'vi');
        if (translatorData.targetLang) setTargetLang(translatorData.targetLang || 'vi');

        if (translatorData.translatedEntries) {
          const sourceMap = new Map(translatorData.translatedEntries);
          setSourceChapters(sourceMap);
          console.log('[StorySummary] Đã load', sourceMap.size, 'chapters từ translator');
        } else {
          console.warn('[StorySummary] Không tìm thấy translatedEntries trong translator file');
        }

        if (translatorData.translatedTitles) {
          const titleMap = new Map(translatorData.translatedTitles.map((t) => [t.id, t.title] as [string, string]));
          const chapterList = translatorData.translatedTitles.map((c) => ({ id: c.id, title: c.title, content: '' }));
          setTranslatedTitles(titleMap);
          setChapters(chapterList);
          console.log('[StorySummary] Đã load', chapterList.length, 'chapter titles');
        } else {
          console.warn('[StorySummary] Không tìm thấy translatedTitles trong translator file');
        }
      } else {
        console.warn('[StorySummary] Translator file không tồn tại hoặc chưa có dữ liệu');
      }

      // 2. Load summary data
      const summaryRes = await window.electronAPI.project.readFeatureFile({
        projectId: pid,
        feature: 'story',
        fileName: STORY_STATE_FILE
      });

      if (summaryRes?.success && summaryRes.data) {
        const saved = JSON.parse(summaryRes.data) as {
          model?: string;
          translateMode?: 'api' | 'token' | 'both';
          summaries?: Array<[string, string]>;
          chapterModels?: Array<[string, string]>;
          chapterMethods?: Array<[string, 'api' | 'token']>;
          summaryTitles?: Array<[string, string]>;
          tokenConfigId?: string | null;
          tokenContext?: TokenContext | null;
          tokenContexts?: Array<[string, TokenContext]>;
          viewMode?: 'original' | 'summary';
          excludedChapterIds?: string[];
          selectedChapterId?: string | null;
        };

        if (saved.model) setModel(saved.model);
        if (saved.translateMode) setTranslateMode(saved.translateMode);
        if (saved.summaries) setSummaries(new Map(saved.summaries));
        if (saved.chapterModels) setChapterModels(new Map(saved.chapterModels));
        if (saved.chapterMethods) setChapterMethods(new Map(saved.chapterMethods));
        if (saved.summaryTitles) setSummaryTitles(new Map(saved.summaryTitles));
        if (typeof saved.tokenConfigId !== 'undefined') {
          setTokenConfigId(saved.tokenConfigId || null);
        }
        if (saved.tokenContexts && saved.tokenContexts.length > 0) {
          setTokenContexts(new Map(saved.tokenContexts));
        } else if (saved.tokenContext && saved.tokenConfigId) {
          setTokenContexts(new Map([[saved.tokenConfigId, saved.tokenContext]]));
        }

        if (saved.viewMode) setViewMode(saved.viewMode);
        if (saved.excludedChapterIds) setExcludedChapterIds(new Set(saved.excludedChapterIds));
        if (typeof saved.selectedChapterId !== 'undefined') setSelectedChapterId(saved.selectedChapterId);
      }
    },
    deps: [
      sourceLang,
      targetLang,
      model,
      translateMode,
      chapters,
      summaries,
      chapterModels,
      chapterMethods,
      summaryTitles,
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
      console.log('[StorySummary] Config changed, reloading...');
      loadConfigurations();
      loadProxySetting();
    });

    return () => {
      removeListener();
    };
  }, []);

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
      alert('Chương này đã bị loại trừ khỏi danh sách tóm tắt. Vui lòng bỏ chọn "Loại trừ" hoặc chọn chương khác.');
      return;
    }

    // Kiểm tra nếu chương đã tóm tắt và checkbox chưa được tick
    if (summaries.has(selectedChapterId) && !retranslateSummary) {
      alert('⚠️ Chương này đã được tóm tắt rồi.\n\nNếu muốn tóm tắt lại, vui lòng tick vào "Tóm tắt lại các chương đã tóm tắt" ở phần cấu hình.');
      return;
    }

    // Kiem tra nguon du lieu
    const sourceContent = sourceChapters.get(selectedChapterId);
    if (!sourceContent) {
      alert('Không tìm thấy bản dịch cho chương này. Vui lòng dịch truyện trước.');
      return;
    }

    setStatus('running');
    
    try {
      console.log('[StorySummary] Đang chuẩn bị prompt tóm tắt...');
      // 1. Prepare Summary Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT, {
        chapterContent: sourceContent,
        sourceLang,
        targetLang
      }) as PreparePromptResult;
      
      if (!prepareResult.success || !prepareResult.prompt) {
        throw new Error(prepareResult.error || 'Lỗi chuẩn bị prompt tóm tắt');
      }

      console.log('[StorySummary] Đã chuẩn bị prompt, đang gửi đến Gemini...');
      
      const method = translateMode === 'token' ? 'WEB' : 'API';
      const methodKey: 'api' | 'token' = method === 'WEB' ? 'token' : 'api';

      let selectedTokenConfig = method === 'WEB' ? getPreferredTokenConfig() : null;
      if (method === 'WEB' && !selectedTokenConfig) {
        await loadConfigurations();
        selectedTokenConfig = getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          alert('Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return;
        }
      }

      const tokenKey = method === 'WEB' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

      // 2. Send to Gemini for Summarization
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
        prompt: prepareResult.prompt,
        model: model,
        method,
        webConfigId: method === 'WEB' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
        useProxy: method === 'WEB' && useProxy,
        useImpit: method === 'WEB' && useImpit,
        metadata: { chapterId: selectedChapterId }
      }) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };

      if (translateResult.success && translateResult.data) {
        // Validate metadata to prevent race condition
        if (translateResult.metadata?.chapterId !== selectedChapterId) {
          console.error(`[StorySummary] ⚠️ RACE CONDITION DETECTED! Response chapterId (${translateResult.metadata?.chapterId}) !== selected (${selectedChapterId})`);
          throw new Error('Metadata validation failed - race condition detected');
        }
        
        // Kiểm tra marker kết thúc
        if (!hasSummaryEndMarker(translateResult.data)) {
          console.warn('[StorySummary] ⚠️ Bản tóm tắt không có "Hết tóm tắt", đang retry...');
          
          // Retry 1 lần
          const retryResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
            prompt: prepareResult.prompt,
            model: model,
            method,
            webConfigId: method === 'WEB' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
            useProxy: method === 'WEB' && useProxy,
            useImpit: method === 'WEB' && useImpit,
            metadata: { chapterId: selectedChapterId }
          }) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };
          
          if (retryResult.success && retryResult.data && hasSummaryEndMarker(retryResult.data)) {
            console.log('[StorySummary] ✅ Retry thành công, bản tóm tắt đã có "Hết tóm tắt"');
            translateResult.data = retryResult.data;
            if (retryResult.context) translateResult.context = retryResult.context;
          } else {
            console.warn('[StorySummary] ⚠️ Retry vẫn không có "Hết tóm tắt", sử dụng bản gốc');
          }
        }
        
        // Lưu tóm tắt vào Map cache
        setSummaries(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, translateResult.data!);
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

        setViewMode('summary');
        console.log('[StorySummary] Tóm tắt thành công!');
      } else {
        throw new Error(translateResult.error || 'Tóm tắt thất bại');
      }

    } catch (error) {
      console.error('[StorySummary] Lỗi trong quá trình tóm tắt:', error);
      alert(`Lỗi tóm tắt: ${error}`);
    } finally {
      setStatus('idle');
    }
  };

  const handleStopTranslation = () => {
    console.log('[StorySummary] Dừng tóm tắt thủ công...');
    shouldStopRef.current = true;
    setShouldStop(true);
  };

  // Tóm tắt tất cả các chương được chọn (continuous queue - gửi liên tục sau khi hoàn thành)
  const handleTranslateAll = async () => {
    // Lấy danh sách các chương cần tóm tắt
    const chaptersToTranslate = chapters.filter(
      c => isChapterIncluded(c.id) && (retranslateSummary || !summaries.has(c.id)) && sourceChapters.has(c.id)
    );
    
    if (chaptersToTranslate.length === 0) {
      alert('Đã tóm tắt xong tất cả các chương được chọn!');
      return;
    }

    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });
    shouldStopRef.current = false;
    setShouldStop(false); // Reset stop flag

    const MIN_DELAY = 5000; // 5 giây
    const MAX_DELAY = 30000; // 30 giây
    let completed = 0;
    let currentIndex = 0;
    const results: Array<{ id: string; text: string } | null> = [];

    // Helper function để dịch 1 chapter
    const translateChapter = async (
      chapter: Chapter,
      index: number,
      workerId: number,
      channelOverride?: 'api' | 'token',
      tokenConfigOverride?: GeminiChatConfigLite | null
    ): Promise<{ id: string; text: string } | null> => {
      // Kiểm tra nếu người dùng đã nhấn Dừng
      if (shouldStopRef.current) {
        console.log(`[StorySummary] ⚠️ Bỏ qua chương ${chapter.title} - Đã dừng`);
        return null;
      }
      
      // setSelectedChapterId(chapter.id); // Removed to prevent UI jumping
      
      const channel = channelOverride || getWorkerChannel(workerId);

      // Lấy nội dung đã dịch để tóm tắt
      const sourceContent = sourceChapters.get(chapter.id);
      if (!sourceContent) {
        console.error(`[StorySummary] ⚠️ Không tìm thấy bản dịch cho chương ${chapter.title}`);
        return null;
      }

      // Mark as processing
      setProcessingChapters(prev => {
        const next = new Map(prev);
        next.set(chapter.id, { startTime: Date.now(), workerId, channel });
        return next;
      });
      
      try {
        console.log(`[StorySummary] 📖 Tóm tắt chương ${index + 1}/${chaptersToTranslate.length}: ${chapter.title}`);
        
        // 1. Prepare Summary Prompt
        const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT, {
          chapterContent: sourceContent,
          sourceLang,
          targetLang
        }) as PreparePromptResult;
        
        if (!prepareResult.success || !prepareResult.prompt) {
          console.error(`Lỗi chuẩn bị prompt tóm tắt cho chương ${chapter.title}:`, prepareResult.error);
          return null;
        }

        const method = channel === 'token' ? 'WEB' : 'API';

        let selectedTokenConfig = method === 'WEB'
          ? (tokenConfigOverride || getPreferredTokenConfig())
          : null;

        if (method === 'WEB' && !selectedTokenConfig) {
          await loadConfigurations();
          selectedTokenConfig = tokenConfigOverride || getPreferredTokenConfig();
          if (!selectedTokenConfig) {
            console.error('[StorySummary] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
            return null;
          }
        }

        const tokenKey = method === 'WEB' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

        // 2. Send to Gemini for Summarization
        const translateResult = await window.electronAPI.invoke(
          STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, 
          {
            prompt: prepareResult.prompt,
            model: model,
            method,
            webConfigId: method === 'WEB' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
            useProxy: method === 'WEB' && useProxy,
            useImpit: method === 'WEB' && useImpit,
            metadata: { chapterId: chapter.id }
          }
        ) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };

        if (translateResult.success && translateResult.data) {
          // Validate metadata to prevent race condition
          if (translateResult.metadata?.chapterId !== chapter.id) {
            console.error(`[StorySummary] ⚠️ RACE CONDITION DETECTED! Response chapterId (${translateResult.metadata?.chapterId}) !== chapter.id (${chapter.id})`);
            return null;
          }
          
          // Kiểm tra marker kết thúc
          if (!hasSummaryEndMarker(translateResult.data)) {
            console.warn(`[StorySummary] ⚠️ Chương ${chapter.title} không có "Hết tóm tắt", đang retry...`);
            
            // Retry 1 lần
            const retryResult = await window.electronAPI.invoke(
              STORY_IPC_CHANNELS.TRANSLATE_CHAPTER,
              {
                prompt: prepareResult.prompt,
                model: model,
                method,
                webConfigId: method === 'WEB' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
                useProxy: method === 'WEB' && useProxy,
                useImpit: method === 'WEB' && useImpit,
                metadata: { chapterId: chapter.id }
              }
            ) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };
            
            if (retryResult.success && retryResult.data && hasSummaryEndMarker(retryResult.data)) {
              console.log(`[StorySummary] ✅ Retry chương ${chapter.title} thành công, đã có "Hết tóm tắt"`);
              translateResult.data = retryResult.data;
              if (retryResult.context) translateResult.context = retryResult.context;
            } else {
              console.warn(`[StorySummary] ⚠️ Retry chương ${chapter.title} vẫn không có "Hết tóm tắt", sử dụng bản gốc`);
            }
          }
          
          // Cập nhật UI NGAY khi tóm tắt xong
          setSummaries(prev => {
            const next = new Map(prev);
            next.set(chapter.id, translateResult.data!);
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

          setSummaryTitles(prev => {
            const next = new Map(prev);
            const chapterTitle = translatedTitles.get(chapter.id) || chapter.title;
            next.set(chapter.id, chapterTitle);
            return next;
          });

          if (translateResult.context && translateResult.context.conversationId && tokenKey) {
            setTokenContexts(prev => {
              const next = new Map(prev);
              next.set(tokenKey, translateResult.context!);
              return next;
            });
          }

          console.log(`[StorySummary] ✅ Tóm tắt xong: ${chapter.title}`);
          return { id: chapter.id, text: translateResult.data! };
        } else {
          console.error(`[StorySummary] ❌ Lỗi tóm tắt chương ${chapter.title}:`, translateResult.error);
          return null;
        }
      } catch (error) {
        console.error(`[StorySummary] ❌ Exception khi tóm tắt chương ${chapter.title}:`, error);
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
    // Logic: API dùng delay cố định, token giữ random delay
    let isFirstChapterTaken = false;
    const worker = async (workerId: number, channel: 'api' | 'token', tokenConfig?: GeminiChatConfigLite | null) => {
      console.log(`[StorySummary] 🚀 Worker ${workerId} started`);
      let hasDispatched = false;
      
      while (!shouldStopRef.current) {
        // 1. Chờ random TRƯỚC khi lấy chương (trừ chương đầu tiên)
        if (channel === 'api') {
          if (hasDispatched && apiRequestDelayMs > 0) {
            console.log(`[StorySummary] ⏳ Worker ${workerId} chờ ${Math.round(apiRequestDelayMs / 1000)}s trước khi lấy chương tiếp...`);
            await new Promise(resolve => setTimeout(resolve, apiRequestDelayMs));
          }
        } else if (isFirstChapterTaken) {
          const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
          console.log(`[StorySummary] ⏳ Worker ${workerId} chờ ${Math.round(delay/1000)}s trước khi lấy chương tiếp...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // Kiểm tra lại shouldStop sau khi chờ
        if (shouldStopRef.current) {
          console.log(`[StorySummary] ⚠️ Worker ${workerId} stopped`);
          break;
        }
        
        // 2. SAU KHI chờ xong, mới lấy chương tiếp theo
        if (currentIndex >= chaptersToTranslate.length) break;
        const index = currentIndex++;
        const chapter = chaptersToTranslate[index];
        
        if (!isFirstChapterTaken) {
          isFirstChapterTaken = true;
          console.log(`[StorySummary] 🚀 Worker ${workerId} lấy chương đầu tiên - gửi ngay`);
        } else {
          console.log(`[StorySummary] 📖 Worker ${workerId} lấy chương ${index + 1} sau khi chờ delay`);
        }
        hasDispatched = true;
        
        const result = await translateChapter(chapter, index, workerId, channel, tokenConfig);
        results.push(result);
        
        completed++;
        setBatchProgress({ current: completed, total: chaptersToTranslate.length });
        
        console.log(`[StorySummary] 📊 Progress: ${completed}/${chaptersToTranslate.length} (Worker ${workerId})`);
      }
      
      console.log(`[StorySummary] ✓ Worker ${workerId} finished`);
    };

    const tokenConfigsResult = translateMode === 'token' || translateMode === 'both'
      ? await window.electronAPI.geminiChat.getAll()
      : null;

    const tokenConfigsForRun = tokenConfigsResult?.success && tokenConfigsResult.data
      ? getDistinctActiveTokenConfigs(tokenConfigsResult.data as GeminiChatConfigLite[])
      : [];

    if ((translateMode === 'token' || translateMode === 'both') && tokenConfigsForRun.length === 0) {
      console.error('[StorySummary] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
      setStatus('idle');
      setBatchProgress(null);
      return;
    }

    let apiWorkerCountSetting = 1;
    let apiRequestDelayMs = 500;
    try {
      const settingsResult = await window.electronAPI.appSettings.getAll();
      if (settingsResult.success && settingsResult.data) {
        const raw = Number(settingsResult.data.apiWorkerCount);
        apiWorkerCountSetting = Number.isFinite(raw) ? Math.min(10, Math.max(1, Math.floor(raw))) : 1;
        const rawDelay = Number(settingsResult.data.apiRequestDelayMs);
        apiRequestDelayMs = Number.isFinite(rawDelay) ? Math.min(30000, Math.max(0, Math.floor(rawDelay))) : 500;
      }
    } catch (error) {
      console.warn('[StorySummary] Không lấy được apiWorkerCount, dùng mặc định 1', error);
    }
    const apiWorkerCount = translateMode === 'api'
      ? apiWorkerCountSetting
      : translateMode === 'both'
        ? apiWorkerCountSetting
        : 0;
    const tokenWorkerCount = translateMode === 'token'
      ? tokenConfigsForRun.length
      : translateMode === 'both'
        ? tokenConfigsForRun.length
        : 0;
    const totalWorkers = apiWorkerCount + tokenWorkerCount;

    console.log(`[StorySummary] 🎯 Bắt đầu tóm tắt ${chaptersToTranslate.length} chapters với ${totalWorkers} workers song song`);

    const workers: Promise<void>[] = [];
    let workerId = 1;

    for (let i = 0; i < apiWorkerCount; i += 1) {
      workers.push(worker(workerId++, 'api'));
    }

    for (const config of tokenConfigsForRun) {
      workers.push(worker(workerId++, 'token', config));
    }
    
    await Promise.all(workers);

    setStatus('idle');
    setBatchProgress(null);
    setViewMode('summary');
    
    if (shouldStopRef.current) {
      console.log(`[StorySummary] 🛑 Đã dừng: ${results.filter(r => r).length}/${chaptersToTranslate.length} chapters đã tóm tắt`);
    } else {
      console.log(`[StorySummary] 🎉 Hoàn thành: ${results.filter(r => r).length}/${chaptersToTranslate.length} chapters`);
    }
  };

  const handleSavePrompt = async () => {
    if (!selectedChapterId) return;
    const sourceContent = sourceChapters.get(selectedChapterId);
    if (!sourceContent) {
      alert('⚠️ Không tìm thấy bản dịch cho chương này.');
      return;
    }

    setSavingPrompt(true);
    try {
      console.log('[StorySummary] Đang chuẩn bị prompt...');
      const result = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT, {
        chapterContent: sourceContent,
        sourceLang,
        targetLang
      }) as PreparePromptResult;

      if (result.success && result.prompt) {
        const promptString = JSON.stringify(result.prompt);
        
        // Copy to clipboard
        try {
          await navigator.clipboard.writeText(promptString);
          console.log('[StorySummary] Đã copy prompt vào clipboard');
        } catch (clipboardErr) {
          console.warn('[StorySummary] Không thể copy vào clipboard:', clipboardErr);
        }

        // Save to file (if SAVE_PROMPT channel exists)
        try {
          await window.electronAPI.invoke(STORY_IPC_CHANNELS.SAVE_PROMPT, promptString);
          alert('✅ Đã lưu prompt thành công!\n📋 Prompt đã được copy vào clipboard.');
        } catch (saveErr) {
          // If save fails, at least we copied to clipboard
          alert('📋 Prompt đã được copy vào clipboard.\n⚠️ Không thể lưu vào file.');
        }
      } else {
        alert('❌ Lỗi: ' + (result.error || 'Không thể tạo prompt'));
      }
    } catch (e) {
      console.error('[StorySummary] Lỗi lưu prompt:', e);
      alert('❌ Lỗi khi xử lý prompt: ' + String(e));
    } finally {
      setSavingPrompt(false);
    }
  }

  // Export ebook với 3 chế độ: translation only, summary only, combined
  const handleExportEbook = async () => {
    if (summaries.size === 0 && sourceChapters.size === 0) {
      alert('Chưa có nội dung nào để export!');
      return;
    }

    // Ask user for export mode
    const exportMode = await new Promise<'translation' | 'summary' | 'combined' | null>((resolve) => {
      const userChoice = window.confirm(
        '📚 Chọn loại nội dung đóng gói:\n\n' +
        '✅ OK = Bản dịch + Tóm tắt (Kết hợp)\n' +
        '❌ Cancel = Chỉ tóm tắt\n\n' +
        '(Để chọn "Chỉ bản dịch", nhấn Cancel rồi chọn lại)'
      );
      
      if (userChoice) {
        resolve('combined');
      } else {
        // Second prompt for translation vs summary
        const translationOnly = window.confirm(
          '📚 Bạn đã chọn không kết hợp.\n\n' +
          '✅ OK = Chỉ bản dịch\n' +
          '❌ Cancel = Chỉ tóm tắt'
        );
        resolve(translationOnly ? 'translation' : 'summary');
      }
    });

    if (!exportMode) {
      return;
    }

    setExportStatus('exporting');

    try {
      console.log('[StorySummary] Bắt đầu export ebook...', { exportMode });

      // Validate data based on mode
      if ((exportMode === 'translation' || exportMode === 'combined') && sourceChapters.size === 0) {
        alert('⚠️ Chưa có bản dịch nào! Vui lòng dịch truyện trước.');
        setExportStatus('idle');
        return;
      }
      
      if ((exportMode === 'summary' || exportMode === 'combined') && summaries.size === 0) {
        alert('⚠️ Chưa có tóm tắt nào! Vui lòng tóm tắt truyện trước.');
        setExportStatus('idle');
        return;
      }

      // 1. Ask user for save location
      const defaultName = exportMode === 'translation'
        ? `translation_${sourceLang}.epub`
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
      const orderedChapters = chapters.filter(c => 
        (exportMode === 'translation' || exportMode === 'combined') ? sourceChapters.has(c.id) :
        (exportMode === 'summary') ? summaries.has(c.id) : false
      );

      if (exportMode === 'translation') {
        // Chỉ bản dịch
        for (const chapter of orderedChapters) {
          const content = sourceChapters.get(chapter.id);
          if (content) {
            const title = translatedTitles.get(chapter.id) || chapter.title;
            ebookChapters.push({ title, content });
          }
        }
      } else if (exportMode === 'summary') {
        // Chỉ tóm tắt
        for (const chapter of orderedChapters) {
          const content = summaries.get(chapter.id);
          if (content) {
            const title = summaryTitles.get(chapter.id) || translatedTitles.get(chapter.id) || chapter.title;
            ebookChapters.push({
              title: `[Tóm tắt] ${title}`,
              content
            });
          }
        }
      } else {
        // Kết hợp: Chương 1 -> Tóm tắt 1 -> Chương 2 -> Tóm tắt 2...
        for (const chapter of orderedChapters) {
          const translationContent = sourceChapters.get(chapter.id);
          const summaryContent = summaries.get(chapter.id);
          const chapterTitle = translatedTitles.get(chapter.id) || chapter.title;

          // Add translation
          if (translationContent) {
            ebookChapters.push({
              title: chapterTitle,
              content: translationContent
            });
          }

          // Add summary
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

      console.log(`[StorySummary] Đóng gói ${ebookChapters.length} mục...`);
      const outputDir = saveDialogResult.filePath.substring(0, saveDialogResult.filePath.lastIndexOf('\\'));
      const filename = saveDialogResult.filePath.substring(saveDialogResult.filePath.lastIndexOf('\\') + 1).replace('.epub', '');

      // 3. Gọi service tạo ebook
      const result = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.CREATE_EBOOK,
        {
          chapters: ebookChapters,
          title: filename,
          author: 'AI Translator',
          filename: filename,
          outputDir: outputDir
        }
      ) as { success: boolean; filePath?: string; error?: string };

      if (result.success && result.filePath) {
        console.log('[StorySummary] Export thành công:', result.filePath);
        const modeText = exportMode === 'translation' ? 'Bản dịch' :
          exportMode === 'summary' ? 'Tóm tắt' : 'Kết hợp';
        alert(`✅ Đã export thành công!\n\nLoại: ${modeText}\nFile: ${result.filePath}\n\nSố mục: ${ebookChapters.length}`);
      } else {
        throw new Error(result.error || 'Export thất bại');
      }

    } catch (error) {
      console.error('[StorySummary] Lỗi export ebook:', error);
      alert(`❌ Lỗi export ebook: ${error}`);
    } finally {
      setExportStatus('idle');
    }
  }

  return (
    <div className="flex flex-col h-screen p-6 gap-4 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <FileText size={28} className="text-teal-500" />
          <h1 className="text-2xl font-bold bg-linear-to-r from-teal-500 to-emerald-500 bg-clip-text text-transparent">
            Tóm Tắt Truyện AI
          </h1>
        </div>
        {chapters.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm px-3 py-1 bg-blue-500/10 text-blue-500 rounded-full border border-blue-500/20">
              📚 {sourceChapters.size} chương nguồn
            </span>
            <span className="text-sm px-3 py-1 bg-teal-500/10 text-teal-600 rounded-full border border-teal-500/20">
              ✨ {summaries.size}/{chapters.length} tóm tắt
            </span>
            {(summaries.size > 0 || sourceChapters.size > 0) && (
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
        <div className="md:col-span-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text-secondary">Nguồn dữ liệu</label>
            <div className="h-9 px-3 py-2 rounded-lg border border-border bg-surface/50 text-sm text-text-secondary flex items-center">
              {sourceChapters.size > 0 ? `${sourceChapters.size} chương từ Translator` : 'Chưa có dữ liệu'}
            </div>
          </div>
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

        <div className="md:col-span-2">
          <Select
            label="Phương thức"
            value={translateMode}
            onChange={(e) => setTranslateMode(e.target.value as 'api' | 'token' | 'both')}
            options={[
              { value: 'api', label: 'API' },
              { value: 'token', label: 'Token' },
              { value: 'both', label: 'Kết hợp' }
            ]}
          />
        </div>

        <div className="md:col-span-4 flex items-end gap-2">
          <Button 
            onClick={handleTranslate} 
            variant="secondary" 
            disabled={sourceChapters.size === 0 || status === 'running' || !selectedChapterId}
            className="flex-1 h-9 px-3"
            title="Tóm tắt chương đang chọn"
          >
            <Sparkles size={16} />
            Tóm tắt 1
          </Button>
          {status === 'running' && batchProgress ? (
            <Button 
              onClick={handleStopTranslation}
              variant="secondary"
              className="flex-1 h-9 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
              title="Dừng tóm tắt batch hiện tại"
            >
              <StopCircle size={16} />
              Dừng ({batchProgress.current}/{batchProgress.total})
            </Button>
          ) : (
            <Button 
              onClick={handleTranslateAll} 
              variant="primary" 
              disabled={sourceChapters.size === 0 || status === 'running' || selectedChapterCount === 0}
              className="flex-1 h-9 px-3"
              title="Tóm tắt tất cả chương được chọn"
            >
              <Sparkles size={16} />
              Tóm tắt {retranslateSummary ? 'lại ' : ''}{selectedChapterCount}
            </Button>
          )}
        </div>

        <div className="md:col-span-12 flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer hover:text-primary">
            <input
              type="checkbox"
              checked={retranslateSummary}
              onChange={(e) => setRetranslateSummary(e.target.checked)}
              className="w-4 h-4 rounded border-border cursor-pointer"
            />
            <span>Tóm tắt lại các chương đã tóm tắt</span>
          </label>
        </div>
      </div>

      {/* Main Split View */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Empty State - Chưa có projectId */}
        {!projectId && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <FileText size={64} className="text-orange-500/30 mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">Chưa chọn Project</h2>
            <p className="text-text-secondary mb-4 max-w-md">
              Vui lòng mở một project từ Dashboard để sử dụng tính năng tóm tắt truyện.
            </p>
          </div>
        )}

        {/* Empty State - Chưa có dữ liệu */}
        {projectId && chapters.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <FileText size={64} className="text-teal-500/30 mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">Chưa có dữ liệu để tóm tắt</h2>
            <p className="text-text-secondary mb-4 max-w-md">
              Bạn cần dịch truyện ở tab <span className="font-semibold text-primary">"Dịch Truyện AI"</span> trước.
              Sau đó quay lại đây để tóm tắt các chương đã dịch.
            </p>
            <div className="flex flex-col gap-2 text-sm text-text-secondary bg-surface/50 p-4 rounded-lg border border-border">
              <p className="font-semibold text-text-primary mb-1">📋 Hướng dẫn:</p>
              <p>1. Chọn project (nếu chưa có)</p>
              <p>2. Vào tab "Dịch Truyện AI"</p>
              <p>3. Upload file truyện và dịch các chương</p>
              <p>4. Quay lại tab này để tóm tắt</p>
            </div>
          </div>
        )}

        {/* Left Panel: Chapter List */}
        {chapters.length > 0 && (
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
              const hasSummary = summaries.has(chapter.id);
              
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
                    // Tự động chuyển sang view summary nếu đã có tóm tắt
                    if (summaries.has(chapter.id)) {
                      setViewMode('summary');
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
                      : hasSummary 
                        ? 'text-emerald-500 font-medium' 
                        : selectedChapterId === chapter.id 
                          ? 'text-white' 
                          : 'text-text-secondary'
                  }`}>
                    {translatedTitles.get(chapter.id) || chapter.title}
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
        )}

        {/* Right Panel: Content */}
        {chapters.length > 0 && (
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
                 <div className="flex items-center gap-2 mr-2">
                    <input 
                      type="checkbox" 
                      id="useImpit" 
                      checked={useImpit} 
                      onChange={(e) => setUseImpit(e.target.checked)}
                      className="rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="useImpit" className="text-xs text-text-secondary cursor-pointer select-none">
                      Use Impit
                    </label>
                 </div>
                 <Button 
                   onClick={handleSavePrompt} 
                   variant="secondary" 
                   disabled={savingPrompt || !selectedChapterId || !sourceChapters.has(selectedChapterId)}
                   className="text-xs h-8 px-3 gap-1"
                   title="Tạo và copy prompt tóm tắt vào clipboard"
                 >
                   {savingPrompt ? (
                     <>
                       <Loader size={12} className="animate-spin" />
                       Đang xử lý...
                     </>
                   ) : (
                     <>
                       📋 Lưu Prompt
                     </>
                   )}
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
                  sourceChapters.get(selectedChapterId) ? (
                    <div className="whitespace-pre-wrap wrap-break-word">
                      {sourceChapters.get(selectedChapterId)}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                      <FileText size={48} className="mb-4" />
                      <p className="text-base">Không tìm thấy bản dịch cho chương này.</p>
                    </div>
                  )
                ) : (
                  summaries.get(selectedChapterId) ? (
                    <div className="whitespace-pre-wrap wrap-break-word">
                      {summaries.get(selectedChapterId)}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                      <Sparkles size={48} className="mb-4 text-teal-500/50" />
                      <p className="text-base">Chưa có tóm tắt. Nhấn "Tóm tắt 1" hoặc "Tóm tắt All" để bắt đầu.</p>
                    </div>
                  )
                )
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                  <FileText size={48} className="mb-4 text-teal-500/30" />
                  <p className="text-base">Chọn một chương để xem nội dung</p>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

