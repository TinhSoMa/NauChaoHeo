import { ipcMain } from 'electron';
import { detectAgents, detectAgent } from '../agents/detection';
import { detectAllAgents } from '../agents/cliAgentBridge';
import type { AgentId } from '../agents/types';

export const AGENT_IPC_CHANNELS = {
  LIST: 'agents:list',
  GET: 'agents:get',
  LIST_ALL: 'agents:listAll',
} as const;

export function registerAgentHandlers(): void {
  console.log('[IPC] Đang đăng ký Agent handlers...');

  ipcMain.handle(AGENT_IPC_CHANNELS.LIST, async () => {
    return detectAgents();
  });

  ipcMain.handle(AGENT_IPC_CHANNELS.GET, async (_event, id: AgentId) => {
    return detectAgent(id);
  });

  ipcMain.handle(AGENT_IPC_CHANNELS.LIST_ALL, async () => {
    return detectAllAgents();
  });
}
