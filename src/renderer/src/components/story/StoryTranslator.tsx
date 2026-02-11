import { useState, useEffect } from 'react';
import { Chapter } from '@shared/types';
import { GEMINI_MODEL_LIST } from '@shared/constants';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { BookOpen, FileText, CheckSquare, Square, StopCircle, Download, Loader, Clock } from 'lucide-react';
import { extractTranslatedTitle } from './utils/chapterUtils';
import { useChapterSelection } from './hooks/useChapterSelection';
import { useTokenManagement } from './hooks/useTokenManagement';
import { useStoryTranslatorPersistence } from './hooks/useStoryTranslatorPersistence';
import { useProxySettings } from './hooks/useProxySettings';
import { useStoryFileManagement } from './hooks/useStoryFileManagement';
import { useStoryTranslation } from './hooks/useStoryTranslation';
import { useStoryBatchTranslation } from './hooks/useStoryBatchTranslation';
import { useStoryExport } from './hooks/useStoryExport';

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
  const [summaries, setSummaries] = useState<Map<string, string>>(new Map());
  const [summaryTitles, setSummaryTitles] = useState<Map<string, string>>(new Map());
  const [viewMode, setViewMode] = useState<'original' | 'translated' | 'summary'>('original');
  
  // Token management (using custom hook)
  const {
    tokenConfigs,
    tokenConfigId,
    setTokenConfigId,
    tokenContexts,
    setTokenContexts,
    loadConfigurations,
    getDistinctActiveTokenConfigs,
    getPreferredTokenConfig
  } = useTokenManagement();
  
  // Chapter selection (using custom hook)
  const {
    excludedChapterIds,
    setExcludedChapterIds,
    isChapterIncluded,
    toggleChapterExclusion,
    selectAllChapters,
    deselectAllChapters,
    selectedChapterCount
  } = useChapterSelection(chapters);

  // Reading settings
  const [fontSize, setFontSize] = useState<number>(18);
  const [lineHeight, setLineHeight] = useState<number>(1.8);
  const [retranslateExisting, setRetranslateExisting] = useState(false);

  // Proxy settings hook
  const { useProxy } = useProxySettings();

  // File management hook
  const fileManagement = useStoryFileManagement({
    sourceLang,
    targetLang,
    model,
    setFilePath,
    setChapters,
    setExcludedChapterIds,
    setSelectedChapterId,
    setTranslatedChapters,
    setViewMode,
    setStatus
  });

  // Batch translation hook (provides processingChapters state)
  const {
    batchProgress,
    processingChapters,
    setProcessingChapters,
    handleTranslateAll: batchHandleTranslateAll,
    handleStopTranslation: batchHandleStopTranslation
  } = useStoryBatchTranslation({
    chapters,
    sourceLang,
    targetLang,
    model,
    translateMode,
    retranslateExisting,
    useProxy,
    isChapterIncluded,
    translatedChapters,
    tokenConfigs,
    getDistinctActiveTokenConfigs,
    getPreferredTokenConfig,
    setStatus,
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods,
    setTokenContexts
  });

  // Single translation hook (using processingChapters from batch hook)
  const translation = useStoryTranslation({
    chapters,
    sourceLang,
    targetLang,
    model,
    translateMode,
    retranslateExisting,
    useProxy,
    isChapterIncluded,
    getPreferredTokenConfig,
    loadConfigurations,
    setStatus,
    setProcessingChapters, // Share state with batch translation
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods,
    setTokenContexts,
    setViewMode,
    translatedChapters
  });

  // Project state persistence
  const { projectId } = useStoryTranslatorPersistence(
    {
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
      selectedChapterId,
      summaries,
      summaryTitles
    },
    {
      setFilePath,
      setSourceLang,
      setTargetLang,
      setModel,
      setTranslateMode,
      setTranslatedChapters,
      setChapterModels,
      setChapterMethods,
      setTranslatedTitles,
      setTokenConfigId,
      setTokenContexts,
      setViewMode,
      setExcludedChapterIds,
      setSelectedChapterId,
      setSummaries,
      setSummaryTitles,
      setChapters
    },
    fileManagement.parseFile
  );

  // Export ebook hook
  const { exportStatus, handleExportEbook } = useStoryExport({
    translatedChapters,
    translatedTitles,
    chapters,
    sourceLang,
    targetLang,
    projectId
  });

  // Debug logging
  console.log('[StoryTranslator] Render - translatedChapters.size:', translatedChapters.size);
  console.log('[StoryTranslator] Render - status:', status);
  console.log('[StoryTranslator] Render - chapters.length:', chapters.length);

  useEffect(() => {
    if (translateMode === 'token' || translateMode === 'both') {
      if (!tokenConfigId) {
        loadConfigurations();
      }
    }
  }, [translateMode, tokenConfigId]);

  const handleTranslate = async () => {
    await translation.handleTranslate(selectedChapterId);
  };

  const handleTranslateAll = async () => {
    await batchHandleTranslateAll();
  };

  const handleStopTranslation = () => {
    batchHandleStopTranslation();
  };

  const handleSavePrompt = async () => {
    await fileManagement.handleSavePrompt(selectedChapterId, chapters);
  };

  const handleBrowse = async () => {
    await fileManagement.handleBrowse();
  };

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
              Dừng ({batchProgress?.current}/{batchProgress?.total})
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
                      {translatedChapters.get(selectedChapterId) || ''}
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
                          <h3 className="text-lg font-bold mb-4 text-primary">{summaryTitles.get(selectedChapterId) || ''}</h3>
                       )}
                       {summaries.get(selectedChapterId) || ''}
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

