import { useState, useCallback, useRef, useEffect } from 'react';
import { Chapter, STORY_IPC_CHANNELS } from '@shared/types';
import type { StoryAudioProgressEvent } from '@shared/types';
import { exportChapterAudio, selectOutputDirectory } from '../services/storyTtsExporter';

export type AudioContentSource = 'translation' | 'summary';

interface UseStoryTtsExportParams {
  chapters: Chapter[];
  translatedChapters: Map<string, string>;
  summaries: Map<string, string>;
  isChapterIncluded: (id: string) => boolean;
  filePath: string;
}

interface AudioChapterResult {
  chapterId: string;
  chapterTitle: string;
  filePath?: string;
  error?: string;
  success: boolean;
}

const VIETNAMESE_MAP: Record<string, string> = {
  'à': 'a', 'á': 'a', 'ạ': 'a', 'ả': 'a', 'ã': 'a',
  'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ậ': 'a', 'ẩ': 'a', 'ẫ': 'a',
  'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ặ': 'a', 'ẳ': 'a', 'ẵ': 'a',
  'è': 'e', 'é': 'e', 'ẹ': 'e', 'ẻ': 'e', 'ẽ': 'e',
  'ê': 'e', 'ề': 'e', 'ế': 'e', 'ệ': 'e', 'ể': 'e', 'ễ': 'e',
  'ì': 'i', 'í': 'i', 'ị': 'i', 'ỉ': 'i', 'ĩ': 'i',
  'ò': 'o', 'ó': 'o', 'ọ': 'o', 'ỏ': 'o', 'õ': 'o',
  'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ộ': 'o', 'ổ': 'o', 'ỗ': 'o',
  'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ợ': 'o', 'ở': 'o', 'ỡ': 'o',
  'ù': 'u', 'ú': 'u', 'ụ': 'u', 'ủ': 'u', 'ũ': 'u',
  'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ự': 'u', 'ử': 'u', 'ữ': 'u',
  'ỳ': 'y', 'ý': 'y', 'ỵ': 'y', 'ỷ': 'y', 'ỹ': 'y',
  'đ': 'd',
};

function removeVietnamese(text: string): string {
  let result = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const mapped = VIETNAMESE_MAP[lower];
    if (mapped) {
      result += ch === lower ? mapped : mapped.toUpperCase();
    } else {
      result += ch;
    }
  }
  return result;
}

function sanitizeFilename(name: string, chapterIndex: number): string {
  const base = removeVietnamese(name)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  const padded = String(chapterIndex).padStart(3, '0');
  return base ? `${padded}_${base}` : `${padded}_chapter`;
}

const DEFAULT_VOICE = 'edge:vi-VN-HoaiMyNeural';
const DEFAULT_RATE = '+0%';
const DEFAULT_VOLUME = '+0%';

export function useStoryTtsExport(params: UseStoryTtsExportParams) {
  const { chapters, translatedChapters, summaries, isChapterIncluded, filePath } = params;
  const [audioExportProgress, setAudioExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [audioExportResults, setAudioExportResults] = useState<AudioChapterResult[] | null>(null);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [audioDetail, setAudioDetail] = useState<StoryAudioProgressEvent | null>(null);
  const shouldStopRef = useRef(false);

  useEffect(() => {
    const unsub = window.electronAPI.onMessage(
      STORY_IPC_CHANNELS.AUDIO_PROGRESS,
      (event: unknown) => {
        setAudioDetail(event as StoryAudioProgressEvent);
      }
    );
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  const handleGenerateAudioBatch = useCallback(async (source: AudioContentSource) => {
    const eligible = chapters.filter((c) => {
      if (!isChapterIncluded(c.id)) return false;
      const content = source === 'translation' ? translatedChapters.get(c.id) : summaries.get(c.id);
      return !!content?.trim();
    });

    if (eligible.length === 0) {
      const label = source === 'translation' ? 'bản dịch' : 'tóm tắt';
      alert(`Không có chương nào được chọn và có ${label} để tạo audio.`);
      return;
    }

    const pickedDir = await selectOutputDirectory();
    const outputDir = pickedDir || undefined;
    const sourceFile = !pickedDir ? filePath : undefined;
    const sourceType = source;

    shouldStopRef.current = false;
    setAudioExportProgress({ current: 0, total: eligible.length });
    setAudioExportResults(null);
    setAudioDetail(null);

    const results: AudioChapterResult[] = [];
    const sourceLabel = source === 'translation' ? 'bản dịch' : 'tóm tắt';
    console.log(`[StoryTTS Batch] Bắt đầu: ${eligible.length} chapters, source=${source}`);

    for (let i = 0; i < eligible.length; i++) {
      if (shouldStopRef.current) break;

      const chapter = eligible[i];
      const content = source === 'translation'
        ? translatedChapters.get(chapter.id)!
        : summaries.get(chapter.id)!;

      setAudioExportProgress({ current: i + 1, total: eligible.length });

      const chapterNumber = chapters.findIndex((c) => c.id === chapter.id) + 1;
      const safeName = sanitizeFilename(chapter.title || chapter.id, chapterNumber);
      setAudioDetail(null);
      console.log(`[StoryTTS Batch] Chapter ${i + 1}/${eligible.length}: "${chapter.title}" bắt đầu...`);
      const t0 = Date.now();
      const result = await exportChapterAudio({
        chapterText: content,
        voice,
        outputDir,
        filename: safeName,
        sourceFile,
        sourceType,
        rate,
        volume,
        chapterTitle: chapter.title,
      });
      const elapsed = Date.now() - t0;

      if (result.success && result.filePath) {
        console.log(`[StoryTTS Batch] Chapter "${chapter.title}" OK (${elapsed}ms)`);
        results.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          filePath: result.filePath,
          success: true,
        });
      } else {
        console.log(`[StoryTTS Batch] Chapter "${chapter.title}" FAIL (${elapsed}ms): ${result.error}`);
        results.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          error: result.error || 'Audio generation failed',
          success: false,
        });
      }
    }

    setAudioDetail(null);

    setAudioExportResults(results);
    setAudioExportProgress(null);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`[StoryTTS Batch] Hoàn thành: ${succeeded}/${results.length} OK, ${failed} failed`);

    if (failed === 0) {
      alert(`✅ Đã tạo audio ${sourceLabel} thành công!\n${succeeded}/${results.length} file\nThư mục: ${outputDir}`);
    } else {
      alert(`${succeeded}/${results.length} file audio ${sourceLabel} thành công.\n${failed} file thất bại.\nThư mục: ${outputDir}`);
    }
  }, [chapters, translatedChapters, summaries, isChapterIncluded, filePath, voice, rate, volume]);

  const handleStopAudioBatch = useCallback(() => {
    shouldStopRef.current = true;
    window.electronAPI.tts?.stop?.();
  }, []);

  const handleResetAudioResults = useCallback(() => {
    setAudioExportProgress(null);
    setAudioExportResults(null);
    setAudioDetail(null);
  }, []);

  const isAudioGenerating = audioExportProgress !== null;
  const isCapCutVoice = voice.toLowerCase().startsWith('capcut:');

  return {
    audioExportProgress,
    audioExportResults,
    audioDetail,
    isAudioGenerating,
    voice,
    rate,
    volume,
    isCapCutVoice,
    setVoice,
    setRate,
    setVolume,
    handleGenerateAudioBatch,
    handleStopAudioBatch,
    handleResetAudioResults,
  };
}
