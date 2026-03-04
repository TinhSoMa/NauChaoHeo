/**
 * Types cho Caption Translation và TTS
 * Định nghĩa các interface dùng chung giữa main và renderer process
 */

// ============================================
// SUBTITLE ENTRY
// ============================================

/**
 * Một entry trong file SRT
 */
export interface SubtitleEntry {
  index: number;
  startTime: string;      // Format: "00:00:01,000"
  endTime: string;        // Format: "00:00:03,500"
  startMs: number;        // Thời gian bắt đầu (milliseconds)
  endMs: number;          // Thời gian kết thúc (milliseconds)
  durationMs: number;     // Thời lượng (milliseconds)
  text: string;           // Text gốc
  translatedText?: string; // Text đã dịch
}

/**
 * Kết quả parse file SRT
 */
export interface ParseSrtResult {
  success: boolean;
  entries: SubtitleEntry[];
  totalEntries: number;
  filePath: string;
  error?: string;
}

// ============================================
// TRANSLATION
// ============================================

/**
 * Options cho việc dịch caption
 */
export interface TranslationOptions {
  entries: SubtitleEntry[];
  targetLanguage: string;        // "Vietnamese"
  model: string;                 // "gemini-2.5-flash"
  linesPerBatch: number;         // Số dòng mỗi batch (default: 50)
  promptTemplate?: string;       // Custom prompt template
  translateMethod?: 'api' | 'impit'; // Phương thức dịch (default: 'api')
}

/**
 * Kết quả dịch
 */
export interface TranslationResult {
  success: boolean;
  entries: SubtitleEntry[];
  totalLines: number;
  translatedLines: number;
  failedLines: number;
  errors?: string[];
}

/**
 * Progress callback cho quá trình dịch
 */
export interface TranslationProgress {
  current: number;
  total: number;
  batchIndex: number;
  totalBatches: number;
  status: 'translating' | 'completed' | 'error';
  message: string;
}

// ============================================
// SPLIT TEXT
// ============================================

/**
 * Options cho việc chia nhỏ text
 */
export interface SplitOptions {
  entries: SubtitleEntry[];
  splitByLines: boolean;   // true = chia theo số dòng, false = chia theo số phần
  value: number;           // Số dòng/file hoặc số phần
  outputDir: string;       // Thư mục output
}

/**
 * Kết quả chia nhỏ text
 */
export interface SplitResult {
  success: boolean;
  partsCount: number;
  files: string[];
  error?: string;
}

// ============================================
// TTS (Text-to-Speech)
// ============================================

/**
 * Options cho TTS
 */
export interface TTSOptions {
  voice: string;          // "vi-VN-HoaiMyNeural"
  rate: string;           // "+0%" đến "+50%"
  volume: string;         // "+0%" đến "+50%"
  pitch: string;          // "+0Hz"
  outputFormat: 'wav' | 'mp3';
  outputDir: string;      // Thư mục output
  maxConcurrent: number;  // Số file tạo song song (default: 5)
}

/**
 * Thông tin một file audio đã tạo
 */
