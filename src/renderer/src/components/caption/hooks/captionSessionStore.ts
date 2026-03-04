import {
  CaptionArtifactFile,
  CaptionSessionV1,
  CaptionProjectSettingsValues,
  CaptionStepNumber,
  CaptionStepState,
  SubtitleEntry,
} from '@shared/types/caption';
import { ThumbnailPreviewRuntimeState } from '../CaptionTypes';
import {
  createDefaultCaptionSession,
  getCaptionSessionPathFromInput,
  nowIso,
} from '@shared/utils/captionSession';

export type CaptionInputType = 'srt' | 'draft';
const sessionWriteQueue = new Map<string, Promise<void>>();
const sessionSyncRetryTimers = new Map<string, number>();

export function getInputPaths(inputType: CaptionInputType, filePath: string): string[] {
  if (!filePath) return [];
  if (inputType === 'draft') {
    return filePath.split('; ').map((p) => p.trim()).filter(Boolean);
  }
  return [filePath];
}

export function getSessionPathForInputPath(inputType: CaptionInputType, inputPath: string): string {
  return getCaptionSessionPathFromInput(inputType, inputPath);
}

const DEFAULT_THUMBNAIL_PREVIEW_RUNTIME: Required<ThumbnailPreviewRuntimeState> = {
  tab: 'edit',
  activeLayer: 'primary',
  sourceStatus: 'idle',
  realStatus: 'idle',
  lastRealError: '',
  lastSyncHash: '',
  lastSyncAt: '',
};

export function readThumbnailPreviewRuntime(
  session: CaptionSessionV1
): Required<ThumbnailPreviewRuntimeState> {
  const runtime = (session.runtime?.thumbnailPreview || {}) as ThumbnailPreviewRuntimeState;
  return {
    tab: runtime.tab || DEFAULT_THUMBNAIL_PREVIEW_RUNTIME.tab,
    activeLayer: runtime.activeLayer || DEFAULT_THUMBNAIL_PREVIEW_RUNTIME.activeLayer,
    sourceStatus: runtime.sourceStatus || DEFAULT_THUMBNAIL_PREVIEW_RUNTIME.sourceStatus,
    realStatus: runtime.realStatus || DEFAULT_THUMBNAIL_PREVIEW_RUNTIME.realStatus,
    lastRealError: typeof runtime.lastRealError === 'string' ? runtime.lastRealError : '',
    lastSyncHash: typeof runtime.lastSyncHash === 'string' ? runtime.lastSyncHash : '',
    lastSyncAt: typeof runtime.lastSyncAt === 'string' ? runtime.lastSyncAt : '',
  };
}

export function writeThumbnailPreviewRuntime(
  session: CaptionSessionV1,
  runtimePatch: Partial<ThumbnailPreviewRuntimeState>
): CaptionSessionV1 {
  const current = readThumbnailPreviewRuntime(session);
  return {
    ...session,
    runtime: {
      ...session.runtime,
      thumbnailPreview: {
        ...current,
        ...runtimePatch,
      },
    },
  };
}

export function buildThumbnailPreviewHash(payload: Record<string, unknown>): string {
  return buildObjectFingerprint(payload);
}

export function shouldSkipRealPreviewRequest(lastHash: string, nextHash: string): boolean {
  if (!nextHash) return false;
  return lastHash === nextHash;
}

export async function readCaptionSession(
  sessionPath: string,
  fallback?: { projectId?: string | null; inputType?: CaptionInputType; sourcePath?: string; folderPath?: string }
): Promise<CaptionSessionV1> {
  const res = await window.electronAPI.caption.readSession(sessionPath);
  if (res?.success && res.data) {
    const parsed = res.data as CaptionSessionV1;
    return {
      ...createDefaultCaptionSession(fallback),
      ...parsed,
      projectContext: {
        ...createDefaultCaptionSession(fallback).projectContext,
        ...(parsed.projectContext || {}),
      },
      settings: {
        ...(parsed.settings || {}),
      },
      steps: {
        ...createDefaultCaptionSession(fallback).steps,
        ...(parsed.steps || {}),
      },
      data: {
        ...(parsed.data || {}),
      },
      artifacts: {
        ...(parsed.artifacts || {}),
      },
      timing: {
        ...(parsed.timing || {}),
      },
      runtime: {
        ...createDefaultCaptionSession(fallback).runtime,
        ...(parsed.runtime || {}),
      },
    };
  }
  return createDefaultCaptionSession(fallback);
}

