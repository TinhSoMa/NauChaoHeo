import { app } from 'electron';
import * as path from 'path';
import type { GrokUiHealthSnapshot } from '../../../shared/types/grokUi';
import { AppSettingsService } from '../appSettings';
import { GrokUiPythonBridge } from './pythonBridge';

interface GrokUiAskRequest {
  prompt: string;
  timeoutMs?: number;
}

interface GrokUiAskResult {
  success: boolean;
  text?: string;
  error?: string;
}

interface WorkerHealthPayload {
  pythonVersion?: string;
  modules?: Record<string, boolean>;
}

class GrokUiService {
  private readonly bridge = new GrokUiPythonBridge();

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

  async ask(request: GrokUiAskRequest): Promise<GrokUiAskResult> {
    const prompt = (request.prompt || '').trim();
    if (!prompt) {
      return { success: false, error: 'Prompt rỗng.' };
    }

    const settings = AppSettingsService.getAll();
    const anonymous = settings.grokUiAnonymous === true;
    const profileDir = anonymous
      ? ''
      : (settings.grokUiProfileDir || path.join(app.getPath('userData'), 'grok3_profile'));
    const profileName = anonymous ? '' : (settings.grokUiProfileName || 'Default');
    const timeoutMs = Number.isFinite(request.timeoutMs)
      ? Math.max(10_000, Math.floor(request.timeoutMs as number))
      : settings.grokUiTimeoutMs;

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
      return { success: false, error: response.error || 'Grok UI request failed' };
    }

    const text = response.data?.text?.toString() || '';
    if (!text.trim()) {
      return { success: false, error: 'Grok UI trả về rỗng.' };
    }

    return { success: true, text };
  }

  async shutdown(): Promise<void> {
    await this.bridge.shutdown();
  }
}

let runtime: GrokUiService | null = null;

export function getGrokUiRuntime(): GrokUiService {
  if (!runtime) {
    runtime = new GrokUiService();
  }
  return runtime;
}
