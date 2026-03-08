import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RotationQueueEventRecord,
  RotationQueueInspectorSnapshot,
  RotationQueueInspectorStatus,
  RotationQueueRuntimeInfo,
  RotationQueueViewOptions
} from '@shared/types/rotationQueue';

const DEFAULT_VIEW_OPTIONS: RotationQueueViewOptions = {
  state: 'all',
  limit: 200,
  includePayload: false
};

const HISTORY_FETCH_LIMIT = 100;
const TIMELINE_BUFFER_LIMIT = 300;
const RUNTIME_REFRESH_INTERVAL_MS = 3000;

function pickPreferredRuntime(
  runtimes: RotationQueueRuntimeInfo[],
  currentRuntimeKey: string
): string {
  if (runtimes.length === 0) {
    return currentRuntimeKey || 'default';
  }

  const withRunning = runtimes.find((item) => (item.jobCounts?.running ?? 0) > 0);
  if (withRunning) {
    return withRunning.key;
  }

  const withQueued = runtimes.find((item) => (item.jobCounts?.queued ?? 0) > 0);
  if (withQueued) {
    return withQueued.key;
  }

  const normalizedCurrent = currentRuntimeKey?.trim();
  if (normalizedCurrent && runtimes.some((item) => item.key === normalizedCurrent)) {
    return normalizedCurrent;
  }

  const nonDefault = runtimes.find((item) => item.key !== 'default');
  if (nonDefault) {
    return nonDefault.key;
  }

  return runtimes[0].key;
}

