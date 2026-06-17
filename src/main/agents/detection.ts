import { AppSettingsService } from '../services/appSettings';
import { getKeyManager } from '../services/openrouter/openrouterKeyManager';
import { getApiManager } from '../services/gemini/apiManager';
import { getAllAgentDefs, getAgentDef } from './registry';
import type { DetectedAgent, DetectedAgentMap, AgentId, AgentModelOption } from './types';

function probeGeminiAuth(): { status: 'ok' | 'missing' | 'unknown'; message?: string } {
  try {
    const manager = getApiManager();
    const stats = manager.getStats();
    return stats.available > 0
      ? { status: 'ok' }
      : { status: 'missing', message: 'No Gemini API keys configured' };
  } catch {
    return { status: 'unknown' };
  }
}

function probeOpenRouterAuth(): { status: 'ok' | 'missing' | 'unknown'; message?: string } {
  try {
    const settings = AppSettingsService.getAll();
    if (settings.openrouterApiKey) {
      return { status: 'ok' };
    }
    const keyManager = getKeyManager();
    const hasKeys = keyManager.hasKeys();
    return hasKeys
      ? { status: 'ok' }
      : { status: 'missing', message: 'No OpenRouter API key configured' };
  } catch {
    return { status: 'unknown' };
  }
}

function probeGrokUiAuth(): { status: 'ok' | 'missing' | 'unknown'; message?: string } {
  try {
    const settings = AppSettingsService.getAll();
    const hasProfile = !!(
      settings.grokUiProfileDir ||
      settings.grokUiProfiles?.length
    );
    return hasProfile
      ? { status: 'ok' }
      : { status: 'missing', message: 'No Grok UI profile configured' };
  } catch {
    return { status: 'unknown' };
  }
}

function probeGeminiWebApiAuth(): { status: 'ok' | 'missing' | 'unknown'; message?: string } {
  try {
    const settings = AppSettingsService.getAll();
    const fallback = settings.geminiWebApiCookieFallback;
    const hasCookies = !!(fallback?.cookie?.trim());
    return hasCookies
      ? { status: 'ok' }
      : { status: 'missing', message: 'No Gemini Web cookies configured' };
  } catch {
    return { status: 'unknown' };
  }
}

const AUTH_PROBERS: Record<AgentId, () => { status: 'ok' | 'missing' | 'unknown'; message?: string }> = {
  'gemini': probeGeminiAuth,
  'openrouter': probeOpenRouterAuth,
  'grok-ui': probeGrokUiAuth,
  'gemini-webapi': probeGeminiWebApiAuth,
};

function getModelsForAgent(id: AgentId): AgentModelOption[] {
  const def = getAgentDef(id);
  return def ? [...def.fallbackModels] : [];
}

export function detectAgents(): DetectedAgentMap {
  const defs = getAllAgentDefs();
  const result: DetectedAgentMap = {} as DetectedAgentMap;

  for (const def of defs) {
    const authResult = AUTH_PROBERS[def.id]?.() ?? { status: 'unknown' as const };
    const models = getModelsForAgent(def.id);

    result[def.id] = {
      ...def,
      available: authResult.status === 'ok',
      authStatus: authResult.status,
      authMessage: authResult.message,
      models,
      modelsSource: 'fallback',
    };
  }

  return result;
}

export function detectAgent(id: AgentId): DetectedAgent | null {
  const def = getAgentDef(id);
  if (!def) return null;

  const authResult = AUTH_PROBERS[id]?.() ?? { status: 'unknown' as const };
  const models = getModelsForAgent(id);

  return {
    ...def,
    available: authResult.status === 'ok',
    authStatus: authResult.status,
    authMessage: authResult.message,
    models,
    modelsSource: 'fallback',
  };
}
