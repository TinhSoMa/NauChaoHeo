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
  hardwareAcceleration?: 'none' | 'qsv';
  style?: ASSStyleConfig;
  renderMode?: 'hardsub' | 'black_bg';
  renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
  position?: { x: number; y: number }; // Vị trí subtitle (ASS \pos), nếu set sẽ override alignment
  blackoutTop?: number;   // Vùng tô đen: tỉ lệ 0-1 từ trên xuống, VD 0.85 = che 15% dưới video
  audioSpeed?: number;    // Tốc độ phát audio (sẽ tự động tính videoSpeed để khớp)
  step7AudioSpeedInput?: number; // Tốc độ audio người dùng nhập ở Step 7 (giữ riêng để trace khi audioPath đã pre-adjust)
  srtTimeScale?: number;  // Scale timeline SRT đã dùng khi merge audio (vd: settings.srtSpeed)
  step4SrtScale?: number; // Scale timeline thực tế từ bước 4/6 (vd: 1.3x), dùng để trace timing
  timingContextPath?: string; // Đường dẫn JSON context để fallback speed/scale khi thiếu runtime data
  audioSpeedModel?: 'step4_minus_step7_delta'; // Công thức tốc độ audio thực
  ttsRate?: string;       // Tốc độ đọc TTS dùng lúc tạo audio (vd: "+20%"), để debug/sync trace
  audioPath?: string;     // Đường dẫn file audio (TTS) để mix vào video
  videoVolume?: number;   // Âm lượng video gốc (%)
  audioVolume?: number;   // Âm lượng file audio TTS (%)
  logoPath?: string;      // Đường dẫn file logo để watermark
  logoPosition?: { x: number; y: number }; // Toạ độ (tâm) chèn logo
  logoScale?: number;     // Tỉ lệ kích thước logo (1.0 = 100%, 0.5 = 50%, 2.0 = 200%)
}

/**
 * Progress callback khi render video
 */
export interface RenderProgress {
  currentFrame: number;
  totalFrames: number;
  fps: number;
  percent: number;
  status: 'rendering' | 'completed' | 'error';
  message: string;
}

/**
 * Kết quả render video
 */
export interface RenderResult {
  success: boolean;
  outputPath?: string;
  duration?: number;
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

// Thêm vào CAPTION_IPC_CHANNELS
export const CAPTION_VIDEO_IPC_CHANNELS = {
  RENDER_VIDEO: 'captionVideo:renderVideo',
  RENDER_PROGRESS: 'captionVideo:renderProgress',
  GET_VIDEO_METADATA: 'captionVideo:getVideoMetadata',
  EXTRACT_FRAME: 'captionVideo:extractFrame',
  FIND_BEST_VIDEO: 'captionVideo:findBestVideo',
  GET_AVAILABLE_FONTS: 'captionVideo:getAvailableFonts',
} as const;
