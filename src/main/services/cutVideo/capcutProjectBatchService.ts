import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { capcutProjectIndexStore } from './capcutProjectIndexStore';
import { checkPycapcutAvailability, type PythonRuntimeResolution } from '../../utils/pythonRuntime';

export const DEFAULT_CAPCUT_DRAFTS_PATH = 'D:\\User\\CongTinh\\Videos\\CapCut Drafts';

export type CapcutNamingMode = 'index_plus_filename' | 'month_day_suffix';

export interface CapcutScanVideoItem {
  fileName: string;
  fullPath: string;
  ext: string;
}

export interface CapcutScanVideosResult {
  success: boolean;
  data?: {
    folderPath: string;
    videos: CapcutScanVideoItem[];
    count: number;
  };
  error?: string;
}

export interface CapcutBatchLog {
  time: string;
  status: 'info' | 'processing' | 'success' | 'error';
  message: string;
  videoName?: string;
  projectName?: string;
}

export interface CapcutBatchProgress {
  total: number;
  current: number;
  percent: number;
  currentVideoName?: string;
  stage: 'preflight' | 'scanning' | 'creating' | 'copying_clips' | 'completed' | 'stopped' | 'error';
  message: string;
}

export interface CapcutProjectBatchOptions {
  sourceFolderPath: string;
  capcutDraftsPath: string;
  namingMode: CapcutNamingMode;
  orderedVideoPaths?: string[];
  onProgress?: (progress: CapcutBatchProgress) => void;
  onLog?: (log: CapcutBatchLog) => void;
}

export interface CapcutProjectBatchItemResult {
  videoName: string;
  projectName: string;
  status: 'success' | 'error';
  copiedClipCount?: number;
  copiedVideoPath?: string;
  assetFolder?: string;
  error?: string;
}

export interface CapcutProjectBatchResult {
  success: boolean;
  data?: {
    total: number;
    created: number;
    failed: number;
    stopped: boolean;
    projects: CapcutProjectBatchItemResult[];
  };
  error?: string;
}

