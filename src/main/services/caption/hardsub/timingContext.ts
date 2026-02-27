import * as fs from 'fs/promises';
import { existsSync } from 'fs';

export type AudioSpeedModel = 'step4_minus_step7_delta';

export interface RenderTimingContext {
  step4SrtScale?: number;
  step7AudioSpeed?: number;
  audioSpeedModel?: AudioSpeedModel;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validateTimingContext(raw: unknown): RenderTimingContext | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const rawObj = raw as Record<string, unknown>;
  const timingObj = (
    rawObj.timing &&
    typeof rawObj.timing === 'object' &&
    !Array.isArray(rawObj.timing)
  )
    ? (rawObj.timing as Record<string, unknown>)
    : rawObj;
  const obj = timingObj;
  const result: RenderTimingContext = {};

  if (isPositiveNumber(obj.step4SrtScale)) {
    result.step4SrtScale = obj.step4SrtScale;
  }
  if (isPositiveNumber(obj.step7AudioSpeed)) {
    result.step7AudioSpeed = obj.step7AudioSpeed;
  }
  if (obj.audioSpeedModel === 'step4_minus_step7_delta') {
    result.audioSpeedModel = obj.audioSpeedModel;
  }

  return Object.keys(result).length > 0 ? result : null;
}

export async function readRenderTimingContext(contextPath?: string): Promise<RenderTimingContext | null> {
  if (!contextPath || !existsSync(contextPath)) {
    return null;
  }
  try {
    const raw = await fs.readFile(contextPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return validateTimingContext(parsed);
  } catch {
    return null;
  }
}
