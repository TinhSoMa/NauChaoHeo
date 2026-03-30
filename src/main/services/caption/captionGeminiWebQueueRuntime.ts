import { getDatabase } from '../../database/schema';
import {
  AppSettingsService,
  GEMINI_MIN_SEND_INTERVAL_DEFAULT_MS,
  normalizeGeminiMinSendIntervalMs,
  normalizeGeminiMaxSendIntervalMs,
  normalizeGeminiSendIntervalMode,
} from '../appSettings';
import {
  getQueueRuntimeOrCreate,
  type UniversalRotationQueueService
} from '../shared/universalRotationQueue';

export const CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY = 'caption.translation.geminiWeb';
export const CAPTION_GEMINI_WEB_QUEUE_POOL_ID = 'caption-geminiweb-accounts';
export const CAPTION_GEMINI_WEB_QUEUE_FEATURE = 'caption.translate.geminiWeb';
export const CAPTION_GEMINI_WEB_QUEUE_SERVICE_ID = 'caption-step3';
export const CAPTION_STEP3_QUEUE_GAP_MS = GEMINI_MIN_SEND_INTERVAL_DEFAULT_MS;

interface GeminiWebQueueAccountRow {
  id: string;
  name: string;
  is_active: number;
  secure_1psid: string | null;
  secure_1psidts: string | null;
}

export interface CaptionGeminiWebQueueRuntimeContext {
  queue: UniversalRotationQueueService;
  resourceLabelById: Map<string, string>;
  queueGapMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  intervalMode: 'fixed' | 'random';
}

export function getCaptionStep3QueueGapMs(): number {
  const settings = AppSettingsService.getAll();
  return normalizeGeminiMinSendIntervalMs(settings.geminiMinSendIntervalMs);
}

export function ensureCaptionGeminiWebQueueRuntime(): CaptionGeminiWebQueueRuntimeContext {
  const queue = getQueueRuntimeOrCreate(CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY);
  const settings = AppSettingsService.getAll();
  const minIntervalMs = normalizeGeminiMinSendIntervalMs(settings.geminiMinSendIntervalMs);
  const maxIntervalMs = normalizeGeminiMaxSendIntervalMs(settings.geminiMaxSendIntervalMs, minIntervalMs);
  const intervalMode = normalizeGeminiSendIntervalMode(settings.geminiSendIntervalMode);
  const queueGapMs = minIntervalMs;
  queue.registerPool({
    poolId: CAPTION_GEMINI_WEB_QUEUE_POOL_ID,
    label: 'Caption GeminiWeb Accounts',
    selector: 'round_robin',
    dispatchSpacingMs: queueGapMs,
    defaultCooldownMinMs: 0,
    defaultCooldownMaxMs: 0
  });

  const db = getDatabase();
  const rows = db
    .prepare(
      `
        SELECT
          id,
          name,
          is_active,
          "__Secure-1PSID" AS secure_1psid,
          "__Secure-1PSIDTS" AS secure_1psidts
        FROM gemini_chat_config
        ORDER BY updated_at DESC
      `
    )
    .all() as GeminiWebQueueAccountRow[];

  const eligibleResourceIds = new Set<string>();
  const resourceLabelById = new Map<string, string>();

  for (const row of rows) {
    const isActive = row.is_active === 1;
    const hasSecureCookies = !!row.secure_1psid?.trim() && !!row.secure_1psidts?.trim();
    const enabled = isActive && hasSecureCookies;
    const label = row.name?.trim() || row.id;

    queue.upsertResource({
      poolId: CAPTION_GEMINI_WEB_QUEUE_POOL_ID,
      resourceId: row.id,
      label,
      capabilities: ['caption_translate', 'gemini_webapi'],
      enabled,
      maxConcurrency: 1,
      cooldownMinMs: intervalMode === 'random' ? minIntervalMs : 0,
      cooldownMaxMs: intervalMode === 'random' ? maxIntervalMs : 0,
      metadata: {
        accountName: label
      }
    });

    resourceLabelById.set(row.id, label);
    if (enabled) {
      eligibleResourceIds.add(row.id);
    }
  }

  const snapshot = queue.getSnapshot();
  const existingResourceIds = snapshot.resources
    .filter((resource) => resource.poolId === CAPTION_GEMINI_WEB_QUEUE_POOL_ID)
    .map((resource) => resource.resourceId);

  for (const resourceId of existingResourceIds) {
    if (!eligibleResourceIds.has(resourceId)) {
      queue.setResourceEnabled(CAPTION_GEMINI_WEB_QUEUE_POOL_ID, resourceId, false);
    }
  }

  return {
    queue,
    resourceLabelById,
    queueGapMs,
    minIntervalMs,
    maxIntervalMs,
    intervalMode,
  };
}
