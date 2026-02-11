import { useState, useCallback, useEffect } from 'react';
import type { GeminiChatConfigLite, TokenContext } from '../types';
import { buildTokenKey } from '../utils/tokenUtils';

export function useTokenManagement() {
  const [tokenConfigs, setTokenConfigs] = useState<GeminiChatConfigLite[]>([]);
  const [tokenConfigId, setTokenConfigId] = useState<string | null>(null);
  const [tokenContexts, setTokenContexts] = useState<Map<string, TokenContext>>(new Map());

  // Load token configurations from backend
  const loadConfigurations = useCallback(async () => {
    try {
      const configsResult = await window.electronAPI.geminiChat.getAll();
      if (configsResult.success && configsResult.data) {
        const configs = configsResult.data as GeminiChatConfigLite[];
        setTokenConfigs(configs);

        const activeConfigs = configs.filter(c => c.isActive && !c.isError);
        const uniqueActive = activeConfigs.filter((config, index) => {
          const key = buildTokenKey(config);
          return activeConfigs.findIndex(c => buildTokenKey(c) === key) === index;
        });

        // Set fallback tokenConfigId if not set
        const fallbackConfig = uniqueActive[0] || configs[0];
        setTokenConfigId(prev => {
          const nextId = prev || fallbackConfig?.id || null;
          if (nextId && nextId !== prev) {
            return nextId;
          }
          return prev;
        });

        console.log(`[StoryTranslator] Loaded ${uniqueActive.length} unique active tokens`);
      }
    } catch (e) {
      console.error('[StoryTranslator] Error loading config:', e);
    }
  }, []);

  // Get distinct active token configs (no duplicates by token key)
  const getDistinctActiveTokenConfigs = useCallback((configs: GeminiChatConfigLite[]) => {
    const activeConfigs = configs.filter(c => c.isActive && !c.isError);
    const seenKeys = new Set<string>();
    const distinct: GeminiChatConfigLite[] = [];
    for (const config of activeConfigs) {
      const key = buildTokenKey(config);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      distinct.push(config);
    }
    return distinct;
  }, []);

  // Get token config by ID
  const getTokenConfigById = useCallback((id: string | null): GeminiChatConfigLite | null => {
    if (!id) return null;
    return tokenConfigs.find(c => c.id === id) || null;
  }, [tokenConfigs]);

  // Get preferred token config (fallback to first active if current is unavailable or inactive)
  const getPreferredTokenConfig = useCallback((): GeminiChatConfigLite | null => {
    const direct = getTokenConfigById(tokenConfigId);
    if (direct && direct.isActive && !direct.isError) return direct;

    const distinctActive = getDistinctActiveTokenConfigs(tokenConfigs);
    if (distinctActive.length === 0) return null;

    const fallback = distinctActive[0];
    // Always update tokenConfigId to a valid one if the current one is invalid
    if (fallback && fallback.id !== tokenConfigId) {
      setTokenConfigId(fallback.id);
    }
    return fallback;
  }, [tokenConfigId, tokenConfigs, getTokenConfigById, getDistinctActiveTokenConfigs]);

  // Migrate token contexts from config ID to token key
  const migrateTokenContextsToTokenKey = useCallback((
    configs: GeminiChatConfigLite[],
    contexts: Map<string, TokenContext>
  ): { map: Map<string, TokenContext>; changed: boolean } => {
    if (configs.length === 0 || contexts.size === 0) {
      return { map: contexts, changed: false };
    }

    const idToTokenKey = new Map(configs.map(c => [c.id, buildTokenKey(c)] as [string, string]));
    let changed = false;
    const next = new Map(contexts);

    for (const [key, ctx] of contexts.entries()) {
      const tokenKey = idToTokenKey.get(key);
      if (!tokenKey || tokenKey === key) continue;
      if (!next.has(tokenKey)) {
        next.set(tokenKey, ctx);
      }
      if (next.has(key)) {
        next.delete(key);
      }
      changed = true;
    }

    return { map: changed ? next : contexts, changed };
  }, []);

  // Auto-load configurations on mount + listen for config changes
  useEffect(() => {
    loadConfigurations();

    const removeListener = window.electronAPI.onMessage('geminiChat:configChanged', () => {
      console.log('[useTokenManagement] Config changed, reloading...');
      loadConfigurations();
    });

    return () => {
      removeListener();
    };
  }, [loadConfigurations]);

  // Auto-migrate token contexts when configs or contexts change
  useEffect(() => {
    if (tokenConfigs.length === 0 || tokenContexts.size === 0) return;
    
    const { map, changed } = migrateTokenContextsToTokenKey(tokenConfigs, tokenContexts);
    if (changed) {
      console.log('[useTokenManagement] Auto-migrating token contexts to token keys');
      setTokenContexts(map);
    }
  }, [tokenConfigs, tokenContexts, migrateTokenContextsToTokenKey]);

  return {
    tokenConfigs,
    setTokenConfigs,
    tokenConfigId,
    setTokenConfigId,
    tokenContexts,
    setTokenContexts,
    loadConfigurations,
    getDistinctActiveTokenConfigs,
    getTokenConfigById,
    getPreferredTokenConfig,
    migrateTokenContextsToTokenKey
  };
}
