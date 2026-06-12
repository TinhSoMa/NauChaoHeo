import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { UniversalRotationQueueService } from '../universalRotationQueueService';
import { JobPriority } from '../rotationTypes';
import { RateLimitJobError, RotationJobExecutionError } from '../rotationErrors';

interface ScenarioMetrics {
  name: string;
  jobCount: number;
  enqueuePerSec: number;
  dispatchLatencyP50Ms: number;
  dispatchLatencyP95Ms: number;
  dispatchLatencyP99Ms: number;
  rebalanceP95Ms: number;
  snapshotBuildP95Ms: number;
  heapDeltaMb: number;
  durationMs: number;
}

interface BenchmarkOutput {
  generatedAt: string;
  nodeVersion: string;
  scenarios: ScenarioMetrics[];
}

interface ParsedArgs {
  sizes: number[];
  baselinePath?: string;
  outputPath?: string;
}

interface JobPayload {
  id: number;
  mode: 'ok' | 'rate_limit' | 'retry_error';
  capability: 'cap-a' | 'cap-b' | 'generic';
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const parsed: ParsedArgs = {
    sizes: [10_000, 50_000, 100_000]
  };

  for (const arg of args) {
    if (arg.startsWith('--sizes=')) {
      parsed.sizes = arg
        .slice('--sizes='.length)
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0)
        .map((item) => Math.floor(item));
      continue;
    }
    if (arg.startsWith('--baseline=')) {
      parsed.baselinePath = arg.slice('--baseline='.length).trim();
      continue;
    }
    if (arg.startsWith('--output=')) {
      parsed.outputPath = arg.slice('--output='.length).trim();
      continue;
    }
  }

  return parsed;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[rank];
}

async function runScenario(jobCount: number, capabilityMode: 'prefer' | 'strict'): Promise<ScenarioMetrics> {
  const queue = new UniversalRotationQueueService({
    globalMaxConcurrentJobs: 128,
    maxConcurrentPerFeature: 64,
    enableServiceAllocator: true,
    enableRotationQueueInspector: false,
    defaultJobTimeoutMs: 30_000,
    defaultMaxAttempts: 3,
    antiStarvationStepMs: 15_000,
    defaultCooldownMinMs: 100,
    defaultCooldownMaxMs: 200
  });

  queue.registerPool({
    poolId: 'bench-pool',
    selector: 'weighted_round_robin',
    defaultCooldownMinMs: 100,
    defaultCooldownMaxMs: 200,
    defaultMaxConcurrencyPerResource: 8
  });

  const resources = [
    { id: 'acc-a1', caps: ['cap-a'], weight: 3 },
    { id: 'acc-a2', caps: ['cap-a'], weight: 2 },
    { id: 'acc-b1', caps: ['cap-b'], weight: 3 },
    { id: 'acc-b2', caps: ['cap-b'], weight: 2 },
    { id: 'acc-g1', caps: ['generic'], weight: 1 },
    { id: 'acc-g2', caps: ['generic'], weight: 1 },
    { id: 'acc-m1', caps: ['cap-a', 'cap-b'], weight: 2 },
    { id: 'acc-m2', caps: ['cap-a', 'cap-b'], weight: 2 }
  ];

  for (const resource of resources) {
    queue.upsertResource({
      poolId: 'bench-pool',
      resourceId: resource.id,
      capabilities: resource.caps,
      weight: resource.weight,
      maxConcurrency: 8,
      cooldownMinMs: 100,
      cooldownMaxMs: 200
    });
  }

  queue.upsertServicePolicy({
    poolId: 'bench-pool',
    serviceId: 'svc-a',
    weight: 1,
    minReserved: 1,
    capabilityMode,
    requiredCapabilities: ['cap-a'],
    preferredCapabilities: ['cap-a', 'generic']
  });

  queue.upsertServicePolicy({
    poolId: 'bench-pool',
    serviceId: 'svc-b',
    weight: 1,
    minReserved: 1,
    capabilityMode,
    requiredCapabilities: ['cap-b'],
    preferredCapabilities: ['cap-b', 'generic']
  });

  const heapStart = process.memoryUsage().heapUsed;
  const enqueueStartedAt = performance.now();

  const promises: Array<Promise<unknown>> = [];
  const cancelTargets = Math.floor(jobCount * 0.1);
  const queuedJobIdsForCancel: string[] = [];
  const unsubscribe = queue.subscribeEventRecords((record) => {
    if (record.event.type !== 'job_queued') return;
    if (!record.event.jobId) return;
    if (queuedJobIdsForCancel.length >= cancelTargets) return;
    queuedJobIdsForCancel.push(record.event.jobId);
  });

  for (let index = 0; index < jobCount; index += 1) {
    const serviceId = index % 2 === 0 ? 'svc-a' : 'svc-b';
    const capability: JobPayload['capability'] =
      index % 10 < 4 ? 'cap-a' : index % 10 < 8 ? 'cap-b' : 'generic';

    const mode: JobPayload['mode'] =
      index % 10 < 2 ? 'rate_limit' : index % 10 < 4 ? 'retry_error' : 'ok';

    const priority: JobPriority =
      index % 10 === 0 ? 'high' : index % 10 <= 2 ? 'low' : 'normal';

    const payload: JobPayload = {
      id: index,
      mode,
      capability
    };

    const requiredCapabilities = capability === 'generic' ? [] : [capability];

    const promise = queue
      .enqueue({
        poolId: 'bench-pool',
        feature: 'bench.feature',
        serviceId,
        jobType: 'bench-job',
        priority,
        payload,
        requiredCapabilities,
        maxAttempts: 3,
        timeoutMs: 30_000,
        execute: async (ctx) => {
          if (payload.mode === 'rate_limit' && ctx.attempt <= 2) {
            throw new RateLimitJobError(150, 'bench rate limit');
          }

          if (payload.mode === 'retry_error' && ctx.attempt === 1) {
            throw new RotationJobExecutionError('EXECUTION_ERROR', 'bench transient error');
          }

          return {
            ok: true,
            id: payload.id,
            resourceId: ctx.resource.resourceId
          };
        }
      })
      .then((result) => result);

    promises.push(promise);
  }

  const enqueueFinishedAt = performance.now();

  for (let index = 0; index < cancelTargets && index < queuedJobIdsForCancel.length; index += 1) {
    queue.cancel(queuedJobIdsForCancel[index]);
  }

  const rebalanceDurations: number[] = [];
  for (let i = 0; i < 60; i += 1) {
    const started = performance.now();
    queue.rebalance('bench-pool');
    rebalanceDurations.push(performance.now() - started);
  }

  const results = await Promise.all(promises);

  const snapshotDurations: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const started = performance.now();
    queue.getSnapshot();
    snapshotDurations.push(performance.now() - started);
  }

  const dispatchLatencies: number[] = [];
  for (const result of results as Array<{ queuedAt: number; startedAt?: number }>) {
    if (typeof result.startedAt === 'number') {
      dispatchLatencies.push(Math.max(0, result.startedAt - result.queuedAt));
    }
  }

  const heapEnd = process.memoryUsage().heapUsed;
  const heapDeltaMb = (heapEnd - heapStart) / (1024 * 1024);

  unsubscribe();
  await queue.shutdown({ force: true, reason: 'benchmark completed' });

  return {
    name: `jobs_${jobCount}_${capabilityMode}`,
    jobCount,
    enqueuePerSec: jobCount / Math.max(0.001, (enqueueFinishedAt - enqueueStartedAt) / 1000),
    dispatchLatencyP50Ms: percentile(dispatchLatencies, 50),
    dispatchLatencyP95Ms: percentile(dispatchLatencies, 95),
    dispatchLatencyP99Ms: percentile(dispatchLatencies, 99),
    rebalanceP95Ms: percentile(rebalanceDurations, 95),
    snapshotBuildP95Ms: percentile(snapshotDurations, 95),
    heapDeltaMb,
    durationMs: enqueueFinishedAt - enqueueStartedAt
  };
}

