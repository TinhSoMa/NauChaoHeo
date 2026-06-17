import { ipcMain } from 'electron';
import { scanCliAgents } from '../cliAgentScan/detection';
import { AppSettingsService } from '../services/appSettings';
import type { CliAgentConfigEntry } from '../services/appSettings';

export const CLI_AGENT_SCAN_CHANNELS = {
  SCAN: 'cliAgentScan:scan',
  GET_CONFIG: 'cliAgentScan:getConfig',
  UPDATE_CONFIG: 'cliAgentScan:updateConfig',
  GET_DIAGNOSTICS: 'cliAgentScan:getDiagnostics',
} as const;

export function registerCliAgentScanHandlers(): void {
  console.log('[IPC] Đang đăng ký CLI Agent Scan handlers...');

  ipcMain.handle(CLI_AGENT_SCAN_CHANNELS.SCAN, async () => {
    const settings = AppSettingsService.getAll();
    const config = settings.cliAgentConfig;
    return scanCliAgents(config);
  });

  ipcMain.handle(CLI_AGENT_SCAN_CHANNELS.GET_CONFIG, () => {
    return AppSettingsService.getAll().cliAgentConfig;
  });

  ipcMain.handle(CLI_AGENT_SCAN_CHANNELS.UPDATE_CONFIG, (_event, agentId: string, entry: CliAgentConfigEntry) => {
    const current = AppSettingsService.getAll().cliAgentConfig;
    AppSettingsService.update({
      cliAgentConfig: { ...current, [agentId]: entry },
    });
    return AppSettingsService.getAll().cliAgentConfig;
  });

  ipcMain.handle(CLI_AGENT_SCAN_CHANNELS.GET_DIAGNOSTICS, () => {
    return {
      config: AppSettingsService.getAll().cliAgentConfig,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    };
  });
}

/** Fire-and-forget warmup scan — gọi ở startup để warm caches */
export async function warmupCliAgentScan(): Promise<void> {
  try {
    const config = AppSettingsService.getAll().cliAgentConfig;
    await scanCliAgents(config);
    console.log('[CLI Agent Scan] Warmup completed');
  } catch {
    // silent — warmup không critical
  }
}
