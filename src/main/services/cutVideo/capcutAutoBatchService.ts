import * as fs from 'fs';
import * as path from 'path';
import { audioExtractorService } from './audioExtractorService';
import { capcutProjectBatchService } from './capcutProjectBatchService';

type AutoBatchAudioPolicy = 'prefer_existing' | 'force_extract';

type AutoBatchStage = 'preflight' | 'scanning' | 'processing' | 'completed' | 'stopped' | 'error';

interface FolderAnalysis {
  folderPath: string;
  folderName: string;
  projectPath: string;
  videoPath?: string;
  videoName?: string;
  videoSizeBytes?: number;
  existingAudioPath?: string;
  existingAudioName?: string;
  existingAudioSizeBytes?: number;
  draftStatus: 'exists' | 'create';
  canProcess: boolean;
  message?: string;
}

export interface CapcutAutoBatchScanResult {
  success: boolean;
  data?: {
    folders: FolderAnalysis[];
    total: number;
  };
  error?: string;
}

export interface CapcutAutoBatchProgress {
  total: number;
  current: number;
  percent: number;
  currentFolderName?: string;
  stage: AutoBatchStage;
  message: string;
}

export interface CapcutAutoBatchLog {
  time: string;
  status: 'info' | 'processing' | 'success' | 'error';
  message: string;
  folderPath?: string;
  folderName?: string;
}

export interface CapcutAutoBatchItemResult {
  folderPath: string;
  folderName: string;
  projectPath: string;
  draftStatus: 'exists' | 'created' | 'error';
  audioStatus: 'existing' | 'extracted' | 'error';
  videoPath?: string;
  audioPath?: string;
  status: 'success' | 'error';
  error?: string;
}

export interface CapcutAutoBatchStartResult {
  success: boolean;
  data?: {
    total: number;
    successCount: number;
    failedCount: number;
    stopped: boolean;
    results: CapcutAutoBatchItemResult[];
  };
  error?: string;
}

export interface CapcutAutoBatchStartOptions {
  folderPaths: string[];
  audioPolicy?: AutoBatchAudioPolicy;
  onProgress?: (progress: CapcutAutoBatchProgress) => void;
  onLog?: (log: CapcutAutoBatchLog) => void;
}

const SUPPORTED_VIDEO_EXTS = new Set(['.mp4']);
const SUPPORTED_AUDIO_EXTS = new Set(['.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg', '.opus']);
const NAME_COLLATOR = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

function nowIso(): string {
  return new Date().toISOString();
}

function toUniqueExistingFolders(folderPaths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const inputPath of folderPaths) {
    if (!inputPath) continue;
    const normalized = path.resolve(inputPath);
    if (seen.has(normalized)) continue;
    if (!fs.existsSync(normalized)) continue;
    try {
      if (!fs.statSync(normalized).isDirectory()) continue;
    } catch {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function pickLargestFile(
  folderPath: string,
  extensions: Set<string>,
): { filePath: string; fileName: string; sizeBytes: number } | null {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  let best: { filePath: string; fileName: string; sizeBytes: number } | null = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!extensions.has(ext)) continue;
    const fullPath = path.join(folderPath, entry.name);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(fullPath).size;
    } catch {
      continue;
    }
    if (!best || sizeBytes > best.sizeBytes) {
      best = { filePath: fullPath, fileName: entry.name, sizeBytes };
      continue;
    }
    if (sizeBytes === best.sizeBytes && NAME_COLLATOR.compare(entry.name, best.fileName) < 0) {
      best = { filePath: fullPath, fileName: entry.name, sizeBytes };
    }
  }
  return best;
}

function analyzeFolder(folderPath: string): FolderAnalysis {
  const folderName = path.basename(folderPath);
  const projectPath = folderPath;

  try {
    if (!fs.existsSync(folderPath)) {
      return {
        folderPath,
        folderName,
        projectPath,
        draftStatus: 'create',
        canProcess: false,
        message: 'Folder không tồn tại.',
      };
    }
    if (!fs.statSync(folderPath).isDirectory()) {
      return {
        folderPath,
        folderName,
        projectPath,
        draftStatus: 'create',
        canProcess: false,
        message: 'Đường dẫn không phải thư mục.',
      };
    }

    const bestVideo = pickLargestFile(folderPath, SUPPORTED_VIDEO_EXTS);
    if (!bestVideo) {
      return {
        folderPath,
        folderName,
        projectPath,
        draftStatus: fs.existsSync(path.join(folderPath, 'draft_content.json')) ? 'exists' : 'create',
        canProcess: false,
        message: 'Không tìm thấy file mp4 trong folder.',
      };
    }

    const bestAudio = pickLargestFile(folderPath, SUPPORTED_AUDIO_EXTS);
    const draftStatus: 'exists' | 'create' = fs.existsSync(path.join(folderPath, 'draft_content.json'))
      ? 'exists'
      : 'create';

    return {
      folderPath,
      folderName,
      projectPath,
      videoPath: bestVideo.filePath,
      videoName: bestVideo.fileName,
      videoSizeBytes: bestVideo.sizeBytes,
      existingAudioPath: bestAudio?.filePath,
      existingAudioName: bestAudio?.fileName,
      existingAudioSizeBytes: bestAudio?.sizeBytes,
      draftStatus,
      canProcess: true,
    };
  } catch (error) {
    return {
      folderPath,
      folderName,
      projectPath,
      draftStatus: 'create',
      canProcess: false,
      message: String(error),
    };
  }
}