export async function writeCaptionSession(sessionPath: string, session: CaptionSessionV1): Promise<void> {
  const payload: CaptionSessionV1 = {
    ...session,
    updatedAt: nowIso(),
  };
  await window.electronAPI.caption.writeSessionAtomic(sessionPath, payload);
}

export async function updateCaptionSession(
  sessionPath: string,
  updater: (current: CaptionSessionV1) => CaptionSessionV1,
  fallback?: { projectId?: string | null; inputType?: CaptionInputType; sourcePath?: string; folderPath?: string }
): Promise<CaptionSessionV1> {
  const prevQueue = sessionWriteQueue.get(sessionPath) || Promise.resolve();
  let nextSession: CaptionSessionV1 | null = null;
  const queued = prevQueue
    .catch(() => undefined)
    .then(async () => {
      const current = await readCaptionSession(sessionPath, fallback);
      const next = updater(current);
      await writeCaptionSession(sessionPath, next);
      nextSession = next;
    });
  sessionWriteQueue.set(sessionPath, queued);
  await queued;
  return nextSession as CaptionSessionV1;
}

export function toStepKey(step: number): 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7' {
  if (step < 1 || step > 7) {
    return 'step1';
  }
  return `step${step}` as 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7';
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `"${key}":${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}

export function buildObjectFingerprint(value: unknown): string {
  return hashString(stableStringify(value));
}

export function buildEntriesFingerprint(entries: SubtitleEntry[] = []): string {
  const compact = entries.map((entry) => ({
    index: entry.index,
    startMs: entry.startMs,
    endMs: entry.endMs,
    text: entry.text,
    translatedText: entry.translatedText,
  }));
  return buildObjectFingerprint(compact);
}

export function makeStepRunning(prev?: CaptionStepState, settingsSnapshot?: Record<string, unknown>): CaptionStepState {
  return {
    ...prev,
    status: 'running',
    startedAt: nowIso(),
    endedAt: undefined,
    error: undefined,
    blockedReason: undefined,
    settingsSnapshot: settingsSnapshot || prev?.settingsSnapshot,
  };
}

export function makeStepSuccess(
  prev?: CaptionStepState,
  metrics?: Record<string, unknown>
): CaptionStepState {
  return {
    ...prev,
    status: 'success',
    endedAt: nowIso(),
    error: undefined,
    blockedReason: undefined,
    metrics: metrics || prev?.metrics,
  };
}

export function makeStepError(prev: CaptionStepState | undefined, error: string): CaptionStepState {
  return {
    ...prev,
    status: 'error',
    endedAt: nowIso(),
    error,
  };
}

export function makeStepStopped(
  prev: CaptionStepState | undefined,
  reason = 'STOPPED_BY_USER',
  metrics?: Record<string, unknown>
): CaptionStepState {
  return {
    ...prev,
    status: 'stopped',
    endedAt: nowIso(),
    error: reason,
    blockedReason: undefined,
    metrics: metrics || prev?.metrics,
  };
}

const STEP_DEPENDENCIES: Record<CaptionStepNumber, CaptionStepNumber[]> = {
  1: [],
  2: [1],
  3: [1],
  4: [3],
  5: [4],
  6: [4],
  7: [3, 6],
};

function getDependenciesForStep(step: CaptionStepNumber, enabledSteps?: CaptionStepNumber[]): CaptionStepNumber[] {
  const base = [...STEP_DEPENDENCIES[step]];
  if (step === 6 && enabledSteps?.includes(5) && !base.includes(5)) {
    base.push(5);
  }
  return base;
}

function collectDependentSteps(
  changedStep: CaptionStepNumber,
  enabledSteps?: CaptionStepNumber[]
): CaptionStepNumber[] {
  const queue: CaptionStepNumber[] = [changedStep];
  const visited = new Set<CaptionStepNumber>([changedStep]);
  const result: CaptionStepNumber[] = [];

  while (queue.length > 0) {
    const cur = queue.shift() as CaptionStepNumber;
    const allSteps: CaptionStepNumber[] = [1, 2, 3, 4, 5, 6, 7];
    for (const candidate of allSteps) {
      if (candidate === cur || visited.has(candidate)) continue;
      const deps = getDependenciesForStep(candidate, enabledSteps);
      if (deps.includes(cur)) {
        visited.add(candidate);
        result.push(candidate);
        queue.push(candidate);
      }
    }
  }

  return result.sort((a, b) => a - b);
}

export function markFollowingStepsStale(
  session: CaptionSessionV1,
  step: number,
  blockedReason?: string,
  enabledSteps?: CaptionStepNumber[]
): CaptionSessionV1 {
  const changedStep = (step < 1 || step > 7 ? 1 : step) as CaptionStepNumber;
  const next = { ...session, steps: { ...session.steps } };
  const staleSteps = collectDependentSteps(changedStep, enabledSteps);
  for (const staleStep of staleSteps) {
    const k = toStepKey(staleStep);
    next.steps[k] = {
      ...next.steps[k],
      status: 'stale',
      error: undefined,
      metrics: undefined,
      blockedReason: blockedReason || next.steps[k]?.blockedReason,
    };
  }
  return next;
}

export function resolveStepInputsFromSession(session: CaptionSessionV1, step: CaptionStepNumber) {
  const extractedEntries = (session.data.extractedEntries || []) as SubtitleEntry[];
  const translatedEntries = (session.data.translatedEntries || []) as SubtitleEntry[];
  const ttsAudioFiles = session.data.ttsAudioFiles || [];
  const mergedAudioPath = typeof session.artifacts.mergedAudioPath === 'string'
    ? session.artifacts.mergedAudioPath
    : '';
  const translatedSrtPath = typeof session.artifacts.translatedSrtPath === 'string'
    ? session.artifacts.translatedSrtPath
    : '';
  const scaledSrtPath = typeof session.artifacts.scaledSrtPath === 'string'
    ? session.artifacts.scaledSrtPath
    : '';

  return {
    step,
    extractedEntries,
    translatedEntries,
    ttsAudioFiles,
    mergedAudioPath,
    translatedSrtPath,
    scaledSrtPath,
  };
}

export function canRunStep(
  session: CaptionSessionV1,
  step: CaptionStepNumber,
  enabledSteps: CaptionStepNumber[] = []
): { ok: boolean; reason?: string; code?: string; missingDeps: CaptionStepNumber[] } {
  const deps = getDependenciesForStep(step, enabledSteps);
  const enabledSet = new Set<CaptionStepNumber>(enabledSteps);
  const missingDeps: CaptionStepNumber[] = [];

  for (const dep of deps) {
    const depKey = toStepKey(dep);
    const depState = session.steps[depKey];
    const depSuccess = depState?.status === 'success';
    const depWillRun = enabledSet.has(dep) && dep < step;
    if (!depSuccess && !depWillRun) {
      missingDeps.push(dep);
    }
  }

  if (missingDeps.length > 0) {
    const first = missingDeps[0];
    if (step === 7 && first === 3) {
      return { ok: false, code: 'STEP7_MISSING_STEP3_TRANSLATED', reason: 'Chưa chạy Step 3 hoặc chưa có dữ liệu dịch trong session.', missingDeps };
    }
    if (step === 7 && first === 6) {
      return { ok: false, code: 'STEP7_MISSING_STEP6_MERGED_AUDIO', reason: 'Chưa chạy Step 6 hoặc chưa có merged audio trong session.', missingDeps };
    }
    return {
      ok: false,
      code: `STEP${step}_MISSING_DEP_${first}`,
      reason: `Thiếu dữ liệu phụ thuộc Step ${first}.`,
      missingDeps,
    };
  }

  const stepInputs = resolveStepInputsFromSession(session, step);
  if (step === 2 && !enabledSet.has(1) && stepInputs.extractedEntries.length === 0) {
    return { ok: false, code: 'STEP2_MISSING_STEP1_EXTRACTED', reason: 'Chưa có extractedEntries trong session. Hãy chạy Step 1 trước.', missingDeps: [1] };
  }
  if (step === 3 && !enabledSet.has(1) && stepInputs.extractedEntries.length === 0) {
    return { ok: false, code: 'STEP3_MISSING_STEP1_EXTRACTED', reason: 'Chưa có extractedEntries trong session. Hãy chạy Step 1 trước.', missingDeps: [1] };
  }
  if (step === 4 && !enabledSet.has(3) && stepInputs.translatedEntries.length === 0) {
    return { ok: false, code: 'STEP4_MISSING_STEP3_TRANSLATED', reason: 'Chưa có translatedEntries trong session. Hãy chạy Step 3 trước.', missingDeps: [3] };
  }
  if (step === 5 && !enabledSet.has(4) && stepInputs.ttsAudioFiles.length === 0) {
    return { ok: false, code: 'STEP5_MISSING_STEP4_TTS', reason: 'Chưa có ttsAudioFiles trong session. Hãy chạy Step 4 trước.', missingDeps: [4] };
  }
  if (step === 6 && !enabledSet.has(4) && stepInputs.ttsAudioFiles.length === 0) {
    return { ok: false, code: 'STEP6_MISSING_STEP4_TTS', reason: 'Chưa có ttsAudioFiles trong session. Hãy chạy Step 4 trước.', missingDeps: [4] };
  }
  if (step === 7) {
    if (!enabledSet.has(3) && stepInputs.translatedEntries.length === 0) {
      return { ok: false, code: 'STEP7_MISSING_STEP3_TRANSLATED', reason: 'Chưa có translatedEntries trong session. Hãy chạy Step 3 trước.', missingDeps: [3] };
    }
    if (!enabledSet.has(6) && !stepInputs.mergedAudioPath) {
      return { ok: false, code: 'STEP7_MISSING_STEP6_MERGED_AUDIO', reason: 'Chưa có mergedAudioPath trong session. Hãy chạy Step 6 trước.', missingDeps: [6] };
    }
  }

  return { ok: true, missingDeps: [] };
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isSkipMetric(stepState?: CaptionStepState): boolean {
  const metrics = toRecord(stepState?.metrics);
  return metrics.skipped === true || metrics.skipBy === 'session_contract';
}

export function validateStepOutputForSkip(
  session: CaptionSessionV1,
  step: CaptionStepNumber
): { ok: boolean; reason?: string } {
  const data = session.data || {};
  const artifacts = session.artifacts || {};
  const stepState = session.steps?.[toStepKey(step)];

  if (step === 1) {
    const extracted = Array.isArray(data.extractedEntries) ? data.extractedEntries : [];
    if (extracted.length > 0) return { ok: true };
    return { ok: false, reason: 'missing_extracted_entries' };
  }

  if (step === 2) {
    const metrics = toRecord(stepState?.metrics);
    const files = Array.isArray(metrics.files) ? metrics.files : [];
    const partsCount = typeof metrics.partsCount === 'number' ? metrics.partsCount : 0;
    if (partsCount > 0 || files.length > 0) return { ok: true };
    return { ok: false, reason: 'missing_split_metadata' };
  }

  if (step === 3) {
    const translated = Array.isArray(data.translatedEntries) ? data.translatedEntries : [];
    if (translated.length === 0) return { ok: false, reason: 'missing_translated_entries' };
    if (!hasNonEmptyString(data.translatedSrtContent)) return { ok: false, reason: 'missing_translated_srt_content' };
    return { ok: true };
  }

  if (step === 4) {
    const tts = Array.isArray(data.ttsAudioFiles) ? data.ttsAudioFiles : [];
    const valid = tts.some((item: unknown) => {
      const rec = toRecord(item);
      return hasNonEmptyString(rec.path) && typeof rec.startMs === 'number';
    });
    if (!valid) return { ok: false, reason: 'missing_tts_audio_files' };
    return { ok: true };
  }

  if (step === 5) {
    if (isSkipMetric(stepState)) return { ok: true };
    const trimResults = toRecord(data.trimResults);
    if (Object.keys(trimResults).length > 0) return { ok: true };
    return { ok: false, reason: 'missing_trim_results' };
  }

  if (step === 6) {
    const mergeResult = toRecord(data.mergeResult);
    if (mergeResult.success !== true) return { ok: false, reason: 'missing_merge_success' };
    if (!hasNonEmptyString(artifacts.mergedAudioPath)) return { ok: false, reason: 'missing_merged_audio_path' };
    return { ok: true };
  }

  if (step === 7) {
    const renderResult = toRecord(data.renderResult);
    if (renderResult.success !== true) return { ok: false, reason: 'missing_render_success' };
    if (!hasNonEmptyString(artifacts.finalVideoPath)) return { ok: false, reason: 'missing_final_video_path' };
    return { ok: true };
  }

  return { ok: false, reason: 'unknown_step' };
}

export function shouldSkipStep(
  session: CaptionSessionV1,
  step: CaptionStepNumber
): { skip: boolean; reason?: string } {
  // Step 7 (render video) luôn cho phép chạy lại nhiều lần.
  if (step === 7) {
    return { skip: false, reason: 'step7_always_rerender' };
  }
  const stepKey = toStepKey(step);
  const stepState = session.steps[stepKey];
  if (!stepState || stepState.status !== 'success') {
    return { skip: false, reason: 'not_success_yet' };
  }
  if (stepState.status === 'stale') {
    return { skip: false, reason: 'step_stale' };
  }
  const outputCheck = validateStepOutputForSkip(session, step);
  if (!outputCheck.ok) {
    return { skip: false, reason: outputCheck.reason };
  }
  return { skip: true, reason: 'session_output_ready' };
}

export function recordStepSkipped(
  prev: CaptionStepState | undefined,
  reason?: string
): CaptionStepState {
  const oldMetrics = toRecord(prev?.metrics);
  return makeStepSuccess(prev, {
    ...oldMetrics,
    skipped: true,
    skipReason: reason || 'session_output_ready',
    skipAt: nowIso(),
    skipBy: 'session_contract',
  });
}

export function normalizeStepArtifacts(files: CaptionArtifactFile[] = []): CaptionArtifactFile[] {
  const seen = new Set<string>();
  const normalized: CaptionArtifactFile[] = [];

  for (const file of files) {
    if (!file || !hasNonEmptyString(file.path)) continue;
    const role = hasNonEmptyString(file.role) ? file.role.trim() : 'artifact';
    const kind: 'file' | 'dir' = file.kind === 'dir' ? 'dir' : 'file';
    const key = `${role}|${kind}|${file.path.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      role,
      kind,
      path: file.path.trim(),
      note: hasNonEmptyString(file.note) ? file.note.trim() : undefined,
    });
  }

  return normalized;
}

