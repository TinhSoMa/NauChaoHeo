import { CaptionSessionV1, CaptionStepState } from '../types/caption';

export function nowIso(): string {
  return new Date().toISOString();
}

export function getCaptionOutputDirFromInput(inputType: 'srt' | 'draft', inputPath: string): string {
  if (!inputPath) return '';
  if (inputType === 'draft') {
    return `${inputPath}/caption_output`;
  }
  return inputPath.replace(/[^/\\]+$/, 'caption_output');
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
