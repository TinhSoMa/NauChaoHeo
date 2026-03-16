import { ipcMain, IpcMainInvokeEvent, dialog, WebContents } from 'electron';
import * as fs from 'fs/promises';
import * as StoryService from '../services/story';
import { getQueueRuntimeOrCreate } from '../services/shared/universalRotationQueue';
import type {
  QueueEventRecord,
  QueueJobRuntimeSnapshot
} from '../services/shared/universalRotationQueue/rotationTypes';
import {
  STORY_IPC_CHANNELS,
  StoryCancelGeminiWebQueueBatchPayload,
  StoryCancelGeminiWebQueueBatchResult,
  StoryGeminiWebQueueCapacity,
  StoryGeminiWebQueueJobView,
  StoryGeminiWebQueueSnapshot,
  StoryGeminiWebQueueStreamEvent,
  StoryTranslateGeminiWebQueuePayload,
  StoryTranslateGeminiWebQueueResult,
  CreateEbookPayload
} from '../../shared/types';

const STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY = 'story.translation.geminiWeb';
const STORY_GEMINI_WEB_QUEUE_POOL_ID = 'story-geminiweb-accounts';
const STORY_GEMINI_WEB_QUEUE_FEATURE = 'story.translate.geminiWeb';
const STORY_GEMINI_WEB_QUEUE_SERVICE_ID = 'story-translator-ui';

interface StoryQueueStreamSession {
  queue: ReturnType<typeof getQueueRuntimeOrCreate>;
  unsubscribe: () => void;
  detached: boolean;
}

const storyQueueSessions = new Map<number, StoryQueueStreamSession>();

