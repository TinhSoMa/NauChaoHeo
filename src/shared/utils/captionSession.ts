import { CaptionSessionV1, CaptionStepState } from '../types/caption';

export function nowIso(): string {
  return new Date().toISOString();
}

export function getCaptionOutputDirFromInput(inputType: 'srt' | 'draft', inputPath: string): string {
  if (!inputPath) return '';
  const sep = inputPath.includes('\\') ? '\\' : '/';
  const prefix = inputPath.startsWith('\\\\')
    ? '\\\\'
    : (inputPath.startsWith('/') && sep === '/' ? '/' : '');
  const normalized = prefix ? inputPath.slice(prefix.length) : inputPath;
  const segments = normalized.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0) {
    return '';
  }

  const joinPath = (parts: string[]): string => (prefix ? prefix : '') + parts.join(sep);

  // draft/srt mode đều đang chạy theo danh sách folder đầu vào.
  // Vì vậy caption_output phải nằm bên trong chính folder input đó.
  if (inputType === 'draft' || inputType === 'srt') {
    const lastSegment = segments[segments.length - 1]?.toLowerCase() || '';
    if (lastSegment === 'caption_output') {
      return joinPath(segments);
    }
    return joinPath([...segments, 'caption_output']);
  }

  let captionIndex = -1;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i].toLowerCase() === 'caption_output') {
      captionIndex = i;
      break;
    }
  }
  if (captionIndex >= 0) {
    const resolved = joinPath(segments.slice(0, captionIndex + 1));
    if (typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production') {
      console.log('[CaptionSession] Resolved caption_output from SRT path:', {
        inputPath,
        outputDir: resolved,
      });
    }
    return resolved;
  }

  return joinPath([...segments.slice(0, -1), 'caption_output']);
}

export function getCaptionSessionPathFromInput(inputType: 'srt' | 'draft', inputPath: string): string {
  const outputDir = getCaptionOutputDirFromInput(inputType, inputPath);
  return outputDir ? `${outputDir}/caption_session.json` : '';
}

export function getCaptionSessionPathFromOutputDir(outputDir: string): string {
  if (!outputDir) return '';
  return `${outputDir}/caption_session.json`;
}

function createIdleStepState(): CaptionStepState {
  return { status: 'idle' };
}

export function createDefaultCaptionSession(input?: {
  projectId?: string | null;
  inputType?: 'srt' | 'draft';
  sourcePath?: string;
  folderPath?: string;
}): CaptionSessionV1 {
  const now = nowIso();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    projectContext: {
      projectId: input?.projectId ?? null,
      inputType: input?.inputType,
      sourcePath: input?.sourcePath,
      folderPath: input?.folderPath,
    },
    settings: {},
    steps: {
      step1: createIdleStepState(),
      step2: createIdleStepState(),
      step3: createIdleStepState(),
      step4: createIdleStepState(),
      step5: createIdleStepState(),
      step6: createIdleStepState(),
      step7: createIdleStepState(),
    },
    data: {},
    artifacts: {},
    timing: {},
    effectiveSettingsRevision: 0,
    effectiveSettingsUpdatedAt: now,
    effectiveSettingsSource: 'project_default',
    syncState: 'synced',
    runtime: {
      runState: 'idle',
    },
  };
}
