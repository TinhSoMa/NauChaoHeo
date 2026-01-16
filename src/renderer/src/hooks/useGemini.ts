/**
 * useGemini Hook - React hook để sử dụng Gemini API
 * Cung cấp các hàm gọi Gemini API và quản lý API keys
 */

import { useState, useCallback, useEffect } from 'react';

// Types
interface KeyInfo {
  accountId: string;
  accountEmail: string;
  projectName: string;
  apiKey: string;
  name: string;
  accountIndex: number;
  projectIndex: number;
}

interface ApiStats {
  totalAccounts: number;
  totalProjects: number;
  available: number;
  rateLimited: number;
  exhausted: number;
  error: number;
  emptyKeys: number;
  totalRequestsToday: number;
  currentAccountIndex: number;
  currentProjectIndex: number;
  rotationRound: number;
}

interface GeminiResponse {
  success: boolean;
  data?: string;
  error?: string;
}

interface UseGeminiReturn {
  // State
  loading: boolean;
  stats: ApiStats | null;
  lastResponse: GeminiResponse | null;
  error: string | null;

  // Actions
  callGemini: (prompt: string | object, model?: string) => Promise<GeminiResponse>;
  translateText: (text: string, targetLanguage?: string, model?: string) => Promise<GeminiResponse>;
  refreshStats: () => Promise<void>;
  resetAllStatus: () => Promise<boolean>;
  reloadConfig: () => Promise<boolean>;
}

/**
 * Hook để sử dụng Gemini API trong Renderer process
 */
export function useGemini(): UseGeminiReturn {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [lastResponse, setLastResponse] = useState<GeminiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lấy stats khi component mount
  const refreshStats = useCallback(async () => {
    try {
      const response = await window.electronAPI.gemini.getStats();
      if (response.success && response.data) {
        setStats(response.data);
      }
    } catch (err) {
      console.error('[useGemini] Lỗi lấy stats:', err);
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Gọi Gemini API
  const callGemini = useCallback(async (prompt: string | object, model?: string): Promise<GeminiResponse> => {
    setLoading(true);
    setError(null);

    try {
      const response = await window.electronAPI.gemini.callGemini(prompt, model);
      
      if (response.success && response.data) {
        setLastResponse(response.data);
        // Refresh stats sau khi gọi API
        refreshStats();
        return response.data;
      } else {
        const errorMsg = response.error || 'Lỗi không xác định';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }
    } catch (err) {
      const errorMsg = String(err);
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [refreshStats]);

  // Dịch text
  const translateText = useCallback(async (
    text: string,
    targetLanguage?: string,
    model?: string
  ): Promise<GeminiResponse> => {
    setLoading(true);
    setError(null);

    try {
      const response = await window.electronAPI.gemini.translateText(text, targetLanguage, model);
      
      if (response.success && response.data) {
        setLastResponse(response.data);
        refreshStats();
        return response.data;
      } else {
        const errorMsg = response.error || 'Lỗi không xác định';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }
    } catch (err) {
      const errorMsg = String(err);
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [refreshStats]);

  // Reset tất cả status
  const resetAllStatus = useCallback(async (): Promise<boolean> => {
    try {
      const response = await window.electronAPI.gemini.resetAllStatus();
      if (response.success) {
        refreshStats();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[useGemini] Lỗi reset status:', err);
      return false;
    }
  }, [refreshStats]);

  // Reload config
  const reloadConfig = useCallback(async (): Promise<boolean> => {
    try {
      const response = await window.electronAPI.gemini.reloadConfig();
      if (response.success) {
        refreshStats();
        return true;
      }
      return false;
    } catch (err) {
      console.error('[useGemini] Lỗi reload config:', err);
      return false;
    }
  }, [refreshStats]);

  return {
    loading,
    stats,
    lastResponse,
    error,
    callGemini,
    translateText,
    refreshStats,
    resetAllStatus,
    reloadConfig,
  };
}

export default useGemini;
