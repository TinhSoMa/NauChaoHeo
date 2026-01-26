import { useState, useEffect, useRef } from 'react';
import { Chapter, ParseStoryResult, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { FileText, CheckSquare, Square, Check, MessageSquare, Ban, Clock, Loader2, Monitor, Settings } from 'lucide-react';

// Browser config interface
interface BrowserConfig {
  userAgent: string | null;
  platform: string | null;
  acceptLanguage: string | null;
}

export function StoryTranslatorWeb() {
  const [filePath, setFilePath] = useState('');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [status, setStatus] = useState('idle');
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [translatedChapters, setTranslatedChapters] = useState<Map<string, string>>(new Map());
  const [processingTimes, setProcessingTimes] = useState<Map<string, number>>(new Map()); // Luu thoi gian xl (ms)
  const [viewMode, setViewMode] = useState<'original' | 'translated'>('original');
  const [excludedChapterIds, setExcludedChapterIds] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  
  // New Config Configs
  const [webConfigs, setWebConfigs] = useState<{label: string, value: string, platform?: string | null}[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [selectedBrowserConfig, setSelectedBrowserConfig] = useState<BrowserConfig | null>(null);
  
  // Session Context State (Conversation Memory)
  const [sessionContext, setSessionContext] = useState<{ conversationId: string; responseId: string; choiceId: string } | null>(null);
  
  // Stop Control
  const stopRef = useRef<boolean>(false);
  
  // Timer States
  const [waitingTime, setWaitingTime] = useState<number>(0); // Seconds waiting for response
  const [cooldownTime, setCooldownTime] = useState<number>(0); // Countdown between requests
  const [isWaitingResponse, setIsWaitingResponse] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleStop = () => {
      stopRef.current = true;
      console.log('[StoryTranslator] Stop requested by user.');
  };

  useEffect(() => {
    loadConfigurations();
  }, []);

  const loadConfigurations = async () => {
    try {
        // 1. Get List of Configs
        const configsResult = await window.electronAPI.geminiChat.getAll();
        if (configsResult.success && configsResult.data) {
            const options = configsResult.data.map(c => ({
                label: c.name || c.id.substring(0, 8),
                value: c.id,
                platform: c.platform
            }));
            setWebConfigs(options);
            
            // Auto-select active config or first one
            const activeConfig = configsResult.data.find(c => c.isActive);
            if (activeConfig) {
                setSelectedConfigId(activeConfig.id);
                updateBrowserConfig(activeConfig.id, configsResult.data);
            } else if (options.length > 0) {
                setSelectedConfigId(options[0].value);
                updateBrowserConfig(options[0].value, configsResult.data);
            }
        }

    } catch (e) {
        console.error('Error loading config:', e);
    }
  };

  const updateBrowserConfig = async (configId: string, configs?: any[]) => {
    try {
        let configData;
        if (configs) {
            configData = configs.find(c => c.id === configId);
        } else {
            const result = await window.electronAPI.geminiChat.getById(configId);
            if (result.success) configData = result.data;
        }
        
        if (configData) {
            setSelectedBrowserConfig({
                userAgent: configData.userAgent || null,
                platform: configData.platform || null,
                acceptLanguage: configData.acceptLanguage || null
            });
        }
    } catch (e) {
        console.error('Error loading browser config:', e);
    }
  };

  const isChapterIncluded = (chapterId: string) => !excludedChapterIds.has(chapterId);

  const toggleChapterExclusion = (chapterId: string) => {
    setExcludedChapterIds(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const selectAllChapters = () => setExcludedChapterIds(new Set());
  const deselectAllChapters = () => setExcludedChapterIds(new Set(chapters.map(c => c.id)));
  const selectedChapterCount = chapters.length - excludedChapterIds.size;

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

  const parseFile = async (path: string) => {
      setStatus('running');
      try {
        const parseResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PARSE, path) as ParseStoryResult;
        if (parseResult.success && parseResult.chapters) {
          setChapters(parseResult.chapters);
          setExcludedChapterIds(new Set()); // Reset exclusion
          if (parseResult.chapters.length > 0) {
             setSelectedChapterId(parseResult.chapters[0].id);
             setViewMode('original');
          }
        }
      } catch (error) {
         console.error('Loi parse:', error);
      } finally {
        setStatus('idle');
      }
  }



  // ... (existing helper functions)

  const handleTranslate = async () => {
    if (!selectedChapterId) return;
    if (!selectedChapterId) return;
    if (!selectedConfigId) { 
        alert('Vui lòng chọn Cấu hình Web!'); 
        return; 
    }
    
    // Reset Context override? No, maybe user wants to continue even single clicks.
    // If user wants to START NEW conversation, we might need a button for that.
    
    const chapter = chapters.find(c => c.id === selectedChapterId);
    if (!chapter) return;

    setStatus('running');
    try {
      // 1. Prepare Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang
      }) as PreparePromptResult;
      
      if (!prepareResult.success || !prepareResult.prompt) throw new Error(prepareResult.error);

      // 2. Send to Gemini Web
      const startTime = Date.now();
      
      // --- FETCH MODE (Original) ---
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
          prompt: prepareResult.prompt,
          method: 'WEB',
          webConfigId: selectedConfigId,
          context: sessionContext
      }) as { success: boolean; data?: string; error?: string; context?: any };

      if (translateResult.success && translateResult.data) {
        setTranslatedChapters(prev => {
          const next = new Map(prev);
          next.set(selectedChapterId, translateResult.data!);
          return next;
        });
        
        // Update Processing Time
        const duration = Date.now() - startTime;
        setProcessingTimes(prev => new Map(prev).set(selectedChapterId, duration));
        
        // Update Session Context from response
        if (translateResult.context) {
            console.log('Cập nhật Session Context:', translateResult.context);
            setSessionContext(translateResult.context);
        }

        setViewMode('translated');
      } else {
        throw new Error(translateResult.error);
      }
    } catch (error) {
      alert(`Lỗi dịch: ${error}`);
    } finally {
      setStatus('idle');
    }
  };

  // ... (existing code: Auto-Pack State, helpers, etc)

  // ... Update Return JSX with Toggle ...
  
  // Inside return (...), adjust the Select area
  /*
        <div className="md:col-span-3 relative group">
             <Select label="Cấu hình Web" value={selectedConfigId} onChange={e => setSelectedConfigId(e.target.value)} options={configOptions} />
             ...
        </div>
        
        <div className="md:col-span-2">
             <Select label="Chế độ" value={useStream ? 'stream' : 'fetch'} onChange={e => setUseStream(e.target.value === 'stream')} options={[{value: 'fetch', label: 'Fetch (Chờ)'}, {value: 'stream', label: 'Stream (Live)'}]} />
        </div>
  */


  // Auto-Pack State
  const [packInterval, setPackInterval] = useState<number>(0); // 0: None, -1: End, >0: Interval

  // ... (existing helper functions)

  const createEbook = async (chaptersToPack: Chapter[], suffix: string) => {
      try {
          const originalTitle = chaptersToPack[0]?.title ? filePath.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "") || "Story" : "Story";
          const title = `${originalTitle} ${suffix}`;
          
          await window.electronAPI.invoke(STORY_IPC_CHANNELS.CREATE_EBOOK, {
              chapters: chaptersToPack.map(c => ({ 
                  title: c.title, 
                  content: translatedChapters.get(c.id) || c.content 
              })),
              title: title,
              filename: title
          });
          console.log(`Đã đóng gói Ebook: ${title}`);
      } catch (e) {
          console.error('Lỗi đóng gói ebook:', e);
      }
  };

  const handleTranslateAll = async () => {
    if (!selectedConfigId) { 
      alert('Vui lòng chọn Cấu hình Web!'); 
      return; 
    }
    
    const chaptersToTranslate = chapters.filter(c => isChapterIncluded(c.id) && !translatedChapters.has(c.id));
    if (chaptersToTranslate.length === 0) { alert('Đã dịch xong!'); return; }

    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });
    
    // Reset stop signal
    stopRef.current = false;

    // Use a local variable to track context through the loop, initializing with current state
    let currentContext = sessionContext;
    let chaptersSinceLastPack: Chapter[] = [];
    
    // Store localized translations to ensure we have latest data for packing
    const sessionMap = new Map<string, string>();
    translatedChapters.forEach((v, k) => sessionMap.set(k, v));

    for (let i = 0; i < chaptersToTranslate.length; i++) {
      // Check Stop
      if (stopRef.current) {
          console.warn('[StoryTranslator] Batch translation stopped by user.');
          break;
      }

      const chapter = chaptersToTranslate[i];
      setBatchProgress({ current: i + 1, total: chaptersToTranslate.length });
      setSelectedChapterId(chapter.id);

      console.group(`[StoryTranslator] Processing Chapter ${i + 1}/${chaptersToTranslate.length}: ${chapter.title}`);
      
      try {
        console.log('[StoryTranslator] Step 1: Preparing prompt...');
        const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
          chapterContent: chapter.content,
          sourceLang, 
          targetLang
        }) as PreparePromptResult;
        console.log('[StoryTranslator] Step 2: Prompt prepared, success:', prepareResult.success);
        
        if (prepareResult.success && prepareResult.prompt) {
             console.log('[StoryTranslator] Step 3: Calling TRANSLATE_CHAPTER...');
             
             // Start waiting timer
             setIsWaitingResponse(true);
             setWaitingTime(0);
             const startTime = Date.now();
             timerRef.current = setInterval(() => {
                 setWaitingTime(Math.floor((Date.now() - startTime) / 1000));
             }, 1000);
             
             // --- FETCH MODE (Original Batch) ---
             const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
                prompt: prepareResult.prompt,
                method: 'WEB',
                webConfigId: selectedConfigId,
                context: currentContext
            }) as { success: boolean; data?: string; error?: string; context?: any };
            
            // Stop waiting timer
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            setIsWaitingResponse(false);
            
            console.log('[StoryTranslator] Step 4: TRANSLATE_CHAPTER returned, success:', translateResult.success);

            if (translateResult.success && translateResult.data) {
                const translatedText = translateResult.data!;
                console.log('[StoryTranslator] Step 5: Translated length:', translatedText.length);

                setTranslatedChapters(prev => {
                    const next = new Map(prev);
                    next.set(chapter.id, translatedText);
                    return next;
                });
                
                chaptersSinceLastPack.push(chapter);
                sessionMap.set(chapter.id, translatedText);

                // Update Processing Time
                const duration = Date.now() - startTime;
                setProcessingTimes(prev => new Map(prev).set(chapter.id, duration));

                // Auto-Pack Interval Logic
                if (packInterval > 0 && chaptersSinceLastPack.length >= packInterval) {
                     console.log('[StoryTranslator] Auto-Packing...');
                     const packBatchIndex = Math.ceil((i + 1) / packInterval);
                     await createEbook(
                         chaptersSinceLastPack, 
                         `- Part ${packBatchIndex}`
                     );
                     chaptersSinceLastPack = []; // Reset batch
                }

                if (translateResult.context) {
                    currentContext = translateResult.context;
                    console.log('[StoryTranslator] Step 6: Context updated');
                    setSessionContext(currentContext);
                }
            } else {
                console.error(`[StoryTranslator] Translation Failed:`, translateResult.error);
            }
        }
        
        // Cooldown delay between chapters (5 seconds to avoid rate limiting)
        const DELAY_SECONDS = 5;
        if (i < chaptersToTranslate.length - 1 && !stopRef.current) {
            console.log(`[StoryTranslator] Step 7: Waiting ${DELAY_SECONDS}s before next chapter...`);
            for (let countdown = DELAY_SECONDS; countdown > 0 && !stopRef.current; countdown--) {
                setCooldownTime(countdown);
                await new Promise(r => setTimeout(r, 1000));
            }
            setCooldownTime(0);
        }

      } catch (error) {
        console.error(`[StoryTranslator] Error:`, error);
        // Stop waiting timer on error
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setIsWaitingResponse(false);
      }
      console.groupEnd();
    }

    // Final Packing Logic (Only if NOT fully stopped early? Or just pack what we have?)
    // If stopped, we might still want to pack what we have if the user wants partials.
    // Given logic: "Pack remaining"
    
    if (packInterval === -1 && !stopRef.current) {
         // Pack Full - Only if finished normally? Or partial full? 
         // If stopped, we probably shouldn't pack "Full".
         // Let's pack whatever we have if requested? 
         // Usually "Pack when done" implies completion. 
         // If stopped, let's NOT pack Full automatically.
         
         const finalChapters: Chapter[] = [];
         for (const chapter of chapters) {
              let content = sessionMap.get(chapter.id);
              if (!content) content = translatedChapters.get(chapter.id);
              if (content) finalChapters.push({ ...chapter, content: content });
         }
         
         if (finalChapters.length > 0) {
              await createEbook(finalChapters, " - Full");
         }
    } else if (packInterval > 0 && chaptersSinceLastPack.length > 0) {
         // Pack stragglers
         const packBatchIndex = Math.ceil(sessionMap.size / packInterval); 
         await createEbook(chaptersSinceLastPack, `- Part ${packBatchIndex} (End)`);
    }

    setStatus('idle');
    setBatchProgress(null);
    setViewMode('translated');
  };

  const resetSession = () => {
      setSessionContext(null);
      alert('Đã xóa ngữ cảnh phiên làm việc. Chương tiếp theo sẽ bắt đầu hội thoại mới.');
  };

  const LANG_OPTIONS = [
    { value: 'auto', label: 'Tự động' },
    { value: 'en', label: 'Tiếng Anh' },
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'zh', label: 'Tiếng Trung' },
    { value: 'ja', label: 'Tiếng Nhật' },
    { value: 'ko', label: 'Tiếng Hàn' },
  ];
  
  const PACK_OPTIONS = [
      { value: 0, label: 'Không đóng gói' },
      { value: 10, label: 'Mỗi 10 chương' },
      { value: 50, label: 'Mỗi 50 chương' },
      { value: -1, label: 'Đóng gói khi xong' },
  ];

  return (
    <div className="flex flex-col h-screen p-6 gap-4 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
          <MessageSquare className="w-8 h-8" />
          Dịch Truyện (Google Web)
        </h1>
        <div className="flex gap-2 items-center">
             {selectedBrowserConfig && (
               <div className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded border border-blue-200 flex items-center gap-1" title={selectedBrowserConfig.userAgent || 'Chưa có User-Agent'}>
                 <Monitor size={12} />
                 <span>{selectedBrowserConfig.platform || 'Auto Browser'}</span>
               </div>
             )}
             {!selectedConfigId && (
                 <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded border border-red-200">
                    Chưa chọn Config
                 </span>
             )}
             {sessionContext && (
                 <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded border border-green-200">
                    Đang nhớ ngữ cảnh ({sessionContext.conversationId})
                 </span>
             )}
             <Button onClick={resetSession} variant="secondary" className="text-xs h-8">Reset Session</Button>
             <Button 
               onClick={() => {
                 // Navigate to Settings tab
                 const event = new CustomEvent('navigate-to-settings', { detail: { tab: 'gemini-chat' } });
                 window.dispatchEvent(event);
               }} 
               variant="secondary" 
               className="text-xs h-8 flex items-center gap-1"
               title="Mở cài đặt Gemini Chat"
             >
               <Settings size={14} />
               Cài đặt
             </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 bg-card border border-border rounded-xl">
        <div className="md:col-span-4 flex flex-col gap-2">
             <label className="text-sm font-medium">File Truyện</label>
             <div className="flex gap-2">
               <Input value={filePath} readOnly placeholder="Chọn file..." containerClassName="flex-1" />
               <Button onClick={handleBrowse} variant="secondary"><FileText size={16} /></Button>
             </div>
        </div>
        
        <div className="md:col-span-3 relative group">
             <Select 
               label="Cấu hình Web" 
               value={selectedConfigId} 
               onChange={e => {
                 setSelectedConfigId(e.target.value);
                 updateBrowserConfig(e.target.value);
               }} 
               options={webConfigs} 
             />
             {selectedBrowserConfig && (
               <div className="absolute right-2 top-9 flex items-center gap-1 pointer-events-none">
                 <Monitor size={14} className="text-muted-foreground" />
                 <span className="text-xs text-muted-foreground">
                   {selectedBrowserConfig.platform || 'Auto'}
                 </span>
               </div>
             )}
        </div>

        <div className="md:col-span-2">
             <Select label="Đóng gói Ebook" value={packInterval} onChange={e => setPackInterval(Number(e.target.value))} options={PACK_OPTIONS} />
        </div>
        


        <div className="md:col-span-2">
          <Select label="Ngôn ngữ gốc" value={sourceLang} onChange={e => setSourceLang(e.target.value)} options={LANG_OPTIONS} />
        </div>

        <div className="md:col-span-2">
           <Select label="Ngôn ngữ đích" value={targetLang} onChange={e => setTargetLang(e.target.value)} options={LANG_OPTIONS} />
        </div>

        <div className="md:col-span-2 flex items-end gap-2 col-start-11 md:col-start-auto">
          <Button onClick={handleTranslate} disabled={!selectedChapterId || status === 'running'} className="flex-1" title="Dịch chương hiện tại">
            Dịch 1
          </Button>
          {status === 'running' ? (
              <Button onClick={handleStop} variant="danger" className="flex-1">
                  <Ban size={16} className="mr-1" /> Dừng ({batchProgress ? `${batchProgress.current}/${batchProgress.total}` : ''})
              </Button>
          ) : (
              <Button onClick={handleTranslateAll} variant="primary" disabled={!selectedChapterId || status === 'running'} className="flex-1" title="Dịch toàn bộ">
                Dịch All
              </Button>
          )}
        </div>
        
        {/* Timer Status Bar */}
        {status === 'running' && (
          <div className="md:col-span-12 flex items-center gap-4 px-3 py-2 bg-surface/50 border border-border rounded-lg text-sm">
            {isWaitingResponse ? (
              <>
                <Loader2 size={16} className="animate-spin text-primary" />
                <span className="text-muted-foreground">Đang chờ phản hồi...</span>
                <span className="font-mono text-primary font-semibold">{waitingTime}s</span>
              </>
            ) : cooldownTime > 0 ? (
              <>
                <Clock size={16} className="text-warning" />
                <span className="text-muted-foreground">Chờ trước khi dịch chương tiếp theo:</span>
                <span className="font-mono text-warning font-semibold">{cooldownTime}s</span>
              </>
            ) : (
              <>
                <Check size={16} className="text-success" />
                <span className="text-success">Sẵn sàng dịch chương tiếp theo...</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Chapter List */}
        <div className="w-1/4 bg-card border border-border rounded-xl flex flex-col">
          <div className="p-3 border-b flex justify-between items-center bg-surface/50">
             <span className="font-semibold">Chương ({selectedChapterCount}/{chapters.length})</span>
             <div className="flex gap-1">
               <button onClick={selectAllChapters} className="p-1 hover:bg-primary/10 rounded"><CheckSquare size={14} /></button>
               <button onClick={deselectAllChapters} className="p-1 hover:bg-primary/10 rounded"><Square size={14} /></button>
             </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {chapters.map(c => (
              <div 
                key={c.id} 
                onClick={() => { setSelectedChapterId(c.id); setViewMode(translatedChapters.has(c.id) ? 'translated' : 'original'); }}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer ${selectedChapterId === c.id ? 'bg-primary text-white' : 'hover:bg-surface'}`}
              >
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleChapterExclusion(c.id); }}
                  className={`w-4 h-4 border rounded flex items-center justify-center ${isChapterIncluded(c.id) ? 'bg-current' : 'border-gray-400'}`}
                >
                   {isChapterIncluded(c.id) && <Check size={10} className={selectedChapterId === c.id ? 'text-primary' : 'text-white'} />}
                </button>
                <span className={`truncate text-sm flex-1 ${!isChapterIncluded(c.id) && 'opacity-50 line-through'}`}>{c.title}</span>
                {processingTimes.has(c.id) && (
                    <span className="text-[10px] text-gray-400 font-mono">
                        {(processingTimes.get(c.id)! / 1000).toFixed(1)}s
                    </span>
                )}
                {translatedChapters.has(c.id) && <Check size={14} className="text-green-400" />}
              </div>
            ))}
          </div>
        </div>

        {/* Content View */}
        <div className="flex-1 bg-card border border-border rounded-xl flex flex-col">
            <div className="p-3 border-b flex justify-between items-center bg-surface/50">
               <div className="flex gap-2">
                 <Button variant={viewMode === 'original' ? 'primary' : 'secondary'} onClick={() => setViewMode('original')} className="text-xs h-7 px-3">Gốc</Button>
                 <Button variant={viewMode === 'translated' ? 'primary' : 'secondary'} onClick={() => setViewMode('translated')} disabled={!selectedChapterId || !translatedChapters.has(selectedChapterId)} className="text-xs h-7 px-3">Bản Dịch</Button>
               </div>
               <span className="text-sm font-medium">{chapters.find(c => c.id === selectedChapterId)?.title}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-6 text-lg leading-relaxed whitespace-pre-wrap">
               {selectedChapterId ? (
                   viewMode === 'original' 
                   ? chapters.find(c => c.id === selectedChapterId)?.content 
                   : (translatedChapters.get(selectedChapterId) || 'Chưa dịch')
               ) : <div className="text-center text-gray-400 mt-20">Chọn chương để xem</div>}
            </div>
        </div>
      </div>
    </div>
  );
}
