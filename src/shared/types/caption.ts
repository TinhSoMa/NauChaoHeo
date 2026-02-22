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
 * Cấu hình style cho file ASS
 */
export interface ASSStyleConfig {
  fontName: string;       // "ZYVNA Fairy", "Be Vietnam Pro"
  fontSize: number;       // 48
  fontColor: string;      // "#FFFFFF" (HEX format)
  shadow: number;         // 0-3 (0 = no shadow)
  marginV: number;        // Khoảng cách từ đáy video
  alignment: number;      // 2 = bottom-center, 5 = middle-center
}

/**
 * Thông tin metadata của video
 */
export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;       // Seconds
  frameCount: number;
  fps: number;
}

/**
 * Options để convert SRT sang ASS
 */
export interface ConvertToAssOptions {
  srtPath: string;
  assPath: string;
  videoResolution?: { width: number; height: number };
  style: ASSStyleConfig;
  position?: { x: number; y: number };  // Tọa độ \pos(x,y) cho ASS
}

/**
 * Options để render video từ ASS
 */
export interface RenderVideoOptions {
  assPath: string;
  outputPath: string;
  width: number;          // Default: 1920
  height?: number;        // Optional - nếu không có sẽ tự tính từ style
  useGpu: boolean;        // Sử dụng hardware encoding (QSV/NVENC)
  style?: ASSStyleConfig; // Dùng để tính chiều cao tự động
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
  CONVERT_TO_ASS: 'captionVideo:convertToAss',
  RENDER_VIDEO: 'captionVideo:renderVideo',
  RENDER_PROGRESS: 'captionVideo:renderProgress',
  GET_VIDEO_METADATA: 'captionVideo:getVideoMetadata',
  EXTRACT_FRAME: 'captionVideo:extractFrame',
} as const;
