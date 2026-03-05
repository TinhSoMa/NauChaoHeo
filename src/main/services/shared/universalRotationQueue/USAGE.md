# Universal Rotation & Queue Service

## Muc tieu
Service nay la backend library dung chung cho moi feature can xoay vong tai nguyen:
- token
- api key
- proxy
- account
- browser slot
- worker slot

Vong doi resource:
`ready -> busy -> cooldown -> ready`

## Tao service

```ts
import { UniversalRotationQueueService } from './universalRotationQueue';

const queue = new UniversalRotationQueueService({
  globalMaxConcurrentJobs: 20,
  maxConcurrentPerFeature: 5,
  defaultJobTimeoutMs: 120000,
  defaultMaxAttempts: 3,
  defaultCooldownMinMs: 10000,
  defaultCooldownMaxMs: 20000,
  antiStarvationStepMs: 15000,
  enableServiceAllocator: true,
  enableRotationQueueInspector: true
});
```

## Runtime registry cleanup an toan

```ts
import {
  getQueueRuntimeOrCreate,
  removeQueueRuntime,
  removeAllQueueRuntimes
} from './runtimeRegistry';

const runtime = getQueueRuntimeOrCreate('caption.translation');

// Backward compatible (sync)
removeQueueRuntime('caption.translation');

// Safe cleanup (async shutdown truoc khi remove)
await removeQueueRuntime('caption.translation', {
  shutdown: true,
  force: false,
  timeoutMs: 30000,
  reason: 'Runtime removed'
});

await removeAllQueueRuntimes({ shutdown: true, force: true });
```

## Queue observability

Mac dinh inspector duoc bat qua feature flag main process:

```powershell
$env:ENABLE_ROTATION_QUEUE_INSPECTOR="1"
```

Tu code backend:

```ts
const inspector = queue.getInspectorSnapshot({
  state: 'all',
  includePayload: false
});

const history = queue.getEventHistory(100);
```

Co the clear history:

```ts
queue.clearEventHistory();
// equivalent:
queue.clearEventHistory({ resetDroppedCounter: true });
```

Policy clear history:
- `clearEventHistory()` luon clear buffer event.
- `seq` cua `QueueEventRecord` la monotonic trong suot runtime instance, **khong reset** sau clear.
- `droppedHistoryCount` reset ve `0` theo default (`resetDroppedCounter: true`).
- Neu muon giu dropped counter: `clearEventHistory({ resetDroppedCounter: false })`.

## Dang ky pool va resource

```ts
queue.registerPool({
  poolId: 'caption-api-keys',
  selector: 'weighted_round_robin'
});

queue.upsertResource({
  poolId: 'caption-api-keys',
  resourceId: 'acc-a',
  capabilities: ['gemini', 'caption'],
  weight: 2,
  maxConcurrency: 1,
  cooldownMinMs: 10000,
  cooldownMaxMs: 20000
});

queue.upsertResource({
  poolId: 'caption-api-keys',
  resourceId: 'acc-b',
  capabilities: ['gemini', 'caption'],
  weight: 1,
  maxConcurrency: 1
});
```

## Enqueue job

```ts
const result = await queue.enqueue({
  poolId: 'caption-api-keys',
  feature: 'caption',
  serviceId: 'caption-service-a',
  jobType: 'translate-line',
  priority: 'normal',
  requiredCapabilities: ['caption'],
  payload: { text: 'xin chao' },
  execute: async (ctx) => {
    // ctx.resource la account duoc chon tu scheduler
    // ctx.attempt la lan thu hien tai
    return `translated by ${ctx.resource.resourceId}`;
  }
});
```

## Chia account theo service

```ts
queue.upsertServicePolicy({
  poolId: 'caption-api-keys',
  serviceId: 'caption-service-a',
  weight: 1,
  minReserved: 1,
  idleTtlMs: 30000
});

queue.upsertServicePolicy({
  poolId: 'caption-api-keys',
  serviceId: 'caption-service-b',
  weight: 1,
  minReserved: 1,
  idleTtlMs: 30000
});

// Rebalance thu cong khi can debug/ops
queue.rebalance('caption-api-keys');
```

Quy tac:
- `serviceId` mac dinh = `feature` neu khong truyen.
- 2 service cung chay: chia account theo fair-share dong.
- Service dung qua `idleTtlMs`: account assigned duoc thu hoi.
- Service moi vao khi service cu dang chay: khong preempt job dang chay, chi ap dung cho job moi.

## Event stream va snapshot

```ts
const unsubscribe = queue.subscribeEventRecords((record, snapshot) => {
  console.log(record.seq, record.event.type, record.event.jobId, record.event.resourceId);
  console.log(snapshot.queueDepthByPool, snapshot.resourceStateCountsByPool);
});
```

