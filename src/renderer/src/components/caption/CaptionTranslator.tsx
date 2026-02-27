import { useState, useEffect } from 'react';
import styles from './CaptionTranslator.module.css';
import { Button } from '../common/Button';
import folderIconUrl from '../../../../../resources/icons/folder.svg';
import videoIconUrl from '../../../../../resources/icons/video.svg';
import { Input } from '../common/Input';
import { RadioButton } from '../common/RadioButton';
import { Checkbox } from '../common/Checkbox';
import { useProjectContext } from '../../context/ProjectContext';
import {
  GEMINI_MODELS,
  VOICES,
  RATE_OPTIONS,
  VOLUME_OPTIONS,
  STEP_LABELS,
  LINES_PER_FILE_OPTIONS,
} from '../../config/captionConfig';
import { Step } from './CaptionTypes';
import { useCaptionSettings } from './hooks/useCaptionSettings';
import { useCaptionFileManagement } from './hooks/useCaptionFileManagement';
import { useCaptionProcessing } from './hooks/useCaptionProcessing';
import { SubtitlePreview } from './SubtitlePreview';
import { Settings, Download } from 'lucide-react';

export function CaptionTranslator() {
  // Project output paths
  const { paths } = useProjectContext();
  const captionFolder = paths?.caption ?? null;

  // 1. Settings Hook
  const settings = useCaptionSettings();

  // 2. File Management Hook
  const fileManager = useCaptionFileManagement({
    inputType: settings.inputType,
  });

  // 3. Subtitle Position State (for hardsub drag-drop)
  const [subtitlePosition, setSubtitlePosition] = useState<{ x: number; y: number } | null>(null);

  // 4. Processing Hook
  const processing = useCaptionProcessing({
    entries: fileManager.entries,
    setEntries: fileManager.setEntries,
    filePath: fileManager.filePath,
    inputType: settings.inputType,
    captionFolder,
    settings: { ...settings, subtitlePosition },
    enabledSteps: settings.enabledSteps,
    setEnabledSteps: settings.setEnabledSteps,
  });

  const audioFiles = processing.audioFiles;

  // --- Download prompt preview ---
  const handleDownloadPromptPreview = async () => {
    const entries = fileManager.entries;
    const linesPerBatch = 50;
    const batchTexts = entries.slice(0, linesPerBatch).map(e => e.text);
    const count = batchTexts.length;

    // Lấy custom prompt từ DB nếu có
    let customTemplate: string | undefined;
    let promptName = 'default';
    try {
      const settingsRes = await window.electronAPI.appSettings.getAll();
      const captionPromptId = settingsRes?.data?.captionPromptId;
      if (captionPromptId) {
        const promptRes: any = await window.electronAPI.invoke('prompt:getById', captionPromptId);
        if (promptRes?.content) {
          customTemplate = promptRes.content;
          promptName = promptRes.name || captionPromptId;
        }
      }
    } catch (e) {
      console.warn('[PromptPreview] Không tải được settings/prompt:', e);
    }

    let prompt: string;
    let responseFormat: 'pipe' | 'numbered';

    if (customTemplate) {
      const arrayText = JSON.stringify(batchTexts);
      const rawText = batchTexts.join('\n');
      prompt = customTemplate
        .replace(/"\{\{TEXT\}\}"/g, arrayText)   // "{{TEXT}}" → JSON array
        .replace(/\{\{TEXT\}\}/g, rawText)          // {{TEXT}} → plain fallback
        .replace(/\{\{COUNT\}\}/g, String(count))
        .replace(/\{\{FILE_NAME\}\}/g, 'subtitle');
      const isPipe = /response_format["']?\s*:\s*["']?\|/.test(customTemplate)
        || /"separator"\s*:\s*"\|"/.test(customTemplate)
        || /Format output.*\|/.test(customTemplate);
      responseFormat = isPipe ? 'pipe' : 'numbered';
    } else {
      // Default numbered format
      const numberedLines = batchTexts.map((t, i) => `[${i + 1}] ${t}`).join('\n');
      prompt = `Dịch các dòng subtitle sau sang tiếng Vietnamese.\nQuy tắc:\n1. Dịch tự nhiên, phù hợp ngữ cảnh\n2. Giữ nguyên số thứ tự [1], [2], ...\n3. Không thêm giải thích\n4. Mỗi dòng dịch tương ứng với dòng gốc\n\nNội dung cần dịch:\n${numberedLines}\n\nKết quả (chỉ trả về các dòng đã dịch, giữ nguyên format [số]):`;
      responseFormat = 'numbered';
    }

    const header = [
      `; === CAPTION PROMPT PREVIEW ===`,
      `; Prompt: ${customTemplate ? promptName : '(default built-in)'}`,
      `; Response format: ${responseFormat}`,
      `; Batch size: ${count} / ${entries.length} dòng (chỉ batch đầu tiên)`,
      `; ================================`,
      '',
    ].join('\n');

    const content = header + prompt;

    const saveRes = await (window.electronAPI as any).invoke('dialog:showSaveDialog', {
      title: 'Lưu preview prompt',
      defaultPath: 'caption_prompt_preview.txt',
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (!saveRes?.filePath) return;

    // Ghi file qua IPC
    await (window.electronAPI as any).invoke('fs:writeFile', { filePath: saveRes.filePath, content });
  };

  // 5. Available Fonts State
  const [availableFonts, setAvailableFonts] = useState<string[]>(['ZYVNA Fairy', 'Be Vietnam Pro', 'Roboto']);

  const [diskAudioDuration, setDiskAudioDuration] = useState<number | null>(null);
  const [diskSubtitleDuration, setDiskSubtitleDuration] = useState<number | null>(null);

  // Section 6 (Cấu hình) luôn dùng folder đầu tiên làm tham chiếu cấu hình.
  // Folder đang xử lý (processing.currentFolder) chỉ dùng cho progress badge ở Section 7.
  const firstFolderPath = fileManager.filePath?.split('; ')[0] ?? '';
  const isMultiFolder = (fileManager.filePath?.split('; ').length ?? 0) > 1;

  // Khi đang xử lý multi-folder, dùng path của folder đang xử lý để hiển thị thông số video chính xác.
  // Khi idle, hiển thị folder đầu tiên trong danh sách.
  const displayPath = processing.currentFolder?.path ?? firstFolderPath;
  const videoInfo = displayPath ? fileManager.folderVideos[displayPath] : null;
  const originalVideoDuration = videoInfo?.duration || 0;

  // Output dir cho folder đang display (theo dõi real-time trong multi-folder)
  const displayOutputDir = settings.inputType === 'srt'
    ? (displayPath ? displayPath.replace(/[^/\\]+$/, 'caption_output') : captionFolder)
    : (displayPath ? `${displayPath}/caption_output` : '');

  // 6. Tính toán thời lượng Audio & Video cho Step 7
  // Reset khi chuyển folder cấu hình (firstFolderPath thay đổi)
  useEffect(() => {
    setDiskAudioDuration(null);
    setDiskSubtitleDuration(null);
  }, [firstFolderPath]);

  useEffect(() => {
    let mounted = true;
    const fetchDiskDuration = async () => {
      if (!displayOutputDir) {
        if (mounted) setDiskAudioDuration(null);
        return;
      }
      try {
        const audioPath = `${displayOutputDir}/merged_audio.wav`;
        console.log("Fetching metadata for audio path:", audioPath);
        const res = await (window.electronAPI as any).captionVideo.getVideoMetadata(audioPath);
        console.log("Metadata response:", res);
        if (mounted && res?.success && res.data?.duration) {
          const audioDuration: number = res.data.duration;
          // Sanity check: nếu audio > 2× video duration → stale file từ run cũ, bỏ qua
          if (originalVideoDuration > 0 && audioDuration > originalVideoDuration * 2) {
            console.warn(`diskAudioDuration ${audioDuration}s > 2× video ${originalVideoDuration}s — stale file, ignoring`);
            if (mounted) setDiskAudioDuration(null);
          } else {
            if (mounted) setDiskAudioDuration(audioDuration);
          }
        } else if (mounted) {
          setDiskAudioDuration(null);
        }
      } catch (err) {
        console.error("Error fetching disk duration:", err);
        if (mounted) setDiskAudioDuration(null);
      }
    };

    fetchDiskDuration();
    if (processing.status === 'success') {
      fetchDiskDuration();
    }
    return () => { mounted = false; };
  }, [displayOutputDir, originalVideoDuration, processing.status]);

  const srtDurationMs = fileManager.entries.length > 0 
    ? Math.max(...fileManager.entries.map(e => e.endMs || 0)) 
    : 0;
  const srtTimeScale = settings.srtSpeed > 0 ? settings.srtSpeed : 1.0;

  const normalizeSpeedLabel = (speed: number) => {
    const fixed = speed.toFixed(2);
    return fixed.replace(/\.?0+$/, '');
  };

  useEffect(() => {
    let mounted = true;
    const fetchDiskSubtitleDuration = async () => {
      if (!displayOutputDir) {
        if (mounted) setDiskSubtitleDuration(null);
        return;
      }

      const getDurationFromSrt = async (srtPath: string, scale: number) => {
        try {
          const res = await (window.electronAPI as any).caption.parseSrt(srtPath);
          if (!res?.success || !res?.data?.entries?.length) return null;
          const endMs = Math.max(...res.data.entries.map((e: any) => e.endMs || 0));
          if (!endMs || endMs <= 0) return null;
          return (endMs / 1000) * scale;
        } catch {
          return null;
        }
      };

      const scaleLabel = normalizeSpeedLabel(srtTimeScale);
      const scaledSrtPath = `${displayOutputDir}/srt/subtitle_${scaleLabel}x.srt`;
      const translatedSrtPath = `${displayOutputDir}/srt/translated.srt`;

      let durationSec = await getDurationFromSrt(scaledSrtPath, 1.0);
      if (durationSec == null) {
        durationSec = await getDurationFromSrt(translatedSrtPath, srtTimeScale);
      }

      if (mounted) {
        setDiskSubtitleDuration(durationSec);
      }
    };

    fetchDiskSubtitleDuration();
    if (processing.status === 'success') {
      fetchDiskSubtitleDuration();
    }
    return () => { mounted = false; };
  }, [displayOutputDir, srtTimeScale, processing.status]);

  const scaledSrtDurationSec = srtDurationMs > 0 ? (srtDurationMs / 1000) * srtTimeScale : 0;
  const subtitleSyncDurationSec = scaledSrtDurationSec > 0
    ? scaledSrtDurationSec
    : (diskSubtitleDuration || 0);

  // Multi-folder: entries không được load (guarded by !isMulti) nên srtDurationMs = 0.
  // Fallback: dùng videoInfo.duration của folder hiện tại làm ước tính duration audio
  // (TTS fill theo SRT timing ≈ video duration). Cập nhật real-time khi currentFolder đổi.
  let fallbackBaseAudioDurationMs = srtDurationMs;
  if (isMultiFolder && fallbackBaseAudioDurationMs === 0 && originalVideoDuration > 0) {
    fallbackBaseAudioDurationMs = originalVideoDuration * 1000;
  }

  // Single-folder: có thể dùng audioFiles nếu đã chạy TTS
  if (!isMultiFolder && !settings.autoFitAudio && audioFiles && audioFiles.length > 0) {
    let maxEndTime = 0;
    for (const f of audioFiles) {
      // @ts-ignore
      const ttsEndMs = f.startMs + (typeof f.durationMs === 'number' ? f.durationMs : 0);
      if (ttsEndMs > maxEndTime) maxEndTime = ttsEndMs;
    }
    fallbackBaseAudioDurationMs = Math.max(srtDurationMs, maxEndTime);
  }

  // Dùng diskAudioDuration (file thực trên đĩa) nếu có, cả single và multi-folder
  const baseAudioDuration = (diskAudioDuration !== null && diskAudioDuration > 0)
    ? diskAudioDuration
    : (fallbackBaseAudioDurationMs / 1000);

  // isEstimated: true khi không có audio file thực và dùng video duration fallback
  const isEstimated = diskAudioDuration === null && srtDurationMs === 0 && originalVideoDuration > 0;

  const audioExpectedDuration = settings.renderAudioSpeed > 0 
    ? baseAudioDuration / settings.renderAudioSpeed 
    : baseAudioDuration;

  const step4Scale = srtTimeScale > 0 ? srtTimeScale : 1.0;
  const step7Speed = settings.renderAudioSpeed > 0 ? settings.renderAudioSpeed : 1.0;
  const audioEffectiveSpeed = step4Scale - (step7Speed - 1);
  const subRenderDuration = subtitleSyncDurationSec;
  const videoSubBaseDuration = step4Scale > 0 ? (subRenderDuration / step4Scale) : subRenderDuration;

  let autoVideoSpeed = 1.0;
  if (videoSubBaseDuration > 0 && audioExpectedDuration > 0) {
    autoVideoSpeed = videoSubBaseDuration / audioExpectedDuration;
  }
  const videoMarkerSec = audioExpectedDuration * autoVideoSpeed;

  const formatDuration = (seconds: number) => {
    if (seconds <= 0) return '--';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1);
    return m > 0 ? `${m}p${s}s` : `${s}s`;
  };

  useEffect(() => {
    console.log(`[CaptionTranslator] 🕒 THỜI GIAN GỐC & TÍNH TOÁN (AUTO-FIT):
- File audio trên đĩa (diskAudioDuration): ${diskAudioDuration ? diskAudioDuration.toFixed(2) + 's' : 'null'}
- Thời gian gốc dự phòng (fallbackBaseAudioDurationMs): ${(fallbackBaseAudioDurationMs / 1000).toFixed(2)}s
- Mốc subtitle cuối (scaled theo srtSpeed): ${scaledSrtDurationSec.toFixed(2)}s
- Mốc subtitle từ file SRT trên đĩa: ${diskSubtitleDuration ? diskSubtitleDuration.toFixed(2) + 's' : 'null'}
- Step4 scale: ${step4Scale.toFixed(3)}x
- Step7 speed: ${step7Speed.toFixed(3)}x
- Audio hiệu dụng (step4 - delta step7): ${audioEffectiveSpeed.toFixed(3)}x
- Sub render duration: ${subRenderDuration.toFixed(2)}s
- Video sub base duration: ${videoSubBaseDuration.toFixed(2)}s
- Duration Audio gốc (baseAudioDuration): ${baseAudioDuration.toFixed(2)}s
- Tốc độ Audio thiết lập (settings.renderAudioSpeed): ${settings.renderAudioSpeed}x
- 👉 Duration Audio mới (Render video length): ${audioExpectedDuration.toFixed(2)}s
- Duration Video dùng để sync (videoSubBaseDuration): ${videoSubBaseDuration.toFixed(2)}s
- 👉 Tốc độ Video tự động chỉnh (autoVideoSpeed): ${autoVideoSpeed.toFixed(3)}x
- 🎯 Mốc video chuẩn (gốc): ${videoMarkerSec.toFixed(2)}s
    `);
  }, [diskAudioDuration, diskSubtitleDuration, fallbackBaseAudioDurationMs, scaledSrtDurationSec, baseAudioDuration, settings.renderAudioSpeed, audioExpectedDuration, step4Scale, step7Speed, audioEffectiveSpeed, subRenderDuration, videoSubBaseDuration, autoVideoSpeed, videoMarkerSec]);

  useEffect(() => {
    // Lấy danh sách font thực tế từ resources/fonts
    const fetchFonts = async () => {
      try {
        const res = await (window.electronAPI as any).captionVideo.getAvailableFonts();
        if (res?.success && res.data?.length > 0) {
          setAvailableFonts(res.data);
        }
      } catch (err) {
        console.error("Lỗi lấy font", err);
      }
    };
    fetchFonts();
  }, []);
  
  const getProgressColor = () => {
    if (processing.status === 'error') return 'var(--color-error)';
    if (processing.status === 'success') return 'var(--color-success)';
    return 'var(--color-primary)';
  };

  return (
    <div className={styles.container}>

      {/* Cột trái: Input, Model, TTS */}
      <div className={styles.leftColumn}>
        {/* Section 1: File Input */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>1. Chọn file đầu vào</div>
          
            <div className={styles.fileTypeSelection}>
            <RadioButton
              label="File SRT"
              checked={settings.inputType === 'srt'}
              onChange={() => settings.setInputType('srt')}
              name="inputType"
            />
            <RadioButton
              label="Draft JSON (CapCut)"
              description="Dịch trực tiếp từ CapCut"
              checked={settings.inputType === 'draft'}
              onChange={() => settings.setInputType('draft')}
              name="inputType"
            />
          </div>

          <div className={styles.flexRow} style={settings.inputType === 'draft' ? { alignItems: 'stretch' } : {}}>
            {settings.inputType === 'srt' ? (
              <Input
                value={fileManager.filePath}
                onChange={(e) => fileManager.setFilePath(e.target.value)}
                placeholder="Đường dẫn file .srt"
              />
            ) : (
              <div 
                className={`${styles.folderBoxContainer} ${!fileManager.filePath ? styles.emptyFolderBox : ''}`}
                onClick={!fileManager.filePath ? fileManager.handleBrowseFile : undefined}
              >
                {!fileManager.filePath ? (
                  <span className={styles.placeholderText}>Chưa chọn thư mục dự án nào...</span>
                ) : (
                  <div className={styles.folderGrid}>
                    {fileManager.filePath.split('; ').map((path, idx) => {
                      // Extract folder name from path
                      const folderName = path.split(/[/\\]/).pop() || path;
                      const videoInfo = fileManager.folderVideos[path];
                      
                      return (
                        <div key={idx} className={styles.folderBox} title={path}>
                          <div className={styles.folderBoxHeader}>
                            <img src={folderIconUrl} alt="folder" className={styles.folderIcon} style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                            <span className={styles.folderName}>{folderName}</span>
                          </div>
                          {videoInfo && (
                            <div className={styles.folderBoxSubText}>
                              <img src={videoIconUrl} alt="video" style={{ width: '14px', height: '14px', display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} />
                              {videoInfo.name}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <Button onClick={fileManager.handleBrowseFile}>
              Browse
            </Button>
          </div>
          {fileManager.entries.length > 0 && (
            <p className={styles.textMuted} style={{ marginTop: '8px' }}>Đã load: {fileManager.entries.length} dòng</p>
          )}
        </div>

        {/* Section 2: Split Config */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>2. Cấu hình chia nhỏ Text</div>
          <div className={styles.splitConfig}>

            <RadioButton
              label="Dòng/file"
              checked={settings.splitByLines}
              onChange={() => settings.setSplitByLines(true)}
              name="splitConfig"
            >
              <select 
                value={settings.linesPerFile} 
                onChange={(e) => settings.setLinesPerFile(Number(e.target.value))}
                className={`${styles.select} ${styles.selectSmall} ${!settings.splitByLines ? styles.disabled : ''}`}
                disabled={!settings.splitByLines}
                onClick={(e) => e.stopPropagation()}
                style={{ marginTop: '8px' }}
              >
                {LINES_PER_FILE_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </RadioButton>

            <RadioButton
              label="Số phần"
              checked={!settings.splitByLines}
              onChange={() => settings.setSplitByLines(false)}
              name="splitConfig"
            >
              <Input
                type="number"
                value={settings.numberOfParts}
                onChange={(e) => settings.setNumberOfParts(Number(e.target.value))}
                min={2}
                max={20}
                variant="small"
                disabled={settings.splitByLines}
                onClick={(e) => e.stopPropagation()}
                containerClassName={settings.splitByLines ? styles.disabled : ''}
                style={{ marginTop: '8px' }}
              />
            </RadioButton>
          </div>
        </div>

        {/* Section 3: Gemini Model */}
        <div className={styles.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div className={styles.sectionTitle} style={{ margin: 0 }}>3. Cấu hình Dịch (Step 3)</div>
            <Button
              variant="secondary"
              onClick={handleDownloadPromptPreview}
              disabled={fileManager.entries.length === 0}
              title={fileManager.entries.length === 0 ? 'Load SRT trước để xem prompt' : 'Tải preview prompt (batch 1)'}
              style={{ padding: '4px 10px', fontSize: '12px', height: '28px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Download size={13} />
              Preview Prompt
            </Button>
          </div>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '10px' }}>
            <RadioButton
              label="API (Gemini Key)"
              checked={settings.translateMethod === 'api'}
              onChange={() => settings.setTranslateMethod('api')}
              name="translateMethod"
            />
            <RadioButton
              label="Impit (Cookie Browser)"
              checked={settings.translateMethod === 'impit'}
              onChange={() => settings.setTranslateMethod('impit')}
              name="translateMethod"
            />
          </div>
          <select
            value={settings.geminiModel}
            onChange={(e) => settings.setGeminiModel(e.target.value)}
            className={styles.select}
            disabled={settings.translateMethod === 'impit'}
            style={settings.translateMethod === 'impit' ? { opacity: 0.4 } : undefined}
          >
            {GEMINI_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Section 4: TTS Config */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>4. Cấu hình Giọng đọc (TTS)</div>
          <div className={styles.grid2}>
            <div>
              <label className={styles.label}>Giọng đọc</label>
              <select value={settings.voice} onChange={(e) => settings.setVoice(e.target.value)} className={styles.select}>
                {VOICES.map(v => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label}>Tốc độ SRT</label>
            <Input
              type="number"
              value={settings.srtSpeed}
              onChange={(e) => settings.setSrtSpeed(Number(e.target.value))}
              min={1}
              max={2}
              step={0.1}
            />
            </div>
          </div>
          <div className={styles.grid2} style={{ marginTop: '12px' }}>
            <div>
              <label className={styles.label}>Tốc độ đọc</label>
              <select value={settings.rate} onChange={(e) => settings.setRate(e.target.value)} className={styles.select}>
                {RATE_OPTIONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label}>Âm lượng</label>
              <select value={settings.volume} onChange={(e) => settings.setVolume(e.target.value)} className={styles.select}>
                {VOLUME_OPTIONS.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          


          <div style={{ marginTop: '12px' }}>
            <Checkbox
              label="Tự động điều chỉnh tốc độ audio (fit vào thời lượng SRT)"
              checked={settings.autoFitAudio}
              onChange={() => settings.setAutoFitAudio(!settings.autoFitAudio)}
            />
          </div>
        </div>
      </div>

      {/* Cột phải: Split, Controls */}
      <div className={styles.rightColumn}>
        {/* Section 6: Video Options (Only shows when Step 7 is checked) */}
        {processing.enabledSteps.has(7) && (
          <div className={styles.section} style={{ marginTop: '20px' }}>
            <div className={styles.sectionTitle}><Settings size={16} style={{display: 'inline-block', verticalAlign: 'middle', marginRight: 8}}/>6. Cấu hình Subtitle Video (Step 7)</div>

            {/* Loại Video Output */}
            <div className={styles.grid2} style={{marginBottom: 16}}>
               <div style={{gridColumn: '1 / -1'}}>
                 <span className={styles.label}>Loại Video Output</span>
                 <div style={{display: 'flex', gap: '20px', marginTop: 8}}>
                    <RadioButton
                      label="Sửa đè (Hardsub) lên Video Gốc"
                      checked={settings.renderMode === 'hardsub'}
                      onChange={() => settings.setRenderMode('hardsub')}
                      name="renderMode"
                    />
                    <RadioButton
                      label="Tạo Video Nền Đen rời (Import CapCut)"
                      checked={settings.renderMode === 'black_bg'}
                      onChange={() => settings.setRenderMode('black_bg')}
                      name="renderMode"
                    />
                 </div>
               </div>
            </div>

            {/* Render Styles*/}
            <div className={styles.grid2} style={{marginBottom: 12}}>
               <div className={styles.inputGroup}>
                 <span className={styles.label}>Font Chữ</span>
                 <select
                    className={styles.select}
                    value={settings.style?.fontName || 'ZYVNA Fairy'}
                    onChange={e => settings.setStyle(s => ({...s, fontName: e.target.value}))}
                 >
                    {availableFonts.map(font => (
                      <option key={font} value={font}>{font}</option>
                    ))}
                 </select>
               </div>
               <div className={styles.inputGroup}>
                 <span className={styles.label}>
                   Font Size (px)
                   {settings.renderMode === 'black_bg' && (
                     <span style={{fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginTop: 2}}>
                       Tự tính = 90% chiều cao strip
                     </span>
                   )}
                 </span>
                 <Input
                    type="number"
                    value={settings.style?.fontSize}
                    onChange={e => settings.setStyle(s => ({...s, fontSize: Number(e.target.value)}))}
                    min={20} max={200}
                    disabled={settings.renderMode === 'black_bg'}
                 />
               </div>
            </div>



            <div className={styles.grid2} style={{marginBottom: 12}}>
               <div className={styles.inputGroup} style={{ gridColumn: '1 / span 2' }}>
                 <span className={styles.label}>Tốc độ Video tự thích ứng (Auto-Fit)</span>
                 <div style={{ padding: '12px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                   
                   <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                     <span style={{ fontSize: '13px', width: '120px' }}>Tăng tốc Audio:</span>
                     <Input
                        type="number"
                        value={settings.renderAudioSpeed}
                        onChange={e => settings.setRenderAudioSpeed(Number(e.target.value))}
                        min={0.5} max={5} step={0.1}
                        style={{ width: '80px' }}
                     />
                     <span style={{ fontSize: '12px', fontWeight: 'bold' }}>x</span>
                   </div>

                   {isMultiFolder && (
                     <div style={{ fontSize: '11px', color: 'var(--color-accent, #4a9eff)', marginBottom: '2px' }}>
                       📁 {videoInfo?.name ?? displayPath.split(/[/\\]/).pop()}
                       {isEstimated && <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>(~ước tính từ video)</span>}
                     </div>
                   )}
                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px', fontSize: '12px' }}>
                     <div>
                       <div style={{ color: 'var(--text-secondary)' }}>🎤 Thời lượng Audio mới:</div>
                       <div style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>{formatDuration(audioExpectedDuration)}</div>
                       <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>(Gốc: {formatDuration(baseAudioDuration)})</div>
                     </div>
                     <div>
                       <div style={{ color: 'var(--text-secondary)' }}>🎬 Tốc độ Video cần thiết:</div>
                       <div style={{ fontWeight: 'bold', color: autoVideoSpeed > 1 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                         {autoVideoSpeed.toFixed(2)}x
                       </div>
                       <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                         Mốc video chuẩn (gốc): {formatDuration(videoMarkerSec)}
                       </div>
                       <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                         {isMultiFolder
                           ? `Mốc sync: ${formatDuration(videoSubBaseDuration)}`
                           : `(Để khớp vỏn vẹn ${formatDuration(audioExpectedDuration)})`}
                       </div>
                     </div>
                   </div>

                 </div>
               </div>
            </div>

            <div className={styles.grid2} style={{marginBottom: 12}}>
               <div className={styles.inputGroup}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <span className={styles.label}>Âm lượng Video gốc (%)</span>
                   <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{settings.videoVolume}%</span>
                 </div>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                   <input
                      type="range"
                      value={settings.videoVolume}
                      onChange={e => settings.setVideoVolume(Number(e.target.value))}
                      min={0} max={200} step={10}
                      style={{ flex: 1, cursor: 'pointer' }}
                   />
                 </div>
                 <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                   Gắn liền với hình ảnh
                 </div>
               </div>
               <div className={styles.inputGroup}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <span className={styles.label}>Âm lượng Audio TTS (%)</span>
                   <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{settings.audioVolume}%</span>
                 </div>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                   <input
                      type="range"
                      value={settings.audioVolume}
                      onChange={e => settings.setAudioVolume(Number(e.target.value))}
                      min={0} max={200} step={10}
                      style={{ flex: 1, cursor: 'pointer' }}
                   />
                 </div>
                 <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                   Âm thanh giọng đọc
                 </div>
               </div>
            </div>

             <div className={styles.grid2} style={{marginBottom: 12}}>

               
               <div className={styles.inputGroup}>
                 <span className={styles.label}>Màu Chữ</span>
                 <label style={{display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 6, position: 'relative'}}>
                   <div style={{
                     width: 36, height: 36,
                     borderRadius: 8,
                     background: settings.style?.fontColor || '#FFFF00',
                     border: '2px solid rgba(255,255,255,0.2)',
                     boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                     flexShrink: 0,
                   }} />
                   <span style={{fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: 13}}>
                     {(settings.style?.fontColor || '#FFFF00').toUpperCase()}
                   </span>
                   <input
                     type="color"
                     value={settings.style?.fontColor || '#FFFF00'}
                     onChange={e => settings.setStyle(s => ({...s, fontColor: e.target.value}))}
                     style={{position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer', top: 0, left: 0}}
                   />
                 </label>
               </div>
               <div className={styles.inputGroup}>
                 <span className={styles.label}>Hardware Acceleration</span>
                 <div style={{marginTop: 8}}>
                    <select
                      className={styles.select}
                      value={settings.hardwareAcceleration}
                      onChange={(e) => settings.setHardwareAcceleration(e.target.value as any)}
                    >
                      <option value="none">CPU (libx264)</option>
                      <option value="qsv">Intel QuickSync (QSV)</option>
                    </select>
                 </div>
               </div>
            </div>
            {/* Subtitle Preview (hardsub only) */}
            {settings.renderMode === 'hardsub' && settings.inputType === 'draft' && (
              <SubtitlePreview
                videoPath={fileManager.firstVideoPath}
                style={settings.style}
                entries={fileManager.entries}
                blackoutTop={settings.blackoutTop}
                renderResolution={settings.renderResolution}
                logoPath={settings.logoPath}
                logoPosition={settings.logoPosition}
                logoScale={settings.logoScale}
                onPositionChange={setSubtitlePosition}
                onBlackoutChange={settings.setBlackoutTop}
                onRenderResolutionChange={settings.setRenderResolution}
                onLogoPositionChange={(pos) => settings.setLogoPosition(pos || undefined)}
                onLogoScaleChange={(scale) => settings.setLogoScale(scale)}
                onSelectLogo={async () => {
                  const result = await (window.electronAPI as any).invoke('dialog:openFile', {
                    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
                    properties: ['openFile'],
                  });
                  if (!result?.canceled && result?.filePaths?.[0]) {
                    settings.setLogoPath(result.filePaths[0]);
                    settings.setLogoPosition(undefined);
                  }
                }}
                onRemoveLogo={() => {
                  settings.setLogoPath(undefined);
                  settings.setLogoPosition(undefined);
                }}
              />
            )}
          </div>
        )}

        {/* Section 5: Controls */}
        <div className={styles.section} style={{ flex: 1, display: 'flex', flexDirection: 'column', marginTop: '20px' }}>
          <div className={styles.sectionTitle}>7. Điều khiển & Tiến độ</div>
          
          {/* Step Checkboxes */}
          <div className={styles.stepCheckboxes}>
            {([1, 2, 3, 4, 5, 6, 7] as Step[]).map(step => (
              <Checkbox
                key={step}
                label={STEP_LABELS[step - 1]}
                checked={processing.enabledSteps.has(step)}
                onChange={() => processing.toggleStep(step)}
                highlight={processing.currentStep === step}
              />
            ))}
          </div>

          {/* Processing Mode Toggle — chỉ hiển thị khi multi-folder */}
          {isMultiFolder && (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <button
                style={{
                  flex: 1, padding: '5px 8px', fontSize: '12px', fontWeight: 600,
                  borderRadius: '6px', border: '1px solid',
                  cursor: processing.status === 'running' ? 'not-allowed' : 'pointer',
                  opacity: processing.status === 'running' ? 0.5 : 1,
                  background: settings.processingMode !== 'step-first' ? 'var(--color-accent, #4a9eff)' : 'transparent',
                  color: settings.processingMode !== 'step-first' ? '#fff' : 'var(--color-text-muted)',
                  borderColor: settings.processingMode !== 'step-first' ? 'var(--color-accent, #4a9eff)' : 'var(--color-border)',
                }}
                disabled={processing.status === 'running'}
                onClick={() => settings.setProcessingMode('folder-first')}
                title="Hoàn thành tất cả bước của folder 1 rồi mới sang folder 2"
              >
                📁 Folder-first
              </button>
              <button
                style={{
                  flex: 1, padding: '5px 8px', fontSize: '12px', fontWeight: 600,
                  borderRadius: '6px', border: '1px solid',
                  cursor: processing.status === 'running' ? 'not-allowed' : 'pointer',
                  opacity: processing.status === 'running' ? 0.5 : 1,
                  background: settings.processingMode === 'step-first' ? 'var(--color-accent, #4a9eff)' : 'transparent',
                  color: settings.processingMode === 'step-first' ? '#fff' : 'var(--color-text-muted)',
                  borderColor: settings.processingMode === 'step-first' ? 'var(--color-accent, #4a9eff)' : 'var(--color-border)',
                }}
                disabled={processing.status === 'running'}
                onClick={() => settings.setProcessingMode('step-first')}
                title="Bước 1 tất cả folder → Bước 2 tất cả folder → ..."
              >
                ⚡ Step-first
              </button>
            </div>
          )}

          {/* Buttons */}
          <div className={styles.buttonsRow}>
            <Button
              onClick={processing.handleStart}
              disabled={processing.status === 'running'}
              variant="success"
              fullWidth
            >
              ▶ START
            </Button>
            <Button
              onClick={processing.handleStop}
              disabled={processing.status !== 'running'}
              variant="danger"
              fullWidth
            >
              ⏹ STOP
            </Button>
          </div>

          {/* Progress */}
          <div className={styles.progressSection} style={{ marginTop: 'auto', paddingTop: '16px' }}>
            {processing.currentFolder && processing.currentFolder.total > 1 && (
              <div className={styles.progressHeader} style={{ marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-accent, #4a9eff)' }}>
                  📁 Project {processing.currentFolder.index}/{processing.currentFolder.total}: {processing.currentFolder.name}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  {processing.currentFolder.index}/{processing.currentFolder.total}
                </span>
              </div>
            )}
            {processing.enabledSteps.has(7) && originalVideoDuration > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <span>🎬 {videoInfo?.name ?? 'Video'}</span>
                <span>⏱ {formatDuration(originalVideoDuration)}</span>
                <span>🧭 Sync: {formatDuration(videoSubBaseDuration)}</span>
                <span>🔊 Audio: {formatDuration(audioExpectedDuration)}</span>
                <span>🎯 Marker: {formatDuration(videoMarkerSec)}</span>
                <span style={{ color: autoVideoSpeed < 0.8 || autoVideoSpeed > 1.2 ? 'var(--color-warning, #f59e0b)' : 'inherit' }}>
                  🚀 Speed: {autoVideoSpeed.toFixed(2)}x
                </span>
              </div>
            )}
            <div className={styles.progressHeader}>
              <span className={styles.textMuted}>{processing.progress.message}</span>
              {processing.progress.total > 0 && <span className={styles.textMuted}>{processing.progress.current}/{processing.progress.total}</span>}
            </div>
            {processing.currentFolder && processing.currentFolder.total > 1 && (
              <div className={styles.progressBar} style={{ marginBottom: '4px' }}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${((processing.currentFolder.index - 1) / processing.currentFolder.total) * 100}%`,
                    backgroundColor: 'var(--color-accent, #4a9eff)',
                    opacity: 0.5,
                  }}
                />
              </div>
            )}
            {processing.progress.total > 0 && (
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${(processing.progress.current / processing.progress.total) * 100}%`,
                    backgroundColor: getProgressColor(),
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
