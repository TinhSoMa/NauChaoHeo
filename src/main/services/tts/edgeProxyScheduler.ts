import type { ProxyConfig } from '../../../shared/types/proxy';

export interface EdgeProxySchedulerOptions {
  defaultChunkSize: number;
  minChunkSize: number;
  maxChunkSize: number;
  cooldownMs: number;
  maxConsecutiveFailures: number;
  maxInFlightPerProxy: number;
}

interface ProxyState {
  proxy: ProxyConfig;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  consecutiveFailures: number;
  inFlight: number;
  avgLatencyMs: number;
  cooldownUntilMs: number;
}

export interface EdgeProxyBatchReport {
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  elapsedMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class EdgeProxyScheduler {
  private readonly options: EdgeProxySchedulerOptions;

  private readonly states = new Map<string, ProxyState>();

  constructor(proxies: ProxyConfig[], options: EdgeProxySchedulerOptions) {
    this.options = options;
    for (const proxy of proxies) {
      if (!proxy?.id) continue;
      this.states.set(proxy.id, {
        proxy,
        successCount: 0,
        failedCount: 0,
        timeoutCount: 0,
        consecutiveFailures: 0,
        inFlight: 0,
        avgLatencyMs: 0,
        cooldownUntilMs: 0,
      });
    }
  }

  getProxyCount(): number {
    return this.states.size;
  }

  acquireProxy(): ProxyConfig | null {
    const now = Date.now();
    const candidates: ProxyState[] = [];

    for (const state of this.states.values()) {
      if (state.cooldownUntilMs > now) continue;
      if (state.inFlight >= this.options.maxInFlightPerProxy) continue;
      candidates.push(state);
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => this.computeScore(b) - this.computeScore(a));
    const chosen = candidates[0];
    chosen.inFlight += 1;
    return chosen.proxy;
  }

  releaseProxy(proxyId: string, report: EdgeProxyBatchReport): void {
    const state = this.states.get(proxyId);
    if (!state) {
      return;
    }

    state.inFlight = Math.max(0, state.inFlight - 1);

    const elapsed = Number.isFinite(report.elapsedMs) ? Math.max(0, report.elapsedMs) : 0;
    if (elapsed > 0) {
      state.avgLatencyMs = state.avgLatencyMs > 0
        ? (state.avgLatencyMs * 0.7) + (elapsed * 0.3)
        : elapsed;
    }

    state.successCount += Math.max(0, report.successCount || 0);
    state.failedCount += Math.max(0, report.failedCount || 0);
    state.timeoutCount += Math.max(0, report.timeoutCount || 0);

    if ((report.failedCount || 0) > 0) {
      state.consecutiveFailures += 1;
    } else {
      state.consecutiveFailures = 0;
    }

    const attempts = state.successCount + state.failedCount;
    const timeoutRatio = attempts > 0 ? state.timeoutCount / attempts : 0;
    if (state.consecutiveFailures >= this.options.maxConsecutiveFailures || timeoutRatio >= 0.5) {
      state.cooldownUntilMs = Date.now() + this.options.cooldownMs;
      state.consecutiveFailures = 0;
    }
  }

  getRecommendedChunkSize(proxyId: string, fallbackChunkSize: number): number {
    const state = this.states.get(proxyId);
    const safeFallback = clamp(
      Math.round(fallbackChunkSize || this.options.defaultChunkSize),
      this.options.minChunkSize,
      this.options.maxChunkSize,
    );
    if (!state) {
      return safeFallback;
    }

    const attempts = state.successCount + state.failedCount;
    if (attempts < 3) {
      return clamp(Math.round(safeFallback * 0.8), this.options.minChunkSize, this.options.maxChunkSize);
    }

    const failureRate = attempts > 0 ? state.failedCount / attempts : 0;
    const successRate = attempts > 0 ? state.successCount / attempts : 0;

    let chunk = safeFallback;
    if (failureRate >= 0.35) {
      chunk = Math.round(safeFallback * 0.4);
    } else if (failureRate >= 0.15 || state.avgLatencyMs > 8000) {
      chunk = Math.round(safeFallback * 0.6);
    } else if (state.avgLatencyMs > 4500) {
      chunk = Math.round(safeFallback * 0.75);
    } else if (successRate >= 0.9 && state.avgLatencyMs > 0 && state.avgLatencyMs < 1800) {
      chunk = Math.round(safeFallback * 1.25);
    }

    return clamp(chunk, this.options.minChunkSize, this.options.maxChunkSize);
  }

  private computeScore(state: ProxyState): number {
    const attempts = state.successCount + state.failedCount;
    const successRate = attempts > 0 ? state.successCount / attempts : 0.5;
    const failureRate = attempts > 0 ? state.failedCount / attempts : 0;
    const latencyPenalty = state.avgLatencyMs > 0 ? Math.min(0.8, state.avgLatencyMs / 12000) : 0;
    const timeoutPenalty = attempts > 0 ? Math.min(0.7, state.timeoutCount / attempts) : 0;
    const inflightPenalty = Math.min(0.5, state.inFlight * 0.1);

    return successRate - failureRate - latencyPenalty - timeoutPenalty - inflightPenalty;
  }
}