function compareWithBaseline(current: BenchmarkOutput, baselinePath: string): void {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as BenchmarkOutput;
  const baselineByName = new Map(baseline.scenarios.map((item) => [item.name, item]));

  const regressions: string[] = [];
  for (const scenario of current.scenarios) {
    const previous = baselineByName.get(scenario.name);
    if (!previous) continue;

    const dispatchRegression = scenario.dispatchLatencyP95Ms > previous.dispatchLatencyP95Ms * 1.2;
    const rebalanceRegression = scenario.rebalanceP95Ms > previous.rebalanceP95Ms * 1.2;

    if (dispatchRegression || rebalanceRegression) {
      regressions.push(
        `${scenario.name}: dispatchP95 ${previous.dispatchLatencyP95Ms.toFixed(2)} -> ${scenario.dispatchLatencyP95Ms.toFixed(2)}, rebalanceP95 ${previous.rebalanceP95Ms.toFixed(2)} -> ${scenario.rebalanceP95Ms.toFixed(2)}`
      );
    }
  }

  if (regressions.length > 0) {
    throw new Error(`Benchmark regression >20% detected:\n${regressions.join('\n')}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.sizes.length === 0) {
    throw new Error('No benchmark size provided. Use --sizes=10000,50000,100000');
  }

  const scenarios: ScenarioMetrics[] = [];
  for (const size of args.sizes) {
    scenarios.push(await runScenario(size, 'prefer'));
    scenarios.push(await runScenario(size, 'strict'));
  }

  const output: BenchmarkOutput = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    scenarios
  };

  const serialized = JSON.stringify(output, null, 2);
  if (args.outputPath) {
    writeFileSync(args.outputPath, serialized, 'utf8');
  }

  if (args.baselinePath) {
    compareWithBaseline(output, args.baselinePath);
  }

  console.log(serialized);
}

void main().catch((error) => {
  console.error('[queueBenchmark] failed:', error);
  process.exitCode = 1;
});
