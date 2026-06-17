import { detectAgents } from './detection';
import type { DetectedAgentMap } from './types';
import { scanCliAgents } from '../cliAgentScan/detection';
import type { DetectedCliAgent, CliAgentId } from '../cliAgentScan/types';
import { AppSettingsService } from '../services/appSettings';

export interface UnifiedAgentInfo {
  api: DetectedAgentMap;
  cli: DetectedCliAgent[];
}

export async function detectAllAgents(): Promise<UnifiedAgentInfo> {
  const api = detectAgents();
  const settings = AppSettingsService.getAll();
  const config = settings.cliAgentConfig;
  const cli = await scanCliAgents(config);
  return { api, cli };
}
