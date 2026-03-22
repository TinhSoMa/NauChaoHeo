import { app } from 'electron';
import * as path from 'path';
import type {
  GrokUiHealthSnapshot,
  GrokUiProfileConfig,
  GrokUiProfileStatus,
  GrokUiProfileStatusEntry,
} from '../../../shared/types/grokUi';
import { AppSettingsService } from '../appSettings';
import { GrokUiPythonBridge } from './pythonBridge';
import { GrokUiProfileDatabase } from '../../database/grokUiProfileDatabase';

interface GrokUiAskRequest {
  prompt: string;
  timeoutMs?: number;
}

interface GrokUiCreateProfileRequest {
  profileDir?: string | null;
  profileName?: string | null;
  allowExisting?: boolean;
}

interface GrokUiCreateProfileResult {
  success: boolean;
  profileDir?: string;
  profileName?: string;
  profilePath?: string;
  error?: string;
}

interface GrokUiAskResult {
  success: boolean;
  text?: string;
  error?: string;
  errorCode?: string;
}

interface WorkerHealthPayload {
  pythonVersion?: string;
  modules?: Record<string, boolean>;
}

const DEFAULT_PROFILE_NAME = 'Default';

function buildLegacyProfile(settings: ReturnType<typeof AppSettingsService.getAll>): GrokUiProfileConfig {
  const anonymous = settings.grokUiAnonymous === true;
  return {
    id: 'default',
    profileDir: anonymous ? null : (settings.grokUiProfileDir || path.join(app.getPath('userData'), 'grok3_profile')),
    profileName: anonymous ? null : (settings.grokUiProfileName || DEFAULT_PROFILE_NAME),
    anonymous,
    enabled: true,
  };
}

function resolveProfiles(settings: ReturnType<typeof AppSettingsService.getAll>): GrokUiProfileConfig[] {
  const profiles = GrokUiProfileDatabase.getAll();
  if (profiles.length > 0) {
    return profiles;
  }
  return [buildLegacyProfile(settings)];
}

