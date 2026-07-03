import { AppSettingsService, getApiRequestTimeoutMs } from '../appSettings.js';
import { makeRequestWithProxy } from '../apiClient.js';
import { DeepSeekDatabase } from '../../database/deepseekDatabase.js';
import type { DeepSeekConfig, DeepSeekModelInfo } from '../../../shared/types/deepseek';
import { DEEPSEEK_API_BASE, DEEPSEEK_DEFAULT_MODEL } from '../../../shared/types/deepseek';
import * as fs from 'fs';
import * as path from 'path';

export async function callDeepSeekChat(
  prompt: string,
  options?: {
    systemPrompt?: string;
    model?: string;
    signal?: AbortSignal;
    debugSaveDir?: string;
    batchIndex?: number;
    saveCacheDebugFile?: boolean;
  }
): Promise<{ success: true; data: string } | { success: false; error: string }> {
  try {
    const config = getConfig();
    if (!config.apiKey) {
      return { success: false, error: 'DEEPSEEK_NO_API_KEY' };
    }

    const url = `${DEEPSEEK_API_BASE}/chat/completions`;
    const messages = options?.systemPrompt
      ? [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: prompt },
        ]
      : [
          { role: 'user', content: prompt },
        ];

    const body = {
      model: options?.model || config.defaultModel,
      messages,
      stream: false,
    };

    const result = await makeRequestWithProxy(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      timeout: getApiRequestTimeoutMs(),
      signal: options?.signal,
      useProxy: false,
    });

    if (!result.success) {
      return { success: false, error: result.error || 'DeepSeek API error' };
    }

    const json = result.data;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { success: false, error: 'DeepSeek: unexpected response format' };
    }

    const usage = json?.usage;
    const cacheHitTokens = usage?.prompt_cache_hit_tokens;
    const cacheMissTokens = usage?.prompt_cache_miss_tokens;
    if (typeof cacheHitTokens === 'number' || typeof cacheMissTokens === 'number') {
      if (options?.saveCacheDebugFile) {
        const cacheDir = options?.debugSaveDir;
        const idx = typeof options?.batchIndex === 'number' ? options.batchIndex + 1 : Date.now();
        if (cacheDir) {
          try {
            const cacheFile = path.join(cacheDir, `step3_deepseek_cache_batch_${idx}.json`);
            fs.writeFileSync(cacheFile, JSON.stringify({
              promptCacheHitTokens: cacheHitTokens,
              promptCacheMissTokens: cacheMissTokens,
              model: options?.model ?? config.defaultModel,
              timestamp: new Date().toISOString(),
            }, null, 2), 'utf-8');
          } catch {
            // ignore debug write error
          }
        }
      }
      console.log(`[DeepSeek] Cache: hit=${cacheHitTokens ?? 0} miss=${cacheMissTokens ?? 0}`);
    }

    return { success: true, data: content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function listDeepSeekModels(
  apiKey: string
): Promise<{ success: true; data: DeepSeekModelInfo[] } | { success: false; error: string }> {
  try {
    const url = `${DEEPSEEK_API_BASE}/models`;
    const result = await makeRequestWithProxy(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      timeout: getApiRequestTimeoutMs(),
      useProxy: false,
    });

    if (!result.success) {
      return { success: false, error: result.error || 'DeepSeek list models error' };
    }

    const models: DeepSeekModelInfo[] = result.data?.data ?? [];
    if (!Array.isArray(models)) {
      return { success: false, error: 'DeepSeek: unexpected models response format' };
    }

    return { success: true, data: models };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export function getConfig(): DeepSeekConfig {
  const row = DeepSeekDatabase.get();
  if (row) {
    return { apiKey: row.apiKey, defaultModel: row.defaultModel };
  }

  // Migrate từ AppSettings nếu DB chưa có dữ liệu
  const settings = AppSettingsService.getAll();
  const config: DeepSeekConfig = {
    apiKey: settings.deepseekApiKey ?? null,
    defaultModel: settings.deepseekDefaultModel || DEEPSEEK_DEFAULT_MODEL,
  };
  DeepSeekDatabase.upsert(config.apiKey, config.defaultModel);
  return config;
}

export function setConfig(partial: Partial<DeepSeekConfig>): void {
  const current = getConfig();
  DeepSeekDatabase.upsert(
    partial.apiKey !== undefined ? partial.apiKey : current.apiKey,
    partial.defaultModel !== undefined ? partial.defaultModel : current.defaultModel,
  );
}