export function useQueueMonitor() {
  const [status, setStatus] = useState<RotationQueueInspectorStatus | null>(null);
  const [runtimeInfos, setRuntimeInfos] = useState<RotationQueueRuntimeInfo[]>([]);
  const [selectedRuntimeKey, setSelectedRuntimeKey] = useState('default');
  const [viewOptions, setViewOptions] = useState<RotationQueueViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [activeViewOptions, setActiveViewOptions] = useState<RotationQueueViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [snapshot, setSnapshot] = useState<RotationQueueInspectorSnapshot | null>(null);
  const [events, setEvents] = useState<RotationQueueEventRecord[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const isMountedRef = useRef(true);

  const pushError = useCallback((message: string) => {
    if (!isMountedRef.current) {
      return;
    }
    setErrorMessage(message);
  }, []);

  const refreshStatusAndRuntimes = useCallback(async () => {
    const [statusResult, runtimesResult] = await Promise.all([
      window.electronAPI.rotationQueue.getStatus(),
      window.electronAPI.rotationQueue.listRuntimes()
    ]);

    if (statusResult.success && statusResult.data) {
      setStatus(statusResult.data);
    } else {
      pushError(statusResult.error || 'Không thể lấy trạng thái queue inspector.');
    }

    if (runtimesResult.success && runtimesResult.data) {
      const runtimeList = runtimesResult.data;
      setRuntimeInfos(runtimeList);
      setSelectedRuntimeKey((previousKey) => {
        return pickPreferredRuntime(runtimeList, previousKey);
      });
    } else {
      pushError(runtimesResult.error || 'Không thể lấy danh sách runtime.');
    }
  }, [pushError]);

  const refreshData = useCallback(
    async (runtimeKey: string, options: RotationQueueViewOptions) => {
      const [snapshotResult, historyResult] = await Promise.all([
        window.electronAPI.rotationQueue.getSnapshot(options, runtimeKey),
        window.electronAPI.rotationQueue.getHistory(HISTORY_FETCH_LIMIT, runtimeKey)
      ]);

      if (snapshotResult.success && snapshotResult.data) {
        setSnapshot(snapshotResult.data);
      } else if ((snapshotResult as { errorCode?: string }).errorCode === 'INSPECTOR_DISABLED') {
        setSnapshot(null);
      } else if (snapshotResult.error) {
        pushError(snapshotResult.error);
      }

      if (historyResult.success && historyResult.data) {
        setEvents(historyResult.data.slice().reverse().slice(0, TIMELINE_BUFFER_LIMIT));
      } else if ((historyResult as { errorCode?: string }).errorCode === 'INSPECTOR_DISABLED') {
        setEvents([]);
      } else if (historyResult.error) {
        pushError(historyResult.error);
      }
    },
    [pushError]
  );

  const stopStream = useCallback(async () => {
    try {
      await window.electronAPI.rotationQueue.stopStream();
    } finally {
      if (isMountedRef.current) {
        setIsStreaming(false);
      }
    }
  }, []);

  const startStream = useCallback(
    async (runtimeKey: string, options: RotationQueueViewOptions) => {
      const result = await window.electronAPI.rotationQueue.startStream(options, runtimeKey);
      if (result.success) {
        setIsStreaming(true);
        return;
      }
      setIsStreaming(false);
      if ((result as { errorCode?: string }).errorCode === 'INSPECTOR_DISABLED') {
        return;
      }
      pushError(result.error || 'Không thể khởi động stream queue.');
    },
    [pushError]
  );

  useEffect(() => {
    isMountedRef.current = true;
    const unsubEvent = window.electronAPI.rotationQueue.onEvent((eventRecord) => {
      setEvents((prev) => [eventRecord, ...prev].slice(0, TIMELINE_BUFFER_LIMIT));
    });
    const unsubSnapshot = window.electronAPI.rotationQueue.onSnapshot((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    (async () => {
      try {
        setIsLoading(true);
        await refreshStatusAndRuntimes();
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    })();

    const runtimeTimer = setInterval(() => {
      void refreshStatusAndRuntimes();
    }, RUNTIME_REFRESH_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      unsubEvent();
      unsubSnapshot();
      clearInterval(runtimeTimer);
      window.electronAPI.rotationQueue.stopStream();
    };
  }, [refreshStatusAndRuntimes]);

  useEffect(() => {
    if (!selectedRuntimeKey) {
      return;
    }
    const enabled = status?.enabled === true;

    (async () => {
      try {
        setErrorMessage('');
        setIsLoading(true);
        await stopStream();
        await refreshData(selectedRuntimeKey, activeViewOptions);
        if (enabled && !isPaused) {
          await startStream(selectedRuntimeKey, activeViewOptions);
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    })();
  }, [activeViewOptions, isPaused, refreshData, selectedRuntimeKey, startStream, status?.enabled, stopStream]);

  const applyFilters = useCallback(() => {
    setActiveViewOptions({ ...viewOptions });
  }, [viewOptions]);

  const refreshNow = useCallback(async () => {
    if (!selectedRuntimeKey) {
      return;
    }
    setIsLoading(true);
    try {
      await refreshStatusAndRuntimes();
      await refreshData(selectedRuntimeKey, activeViewOptions);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeViewOptions, refreshData, refreshStatusAndRuntimes, selectedRuntimeKey]);

  const clearHistory = useCallback(async () => {
    const result = await window.electronAPI.rotationQueue.clearHistory({
      runtimeKey: selectedRuntimeKey,
      resetDroppedCounter: true
    });
    if (!result.success) {
      pushError(result.error || 'Không thể xóa lịch sử event.');
      return;
    }
    await refreshData(selectedRuntimeKey, activeViewOptions);
  }, [activeViewOptions, pushError, refreshData, selectedRuntimeKey]);

  const runtimeOptions = useMemo(() => {
    if (runtimeInfos.length > 0) {
      return runtimeInfos;
    }
    return [{ key: 'default' }];
  }, [runtimeInfos]);

  return {
    status,
    runtimeInfos: runtimeOptions,
    selectedRuntimeKey,
    setSelectedRuntimeKey,
    viewOptions,
    setViewOptions,
    applyFilters,
    snapshot,
    events,
    isPaused,
    setIsPaused,
    isStreaming,
    isLoading,
    errorMessage,
    refreshNow,
    clearHistory
  };
}
