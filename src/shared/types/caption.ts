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
  translateMethod?: 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui'; // Phương thức dịch (default: 'api')
  retryBatchIndexes?: number[];  // Chỉ dịch lại các batch index 1-based (Step 3 resume)
  projectId?: string;
  sourcePath?: string;
  runId?: string;
}

export interface TranslationBatchReport {
  batchIndex: number; // 1-based
  startIndex: number; // 0-based
  endIndex: number; // 0-based
  expectedLines: number;
  translatedLines: number;
  missingLinesInBatch: number[]; // 1-based in batch
  missingGlobalLineIndexes: number[]; // 1-based global
  attempts: number;
  status: 'success' | 'failed';
  error?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  transport?: 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui';
  resourceId?: string;
  resourceLabel?: string;
  queueRuntimeKey?: string;
  queuePacingMode?: 'dispatch_spacing_global';
  queueGapMs?: number;
  nextAllowedAt?: number;
}

export interface TranslationQueuePacingMetadata {
  queuePacingMode?: 'dispatch_spacing_global';
  queueGapMs?: number;
  startedAt?: number;
  endedAt?: number;
  nextAllowedAt?: number;
}

/**
 * Kết quả dịch
 */
export interface TranslationResult extends TranslationQueuePacingMetadata {
  success: boolean;
  entries: SubtitleEntry[];
  totalLines: number;
  translatedLines: number;
  failedLines: number;
  errors?: string[];
  batchReports?: TranslationBatchReport[];
  missingBatchIndexes?: number[];
  missingGlobalLineIndexes?: number[];
}

/**
 * Progress callback cho quá trình dịch
 */