export function setStepArtifacts(
  session: CaptionSessionV1,
  step: CaptionStepNumber,
  files: CaptionArtifactFile[]
): CaptionSessionV1 {
  const stepKey = toStepKey(step);
  const nextFiles = normalizeStepArtifacts(files);
  return {
    ...session,
    data: {
      ...session.data,
      stepArtifacts: {
        ...(session.data.stepArtifacts || {}),
        [stepKey]: nextFiles,
      },
    },
  };
}

export function compactEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function buildProjectSettingsMirror(settings: CaptionProjectSettingsValues): Record<string, unknown> {
  return {
    step2Split: {
      splitByLines: settings.splitByLines,
      linesPerFile: settings.linesPerFile,
      numberOfParts: settings.numberOfParts,
    },
    step3Translate: {
      geminiModel: settings.geminiModel,
      translateMethod: settings.translateMethod,
    },
    step4Tts: {
      voice: settings.voice,
      rate: settings.rate,
      volume: settings.volume,
      srtSpeed: settings.srtSpeed,
      autoFitAudio: settings.autoFitAudio,
    },
    step7Render: {
      style: settings.style,
      renderMode: settings.renderMode,
      renderResolution: settings.renderResolution,
      renderContainer: settings.renderContainer,
      hardwareAcceleration: settings.hardwareAcceleration,
      renderAudioSpeed: settings.renderAudioSpeed,
      videoVolume: settings.videoVolume,
      audioVolume: settings.audioVolume,
      thumbnailFontName: settings.thumbnailFontName,
      thumbnailFontSize: settings.thumbnailFontSize,
      thumbnailTextPrimaryFontName: settings.thumbnailTextPrimaryFontName,
      thumbnailTextPrimaryFontSize: settings.thumbnailTextPrimaryFontSize,
      thumbnailTextPrimaryColor: settings.thumbnailTextPrimaryColor,
      thumbnailTextSecondaryFontName: settings.thumbnailTextSecondaryFontName,
      thumbnailTextSecondaryFontSize: settings.thumbnailTextSecondaryFontSize,
      thumbnailTextSecondaryColor: settings.thumbnailTextSecondaryColor,
      thumbnailLineHeightRatio: settings.thumbnailLineHeightRatio,
      thumbnailTextSecondary: settings.thumbnailTextSecondary,
      thumbnailTextPrimaryPosition: settings.thumbnailTextPrimaryPosition,
      thumbnailTextSecondaryPosition: settings.thumbnailTextSecondaryPosition,
      blackoutTop: settings.blackoutTop,
      coverMode: settings.coverMode,
      coverQuad: settings.coverQuad,
      audioSpeed: settings.audioSpeed,
      subtitlePosition: settings.subtitlePosition,
      thumbnailFrameTimeSec: settings.thumbnailFrameTimeSec,
      thumbnailDurationSec: settings.thumbnailDurationSec,
      portraitForegroundCropPercent: settings.portraitForegroundCropPercent,
      layoutProfiles: settings.layoutProfiles,
    },
  };
}