function normalizeErrorMessage(error: unknown): string {
  if (!error) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function parseErrorCode(error: unknown): { errorCode?: string; errorMessage?: string } {
  if (!error) {
    return {};
  }
  if (typeof error === 'string') {
    const lowered = error.toLowerCase();
    const errorCode = (
      lowered.includes('rate_limited')
      || lowered.includes('message limit reached')
      || lowered.includes('heavy usage')
      || lowered.includes('too many requests')
      || lowered.includes('rate limit')
      || lowered.includes('đã đạt giới hạn')
      || lowered.includes('vui lòng nâng cấp')
      || lowered.includes('vui lòng thử lại')
      || lowered.includes('quá tải')
      || lowered.includes('giới hạn')
    ) ? 'rate_limited' : undefined;
    return { errorCode, errorMessage: error };
  }
  if (typeof error === 'object') {
    const payload = error as Record<string, unknown>;
    const errorCode = typeof payload.error_code === 'string'
      ? payload.error_code
      : (typeof payload.errorCode === 'string' ? payload.errorCode : undefined);
    const errorMessage = typeof payload.error === 'string'
      ? payload.error
      : normalizeErrorMessage(error);
    return { errorCode, errorMessage };
  }
  return { errorMessage: String(error) };
}

class GrokUiService {
  private readonly bridge = new GrokUiPythonBridge();
  private readonly profileStatuses = new Map<string, GrokUiProfileStatus>();
  private rotationIndex = 0;

  private syncProfileStatuses(profiles: GrokUiProfileConfig[]): void {
    const keep = new Set(profiles.map((profile) => profile.id));
    for (const key of Array.from(this.profileStatuses.keys())) {
      if (!keep.has(key)) {
        this.profileStatuses.delete(key);
      }
    }
    for (const profile of profiles) {
      if (!this.profileStatuses.has(profile.id)) {
        this.profileStatuses.set(profile.id, { state: 'ok', updatedAt: Date.now() });
      }
    }
  }

  private markProfileStatus(
    profileId: string,
    state: GrokUiProfileStatus['state'],
    errorCode?: string,
    error?: string
  ): void {
    this.profileStatuses.set(profileId, {
      state,
      lastErrorCode: errorCode,
      lastError: error,
      updatedAt: Date.now(),
    });
  }

  async getProfileStatuses(): Promise<GrokUiProfileStatusEntry[]> {
    const settings = AppSettingsService.getAll();
    const profiles = resolveProfiles(settings);
    this.syncProfileStatuses(profiles);
    return profiles.map((profile) => ({
      profile,
      status: this.profileStatuses.get(profile.id) || { state: 'ok', updatedAt: Date.now() },
    }));
  }

  async resetProfileStatuses(): Promise<void> {
    const settings = AppSettingsService.getAll();
    const profiles = resolveProfiles(settings);
    this.profileStatuses.clear();
    this.rotationIndex = 0;
    this.syncProfileStatuses(profiles);
  }

  async getHealth(): Promise<GrokUiHealthSnapshot> {
    const checkedAt = Date.now();
    try {
      const response = await this.bridge.request<WorkerHealthPayload>('health', {}, 30000);
      if (!response.success) {
        return {
          checkedAt,
          pythonOk: false,
          modulesOk: false,
          error: response.error || 'Worker health check failed',
        };
      }

      const runtime = this.bridge.getRuntimeInfo();
      return {
        checkedAt,
        pythonOk: true,
        modulesOk: Object.values(response.data?.modules || {}).every(Boolean),
        runtimeMode: runtime?.runtime?.mode,
        pythonPath: runtime?.runtime?.pythonPath,
        pythonVersion: response.data?.pythonVersion,
        modules: response.data?.modules,
      };
    } catch (error) {
      return {
        checkedAt,
        pythonOk: false,
        modulesOk: false,
        error: String(error),
      };
    }
  }

  async createProfile(request: GrokUiCreateProfileRequest): Promise<GrokUiCreateProfileResult> {
    const response = await this.bridge.request<{ profileDir?: string; profileName?: string; profilePath?: string }>(
      'create_profile',
      {
        profileDir: request.profileDir ?? undefined,
        profileName: request.profileName ?? undefined,
        allowExisting: request.allowExisting !== false,
      },
      30000
    );

    if (!response.success) {
      const { errorMessage } = parseErrorCode(response.error);
      return {
        success: false,
        error: errorMessage || normalizeErrorMessage(response.error) || 'CREATE_PROFILE_FAILED',
      };
    }

    return {
      success: true,
      profileDir: response.data?.profileDir,
      profileName: response.data?.profileName,
      profilePath: response.data?.profilePath,
    };
  }

  async ask(request: GrokUiAskRequest): Promise<GrokUiAskResult> {
    return this.askWithFailover(request);
  }

  private async askWithFailover(request: GrokUiAskRequest): Promise<GrokUiAskResult> {
    const prompt = (request.prompt || '').trim();
    if (!prompt) {
      return { success: false, error: 'Prompt rỗng.' };
    }

    const settings = AppSettingsService.getAll();
    const profiles = resolveProfiles(settings).filter((profile) => profile.enabled === true);
    if (profiles.length === 0) {
      return { success: false, error: 'Không có profile Grok UI khả dụng.' };
    }
    this.syncProfileStatuses(profiles);
    const eligibleProfiles = profiles.filter((profile) => {
      const status = this.profileStatuses.get(profile.id);
      return status?.state !== 'rate_limited';
    });
    if (eligibleProfiles.length === 0) {
      return { success: false, error: 'RATE_LIMIT_ALL_PROFILES', errorCode: 'rate_limited' };
    }
    const timeoutMs = Number.isFinite(request.timeoutMs)
      ? Math.max(10_000, Math.floor(request.timeoutMs as number))
      : settings.grokUiTimeoutMs;
    const startIndex = this.rotationIndex % eligibleProfiles.length;

    for (let offset = 0; offset < eligibleProfiles.length; offset++) {
      const idx = (startIndex + offset) % eligibleProfiles.length;
      const profile = eligibleProfiles[idx];
      this.rotationIndex = (idx + 1) % eligibleProfiles.length;

      const anonymous = profile.anonymous === true;
      const profileDir = anonymous
        ? ''
        : (profile.profileDir ?? '');
      const profileName = anonymous ? '' : (profile.profileName || DEFAULT_PROFILE_NAME);

      const response = await this.bridge.request<{ text?: string }>(
        'ask',
        {
          prompt,
          timeoutMs,
          profileDir,
          profileName,
          anonymous,
        },
        Math.max(10_000, Math.floor(timeoutMs) + 5000),
      );

      if (!response.success) {
        const { errorCode, errorMessage } = parseErrorCode(response.error);
        const fallbackMessage = normalizeErrorMessage(response.error) || 'Grok UI request failed';
        const message = errorMessage || fallbackMessage;
        if (errorCode === 'rate_limited') {
          let profileHint = '';
          let modeHint = '';
          if (response.error && typeof response.error === 'object') {
            const payload = response.error as Record<string, unknown>;
            if (typeof payload.profile === 'string') {
              profileHint = payload.profile;
            }
            if (typeof payload.mode === 'string') {
              modeHint = payload.mode;
            }
          }
          console.warn(
            `[GrokUiService] Rate limited${profileHint ? ` (profile=${profileHint})` : ''}${modeHint ? ` (mode=${modeHint})` : ''}: ${message}`
          );
          this.markProfileStatus(profile.id, 'rate_limited', errorCode, message);
          continue;
        }
        this.markProfileStatus(profile.id, 'error', errorCode, message);
        return { success: false, error: message, errorCode };
      }

      const text = response.data?.text?.toString() || '';
      if (!text.trim()) {
        this.markProfileStatus(profile.id, 'error', 'empty_response', 'Grok UI trả về rỗng.');
        return { success: false, error: 'Grok UI trả về rỗng.', errorCode: 'empty_response' };
      }

      this.markProfileStatus(profile.id, 'ok');
      return { success: true, text };
    }

    return { success: false, error: 'RATE_LIMIT_ALL_PROFILES', errorCode: 'rate_limited' };
  }

  async shutdown(options?: { hard?: boolean }): Promise<void> {
    await this.bridge.shutdown(options);
  }
}

let runtime: GrokUiService | null = null;

export function getGrokUiRuntime(): GrokUiService {
  if (!runtime) {
    runtime = new GrokUiService();
  }
  return runtime;
}