class CapcutAutoBatchService {
  private stopRequested = false;

  stop(): void {
    this.stopRequested = true;
  }

  async scanFolders(folderPaths: string[]): Promise<CapcutAutoBatchScanResult> {
    try {
      const folders = toUniqueExistingFolders(folderPaths).map((folderPath) => analyzeFolder(folderPath));
      return {
        success: true,
        data: {
          folders,
          total: folders.length,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async start(options: CapcutAutoBatchStartOptions): Promise<CapcutAutoBatchStartResult> {
    this.stopRequested = false;
    const emitProgress = (progress: CapcutAutoBatchProgress) => options.onProgress?.(progress);
    const emitLog = (log: CapcutAutoBatchLog) => options.onLog?.(log);

    emitProgress({
      total: 0,
      current: 0,
      percent: 0,
      stage: 'preflight',
      message: 'Đang kiểm tra môi trường CapCut...',
    });

    const uniqueFolders = toUniqueExistingFolders(options.folderPaths || []);
    if (uniqueFolders.length === 0) {
      return { success: false, error: 'Chưa có folder hợp lệ để xử lý.' };
    }

    const env = await capcutProjectBatchService.checkEnvironment();
    if (!env.success) {
      return { success: false, error: env.error || 'Không thể khởi tạo môi trường pycapcut.' };
    }

    const analyses = uniqueFolders.map((folderPath) => analyzeFolder(folderPath));
    const total = analyses.length;

    emitProgress({
      total,
      current: 0,
      percent: 0,
      stage: 'scanning',
      message: `Sẵn sàng xử lý ${total} folder.`,
    });

    const results: CapcutAutoBatchItemResult[] = [];
    let successCount = 0;
    let failedCount = 0;
    const audioPolicy: AutoBatchAudioPolicy = options.audioPolicy === 'force_extract' ? 'force_extract' : 'prefer_existing';

    for (let index = 0; index < analyses.length; index += 1) {
      if (this.stopRequested) {
        emitProgress({
          total,
          current: index,
          percent: Math.round((index / total) * 100),
          stage: 'stopped',
          message: 'Đã dừng theo yêu cầu.',
        });
        break;
      }

      const analysis = analyses[index];
      emitProgress({
        total,
        current: index + 1,
        percent: Math.round((index / total) * 100),
        currentFolderName: analysis.folderName,
        stage: 'processing',
        message: `Đang xử lý folder ${analysis.folderName}...`,
      });

      if (!analysis.canProcess || !analysis.videoPath || !analysis.videoName) {
        failedCount += 1;
        results.push({
          folderPath: analysis.folderPath,
          folderName: analysis.folderName,
          projectPath: analysis.projectPath,
          draftStatus: 'error',
          audioStatus: 'error',
          status: 'error',
          error: analysis.message || 'Folder không đủ điều kiện xử lý.',
        });
        emitLog({
          time: nowIso(),
          status: 'error',
          folderPath: analysis.folderPath,
          folderName: analysis.folderName,
          message: analysis.message || 'Folder không đủ điều kiện xử lý.',
        });
        continue;
      }

      let draftStatus: 'exists' | 'created' | 'error' = analysis.draftStatus === 'exists' ? 'exists' : 'created';
      if (analysis.draftStatus === 'create') {
        const ensureDraft = await capcutProjectBatchService.ensureDraftInProjectFolder(analysis.projectPath);
        if (!ensureDraft.success) {
          failedCount += 1;
          draftStatus = 'error';
          results.push({
            folderPath: analysis.folderPath,
            folderName: analysis.folderName,
            projectPath: analysis.projectPath,
            draftStatus,
            audioStatus: 'error',
            videoPath: analysis.videoPath,
            status: 'error',
            error: ensureDraft.message,
          });
          emitLog({
            time: nowIso(),
            status: 'error',
            folderPath: analysis.folderPath,
            folderName: analysis.folderName,
            message: ensureDraft.message,
          });
          continue;
        }
        draftStatus = 'created';
        emitLog({
          time: nowIso(),
          status: 'success',
          folderPath: analysis.folderPath,
          folderName: analysis.folderName,
          message: 'Đã tạo draft_content.json trong folder nguồn.',
        });
      }

      let audioPath = analysis.existingAudioPath;
      let audioStatus: 'existing' | 'extracted' | 'error' = 'existing';

      const shouldExtract = audioPolicy === 'force_extract' || !audioPath;
      if (shouldExtract) {
        emitLog({
          time: nowIso(),
          status: 'processing',
          folderPath: analysis.folderPath,
          folderName: analysis.folderName,
          message: `Đang tách audio từ video ${analysis.videoName}...`,
        });
        const extraction = await audioExtractorService.extractAudio({
          inputPath: analysis.videoPath,
          outputFormat: 'mp3',
          keepStructure: true,
          overwrite: true,
        });
        if (!extraction.success || !extraction.outputPath) {
          failedCount += 1;
          audioStatus = 'error';
          results.push({
            folderPath: analysis.folderPath,
            folderName: analysis.folderName,
            projectPath: analysis.projectPath,
            draftStatus,
            audioStatus,
            videoPath: analysis.videoPath,
            status: 'error',
            error: extraction.error || 'Không thể tách audio từ video.',
          });
          emitLog({
            time: nowIso(),
            status: 'error',
            folderPath: analysis.folderPath,
            folderName: analysis.folderName,
            message: extraction.error || 'Không thể tách audio từ video.',
          });
          continue;
        }
        audioPath = extraction.outputPath;
        audioStatus = 'extracted';
      }

      if (!audioPath) {
        failedCount += 1;
        audioStatus = 'error';
        results.push({
          folderPath: analysis.folderPath,
          folderName: analysis.folderName,
          projectPath: analysis.projectPath,
          draftStatus,
          audioStatus,
          videoPath: analysis.videoPath,
          status: 'error',
          error: 'Không tìm thấy file audio để gắn vào project.',
        });
        emitLog({
          time: nowIso(),
          status: 'error',
          folderPath: analysis.folderPath,
          folderName: analysis.folderName,
          message: 'Không tìm thấy file audio để gắn vào project.',
        });
        continue;
      }

      emitLog({
        time: nowIso(),
        status: 'processing',
        folderPath: analysis.folderPath,
        folderName: analysis.folderName,
        message: 'Đang gắn audio vào draft_content.json...',
      });
      const attach = await capcutProjectBatchService.attachAudioToProject({
        capcutProjectPath: analysis.projectPath,
        extractedAudioPath: audioPath,
      });

      if (!attach.success) {
        failedCount += 1;
        results.push({
          folderPath: analysis.folderPath,
          folderName: analysis.folderName,
          projectPath: analysis.projectPath,
          draftStatus,
          audioStatus: 'error',
          videoPath: analysis.videoPath,
          audioPath,
          status: 'error',
          error: attach.message,
        });
        emitLog({
          time: nowIso(),
          status: 'error',
          folderPath: analysis.folderPath,
          folderName: analysis.folderName,
          message: attach.message,
        });
        continue;
      }

      successCount += 1;
      results.push({
        folderPath: analysis.folderPath,
        folderName: analysis.folderName,
        projectPath: analysis.projectPath,
        draftStatus,
        audioStatus,
        videoPath: analysis.videoPath,
        audioPath,
        status: 'success',
      });
      emitLog({
        time: nowIso(),
        status: 'success',
        folderPath: analysis.folderPath,
        folderName: analysis.folderName,
        message: `Hoàn tất folder ${analysis.folderName}.`,
      });

      emitProgress({
        total,
        current: index + 1,
        percent: Math.round(((index + 1) / total) * 100),
        currentFolderName: analysis.folderName,
        stage: 'processing',
        message: `Đã xử lý ${index + 1}/${total} folder.`,
      });
    }

    const stopped = this.stopRequested;
    this.stopRequested = false;
    if (stopped) {
      return {
        success: false,
        data: {
          total,
          successCount,
          failedCount,
          stopped: true,
          results,
        },
        error: 'Đã dừng theo yêu cầu.',
      };
    }

    emitProgress({
      total,
      current: total,
      percent: 100,
      stage: failedCount > 0 ? 'error' : 'completed',
      message:
        failedCount > 0
          ? `Hoàn tất với lỗi: ${successCount} thành công, ${failedCount} lỗi.`
          : `Hoàn tất: ${successCount}/${total} folder thành công.`,
    });

    if (failedCount > 0) {
      return {
        success: false,
        data: {
          total,
          successCount,
          failedCount,
          stopped: false,
          results,
        },
        error: `Có ${failedCount} folder lỗi.`,
      };
    }

    return {
      success: true,
      data: {
        total,
        successCount,
        failedCount,
        stopped: false,
        results,
      },
    };
  }
}

export const capcutAutoBatchService = new CapcutAutoBatchService();
