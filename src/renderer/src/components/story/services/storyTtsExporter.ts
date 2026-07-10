import { STORY_IPC_CHANNELS, type StoryGenerateAudioResult } from '@shared/types';

export interface StoryTtsExportOptions {
  chapterText: string;
  voice: string;
  outputDir?: string;
  filename?: string;
  sourceFile?: string;
  sourceType?: 'translation' | 'summary';
  rate?: string;
  volume?: string;
  outputFormat?: 'mp3' | 'wav';
}

export async function exportChapterAudio(
  options: StoryTtsExportOptions
): Promise<StoryGenerateAudioResult> {
  try {
    const result = await window.electronAPI.invoke(
      STORY_IPC_CHANNELS.GENERATE_CHAPTER_AUDIO,
      {
        chapterText: options.chapterText,
        voice: options.voice,
        outputDir: options.outputDir,
        filename: options.filename,
        sourceFile: options.sourceFile,
        sourceType: options.sourceType,
        rate: options.rate,
        volume: options.volume,
        outputFormat: options.outputFormat,
      }
    ) as StoryGenerateAudioResult;

    if (result.success && result.filePath) {
      return result;
    }
    throw new Error(result.error || 'Audio generation failed');
  } catch (error) {
    console.error('[StoryTtsExporter] Error generating audio:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function selectOutputDirectory(): Promise<string | null> {
  try {
    const paths = await window.electronAPI.dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Chọn thư mục lưu audio'
    });
    return paths?.[0] || null;
  } catch {
    return null;
  }
}
