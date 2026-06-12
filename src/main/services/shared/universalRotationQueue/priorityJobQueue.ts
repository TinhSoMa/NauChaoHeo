import { JobPriority, QueuedJobRecord } from './rotationTypes';

const PRIORITY_RANK: Record<JobPriority, number> = {
  low: 0,
  normal: 1,
  high: 2
};

const PRIORITY_BUCKETS: JobPriority[] = ['high', 'normal', 'low'];

interface DispatchCandidate {
  record: QueuedJobRecord<unknown, unknown>;
  effectivePriorityRank: number;
}

interface QueueNode {
  jobId: string;
  bucket: JobPriority;
  record: QueuedJobRecord<unknown, unknown>;
  prev: QueueNode | null;
  next: QueueNode | null;
}

interface QueueBucket {
  head: QueueNode | null;
  tail: QueueNode | null;
  size: number;
}

export interface DispatchOrderResult {
  candidates: QueuedJobRecord<unknown, unknown>[];
  nextWakeAt: number | null;
}

export class PriorityJobQueue {
  private readonly nodeByJobId = new Map<string, QueueNode>();
  private readonly buckets: Record<JobPriority, QueueBucket> = {
    high: { head: null, tail: null, size: 0 },
    normal: { head: null, tail: null, size: 0 },
    low: { head: null, tail: null, size: 0 }
  };

  enqueue(record: QueuedJobRecord<unknown, unknown>): void {
    if (this.nodeByJobId.has(record.jobId)) {
      this.remove(record.jobId);
    }

    const priority = record.request.priority ?? 'normal';
    const bucket = this.buckets[priority];
    const node: QueueNode = {
      jobId: record.jobId,
      bucket: priority,
      record,
      prev: bucket.tail,
      next: null
    };

    if (bucket.tail) {
      bucket.tail.next = node;
    } else {
      bucket.head = node;
    }
    bucket.tail = node;
    bucket.size += 1;
    this.nodeByJobId.set(record.jobId, node);
    this.assertInvariants();
  }

  remove(jobId: string): QueuedJobRecord<unknown, unknown> | null {
    const node = this.nodeByJobId.get(jobId);
    if (!node) return null;

    const bucket = this.buckets[node.bucket];
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      bucket.head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      bucket.tail = node.prev;
    }
    bucket.size = Math.max(0, bucket.size - 1);
    this.nodeByJobId.delete(jobId);
    this.assertInvariants();

    return node.record;
  }

  has(jobId: string): boolean {
    return this.nodeByJobId.has(jobId);
  }

  get(jobId: string): QueuedJobRecord<unknown, unknown> | null {
    return this.nodeByJobId.get(jobId)?.record ?? null;
  }

  size(): number {
    return this.nodeByJobId.size;
  }

  listRecords(): QueuedJobRecord<unknown, unknown>[] {
    const result: QueuedJobRecord<unknown, unknown>[] = [];
    for (const node of this.nodeByJobId.values()) {
      result.push(node.record);
    }
    return result;
  }

  listByPool(poolId: string): QueuedJobRecord<unknown, unknown>[] {
    const result: QueuedJobRecord<unknown, unknown>[] = [];
    for (const node of this.nodeByJobId.values()) {
      if (node.record.request.poolId === poolId) {
        result.push(node.record);
      }
    }
    return result;
  }

  drain(): QueuedJobRecord<unknown, unknown>[] {
    const drained: QueuedJobRecord<unknown, unknown>[] = [];
    for (const jobId of [...this.nodeByJobId.keys()]) {
      const removed = this.remove(jobId);
      if (removed) drained.push(removed);
    }
    return drained;
  }

  getQueueDepthByPool(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const node of this.nodeByJobId.values()) {
      const record = node.record;
      result[record.request.poolId] = (result[record.request.poolId] ?? 0) + 1;
    }
    return result;
  }

  getOldestQueuedMs(nowMs: number): number | null {
    let oldestQueuedAt = Number.POSITIVE_INFINITY;
    for (const node of this.nodeByJobId.values()) {
      const record = node.record;
      if (record.queuedAt < oldestQueuedAt) {
        oldestQueuedAt = record.queuedAt;
      }
    }
    return Number.isFinite(oldestQueuedAt) ? nowMs - oldestQueuedAt : null;
  }

  getDispatchOrder(nowMs: number, antiStarvationStepMs: number): DispatchOrderResult {
    const dispatchCandidates: DispatchCandidate[] = [];
    let nextWakeAt: number | null = null;

    for (const priority of PRIORITY_BUCKETS) {
      let current = this.buckets[priority].head;
      while (current) {
        const record = current.record;

        if (record.availableAt > nowMs) {
          if (nextWakeAt === null || record.availableAt < nextWakeAt) {
            nextWakeAt = record.availableAt;
          }
          current = current.next;
          continue;
        }

        dispatchCandidates.push({
          record,
          effectivePriorityRank: this.computeEffectivePriorityRank(
            record,
            nowMs,
            antiStarvationStepMs
          )
        });
        current = current.next;
      }
    }

    dispatchCandidates.sort((a, b) => {
      if (a.effectivePriorityRank !== b.effectivePriorityRank) {
        return b.effectivePriorityRank - a.effectivePriorityRank;
      }
      return a.record.sequence - b.record.sequence;
    });

    return {
      candidates: dispatchCandidates.map((entry) => entry.record),
      nextWakeAt
    };
  }

  private computeEffectivePriorityRank(
    record: QueuedJobRecord<unknown, unknown>,
    nowMs: number,
    antiStarvationStepMs: number
  ): number {
    const basePriority = record.request.priority ?? 'normal';
    const baseRank = PRIORITY_RANK[basePriority];

    if (antiStarvationStepMs <= 0) return baseRank;

    const waitingMs = Math.max(0, nowMs - record.queuedAt);
    const boostSteps = Math.floor(waitingMs / antiStarvationStepMs);
    return Math.min(PRIORITY_RANK.high, baseRank + boostSteps);
  }

  private assertInvariants(): void {
    if (process.env.NODE_ENV === 'production') return;

    let bucketTotal = 0;
    for (const priority of PRIORITY_BUCKETS) {
      const bucket = this.buckets[priority];
      let count = 0;
      let previous: QueueNode | null = null;
      let current = bucket.head;
      while (current) {
        if (current.bucket !== priority) {
          throw new Error(`Priority bucket mismatch for job "${current.jobId}".`);
        }
        if (current.prev !== previous) {
          throw new Error(`Broken prev link for job "${current.jobId}".`);
        }
        previous = current;
        current = current.next;
        count += 1;
      }
      if (bucket.tail !== previous) {
        throw new Error(`Broken tail link for priority bucket "${priority}".`);
      }
      if (bucket.size !== count) {
        throw new Error(`Bucket size mismatch for priority "${priority}".`);
      }
      bucketTotal += count;
    }

    if (bucketTotal !== this.nodeByJobId.size) {
      throw new Error('Queue size mismatch between buckets and node index map.');
    }
  }
}