function stopStoryQueueSession(webContentsId: number): void {
  const session = storyQueueSessions.get(webContentsId);
  if (!session) return;
  session.detached = true;
  session.unsubscribe();
  storyQueueSessions.delete(webContentsId);
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function toStoryStateFromEventType(
  eventType: StoryGeminiWebQueueStreamEvent['eventType']
): StoryGeminiWebQueueStreamEvent['state'] {
  if (eventType === 'job_started') return 'running';
  if (eventType === 'job_succeeded') return 'succeeded';
  if (eventType === 'job_failed') return 'failed';
  if (eventType === 'job_cancelled') return 'cancelled';
  return 'queued';
}

function isRelevantStoryQueueRecord(record: QueueEventRecord): boolean {
  const event = record.event;
  return (
    event.poolId === STORY_GEMINI_WEB_QUEUE_POOL_ID &&
    event.feature === STORY_GEMINI_WEB_QUEUE_FEATURE &&
    event.serviceId === STORY_GEMINI_WEB_QUEUE_SERVICE_ID
  );
}

function buildResourceLabelById(snapshot: ReturnType<ReturnType<typeof getQueueRuntimeOrCreate>['getInspectorSnapshot']>): Map<string, string> {
  const labels = new Map<string, string>();
  const resources = snapshot.scheduler.resources ?? [];
  for (const resource of resources) {
    if (resource.poolId !== STORY_GEMINI_WEB_QUEUE_POOL_ID) {
      continue;
    }
    labels.set(resource.resourceId, resource.label);
  }
  return labels;
}

function toStoryQueueSnapshotJob(
  job: QueueJobRuntimeSnapshot,
  resourceLabels: Map<string, string>
): StoryGeminiWebQueueJobView {
  const metadata = job.metadata ?? {};
  const resourceId = job.assignedResourceId;
  return {
    jobId: job.jobId,
    chapterId: toOptionalString(metadata.chapterId),
    chapterTitle: toOptionalString(metadata.chapterTitle),
    batchId: toOptionalString(metadata.batchId),
    workerId: toOptionalNumber(metadata.workerId),
    state: job.state === 'running' ? 'running' : 'queued',
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    resourceId,
    resourceLabel: resourceId ? resourceLabels.get(resourceId) : undefined,
    error: job.lastError
  };
}

function getStoryQueueSnapshot(): StoryGeminiWebQueueSnapshot {
  StoryService.StoryService.getStoryGeminiWebQueueCapacity();
  const queue = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
  const snapshot = queue.getInspectorSnapshot({
    poolId: STORY_GEMINI_WEB_QUEUE_POOL_ID,
    serviceId: STORY_GEMINI_WEB_QUEUE_SERVICE_ID,
    state: 'all',
    limit: 500
  });
  const resourceLabels = buildResourceLabelById(snapshot);
  const jobs = snapshot.jobs.map((job) => toStoryQueueSnapshotJob(job as QueueJobRuntimeSnapshot, resourceLabels));
  return {
    timestamp: snapshot.timestamp,
    jobs
  };
}

function mapStoryQueueEvent(record: QueueEventRecord): StoryGeminiWebQueueStreamEvent | null {
  if (!isRelevantStoryQueueRecord(record)) {
    return null;
  }

  const event = record.event;
  const metadata = event.metadata ?? {};
  const eventType = event.type as StoryGeminiWebQueueStreamEvent['eventType'];
  if (
    eventType !== 'job_queued' &&
    eventType !== 'job_started' &&
    eventType !== 'job_retry_scheduled' &&
    eventType !== 'job_succeeded' &&
    eventType !== 'job_failed' &&
    eventType !== 'job_cancelled'
  ) {
    return null;
  }

  return {
    seq: record.seq,
    timestamp: record.timestamp,
    eventType,
    state: toStoryStateFromEventType(eventType),
    jobId: event.jobId || '',
    chapterId: toOptionalString(metadata.chapterId),
    chapterTitle: toOptionalString(metadata.chapterTitle),
    batchId: toOptionalString(metadata.batchId),
    workerId: toOptionalNumber(metadata.workerId),
    queuedAt: eventType === 'job_queued' ? event.timestamp : undefined,
    startedAt: eventType === 'job_started' ? event.timestamp : undefined,
    endedAt:
      eventType === 'job_succeeded' || eventType === 'job_failed' || eventType === 'job_cancelled'
        ? event.timestamp
        : undefined,
    resourceId: event.resourceId,
    resourceLabel: toOptionalString(metadata.resourceLabel),
    error: event.error,
    errorCode: event.errorCode
  };
}

function startStoryQueueStream(webContents: WebContents): void {
  stopStoryQueueSession(webContents.id);
  StoryService.StoryService.getStoryGeminiWebQueueCapacity();
  const queue = getQueueRuntimeOrCreate(STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY);
  const unsubscribe = queue.subscribeEventRecords((record) => {
    if (webContents.isDestroyed()) {
      stopStoryQueueSession(webContents.id);
      return;
    }
    const mapped = mapStoryQueueEvent(record);
    if (!mapped) {
      return;
    }
    webContents.send(STORY_IPC_CHANNELS.GEMINI_WEB_QUEUE_STREAM_EVENT, mapped);
  });

  storyQueueSessions.set(webContents.id, {
    queue,
    unsubscribe,
    detached: false
  });

  webContents.send(STORY_IPC_CHANNELS.GEMINI_WEB_QUEUE_STREAM_SNAPSHOT, getStoryQueueSnapshot());
  webContents.once('destroyed', () => {
    stopStoryQueueSession(webContents.id);
  });
}

export function registerStoryHandlers(): void {
  console.log('[StoryHandlers] Đăng ký handlers...');

  ipcMain.removeHandler('dialog:showSaveDialog');
  ipcMain.handle(
    'dialog:showSaveDialog',
    async (_event: IpcMainInvokeEvent, options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
      const result = await dialog.showSaveDialog({
        title: options?.title,
        defaultPath: options?.defaultPath,
        filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
      });

      return result;
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.PARSE,
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      console.log(`[StoryHandlers] Parse story: ${filePath}`);
      return await StoryService.parseStoryFile(filePath);
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.PREPARE_PROMPT,
    async (_event: IpcMainInvokeEvent, { chapterContent, sourceLang, targetLang }) => {
       console.log(`[StoryHandlers] Prepare prompt logic: ${sourceLang} -> ${targetLang}`);
       return await StoryService.StoryService.prepareTranslationPrompt(chapterContent, sourceLang, targetLang);
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT,
    async (_event: IpcMainInvokeEvent, { chapterContent, sourceLang, targetLang }) => {
       console.log(`[StoryHandlers] Prepare summary prompt: ${sourceLang} -> ${targetLang}`);
       return await StoryService.StoryService.prepareSummaryPrompt(chapterContent, sourceLang, targetLang);
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.SAVE_PROMPT,
    async (_event: IpcMainInvokeEvent, content: string) => {
      console.log('[StoryHandlers] Save prompt to file...');
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Lưu Prompt',
        defaultPath: 'prompt.txt',
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      });

      if (canceled || !filePath) {
        return { success: false, error: 'User canceled' };
      }

      try {
        await fs.writeFile(filePath, content, 'utf-8');
        return { success: true, filePath };
      } catch (error) {
        console.error('Error saving file:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.TRANSLATE_CHAPTER,
    async (_event: IpcMainInvokeEvent, payload: any) => {
      // console.log('[StoryHandlers] Translate chapter params:', payload);
      // Support legacy call (just prompt) or new call (options object)
      // If payload is the prompt directly (array or object check), treat as legacy API method.
      // But typically we should standardize.
      // Let's assume payload is the Options object if it has 'prompt' key.
      
      let options = payload;
      if (!payload.prompt && (Array.isArray(payload) || payload.role)) {
          // It's just the prompt structure
          options = { prompt: payload, method: 'API' };
      }
      
      if (options && options.metadata) {
          const { chapterTitle, tokenInfo, chapterId } = options.metadata;
          console.log(`[StoryHandlers] 📖 Translating: ${chapterTitle || chapterId} (Token: ${tokenInfo || 'Unknown'})`);
      }
      
      options.onRetry = (attempt: number, maxRetries: number) => {
        if (options.metadata?.chapterId) {
            _event.sender.send(STORY_IPC_CHANNELS.TRANSLATION_PROGRESS, {
                chapterId: options.metadata.chapterId,
                attempt,
                maxRetries
            });
        }
      };
      
      return await StoryService.StoryService.translateChapter(options);
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_GEMINI_WEB_QUEUE,
    async (
      _event: IpcMainInvokeEvent,
      payload: StoryTranslateGeminiWebQueuePayload
    ): Promise<StoryTranslateGeminiWebQueueResult> => {
      return await StoryService.StoryService.translateChapterWithGeminiWebQueue(payload);
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.IS_GEMINI_WEB_QUEUE_ENABLED,
    async (): Promise<{ success: boolean; data: boolean }> => {
      return {
        success: true,
        data: StoryService.StoryService.isStoryGeminiWebQueueEnabled()
      };
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.GET_GEMINI_WEB_QUEUE_CAPACITY,
    async (): Promise<{ success: boolean; data: StoryGeminiWebQueueCapacity }> => {
      return {
        success: true,
        data: StoryService.StoryService.getStoryGeminiWebQueueCapacity()
      };
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.GET_GEMINI_WEB_QUEUE_SNAPSHOT,
    async (): Promise<{ success: boolean; data: StoryGeminiWebQueueSnapshot }> => {
      return {
        success: true,
        data: getStoryQueueSnapshot()
      };
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.START_GEMINI_WEB_QUEUE_STREAM,
    async (event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
      startStoryQueueStream(event.sender);
      return { success: true };
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.STOP_GEMINI_WEB_QUEUE_STREAM,
    async (event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
      stopStoryQueueSession(event.sender.id);
      return { success: true };
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.CANCEL_GEMINI_WEB_QUEUE_BATCH,
    async (
      _event: IpcMainInvokeEvent,
      payload: StoryCancelGeminiWebQueueBatchPayload
    ): Promise<StoryCancelGeminiWebQueueBatchResult> => {
      return StoryService.StoryService.cancelStoryGeminiWebQueueBatch(payload?.batchId || '');
    }
  );

  ipcMain.handle(
    STORY_IPC_CHANNELS.CREATE_EBOOK,
    async (_event: IpcMainInvokeEvent, options: CreateEbookPayload) => {
        console.log('[StoryHandlers] Create ebook:', options.title);
        return await StoryService.StoryService.createEbook(options);
    }
  );

  console.log('[StoryHandlers] Đã đăng ký handlers thành công');
}