export interface AudioFile {
  index: number;
  path: string;
  startMs: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Kết quả tạo TTS
 */
export interface TTSResult {
  success: boolean;
  audioFiles: AudioFile[];
  totalGenerated: number;
  totalFailed: number;
  outputDir: string;
  errors?: string[];
}

/**
 * Progress callback cho TTS
 */
export interface TTSProgress {
  current: number;
  total: number;
  status: 'generating' | 'completed' | 'error';
  currentFile: string;
  message: string;
}

// ============================================
// AUDIO MERGE
// ============================================

/**
 * Phân tích audio trước khi merge
 */
export interface AudioSegmentInfo {
  index: number;
  audioPath: string;
  srtStartMs: number;
  srtEndMs: number;
  srtDurationMs: number;
  actualDurationMs: number;
  overflowMs: number;
  overflowPercent: number;
}

/**
 * Kết quả phân tích audio
 */
export interface MergeAnalysis {
  totalSegments: number;
  overflowSegments: number;
  maxOverflowRatio: number;
  recommendedTimeScale: number;
  originalDurationMs: number;
  adjustedDurationMs: number;
  segments: AudioSegmentInfo[];
}

/**
 * Options cho merge audio
 */
export interface MergeOptions {
  audioDir: string;
  srtPath: string;
  outputPath: string;
  autoAdjust: boolean;    // Tự động điều chỉnh timeline
  customScale?: number;   // Hệ số scale tùy chỉnh
}

/**
 * Kết quả merge audio
 */
export interface MergeResult {
  success: boolean;
  outputPath: string;
  analysis?: MergeAnalysis;
  error?: string;
}

/**
 * Kết quả trim silence
 */
export interface TrimSilenceResult {
  success: boolean;
  trimmedCount: number;
  failedCount: number;
  errors?: string[];
}

// ============================================
// IPC CHANNELS
// ============================================

export const CAPTION_IPC_CHANNELS = {
  // Caption
  PARSE_SRT: 'caption:parseSrt',
  TRANSLATE: 'caption:translate',
  TRANSLATE_PROGRESS: 'caption:translateProgress',
  EXPORT_SRT: 'caption:exportSrt',
  SPLIT: 'caption:split',
  
  // TTS
  TTS_GENERATE: 'tts:generate',
  TTS_PROGRESS: 'tts:progress',
  TTS_GET_VOICES: 'tts:getVoices',
  TTS_TRIM_SILENCE: 'tts:trimSilence',
  TTS_TRIM_SILENCE_END: 'tts:trimSilenceEnd',
  TTS_FIT_AUDIO: 'tts:fitAudio',
  
  // Audio Merge
  AUDIO_ANALYZE: 'audio:analyze',
  AUDIO_MERGE: 'audio:merge',
  AUDIO_MERGE_PROGRESS: 'audio:mergeProgress',
} as const;

// ============================================
// VOICES
// ============================================

/**
 * Thông tin giọng đọc Edge TTS
 */
export interface VoiceInfo {
  name: string;           // "vi-VN-HoaiMyNeural"
  displayName: string;    // "Hoài My (Nữ)"
  language: string;       // "vi-VN"
  gender: 'Male' | 'Female';
}

/**
 * Danh sách giọng Việt Nam có sẵn
 */
export const VIETNAMESE_VOICES: VoiceInfo[] = [
  { name: 'vi-VN-HoaiMyNeural', displayName: 'Hoài My (Nữ)', language: 'vi-VN', gender: 'Female' },
  { name: 'vi-VN-NamMinhNeural', displayName: 'Nam Minh (Nam)', language: 'vi-VN', gender: 'Male' },
];

/**
 * Giọng mặc định
 */
export const DEFAULT_VOICE = 'vi-VN-HoaiMyNeural';
export const DEFAULT_RATE = '+0%';
export const DEFAULT_VOLUME = '+0%';

// ============================================
// CAPTION VIDEO (Subtitle Strip)
// ============================================

/**
 * Cấu hình style cho ASS
 */
export interface ASSStyleConfig {
  fontName: string;
  fontSize: number;
  fontColor: string; // HEX: #FFFFFF
  shadow: number;
  marginV: number;
  alignment: number; // 2: bottom center, 5: middle center, 8: top center
}

export type CaptionCoverMode = 'blackout_bottom' | 'copy_from_above';

export interface CoverQuadPoint {
  x: number;
  y: number;
}

export interface CoverQuad {
  tl: CoverQuadPoint;
  tr: CoverQuadPoint;
  br: CoverQuadPoint;
  bl: CoverQuadPoint;
}

/**
 * Options để convert SRT sang ASS
 */
export interface ConvertToAssOptions {
  srtPath: string;
  assPath: string;
  videoResolution?: { width: number; height: number };
  style: ASSStyleConfig;
  position?: { x: number; y: number };
}

/**
 * Thông tin metadata của video
 */
export interface VideoMetadata {
  width: number;
  height: number;
  actualHeight?: number; // Real height from source for >500p filtering (overrides hardcoded 100px render strip)
  duration: number;       // Seconds
  frameCount: number;
  fps: number;
  hasAudio?: boolean;     // Có audio stream hay không
}

/**
 * Options để render video từ SRT
 */
export interface RenderVideoOptions {
  srtPath: string;
  outputPath: string;
  width: number;          // Default: 1920
  height?: number;        // Optional - nếu không có sẽ tự tính từ style
  videoPath?: string;     // Đường dẫn video gốc để hardsub (nếu không có sẽ tạo nền đen)
  targetDuration?: number; // Độ dài cố định (tuỳ chọn) cho nền đen
  hardwareAcceleration?: 'none' | 'qsv' | 'nvenc';
  style?: ASSStyleConfig;
  renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  position?: { x: number; y: number }; // Vị trí subtitle (ASS \pos), nếu set sẽ override alignment
  blackoutTop?: number;   // Tỉ lệ 0-1 từ trên xuống; landscape = tô đen đáy, portrait = mốc bắt đầu blur đáy foreground
  coverMode?: CaptionCoverMode; // Chế độ che video (legacy mặc định: blackout_bottom)
  coverQuad?: CoverQuad; // Tứ giác normalized (0..1) cho mode copy_from_above
  audioSpeed?: number;    // Tốc độ phát audio (sẽ tự động tính videoSpeed để khớp)
  step7AudioSpeedInput?: number; // Tốc độ audio người dùng nhập ở Step 7 (giữ riêng để trace khi audioPath đã pre-adjust)
  srtTimeScale?: number;  // Scale timeline SRT đã dùng khi merge audio (vd: settings.srtSpeed)
  step4SrtScale?: number; // Scale timeline thực tế từ bước 4/6 (vd: 1.3x), dùng để trace timing
  timingContextPath?: string; // Đường dẫn JSON context để fallback speed/scale khi thiếu runtime data
  audioSpeedModel?: 'step4_minus_step7_delta'; // Công thức tốc độ audio thực
  ttsRate?: string;       // Tốc độ đọc TTS dùng lúc tạo audio (vd: "+20%"), để debug/sync trace
  audioPath?: string;     // Đường dẫn file audio (TTS) để mix vào video
  videoVolume?: number;   // Âm lượng video gốc (%), hỗ trợ 0..200, mapping tuyến tính 100=x1
  audioVolume?: number;   // Âm lượng file audio TTS (%), hỗ trợ 0..400, mapping tuyến tính 100=x1
  logoPath?: string;      // Đường dẫn file logo để watermark
  logoPosition?: { x: number; y: number }; // Toạ độ (tâm) chèn logo
  logoScale?: number;     // Tỉ lệ kích thước logo (1.0 = 100%, 0.5 = 50%, 2.0 = 200%)
  portraitForegroundCropPercent?: number; // Chỉ dùng cho mode 9:16, crop tổng theo chiều ngang (%)
  // --- Thumbnail prepend ---
  thumbnailEnabled?: boolean; // Có prepend thumbnail vào đầu video không
  thumbnailDurationSec?: number; // Thời lượng prepend thumbnail (giây), fallback 0.5
  thumbnailTimeSec?: number;  // Giây trong video nguồn để freeze frame làm thumbnail
  thumbnailText?: string;     // Văn bản hiển thị ở trung tâm thumbnail (bỏ trống = không có chữ)
  thumbnailTextSecondary?: string; // Văn bản phụ (ví dụ tên phim), bỏ trống = không render
  thumbnailFontName?: string; // Legacy: font chung cho cả text1/text2
  thumbnailFontSize?: number; // Legacy: size chung cho cả text1/text2
  thumbnailTextPrimaryFontName?: string; // Font riêng cho text1
  thumbnailTextPrimaryFontSize?: number; // Cỡ chữ riêng cho text1
  thumbnailTextPrimaryColor?: string; // Màu riêng cho text1 (hex #RRGGBB)
  thumbnailTextSecondaryFontName?: string; // Font riêng cho text2
  thumbnailTextSecondaryFontSize?: number; // Cỡ chữ riêng cho text2
  thumbnailTextSecondaryColor?: string; // Màu riêng cho text2 (hex #RRGGBB)
  thumbnailLineHeightRatio?: number; // Khoảng cách dòng cho text thumbnail (áp dụng cho Enter + wrap)
  thumbnailTextPrimaryPosition?: { x: number; y: number }; // Vị trí normalized (0..1) của text1 trong vùng hợp lệ
  thumbnailTextSecondaryPosition?: { x: number; y: number }; // Vị trí normalized (0..1) của text2 trong vùng hợp lệ
  step7SubtitleSource?: 'session_translated_entries';
  step7AudioSource?: 'session_merged_audio';
}

/**
 * Progress callback khi render video
 */
export interface RenderProgress {
  currentFrame: number;
  totalFrames: number;
  fps: number;
  percent: number;
  status: 'rendering' | 'completed' | 'stopped' | 'error';
  message: string;
}

/**
 * Kết quả render video
 */
export interface RenderResult {
  success: boolean;
  outputPath?: string;
  duration?: number;
  timingPayload?: Record<string, unknown>;
  error?: string;
}

/**
 * Kết quả extract frame từ video
 */
export interface ExtractFrameResult {
  success: boolean;
  frameData?: string;     // Base64 encoded PNG
  width?: number;
  height?: number;
  error?: string;
}

export interface RenderThumbnailPreviewFrameOptions {
  videoPath: string;
  thumbnailTimeSec: number;
  renderMode?: RenderVideoOptions['renderMode'];
  renderResolution?: RenderVideoOptions['renderResolution'];
  thumbnailText?: string;
  thumbnailTextSecondary?: string;
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  thumbnailTextPrimaryFontName?: string;
  thumbnailTextPrimaryFontSize?: number;
  thumbnailTextPrimaryColor?: string;
  thumbnailTextSecondaryFontName?: string;
  thumbnailTextSecondaryFontSize?: number;
  thumbnailTextSecondaryColor?: string;
  thumbnailLineHeightRatio?: number;
  thumbnailTextPrimaryPosition?: { x: number; y: number };
  thumbnailTextSecondaryPosition?: { x: number; y: number };
}

export interface RenderThumbnailPreviewFrameResult {
  success: boolean;
  frameData?: string; // Base64 PNG (không kèm data-uri prefix)
  width?: number;
  height?: number;
  debug?: Record<string, unknown>;
  error?: string;
}

// ============================================
// CAPTION SESSION (Single JSON Per Folder)
// ============================================

export type CaptionStepStatus = 'idle' | 'running' | 'success' | 'error' | 'stale' | 'stopped';
export type CaptionStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface CaptionStepState {
  status: CaptionStepStatus;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  metrics?: Record<string, unknown>;
  settingsSnapshot?: Record<string, unknown>;
  inputFingerprint?: string;
  outputFingerprint?: string;
  dependsOn?: CaptionStepNumber[];
  blockedReason?: string;
}

export interface CaptionSessionSettings {
  step2Split?: Record<string, unknown>;
  step3Translate?: Record<string, unknown>;
  step4Tts?: Record<string, unknown>;
  step5Trim?: Record<string, unknown>;
  step6Merge?: Record<string, unknown>;
  step7Render?: Record<string, unknown>;
}

export interface CaptionSessionData {
  extractedEntries?: SubtitleEntry[];
  translatedEntries?: SubtitleEntry[];
  translatedSrtContent?: string;
  ttsAudioFiles?: AudioFile[];
  trimResults?: Record<string, unknown>;
  mergeResult?: Record<string, unknown>;
  renderResult?: Record<string, unknown>;
  renderTimingPayload?: Record<string, unknown>;
  step7SubtitleSource?: 'session_translated_entries';
  step7AudioSource?: 'session_merged_audio';
  stepArtifacts?: CaptionStepArtifactsMap;
}

export interface CaptionArtifactFile {
  role: string;
  path: string;
  kind: 'file' | 'dir';
  note?: string;
}

export interface CaptionStepArtifactsMap {
  step1?: CaptionArtifactFile[];
  step2?: CaptionArtifactFile[];
  step3?: CaptionArtifactFile[];
  step4?: CaptionArtifactFile[];
  step5?: CaptionArtifactFile[];
  step6?: CaptionArtifactFile[];
  step7?: CaptionArtifactFile[];
}

export interface CaptionSessionArtifacts {
  translatedSrtPath?: string;
  scaledSrtPath?: string;
  audioDir?: string;
  mergedAudioPath?: string;
  finalVideoPath?: string;
  // Deprecated: timing debug đã được lưu trực tiếp vào caption_session.json (data.renderTimingPayload).
  timingJsonPath?: string;
}

export interface CaptionSessionTiming {
  step4SrtScale?: number;
  step7AudioSpeed?: number;
  audioSpeedModel?: 'step4_minus_step7_delta';
  audioEffectiveSpeed?: number;
  subRenderDuration?: number;
  videoSubBaseDuration?: number;
  videoSpeedMultiplier?: number;
  videoMarkerSec?: number;
}

export type CaptionThumbnailPreviewTab = 'edit' | 'real';
export type CaptionThumbnailPreviewLayer = 'primary' | 'secondary';
export type CaptionThumbnailPreviewSourceStatus = 'idle' | 'loading' | 'ready' | 'error';
export type CaptionThumbnailPreviewRealStatus = 'idle' | 'pending' | 'updating' | 'ready' | 'error';

export interface CaptionThumbnailPreviewRuntimeState {
  tab?: CaptionThumbnailPreviewTab;
  activeLayer?: CaptionThumbnailPreviewLayer;
  sourceStatus?: CaptionThumbnailPreviewSourceStatus;
  realStatus?: CaptionThumbnailPreviewRealStatus;
  lastRealError?: string;
  lastSyncHash?: string;
  lastSyncAt?: string;
}

export interface CaptionSessionStopCheckpoint {
  at: string;
  step: number;
  folderPath: string;
  folderIndex: number;
  totalFolders: number;
  processingMode: 'folder-first' | 'step-first';
  reason: 'user_stop' | 'recovered_interrupted_run';
  resumable: boolean;
}

export interface CaptionSessionRuntime {
  runState?: 'idle' | 'running' | 'stopping' | 'stopped' | 'completed' | 'error';
  stopRequestAt?: string;
  lastStopCheckpoint?: CaptionSessionStopCheckpoint;
  enabledSteps?: number[];
  processingMode?: 'folder-first' | 'step-first';
  currentStep?: number | null;
  lastMessage?: string;
  currentDataSource?: string;
  lastGuardError?: string;
  progress?: {
    current: number;
    total: number;
    message: string;
  };
  thumbnailPreview?: CaptionThumbnailPreviewRuntimeState;
}

export type CaptionSettingsSyncState = 'synced' | 'pending' | 'error';

export interface CaptionProjectSettingsValues {
  inputType?: 'srt' | 'draft';
  geminiModel?: string;
  translateMethod?: 'api' | 'impit';
  voice?: string;
  rate?: string;
  volume?: string;
  srtSpeed?: number;
  splitByLines?: boolean;
  linesPerFile?: number;
  numberOfParts?: number;
  enabledSteps?: number[];
  audioDir?: string;
  autoFitAudio?: boolean;
  hardwareAcceleration?: 'none' | 'qsv' | 'nvenc';
  style?: ASSStyleConfig;
  renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  renderContainer?: 'mp4' | 'mov';
  blackoutTop?: number | null;
  coverMode?: CaptionCoverMode;
  coverQuad?: CoverQuad | null;
  audioSpeed?: number;
  renderAudioSpeed?: number;
  portraitForegroundCropPercent?: number;
  videoVolume?: number; // 0..200, mapping tuyến tính 100=x1
  audioVolume?: number; // 0..400, mapping tuyến tính 100=x1
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  thumbnailTextPrimaryFontName?: string;
  thumbnailTextPrimaryFontSize?: number;
  thumbnailTextPrimaryColor?: string;
  thumbnailTextSecondaryFontName?: string;
  thumbnailTextSecondaryFontSize?: number;
  thumbnailTextSecondaryColor?: string;
  thumbnailLineHeightRatio?: number;
  thumbnailTextSecondary?: string;
  thumbnailTextPrimaryPosition?: { x: number; y: number };
  thumbnailTextSecondaryPosition?: { x: number; y: number };
  thumbnailTextSecondaryByOrder?: string[];
  thumbnailTextSecondaryOverrideFlags?: boolean[];
  thumbnailDurationSec?: number;
  subtitlePosition?: { x: number; y: number } | null;
  thumbnailFrameTimeSec?: number | null;
  layoutProfiles?: {
    landscape?: {
      style?: ASSStyleConfig;
      renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
      renderContainer?: 'mp4' | 'mov';
      blackoutTop?: number | null;
      coverMode?: CaptionCoverMode;
      coverQuad?: CoverQuad | null;
      subtitlePosition?: { x: number; y: number } | null;
      thumbnailFrameTimeSec?: number | null;
      thumbnailDurationSec?: number;
      logoPath?: string;
      logoPosition?: { x: number; y: number };
      logoScale?: number;
      thumbnailFontName?: string;
      thumbnailFontSize?: number;
      thumbnailTextPrimaryFontName?: string;
      thumbnailTextPrimaryFontSize?: number;
      thumbnailTextPrimaryColor?: string;
      thumbnailTextSecondaryFontName?: string;
      thumbnailTextSecondaryFontSize?: number;
      thumbnailTextSecondaryColor?: string;
      thumbnailLineHeightRatio?: number;
      thumbnailTextSecondary?: string;
      thumbnailTextPrimaryPosition?: { x: number; y: number };
      thumbnailTextSecondaryPosition?: { x: number; y: number };
      foregroundCropPercent?: number;
    };
    portrait?: {
      style?: ASSStyleConfig;
      renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
      renderContainer?: 'mp4' | 'mov';
      blackoutTop?: number | null;
      coverMode?: CaptionCoverMode;
      coverQuad?: CoverQuad | null;
      subtitlePosition?: { x: number; y: number } | null;
      thumbnailFrameTimeSec?: number | null;
      thumbnailDurationSec?: number;
      logoPath?: string;
      logoPosition?: { x: number; y: number };
      logoScale?: number;
      thumbnailFontName?: string;
      thumbnailFontSize?: number;
      thumbnailTextPrimaryFontName?: string;
      thumbnailTextPrimaryFontSize?: number;
      thumbnailTextPrimaryColor?: string;
      thumbnailTextSecondaryFontName?: string;
      thumbnailTextSecondaryFontSize?: number;
      thumbnailTextSecondaryColor?: string;
      thumbnailLineHeightRatio?: number;
      thumbnailTextSecondary?: string;
      thumbnailTextPrimaryPosition?: { x: number; y: number };
      thumbnailTextSecondaryPosition?: { x: number; y: number };
      foregroundCropPercent?: number;
    };
  };
  processingMode?: 'folder-first' | 'step-first';
}

export interface CaptionProjectSettings {
  schemaVersion: 1;
  settingsRevision: number;
  source: 'ui' | 'system';
  updatedAt: string;
  settings: CaptionProjectSettingsValues;
}

export interface CaptionSessionV1 {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  projectContext: {
    projectId?: string | null;
    inputType?: 'srt' | 'draft';
    sourcePath?: string;
    folderPath?: string;
    videoPathDetected?: string;
  };
  settings: CaptionSessionSettings;
  steps: Record<'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7', CaptionStepState>;
  data: CaptionSessionData;
  artifacts: CaptionSessionArtifacts;
  timing: CaptionSessionTiming;
  effectiveSettingsRevision?: number;
  effectiveSettingsUpdatedAt?: string;
  effectiveSettingsSource?: 'project_default' | 'session_runtime';
  syncState?: CaptionSettingsSyncState;
  runtime: CaptionSessionRuntime;
}

// Thêm vào CAPTION_IPC_CHANNELS
export const CAPTION_VIDEO_IPC_CHANNELS = {
  RENDER_VIDEO: 'captionVideo:renderVideo',
  STOP_RENDER: 'captionVideo:stopRender',
  RENDER_PROGRESS: 'captionVideo:renderProgress',
  GET_VIDEO_METADATA: 'captionVideo:getVideoMetadata',
  EXTRACT_FRAME: 'captionVideo:extractFrame',
  RENDER_THUMBNAIL_PREVIEW_FRAME: 'captionVideo:renderThumbnailPreviewFrame',
  FIND_BEST_VIDEO: 'captionVideo:findBestVideo',
  GET_AVAILABLE_FONTS: 'captionVideo:getAvailableFonts',
} as const;

export const CAPTION_SESSION_IPC_CHANNELS = {
  READ: 'captionSession:read',
  WRITE_ATOMIC: 'captionSession:writeAtomic',
  PATCH: 'captionSession:patch',
} as const;