export interface TranslationProgress extends TranslationQueuePacingMetadata {
  current: number;
  total: number;
  batchIndex: number;
  totalBatches: number;
  status: 'translating' | 'completed' | 'error';
  message: string;
  runId?: string;
  eventType?: 'batch_started' | 'batch_retry' | 'batch_completed' | 'batch_failed' | 'summary';
  batchReport?: TranslationBatchReport;
  translatedChunk?: {
    startIndex: number;
    texts: string[];
  };
  folderHint?: string;
  transport?: 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui';
  resourceId?: string;
  resourceLabel?: string;
  queueRuntimeKey?: string;
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
  voice: string;          // "edge:vi-VN-HoaiMyNeural" | "capcut:BV074_streaming"
  provider?: TTSProvider; // Optional hint, fallback parse từ voice
  rate: string;           // "+0%" đến "+50%"
  volume: string;         // "+0%" đến "+50%"
  pitch: string;          // "+0Hz"
  outputFormat: 'wav' | 'mp3';
  outputDir: string;      // Thư mục output
  maxConcurrent: number;  // Số file tạo song song (default: 5)
  edgeTtsBatchSize?: number;  // Batch size for Edge TTS (default: 50), only for Edge provider
  edgeWavMode?: 'auto' | 'direct' | 'convert'; // Edge WAV strategy: direct ws / convert fallback / convert-only
  edgeWorkerItemConcurrency?: number; // Items chạy song song trong mỗi Python job
  edgeWorkerTimeoutMs?: number; // Timeout cho mỗi item trong Python worker
  runId?: string;
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

/**
 * Request test nhanh một giọng TTS tại Step 4.
 */
export interface TTSTestVoiceRequest {
  text: string;
  voice: string;
  rate?: string;
  volume?: string;
  outputFormat?: 'wav' | 'mp3';
}

/**
 * Response audio sample trả về renderer để phát ngay.
 */
export interface TTSTestVoiceResponse {
  audioDataUri: string;
  mime: string;
  durationMs?: number;
  provider: TTSProvider;
  voice: string;
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
 * Input/output mapping for trim silence
 */
export interface TrimSilencePathItem {
  inputPath: string;
  outputPath: string;
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

export interface FitAudioPathMapping {
  originalPath: string;
  outputPath: string;
}

export interface FitAudioResponse {
  scaledCount: number;
  skippedCount: number;
  pathMapping: FitAudioPathMapping[];
}

export interface CheckFilesResult {
  missingPaths: string[];
}

// ============================================
// IPC CHANNELS
// ============================================

export const CAPTION_IPC_CHANNELS = {
  // Caption
  PARSE_SRT: 'caption:parseSrt',
  FIND_SRT_IN_FOLDERS: 'caption:findSrtInFolders',
  TRANSLATE: 'caption:translate',
  TRANSLATE_PROGRESS: 'caption:translateProgress',
  TRANSLATE_PROGRESS_ACK: 'caption:translateProgressAck',
  EXPORT_SRT: 'caption:exportSrt',
  EXPORT_PLAIN_TEXT: 'caption:exportPlainText',
  SPLIT: 'caption:split',
  STOP_ALL: 'caption:stopAll',
  
  // TTS
  TTS_GENERATE: 'tts:generate',
  TTS_PROGRESS: 'tts:progress',
  TTS_GET_VOICES: 'tts:getVoices',
  TTS_TEST_VOICE: 'tts:testVoice',
  TTS_STOP: 'tts:stop',
  TTS_TRIM_SILENCE: 'tts:trimSilence',
  TTS_TRIM_SILENCE_END: 'tts:trimSilenceEnd',
  TTS_TRIM_SILENCE_TO_PATHS: 'tts:trimSilenceToPaths',
  TTS_TRIM_SILENCE_END_TO_PATHS: 'tts:trimSilenceEndToPaths',
  TTS_FIT_AUDIO: 'tts:fitAudio',
  TTS_CHECK_FILES: 'tts:checkFiles',
  
  // Audio Merge
  AUDIO_ANALYZE: 'audio:analyze',
  AUDIO_MERGE: 'audio:merge',
  AUDIO_MERGE_PROGRESS: 'audio:mergeProgress',
} as const;

// ============================================
// VOICES
// ============================================

/**
 * Provider TTS
 */
export type TTSProvider = 'edge' | 'capcut';
export type TTSTier = 'free' | 'pro';

/**
 * Thông tin giọng đọc TTS
 */
export interface VoiceInfo {
  name: string;           // "vi-VN-HoaiMyNeural"
  provider: TTSProvider;  // edge | capcut
  voiceId: string;        // provider-specific id
  displayName: string;    // "Hoài My (Nữ)"
  language: string;       // "vi-VN"
  gender: 'Male' | 'Female';
  tier?: TTSTier;         // free | pro
  value?: string;         // canonical value: "edge:vi-VN-HoaiMyNeural"
}

/**
 * Danh sách giọng Edge Việt Nam có sẵn
 */
export const VIETNAMESE_VOICES: VoiceInfo[] = [
  {
    name: 'vi-VN-HoaiMyNeural',
    provider: 'edge',
    voiceId: 'vi-VN-HoaiMyNeural',
    displayName: 'Hoài My (Nữ)',
    language: 'vi-VN',
    gender: 'Female',
    tier: 'free',
    value: 'edge:vi-VN-HoaiMyNeural',
  },
  {
    name: 'vi-VN-NamMinhNeural',
    provider: 'edge',
    voiceId: 'vi-VN-NamMinhNeural',
    displayName: 'Nam Minh (Nam)',
    language: 'vi-VN',
    gender: 'Male',
    tier: 'free',
    value: 'edge:vi-VN-NamMinhNeural',
  },
];

/**
 * Danh sách giọng CapCut tĩnh (catalog)
 */
export const CAPCUT_VOICES: VoiceInfo[] = [
  {
    name: 'BV074_streaming',
    provider: 'capcut',
    voiceId: 'BV074_streaming',
    displayName: 'Cute Female (Ngôn)',
    language: 'vi-VN',
    gender: 'Female',
    tier: 'free',
    value: 'capcut:BV074_streaming',
  },
  {
    name: 'BV074_streaming_dsp',
    provider: 'capcut',
    voiceId: 'BV074_streaming_dsp',
    displayName: 'Giọng bé (DSP)',
    language: 'vi-VN',
    gender: 'Female',
    tier: 'free',
    value: 'capcut:BV074_streaming_dsp',
  },
  {
    name: 'BV075_streaming',
    provider: 'capcut',
    voiceId: 'BV075_streaming',
    displayName: 'Confident Male (Tín)',
    language: 'vi-VN',
    gender: 'Male',
    tier: 'free',
    value: 'capcut:BV075_streaming',
  },
  {
    name: 'BV560_streaming',
    provider: 'capcut',
    voiceId: 'BV560_streaming',
    displayName: 'Anh Dũng',
    language: 'vi-VN',
    gender: 'Male',
    tier: 'pro',
    value: 'capcut:BV560_streaming',
  },
  {
    name: 'BV562_streaming',
    provider: 'capcut',
    voiceId: 'BV562_streaming',
    displayName: 'Chí Mai',
    language: 'vi-VN',
    gender: 'Female',
    tier: 'pro',
    value: 'capcut:BV562_streaming',
  },
  {
    name: 'vi_female_huong',
    provider: 'capcut',
    voiceId: 'vi_female_huong',
    displayName: 'Giọng nữ phổ thông',
    language: 'vi-VN',
    gender: 'Female',
    tier: 'pro',
    value: 'capcut:vi_female_huong',
  },
  {
    name: 'BV421_vivn_streaming',
    provider: 'capcut',
    voiceId: 'BV421_vivn_streaming',
    displayName: 'Sweet Little Girl',
    language: 'vi-VN',
    gender: 'Female',
    tier: 'pro',
    value: 'capcut:BV421_vivn_streaming',
  },
];

export const TTS_VOICE_CATALOG: VoiceInfo[] = [...VIETNAMESE_VOICES, ...CAPCUT_VOICES];

/**
 * Giọng mặc định
 */
export const DEFAULT_VOICE = 'edge:vi-VN-HoaiMyNeural';
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
  allowEmptySubtitles?: boolean; // Cho phép render khi SRT không có entry (preview)
  targetDuration?: number; // Độ dài cố định (tuỳ chọn) cho nền đen
  hardwareAcceleration?: 'none' | 'qsv' | 'nvenc';
  style?: ASSStyleConfig;
  renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  position?: { x: number; y: number }; // Vị trí subtitle (ASS \pos), nếu set sẽ override alignment
  blackoutTop?: number;   // Tỉ lệ 0-1 từ trên xuống; landscape = tô đen đáy, portrait = mốc bắt đầu blur đáy foreground
  coverMode?: CaptionCoverMode; // Chế độ che video (legacy mặc định: blackout_bottom)
  coverQuad?: CoverQuad; // Tứ giác normalized (0..1) cho mode copy_from_above
  coverFeatherPx?: number; // Feather viền vùng copy_from_above (px), không dùng blur
  coverFeatherHorizontalPx?: number; // Feather trái/phải cho copy_from_above (px)
  coverFeatherVerticalPx?: number; // Feather trên/dưới cho copy_from_above (px)
  coverFeatherHorizontalPercent?: number; // Feather trái/phải theo % bề ngang vùng copy
  coverFeatherVerticalPercent?: number; // Feather trên/dưới theo % bề dọc vùng copy
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
  logoPosition?: { x: number; y: number }; // Vị trí tâm logo (ưu tiên normalized 0..1; vẫn tương thích dữ liệu pixel legacy)
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
  thumbnailTextConstrainTo34?: boolean; // Giới hạn text trong khung 4:3 (áp dụng cho thumbnail 16:9)
  hardsubTextPrimary?: string; // Text1 cho main video mode hardsub 16:9
  hardsubTextSecondary?: string; // Text2 cho main video mode hardsub 16:9
  hardsubTextPrimaryFontName?: string; // Font Text1 cho main video mode hardsub 16:9
  hardsubTextPrimaryFontSize?: number; // Size Text1 cho main video mode hardsub 16:9
  hardsubTextPrimaryColor?: string; // Màu Text1 cho main video mode hardsub 16:9
  hardsubTextSecondaryFontName?: string; // Font Text2 cho main video mode hardsub 16:9
  hardsubTextSecondaryFontSize?: number; // Size Text2 cho main video mode hardsub 16:9
  hardsubTextSecondaryColor?: string; // Màu Text2 cho main video mode hardsub 16:9
  hardsubTextPrimaryPosition?: { x: number; y: number }; // Vị trí Text1 cho main video mode hardsub 16:9
  hardsubTextSecondaryPosition?: { x: number; y: number }; // Vị trí Text2 cho main video mode hardsub 16:9
  hardsubPortraitTextPrimary?: string; // Text1 cho main video mode hardsub 9:16
  hardsubPortraitTextSecondary?: string; // Text2 cho main video mode hardsub 9:16
  hardsubPortraitTextPrimaryFontName?: string; // Font Text1 cho main video mode hardsub 9:16
  hardsubPortraitTextPrimaryFontSize?: number; // Size Text1 cho main video mode hardsub 9:16
  hardsubPortraitTextPrimaryColor?: string; // Màu Text1 cho main video mode hardsub 9:16
  hardsubPortraitTextSecondaryFontName?: string; // Font Text2 cho main video mode hardsub 9:16
  hardsubPortraitTextSecondaryFontSize?: number; // Size Text2 cho main video mode hardsub 9:16
  hardsubPortraitTextSecondaryColor?: string; // Màu Text2 cho main video mode hardsub 9:16
  hardsubPortraitTextPrimaryPosition?: { x: number; y: number }; // Vị trí Text1 cho main video mode hardsub 9:16
  hardsubPortraitTextSecondaryPosition?: { x: number; y: number }; // Vị trí Text2 cho main video mode hardsub 9:16
  // Legacy 9:16 naming (giữ để tương thích dữ liệu cũ)
  portraitTextPrimaryFontName?: string; // Font Text1 riêng cho overlay 9:16
  portraitTextPrimaryFontSize?: number; // Cỡ Text1 riêng cho overlay 9:16
  portraitTextPrimaryColor?: string; // Màu Text1 riêng cho overlay 9:16
  portraitTextSecondaryFontName?: string; // Font Text2 riêng cho overlay 9:16
  portraitTextSecondaryFontSize?: number; // Cỡ Text2 riêng cho overlay 9:16
  portraitTextSecondaryColor?: string; // Màu Text2 riêng cho overlay 9:16
  portraitTextPrimaryPosition?: { x: number; y: number }; // Vị trí Text1 riêng cho overlay 9:16
  portraitTextSecondaryPosition?: { x: number; y: number }; // Vị trí Text2 riêng cho overlay 9:16
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

export interface RenderAudioPreviewOptions {
  videoPath: string;
  audioPath: string;
  srtPath: string;
  outputPath: string;
  previewDurationSec?: number;
  previewWindowMode?: 'marker_centered';
  srtTimeScale?: number;
  step4SrtScale?: number;
  step7AudioSpeedInput?: number;
  timingContextPath?: string;
  audioSpeedModel?: 'step4_minus_step7_delta';
  videoVolume?: number;
  audioVolume?: number;
  ttsRate?: string;
  step7SubtitleSource?: 'session_translated_entries';
  step7AudioSource?: 'session_merged_audio';
}

export interface RenderAudioPreviewProgress {
  percent: number;
  status: 'mixing' | 'completed' | 'stopped' | 'error';
  message: string;
}

export interface RenderAudioPreviewResult {
  success: boolean;
  outputPath?: string;
  previewDurationSec?: number;
  startSec?: number;
  endSec?: number;
  markerSec?: number;
  audioDataUri?: string;
  error?: string;
}

export interface RenderVideoPreviewFrameOptions {
  videoPath: string;
  entries: SubtitleEntry[];
  previewTimeSec: number;
  requestToken?: string;
  previewCacheKey?: string;
  timeBucketSec?: number;
  hardwareAcceleration?: 'none' | 'qsv' | 'nvenc';
  style?: ASSStyleConfig;
  renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  position?: { x: number; y: number };
  blackoutTop?: number;
  coverMode?: 'blackout_bottom' | 'copy_from_above';
  coverQuad?: CoverQuad;
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale?: number;
  portraitForegroundCropPercent?: number;
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
  thumbnailTextConstrainTo34?: boolean;
  hardsubTextPrimary?: string;
  hardsubTextSecondary?: string;
  hardsubTextPrimaryFontName?: string;
  hardsubTextPrimaryFontSize?: number;
  hardsubTextPrimaryColor?: string;
  hardsubTextSecondaryFontName?: string;
  hardsubTextSecondaryFontSize?: number;
  hardsubTextSecondaryColor?: string;
  hardsubTextPrimaryPosition?: { x: number; y: number };
  hardsubTextSecondaryPosition?: { x: number; y: number };
  hardsubPortraitTextPrimary?: string;
  hardsubPortraitTextSecondary?: string;
  hardsubPortraitTextPrimaryFontName?: string;
  hardsubPortraitTextPrimaryFontSize?: number;
  hardsubPortraitTextPrimaryColor?: string;
  hardsubPortraitTextSecondaryFontName?: string;
  hardsubPortraitTextSecondaryFontSize?: number;
  hardsubPortraitTextSecondaryColor?: string;
  hardsubPortraitTextPrimaryPosition?: { x: number; y: number };
  hardsubPortraitTextSecondaryPosition?: { x: number; y: number };
  portraitTextPrimaryFontName?: string;
  portraitTextPrimaryFontSize?: number;
  portraitTextPrimaryColor?: string;
  portraitTextSecondaryFontName?: string;
  portraitTextSecondaryFontSize?: number;
  portraitTextSecondaryColor?: string;
  portraitTextPrimaryPosition?: { x: number; y: number };
  portraitTextSecondaryPosition?: { x: number; y: number };
}

export interface RenderVideoPreviewFrameResult {
  success: boolean;
  frameData?: string; // Base64 PNG (không kèm data-uri prefix)
  width?: number;
  height?: number;
  previewTimeSec?: number;
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
  thumbnailTextConstrainTo34?: boolean;
}

export interface RenderThumbnailPreviewFrameResult {
  success: boolean;
  frameData?: string; // Base64 PNG (không kèm data-uri prefix)
  width?: number;
  height?: number;
  debug?: Record<string, unknown>;
  error?: string;
}

export interface RenderThumbnailFileOptions extends RenderThumbnailPreviewFrameOptions {
  fileName: string;
}

export interface RenderThumbnailFileResult {
  success: boolean;
  outputPath?: string;
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
  step2BatchPlan?: Array<{
    batchIndex: number;
    startIndex: number;
    endIndex: number;
    lineCount: number;
    partPath?: string;
  }>;
  step2BatchPlanFingerprint?: string;
  step3BatchState?: {
    totalBatches: number;
    completedBatches: number;
    failedBatches: number;
    missingBatchIndexes: number[];
    missingGlobalLineIndexes: number[];
    batches: TranslationBatchReport[];
    updatedAt: string;
    planFingerprint?: string;
  };
  ttsAudioFiles?: AudioFile[];
  trimResults?: Record<string, unknown>;
  fitResults?: Record<string, unknown>;
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
  fontSizeScaleVersion?: number;
  subtitleFontSizeRel?: number;
  inputType?: 'srt' | 'draft';
  geminiModel?: string;
  translateMethod?: 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui';
  voice?: string;
  rate?: string;
  volume?: string;
  edgeTtsBatchSize?: number;
  edgeWavMode?: 'auto' | 'direct' | 'convert';
  edgeWorkerItemConcurrency?: number;
  edgeWorkerTimeoutMs?: number;
  srtSpeed?: number;
  splitByLines?: boolean;
  linesPerFile?: number;
  numberOfParts?: number;
  enabledSteps?: number[];
  audioDir?: string;
  trimAudioEnabled?: boolean;
  autoFitAudio?: boolean;
  hardwareAcceleration?: 'none' | 'qsv' | 'nvenc';
  style?: ASSStyleConfig;
  renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  renderContainer?: 'mp4' | 'mov';
  blackoutTop?: number | null;
  coverMode?: CaptionCoverMode;
  coverQuad?: CoverQuad | null;
  coverFeatherPx?: number;
  coverFeatherHorizontalPx?: number;
  coverFeatherVerticalPx?: number;
  coverFeatherHorizontalPercent?: number;
  coverFeatherVerticalPercent?: number;
  audioSpeed?: number;
  renderAudioSpeed?: number;
  portraitForegroundCropPercent?: number;
  videoVolume?: number; // 0..200, mapping tuyến tính 100=x1
  audioVolume?: number; // 0..400, mapping tuyến tính 100=x1
  thumbnailFontName?: string;
  thumbnailFontSize?: number;
  thumbnailFontSizeRel?: number;
  thumbnailTextPrimaryFontName?: string;
  thumbnailTextPrimaryFontSize?: number;
  thumbnailTextPrimaryFontSizeRel?: number;
  thumbnailTextPrimaryColor?: string;
  thumbnailTextSecondaryFontName?: string;
  thumbnailTextSecondaryFontSize?: number;
  thumbnailTextSecondaryFontSizeRel?: number;
  thumbnailTextSecondaryColor?: string;
  thumbnailLineHeightRatio?: number;
  thumbnailTextSecondary?: string;
  thumbnailTextPrimaryPosition?: { x: number; y: number };
  thumbnailTextSecondaryPosition?: { x: number; y: number };
  hardsubTextPrimary?: string;
  hardsubTextSecondary?: string;
  hardsubTextPrimaryFontName?: string;
  hardsubTextPrimaryFontSize?: number;
  hardsubTextPrimaryFontSizeRel?: number;
  hardsubTextPrimaryColor?: string;
  hardsubTextSecondaryFontName?: string;
  hardsubTextSecondaryFontSize?: number;
  hardsubTextSecondaryFontSizeRel?: number;
  hardsubTextSecondaryColor?: string;
  hardsubTextPrimaryPosition?: { x: number; y: number };
  hardsubTextSecondaryPosition?: { x: number; y: number };
  hardsubPortraitTextPrimary?: string;
  hardsubPortraitTextSecondary?: string;
  hardsubPortraitTextPrimaryFontName?: string;
  hardsubPortraitTextPrimaryFontSize?: number;
  hardsubPortraitTextPrimaryFontSizeRel?: number;
  hardsubPortraitTextPrimaryColor?: string;
  hardsubPortraitTextSecondaryFontName?: string;
  hardsubPortraitTextSecondaryFontSize?: number;
  hardsubPortraitTextSecondaryFontSizeRel?: number;
  hardsubPortraitTextSecondaryColor?: string;
  hardsubPortraitTextPrimaryPosition?: { x: number; y: number };
  hardsubPortraitTextSecondaryPosition?: { x: number; y: number };
  portraitTextPrimaryFontName?: string;
  portraitTextPrimaryFontSize?: number;
  portraitTextPrimaryFontSizeRel?: number;
  portraitTextPrimaryColor?: string;
  portraitTextSecondaryFontName?: string;
  portraitTextSecondaryFontSize?: number;
  portraitTextSecondaryFontSizeRel?: number;
  portraitTextSecondaryColor?: string;
  portraitTextPrimaryPosition?: { x: number; y: number };
  portraitTextSecondaryPosition?: { x: number; y: number };
  thumbnailTextSecondaryByOrder?: string[];
  thumbnailTextSecondaryOverrideFlags?: boolean[];
  thumbnailTextsByOrder?: string[];
  thumbnailTextsSecondaryByOrder?: string[];
  hardsubTextsByOrder?: string[];
  hardsubTextsSecondaryByOrder?: string[];
  thumbnailDurationSec?: number;
  thumbnailText?: string;
  subtitlePosition?: { x: number; y: number } | null;
  thumbnailFrameTimeSec?: number | null;
  layoutProfiles?: {
    landscape?: {
      fontSizeScaleVersion?: number;
      subtitleFontSizeRel?: number;
      style?: ASSStyleConfig;
      renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
      renderContainer?: 'mp4' | 'mov';
      blackoutTop?: number | null;
      coverMode?: CaptionCoverMode;
      coverQuad?: CoverQuad | null;
      coverFeatherPx?: number;
      coverFeatherHorizontalPx?: number;
      coverFeatherVerticalPx?: number;
      coverFeatherHorizontalPercent?: number;
      coverFeatherVerticalPercent?: number;
      subtitlePosition?: { x: number; y: number } | null;
      thumbnailFrameTimeSec?: number | null;
      thumbnailDurationSec?: number;
      logoPath?: string;
      logoPosition?: { x: number; y: number };
      logoScale?: number;
      thumbnailFontName?: string;
      thumbnailFontSize?: number;
      thumbnailFontSizeRel?: number;
      thumbnailTextPrimaryFontName?: string;
      thumbnailTextPrimaryFontSize?: number;
      thumbnailTextPrimaryFontSizeRel?: number;
      thumbnailTextPrimaryColor?: string;
      thumbnailTextSecondaryFontName?: string;
      thumbnailTextSecondaryFontSize?: number;
      thumbnailTextSecondaryFontSizeRel?: number;
      thumbnailTextSecondaryColor?: string;
      thumbnailLineHeightRatio?: number;
      thumbnailTextSecondary?: string;
      thumbnailTextPrimaryPosition?: { x: number; y: number };
      thumbnailTextSecondaryPosition?: { x: number; y: number };
      thumbnailTextConstrainTo34?: boolean;
      hardsubTextPrimary?: string;
      hardsubTextSecondary?: string;
      hardsubTextPrimaryFontName?: string;
      hardsubTextPrimaryFontSize?: number;
      hardsubTextPrimaryFontSizeRel?: number;
      hardsubTextPrimaryColor?: string;
      hardsubTextSecondaryFontName?: string;
      hardsubTextSecondaryFontSize?: number;
      hardsubTextSecondaryFontSizeRel?: number;
      hardsubTextSecondaryColor?: string;
      hardsubTextPrimaryPosition?: { x: number; y: number };
      hardsubTextSecondaryPosition?: { x: number; y: number };
      hardsubPortraitTextPrimary?: string;
      hardsubPortraitTextSecondary?: string;
      hardsubPortraitTextPrimaryFontName?: string;
      hardsubPortraitTextPrimaryFontSize?: number;
      hardsubPortraitTextPrimaryFontSizeRel?: number;
      hardsubPortraitTextPrimaryColor?: string;
      hardsubPortraitTextSecondaryFontName?: string;
      hardsubPortraitTextSecondaryFontSize?: number;
      hardsubPortraitTextSecondaryFontSizeRel?: number;
      hardsubPortraitTextSecondaryColor?: string;
      hardsubPortraitTextPrimaryPosition?: { x: number; y: number };
      hardsubPortraitTextSecondaryPosition?: { x: number; y: number };
      portraitTextPrimaryFontName?: string;
      portraitTextPrimaryFontSize?: number;
      portraitTextPrimaryFontSizeRel?: number;
      portraitTextPrimaryColor?: string;
      portraitTextSecondaryFontName?: string;
      portraitTextSecondaryFontSize?: number;
      portraitTextSecondaryFontSizeRel?: number;
      portraitTextSecondaryColor?: string;
      portraitTextPrimaryPosition?: { x: number; y: number };
      portraitTextSecondaryPosition?: { x: number; y: number };
      foregroundCropPercent?: number;
    };
    portrait?: {
      fontSizeScaleVersion?: number;
      subtitleFontSizeRel?: number;
      style?: ASSStyleConfig;
      renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
      renderContainer?: 'mp4' | 'mov';
      blackoutTop?: number | null;
      coverMode?: CaptionCoverMode;
      coverQuad?: CoverQuad | null;
      coverFeatherPx?: number;
      coverFeatherHorizontalPx?: number;
      coverFeatherVerticalPx?: number;
      coverFeatherHorizontalPercent?: number;
      coverFeatherVerticalPercent?: number;
      subtitlePosition?: { x: number; y: number } | null;
      thumbnailFrameTimeSec?: number | null;
      thumbnailDurationSec?: number;
      logoPath?: string;
      logoPosition?: { x: number; y: number };
      logoScale?: number;
      thumbnailFontName?: string;
      thumbnailFontSize?: number;
      thumbnailFontSizeRel?: number;
      thumbnailTextPrimaryFontName?: string;
      thumbnailTextPrimaryFontSize?: number;
      thumbnailTextPrimaryFontSizeRel?: number;
      thumbnailTextPrimaryColor?: string;
      thumbnailTextSecondaryFontName?: string;
      thumbnailTextSecondaryFontSize?: number;
      thumbnailTextSecondaryFontSizeRel?: number;
      thumbnailTextSecondaryColor?: string;
      thumbnailLineHeightRatio?: number;
      thumbnailTextSecondary?: string;
      thumbnailTextPrimaryPosition?: { x: number; y: number };
      thumbnailTextSecondaryPosition?: { x: number; y: number };
      hardsubTextPrimary?: string;
      hardsubTextSecondary?: string;
      hardsubTextPrimaryFontName?: string;
      hardsubTextPrimaryFontSize?: number;
      hardsubTextPrimaryFontSizeRel?: number;
      hardsubTextPrimaryColor?: string;
      hardsubTextSecondaryFontName?: string;
      hardsubTextSecondaryFontSize?: number;
      hardsubTextSecondaryFontSizeRel?: number;
      hardsubTextSecondaryColor?: string;
      hardsubTextPrimaryPosition?: { x: number; y: number };
      hardsubTextSecondaryPosition?: { x: number; y: number };
      hardsubPortraitTextPrimary?: string;
      hardsubPortraitTextSecondary?: string;
      hardsubPortraitTextPrimaryFontName?: string;
      hardsubPortraitTextPrimaryFontSize?: number;
      hardsubPortraitTextPrimaryFontSizeRel?: number;
      hardsubPortraitTextPrimaryColor?: string;
      hardsubPortraitTextSecondaryFontName?: string;
      hardsubPortraitTextSecondaryFontSize?: number;
      hardsubPortraitTextSecondaryFontSizeRel?: number;
      hardsubPortraitTextSecondaryColor?: string;
      hardsubPortraitTextPrimaryPosition?: { x: number; y: number };
      hardsubPortraitTextSecondaryPosition?: { x: number; y: number };
      portraitTextPrimaryFontName?: string;
      portraitTextPrimaryFontSize?: number;
      portraitTextPrimaryFontSizeRel?: number;
      portraitTextPrimaryColor?: string;
      portraitTextSecondaryFontName?: string;
      portraitTextSecondaryFontSize?: number;
      portraitTextSecondaryFontSizeRel?: number;
      portraitTextSecondaryColor?: string;
      portraitTextPrimaryPosition?: { x: number; y: number };
      portraitTextSecondaryPosition?: { x: number; y: number };
      foregroundCropPercent?: number;
    };
  };
  logoPath?: string;
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
  RENDER_VIDEO_PREVIEW_FRAME: 'captionVideo:renderVideoPreviewFrame',
  STOP_VIDEO_PREVIEW_FRAME: 'captionVideo:stopVideoPreviewFrame',
  MIX_AUDIO_PREVIEW: 'captionVideo:mixAudioPreview',
  STOP_AUDIO_PREVIEW: 'captionVideo:stopAudioPreview',
  AUDIO_PREVIEW_PROGRESS: 'captionVideo:audioPreviewProgress',
  GET_VIDEO_METADATA: 'captionVideo:getVideoMetadata',
  EXTRACT_FRAME: 'captionVideo:extractFrame',
  RENDER_THUMBNAIL_PREVIEW_FRAME: 'captionVideo:renderThumbnailPreviewFrame',
  RENDER_THUMBNAIL_FILE: 'captionVideo:renderThumbnailFile',
  FIND_BEST_VIDEO: 'captionVideo:findBestVideo',
  GET_AVAILABLE_FONTS: 'captionVideo:getAvailableFonts',
} as const;

export const CAPTION_PROCESS_STOP_SIGNAL = '__CAPTION_PROCESS_STOPPED__';

export const CAPTION_SESSION_IPC_CHANNELS = {
  READ: 'captionSession:read',
  WRITE_ATOMIC: 'captionSession:writeAtomic',
  PATCH: 'captionSession:patch',
} as const;

export const CAPTION_DEFAULTS_IPC_CHANNELS = {
  GET: 'captionDefaults:get',
  SAVE: 'captionDefaults:save',
} as const;