export async function syncSessionWithProjectSettings(
  sessionPath: string,
  payload: {
    projectSettings: CaptionProjectSettingsValues;
    revision: number;
    updatedAt: string;
    source?: 'project_default' | 'session_runtime';
  },
  fallback?: { projectId?: string | null; inputType?: CaptionInputType; sourcePath?: string; folderPath?: string }
): Promise<void> {
  await updateCaptionSession(
    sessionPath,
    (session) => ({
      ...session,
      settings: {
        ...session.settings,
        ...buildProjectSettingsMirror(payload.projectSettings),
      },
      effectiveSettingsRevision: payload.revision,
      effectiveSettingsUpdatedAt: payload.updatedAt,
      effectiveSettingsSource: payload.source || 'project_default',
      syncState: 'synced',
    }),
    fallback
  );
}

export function scheduleSessionSettingsRetry(
  sessionPath: string,
  task: () => Promise<void>,
  attempt = 1
) {
  if (attempt > 3) {
    return;
  }
  const oldTimer = sessionSyncRetryTimers.get(sessionPath);
  if (oldTimer != null) {
    window.clearTimeout(oldTimer);
  }
  const delay = attempt * 1200;
  const timer = window.setTimeout(async () => {
    try {
      await task();
      sessionSyncRetryTimers.delete(sessionPath);
    } catch {
      scheduleSessionSettingsRetry(sessionPath, task, attempt + 1);
    }
  }, delay);
  sessionSyncRetryTimers.set(sessionPath, timer);
}
