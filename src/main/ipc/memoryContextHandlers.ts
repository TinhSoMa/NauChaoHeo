import { ipcMain } from 'electron';
import { getMemoryContextService } from '../services/memoryContext';
import { MEMORY_CONTEXT_IPC_CHANNELS } from '../../shared/types';
import type {
  MemoryContextAddRequest,
  MemoryContextClearNamespaceRequest,
  MemoryContextSearchRequest,
  MemoryContextStatsRequest
} from '../../shared/types';

export function registerMemoryContextHandlers(): void {
  const service = getMemoryContextService();

  ipcMain.handle(MEMORY_CONTEXT_IPC_CHANNELS.GET_HEALTH, async () => {
    return service.getHealth();
  });

  ipcMain.handle(
    MEMORY_CONTEXT_IPC_CHANNELS.SEARCH,
    async (_event, payload: MemoryContextSearchRequest) => {
      return service.searchContext(payload);
    }
  );

  ipcMain.handle(
    MEMORY_CONTEXT_IPC_CHANNELS.ADD,
    async (_event, payload: MemoryContextAddRequest) => {
      return service.addMemory(payload);
    }
  );

  ipcMain.handle(
    MEMORY_CONTEXT_IPC_CHANNELS.CLEAR_NAMESPACE,
    async (_event, payload: MemoryContextClearNamespaceRequest) => {
      return service.clearNamespace(payload);
    }
  );

  ipcMain.handle(
    MEMORY_CONTEXT_IPC_CHANNELS.GET_STATS,
    async (_event, payload: MemoryContextStatsRequest) => {
      return service.getStats(payload);
    }
  );
}