API cu van hoat dong de backward compatibility:

```ts
queue.subscribe((event, snapshot) => {
  console.log(event.type, event.metadata?.seq);
});
```

Events:
- `job_queued`
- `job_started`
- `job_retry_scheduled`
- `job_succeeded`
- `job_failed`
- `job_cancelled`
- `resource_selected`
- `resource_cooldown_set`
- `resource_state_changed`
- `service_active`
- `service_idle`
- `service_inactive`
- `resource_assignment_changed`
- `service_quota_rebalanced`

Snapshot gom:
- `snapshotVersion`
- `stateVersionAtBuild`
- `freshness` (`fresh_read` | `coalesced_emit`)
- `queueDepthByPool`
- `runningJobsByPool`
- `resourceStateCountsByPool`
- `oldestQueuedMs`
- `nextWakeAt`
- `serviceStatsByPool`
- `resourceAssignmentsByPool`
- `jobs` (queued/retry/running, task-level)
- `runningByResource` (resource -> running jobId)
- `historySize`, `droppedHistoryCount`

IPC channels quan sat queue:
- `rotationQueue:getSnapshot`
- `rotationQueue:getHistory`
- `rotationQueue:clearHistory`
- `rotationQueue:startStream`
- `rotationQueue:stopStream`
- push stream:
  - `rotationQueue:stream:event`
  - `rotationQueue:stream:snapshot`

Runtime registry theo feature:

```ts
import { getQueueRuntimeOrCreate } from './runtimeRegistry';

const captionQueue = getQueueRuntimeOrCreate('caption.translation');
const storyQueue = getQueueRuntimeOrCreate('story.translation');
```

`getSnapshot()` luon tra semantics `fresh_read`.  
Snapshot gui kem callback event duoc danh dau `coalesced_emit` theo tick `500ms`.

## Vi du flow xoay vong

### Caption
- Pool: `caption-api-keys`
- Resource: `acc-a`, `acc-b`, `acc-c`
- Job chay xong:
1. Resource vao `cooldown`.
2. Scheduler chon resource tiep theo theo RR/weighted RR.
3. Het cooldown thi resource tu dong quay lai `ready`.

### Story
- Pool: `story-impit-accounts`
- Job summary co `priority: high`.
- Job translation co `priority: normal`.
- Job summary se duoc chay truoc, nhung job cho lau duoc boost priority boi anti-starvation.

### Proxy
- Pool: `proxy-pool`
- Resource co capability theo region: `['us']`, `['sg']`.
- Job co `requiredCapabilities: ['sg']` chi duoc gan vao proxy phu hop.

## Retry va rate limit

- Backoff retry: `2s * attempt`, toi da `30s`, cong jitter `0..500ms`.
- Neu loi co `retryAfterMs`, resource duoc set cooldown theo gia tri do.
- Vuot `maxAttempts` => job `failed` (terminal).

## Error code contract

`DispatchEvent.errorCode` va `JobResult.errorCode` su dung:
- `CANCELLED_BY_USER`
- `CANCELLED_BY_SHUTDOWN`
- `TIMEOUT`
- `RATE_LIMIT`
- `RESOURCE_UNAVAILABLE`
- `EXECUTION_ERROR`

Khuyen nghi feature caller throw loi co `code` ro rang (vd `RATE_LIMIT`) thay vi dua vao parse message.

## Service capability policy

```ts
queue.upsertServicePolicy({
  poolId: 'caption-api-keys',
  serviceId: 'caption-service-a',
  capabilityMode: 'prefer', // default
  requiredCapabilities: ['cap-a'],
  preferredCapabilities: ['generic']
});
```

- `strict`: resource khong match `requiredCapabilities` thi khong duoc assign.
- `prefer`: uu tien resource match capability, nhung van fallback de tranh tac queue.

## Benchmark 10k-100k

```powershell
npm run bench:rotation-queue
```

Co the truyen baseline/output:

```powershell
node dist/main/src/main/services/shared/universalRotationQueue/benchmarks/queueBenchmark.js --sizes=10000,50000,100000 --output=bench.current.json --baseline=bench.baseline.json
```

## Cancel va shutdown

- `cancel(jobId)`:
  - Pending => huy ngay, khong execute.
  - Running => gui abort signal.
- `shutdown({ force: false })`:
  - khong nhan job moi
  - cho job dang chay ket thuc
  - pending con lai bi cancel khi shutdown hoan tat
- `shutdown({ force: true })`:
  - abort running jobs
  - cancel pending jobs