export interface CapcutAudioAttachResult {
  success: boolean;
  skipped?: boolean;
  message: string;
  projectName?: string;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

const SUPPORTED_VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm']);
const NAME_COLLATOR = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeProjectName(input: string): string {
  const replaced = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return replaced || 'video';
}

function getVideoStem(fileName: string): string {
  const ext = path.extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

function pad2(index: number): string {
  return String(index).padStart(2, '0');
}

function pad3(index: number): string {
  return String(index).padStart(3, '0');
}

function getMonthDayName(date: Date): string {
  return `${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function buildPythonCreateDraftScript(): string {
  return [
    'import sys',
    'import pycapcut as cc',
    '',
    'drafts_dir = sys.argv[1]',
    'project_name = sys.argv[2]',
    '',
    'draft_folder = cc.DraftFolder(drafts_dir)',
    'script = draft_folder.create_draft(project_name, 1920, 1080)',
    'script.save()',
    'print("OK")',
  ].join('\n');
}

function buildPythonAttachAudioScript(): string {
  return [
    'import os',
    'import sys',
    'import pycapcut as cc',
    '',
    'drafts_dir = sys.argv[1]',
    'project_name = sys.argv[2]',
    'audio_path = sys.argv[3]',
    '',
    'draft_folder = cc.DraftFolder(drafts_dir)',
    'script = draft_folder.load_template(project_name)',
    '',
    'audio_name = os.path.basename(audio_path)',
    'audio_material = cc.AudioMaterial(audio_path)',
    '',
    'replace_candidates = [',
    '    audio_name,',
    '    "auto_audio.mp3",',
    '    "auto_audio.wav",',
    '    "auto_audio.aac",',
    '    "auto_audio.flac",',
    '    "auto_audio.m4a",',
    ']',
    '',
    'replaced = False',
    'for name in dict.fromkeys(replace_candidates):',
    '    try:',
    '        script.replace_material_by_name(name, audio_material)',
    '        replaced = True',
    '        break',
    '    except Exception:',
    '        pass',
    '',
    'if not replaced:',
    '    track_name = "audio_auto"',
    '    try:',
    '        script.add_track(cc.TrackType.audio, track_name)',
    '    except Exception:',
    '        pass',
    '',
    '    segment = cc.AudioSegment(audio_material, cc.Timerange(0, audio_material.duration))',
    '    try:',
    '        script.add_segment(segment, track_name)',
    '    except Exception:',
    '        script.add_segment(segment)',
    '',
    'script.save()',
    'print("REPLACED" if replaced else "ADDED")',
  ].join('\n');
}

class CapcutProjectBatchService {
  private stopRequested = false;
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private cachedPythonRuntime: PythonRuntimeResolution | null = null;

  stop(): void {
    this.stopRequested = true;
    if (this.activeProcess && !this.activeProcess.killed) {
      try {
        this.activeProcess.kill('SIGKILL');
      } catch {
        // noop
      }
    }
  }

  async checkEnvironment(): Promise<{ success: boolean; error?: string }> {
    const runtimeResult = await this.getPythonRuntime();
    if (!runtimeResult.runtime) {
      return { success: false, error: runtimeResult.error };
    }
    return { success: true };
  }

  async scanVideos(folderPath: string): Promise<CapcutScanVideosResult> {
    try {
      if (!folderPath || typeof folderPath !== 'string') {
        return { success: false, error: 'Thiếu đường dẫn folder video nguồn.' };
      }
      if (!fs.existsSync(folderPath)) {
        return { success: false, error: 'Folder video nguồn không tồn tại.' };
      }
      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) {
        return { success: false, error: 'Đường dẫn nguồn không phải thư mục.' };
      }

      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      const videos: CapcutScanVideoItem[] = entries
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const ext = path.extname(entry.name).toLowerCase();
          return {
            fileName: entry.name,
            fullPath: path.join(folderPath, entry.name),
            ext,
          };
        })
        .filter((item) => SUPPORTED_VIDEO_EXTS.has(item.ext))
        .sort((a, b) => NAME_COLLATOR.compare(a.fileName, b.fileName));

      return {
        success: true,
        data: {
          folderPath,
          videos,
          count: videos.length,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async createProjects(options: CapcutProjectBatchOptions): Promise<CapcutProjectBatchResult> {
    this.stopRequested = false;
    const { sourceFolderPath, capcutDraftsPath, namingMode, onProgress, onLog, orderedVideoPaths } = options;

    const emitProgress = (progress: CapcutBatchProgress): void => {
      onProgress?.(progress);
    };
    const emitLog = (log: CapcutBatchLog): void => {
      onLog?.(log);
    };

    emitProgress({
      total: 0,
      current: 0,
      percent: 0,
      stage: 'preflight',
      message: 'Đang kiểm tra môi trường Python và pycapcut...',
    });

    if (!sourceFolderPath || !capcutDraftsPath) {
      return { success: false, error: 'Thiếu sourceFolderPath hoặc capcutDraftsPath.' };
    }
    if (namingMode !== 'index_plus_filename' && namingMode !== 'month_day_suffix') {
      return { success: false, error: `Naming mode không hỗ trợ: ${namingMode}` };
    }
    if (!fs.existsSync(capcutDraftsPath)) {
      return { success: false, error: `Folder drafts không tồn tại: ${capcutDraftsPath}` };
    }
    if (!fs.statSync(capcutDraftsPath).isDirectory()) {
      return { success: false, error: `Drafts path không phải thư mục: ${capcutDraftsPath}` };
    }

    const runtimeResult = await this.getPythonRuntime();
    if (!runtimeResult.runtime) {
      return { success: false, error: runtimeResult.error || 'Không chuẩn bị được runtime Python.' };
    }
    const runtime = runtimeResult.runtime;
    emitLog({
      time: nowIso(),
      status: 'info',
      message: `Python runtime: mode=${runtime.mode}, path=${runtime.pythonPath}`,
    });

    let videos: CapcutScanVideoItem[] = [];
    const orderedList = Array.isArray(orderedVideoPaths) ? orderedVideoPaths.filter(Boolean) : [];
    if (orderedList.length > 0) {
      const seen = new Set<string>();
      for (const item of orderedList) {
        const resolvedPath = path.resolve(item);
        if (seen.has(resolvedPath)) continue;
        const ext = path.extname(resolvedPath).toLowerCase();
        if (!SUPPORTED_VIDEO_EXTS.has(ext)) continue;
        if (!fs.existsSync(resolvedPath)) continue;
        const fileName = path.basename(resolvedPath);
        videos.push({ fileName, fullPath: resolvedPath, ext });
        seen.add(resolvedPath);
      }
    }

    if (videos.length === 0) {
      const scan = await this.scanVideos(sourceFolderPath);
      if (!scan.success || !scan.data) {
        return { success: false, error: scan.error || 'Không thể quét video nguồn.' };
      }
      videos = scan.data.videos;
    }
    const total = videos.length;
    if (total === 0) {
      return { success: false, error: 'Không tìm thấy video hợp lệ trong folder nguồn.' };
    }

    emitProgress({
      total,
      current: 0,
      percent: 0,
      stage: 'scanning',
      message: `Đã quét ${total} video, chuẩn bị tạo project CapCut...`,
    });

    const existingNames = new Set<string>(
      fs
        .readdirSync(capcutDraftsPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );

    const results: CapcutProjectBatchItemResult[] = [];
    let created = 0;
    let failed = 0;
    const pythonScript = buildPythonCreateDraftScript();

    for (let i = 0; i < videos.length; i += 1) {
      if (this.stopRequested) {
        emitProgress({
          total,
          current: i,
          percent: Math.round((i / total) * 100),
          stage: 'stopped',
          message: 'Đã dừng tạo project theo yêu cầu.',
        });
        break;
      }

      const video = videos[i];
      const projectName = this.resolveProjectName(i + 1, video.fileName, existingNames, namingMode);

      emitProgress({
        total,
        current: i + 1,
        percent: Math.round((i / total) * 100),
        currentVideoName: video.fileName,
        stage: 'creating',
        message: `Đang tạo project ${projectName}...`,
      });
      emitLog({
        time: nowIso(),
        status: 'processing',
        message: 'Đang tạo project bằng pycapcut...',
        videoName: video.fileName,
        projectName,
      });

      const run = await this.runCommand(runtime.command, [
        ...runtime.baseArgs,
        '-c',
        pythonScript,
        capcutDraftsPath,
        projectName,
      ], runtime.mode);

      if (this.stopRequested) {
        emitProgress({
          total,
          current: i,
          percent: Math.round((i / total) * 100),
          stage: 'stopped',
          message: 'Đã dừng tạo project theo yêu cầu.',
        });
        break;
      }

      if (run.code !== 0) {
        failed += 1;
        const errText = (run.stderr || run.error || run.stdout || 'Unknown error').trim();
        results.push({
          videoName: video.fileName,
          projectName,
          status: 'error',
          error: `Tạo project bằng pycapcut thất bại: ${errText}`,
        });
        emitLog({
          time: nowIso(),
          status: 'error',
          message: `Tạo project bằng pycapcut thất bại: ${errText}`,
          videoName: video.fileName,
          projectName,
        });
        continue;
      }

      const projectDir = path.join(capcutDraftsPath, projectName);
      const copiedVideoPath = path.join(projectDir, path.basename(video.fullPath));
      if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        failed += 1;
        const errText = `Không tìm thấy thư mục project vừa tạo: ${projectDir}`;
        results.push({
          videoName: video.fileName,
          projectName,
          status: 'error',
          error: errText,
        });
        emitLog({
          time: nowIso(),
          status: 'error',
          message: errText,
          videoName: video.fileName,
          projectName,
        });
        continue;
      }
      try {
        fs.copyFileSync(video.fullPath, copiedVideoPath);
      } catch (error) {
        failed += 1;
        const errText = `Copy video vào thư mục project thất bại: ${String(error)}`;
        results.push({
          videoName: video.fileName,
          projectName,
          status: 'error',
          assetFolder: projectDir,
          error: errText,
        });
        emitLog({
          time: nowIso(),
          status: 'error',
          message: errText,
          videoName: video.fileName,
          projectName,
        });
        continue;
      }

      emitProgress({
        total,
        current: i + 1,
        percent: Math.round((i / total) * 100),
        currentVideoName: video.fileName,
        stage: 'copying_clips',
        message: `Đang copy video gốc vào ${projectName}...`,
      });

      try {
        await capcutProjectIndexStore.upsert(capcutDraftsPath, {
          sourceVideoPath: video.fullPath,
          sourceVideoFileName: video.fileName,
          projectName,
          draftsPath: capcutDraftsPath,
          assetBaseDir: projectDir,
          clipsDir: projectDir,
          sourceVideoCopiedPath: copiedVideoPath,
        });
      } catch (error) {
        emitLog({
          time: nowIso(),
          status: 'error',
          message: `Không thể cập nhật map project index: ${String(error)}`,
          videoName: video.fileName,
          projectName,
        });
      }

      created += 1;
      results.push({
        videoName: video.fileName,
        projectName,
        status: 'success',
        copiedVideoPath,
        assetFolder: projectDir,
      });
      emitLog({
        time: nowIso(),
        status: 'success',
        message: 'Tạo project thành công. Đã copy video gốc vào thư mục project.',
        videoName: video.fileName,
        projectName,
      });

      emitProgress({
        total,
        current: i + 1,
        percent: Math.round(((i + 1) / total) * 100),
        currentVideoName: video.fileName,
        stage: 'creating',
        message: `Đã xử lý ${i + 1}/${total}.`,
      });
    }

    const stopped = this.stopRequested;
    this.stopRequested = false;

    if (stopped) {
      return {
        success: false,
        data: { total, created, failed, stopped: true, projects: results },
        error: 'Đã dừng theo yêu cầu.',
      };
    }

    emitProgress({
      total,
      current: total,
      percent: 100,
      stage: 'completed',
      message: `Hoàn tất tạo project CapCut: ${created} thành công, ${failed} lỗi.`,
    });

    if (failed > 0) {
      return {
        success: false,
        data: { total, created, failed, stopped: false, projects: results },
        error: `Có ${failed} project tạo thất bại.`,
      };
    }

    return {
      success: true,
      data: { total, created, failed, stopped: false, projects: results },
    };
  }

  async attachAudioToMappedProject(options: {
    sourceVideoPath: string;
    extractedAudioPath: string;
    capcutDraftsPath?: string;
    capcutProjectPath?: string;
  }): Promise<CapcutAudioAttachResult> {
    const draftsPath = options.capcutDraftsPath || DEFAULT_CAPCUT_DRAFTS_PATH;
    if (!options.sourceVideoPath || !options.extractedAudioPath) {
      return { success: false, message: 'Thiếu sourceVideoPath hoặc extractedAudioPath.' };
    }
    if (!fs.existsSync(options.extractedAudioPath)) {
      return { success: false, message: `Audio đã tách không tồn tại: ${options.extractedAudioPath}` };
    }
    if (!fs.existsSync(draftsPath)) {
      if (options.capcutProjectPath) {
        return await this.attachAudioToProject({
          capcutProjectPath: options.capcutProjectPath,
          extractedAudioPath: options.extractedAudioPath,
        });
      }
      return { success: false, message: `Folder drafts không tồn tại: ${draftsPath}` };
    }

    const mapped = await capcutProjectIndexStore.findBySourceVideoPath(draftsPath, options.sourceVideoPath);
    if (!mapped) {
      if (options.capcutProjectPath) {
        return await this.attachAudioToProject({
          capcutProjectPath: options.capcutProjectPath,
          extractedAudioPath: options.extractedAudioPath,
        });
      }
      return {
        success: false,
        skipped: true,
        message: 'Chưa có project map cho video này. Hãy chọn đúng folder project đã copy hoặc nhập drafts path mới.',
      };
    }

    const runtimeResult = await this.getPythonRuntime();
    if (!runtimeResult.runtime) {
      return { success: false, message: runtimeResult.error || 'Không chuẩn bị được runtime Python.' };
    }
    const attach = await this.attachAudioToProject({
      capcutProjectPath: path.join(mapped.draftsPath || draftsPath, mapped.projectName),
      extractedAudioPath: options.extractedAudioPath,
    });
    if (!attach.success) {
      return attach;
    }

    try {
      await capcutProjectIndexStore.updateAutoAudio(
        draftsPath,
        options.sourceVideoPath,
        path.resolve(options.extractedAudioPath),
      );
    } catch {
      // ignore index update errors to avoid breaking attach flow
    }
    return attach;
  }

  async attachAudioToProject(options: {
    capcutProjectPath?: string;
    projectName?: string;
    capcutDraftsPath?: string;
    extractedAudioPath: string;
  }): Promise<CapcutAudioAttachResult> {
    if (!options.extractedAudioPath) {
      return { success: false, message: 'Thiếu extractedAudioPath.' };
    }
    if (!fs.existsSync(options.extractedAudioPath)) {
      return { success: false, message: `Audio đã tách không tồn tại: ${options.extractedAudioPath}` };
    }

    let projectName = options.projectName || '';
    let draftsPath = options.capcutDraftsPath || DEFAULT_CAPCUT_DRAFTS_PATH;
    let projectDir = '';

    if (options.capcutProjectPath) {
      projectDir = path.resolve(options.capcutProjectPath);
      if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        return { success: false, message: `Project CapCut không tồn tại: ${projectDir}` };
      }
      projectName = path.basename(projectDir);
      draftsPath = path.dirname(projectDir);
    } else {
      if (!projectName) {
        return { success: false, message: 'Thiếu projectName hoặc capcutProjectPath.' };
      }
      projectDir = path.join(path.resolve(draftsPath), projectName);
      if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        return { success: false, message: `Project CapCut không tồn tại: ${projectDir}` };
      }
    }

    const runtimeResult = await this.getPythonRuntime();
    if (!runtimeResult.runtime) {
      return { success: false, message: runtimeResult.error || 'Không chuẩn bị được runtime Python.' };
    }
    const runtime = runtimeResult.runtime;

    const directAudioPath = path.resolve(options.extractedAudioPath);

    const attachScript = buildPythonAttachAudioScript();
    const run = await this.runCommand(runtime.command, [
      ...runtime.baseArgs,
      '-c',
      attachScript,
      draftsPath,
      projectName,
      directAudioPath,
    ], runtime.mode);

    if (run.code !== 0) {
      const errText = (run.stderr || run.error || run.stdout || 'Unknown error').trim();
      return {
        success: false,
        message: `Gắn audio vào project thất bại: ${errText}`,
        projectName,
      };
    }

    return {
      success: true,
      message: `Đã gắn audio vừa tách vào project ${projectName}.`,
      projectName,
    };
  }

  async ensureDraftInProjectFolder(projectPath: string): Promise<{
    success: boolean;
    created: boolean;
    message: string;
  }> {
    if (!projectPath) {
      return { success: false, created: false, message: 'Thiếu projectPath.' };
    }

    const resolvedProjectPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedProjectPath) || !fs.statSync(resolvedProjectPath).isDirectory()) {
      return {
        success: false,
        created: false,
        message: `Project folder không tồn tại: ${resolvedProjectPath}`,
      };
    }

    const draftContentPath = path.join(resolvedProjectPath, 'draft_content.json');
    if (fs.existsSync(draftContentPath)) {
      return {
        success: true,
        created: false,
        message: 'Project đã có draft_content.json.',
      };
    }

    const runtimeResult = await this.getPythonRuntime();
    if (!runtimeResult.runtime) {
      return {
        success: false,
        created: false,
        message: runtimeResult.error || 'Không chuẩn bị được runtime Python.',
      };
    }

    const runtime = runtimeResult.runtime;
    const projectName = path.basename(resolvedProjectPath);
    const draftsPath = path.dirname(resolvedProjectPath);
    const pythonScript = buildPythonCreateDraftScript();

    const directCreate = await this.runCommand(
      runtime.command,
      [...runtime.baseArgs, '-c', pythonScript, draftsPath, projectName],
      runtime.mode,
    );

    if (directCreate.code === 0 && fs.existsSync(draftContentPath)) {
      return {
        success: true,
        created: true,
        message: 'Đã tạo draft_content.json trực tiếp trong folder project.',
      };
    }

    const tempName = `${projectName}__auto_draft_${Date.now()}`;
    const tempProjectPath = path.join(draftsPath, tempName);
    const tempCreate = await this.runCommand(
      runtime.command,
      [...runtime.baseArgs, '-c', pythonScript, draftsPath, tempName],
      runtime.mode,
    );

    if (tempCreate.code !== 0 || !fs.existsSync(tempProjectPath)) {
      const errText =
        (directCreate.stderr || directCreate.error || directCreate.stdout || '').trim()
        || (tempCreate.stderr || tempCreate.error || tempCreate.stdout || '').trim()
        || 'Unknown error';
      return {
        success: false,
        created: false,
        message: `Không thể tạo draft_content.json: ${errText}`,
      };
    }

    try {
      this.copyDirectoryContents(tempProjectPath, resolvedProjectPath);
    } catch (error) {
      return {
        success: false,
        created: false,
        message: `Đã tạo draft tạm nhưng copy về folder project thất bại: ${String(error)}`,
      };
    } finally {
      try {
        fs.rmSync(tempProjectPath, { recursive: true, force: true });
      } catch {
        // noop
      }
    }

    if (!fs.existsSync(draftContentPath)) {
      return {
        success: false,
        created: false,
        message: 'Không tìm thấy draft_content.json sau khi copy draft tạm.',
      };
    }

    return {
      success: true,
      created: true,
      message: 'Đã tạo draft_content.json trong folder project từ draft tạm.',
    };
  }

  private resolveProjectName(
    index: number,
    fileName: string,
    existingNames: Set<string>,
    namingMode: CapcutNamingMode,
  ): string {
    if (namingMode === 'month_day_suffix') {
      const base = getMonthDayName(new Date());
      if (!existingNames.has(base)) {
        existingNames.add(base);
        return base;
      }
      let suffix = 1;
      while (existingNames.has(`${base}_${suffix}`)) {
        suffix += 1;
      }
      const finalName = `${base}_${suffix}`;
      existingNames.add(finalName);
      return finalName;
    }

    const stem = sanitizeProjectName(getVideoStem(fileName));
    const base = `${pad3(index)}_${stem}`;
    if (!existingNames.has(base)) {
      existingNames.add(base);
      return base;
    }
    let suffix = 2;
    while (existingNames.has(`${base}_v${suffix}`)) {
      suffix += 1;
    }
    const finalName = `${base}_v${suffix}`;
    existingNames.add(finalName);
    return finalName;
  }

  private async getPythonRuntime(): Promise<{ runtime?: PythonRuntimeResolution; error?: string }> {
    if (this.cachedPythonRuntime) {
      if (this.cachedPythonRuntime.mode === 'embedded' && !fs.existsSync(this.cachedPythonRuntime.command)) {
        this.cachedPythonRuntime = null;
      } else {
        return { runtime: this.cachedPythonRuntime };
      }
    }

    const checkResult = await checkPycapcutAvailability();
    if (!checkResult.success || !checkResult.runtime) {
      return { error: checkResult.error || 'Không thể chuẩn bị runtime Python.' };
    }

    this.cachedPythonRuntime = checkResult.runtime;
    return { runtime: checkResult.runtime };
  }

  private runCommand(
    command: string,
    args: string[],
    mode: 'embedded' | 'system' = 'system',
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const env =
        mode === 'embedded'
          ? {
              ...process.env,
              PYTHONDONTWRITEBYTECODE: '1',
              PYTHONUTF8: '1',
            }
          : process.env;

      try {
        const proc = spawn(command, args, { windowsHide: true, env });
        this.activeProcess = proc;

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        proc.on('error', (error) => {
          if (settled) return;
          settled = true;
          this.activeProcess = null;
          resolve({ code: -1, stdout, stderr, error: error.message });
        });
        proc.on('close', (code) => {
          if (settled) return;
          settled = true;
          this.activeProcess = null;
          resolve({ code, stdout, stderr });
        });
      } catch (error) {
        this.activeProcess = null;
        resolve({ code: -1, stdout, stderr, error: String(error) });
      }
    });
  }

  private copyDirectoryContents(sourceDir: string, targetDir: string): void {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        if (!fs.existsSync(targetPath)) {
          fs.mkdirSync(targetPath, { recursive: true });
        }
        this.copyDirectoryContents(sourcePath, targetPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }
}

export const capcutProjectBatchService = new CapcutProjectBatchService();
