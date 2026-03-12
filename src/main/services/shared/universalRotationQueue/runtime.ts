import { UniversalRotationQueueService } from './universalRotationQueueService';
import {
  getQueueRuntimeOrCreate,
  isRotationQueueInspectorEnabled as isRotationQueueInspectorEnabledFromRegistry,
  isRotationQueuePayloadDebugEnabled as isRotationQueuePayloadDebugEnabledFromRegistry,
  setQueueRuntimeForTesting
} from './runtimeRegistry';

export function isRotationQueueInspectorEnabled(): boolean {
  return isRotationQueueInspectorEnabledFromRegistry();
}

export function isRotationQueuePayloadDebugEnabled(): boolean {
  return isRotationQueuePayloadDebugEnabledFromRegistry();
}

/**
 * @deprecated Prefer getQueueRuntimeOrCreate(featureKey) from runtimeRegistry.ts.
 * This wrapper is retained for backward compatibility and always maps to key "default".
 */
export function getUniversalRotationQueueRuntime(): UniversalRotationQueueService {
  return getQueueRuntimeOrCreate('default');
}

export function setUniversalRotationQueueRuntimeForTesting(
  runtime: UniversalRotationQueueService | null
): void {
  setQueueRuntimeForTesting('default', runtime);
}
