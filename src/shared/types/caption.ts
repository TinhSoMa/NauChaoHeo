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

// ============================================
// IPC CHANNELS
// ============================================

export const CAPTION_IPC_CHANNELS = {
  // Caption
  PARSE_SRT: 'caption:parseSrt',
  TRANSLATE: 'caption:translate',
  TRANSLATE_PROGRESS: 'caption:translateProgress',
  EXPORT_SRT: 'caption:exportSrt',
  
  // TTS
  TTS_GENERATE: 'tts:generate',
  TTS_PROGRESS: 'tts:progress',
  TTS_GET_VOICES: 'tts:getVoices',
  
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
