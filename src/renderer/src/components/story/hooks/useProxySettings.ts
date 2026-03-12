import { useState, useEffect } from 'react';

/**
 * Custom hook to manage proxy settings
 * Loads proxy configuration from app settings and provides state management
 */
export function useProxySettings() {
  const [useProxy, setUseProxy] = useState(true);

  const loadProxySetting = async () => {
    try {
      const result = await window.electronAPI.appSettings.getAll();
      if (result.success && result.data) {
        setUseProxy(result.data.useProxy);
      }
    } catch (error) {
      console.error('[useProxySettings] Error loading proxy setting:', error);
    }
  };

  useEffect(() => {
    loadProxySetting();

    const removeListener = window.electronAPI.onMessage('geminiChat:configChanged', () => {
      console.log('[useProxySettings] Config changed, reloading proxy settings...');
      loadProxySetting();
    });

    return () => {
      removeListener();
    };
  }, []);

  return {
    useProxy,
    setUseProxy,
    loadProxySetting
  };
}
