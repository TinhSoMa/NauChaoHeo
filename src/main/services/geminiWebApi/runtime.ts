import { GeminiWebApiService } from './geminiWebApiService';

let runtimeInstance: GeminiWebApiService | null = null;

export function getGeminiWebApiRuntime(): GeminiWebApiService {
  if (!runtimeInstance) {
    runtimeInstance = new GeminiWebApiService();
  }
  return runtimeInstance;
}

export async function shutdownGeminiWebApiRuntime(): Promise<void> {
  if (!runtimeInstance) {
    return;
  }
  await runtimeInstance.shutdown();
  runtimeInstance = null;
}

export function setGeminiWebApiRuntimeForTesting(instance: GeminiWebApiService | null): void {
  runtimeInstance = instance;
}
