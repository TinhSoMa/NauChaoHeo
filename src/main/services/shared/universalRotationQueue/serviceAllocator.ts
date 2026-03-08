import { ResourceRegistry, ResourceRuntime } from './resourceRegistry';
import {
  DispatchEvent,
  ServicePolicy,
  ServiceRuntimeSnapshot,
  ServiceRuntimeState
} from './rotationTypes';

interface NormalizedPolicy {
  poolId: string;
  serviceId: string;
  weight: number;
  minReserved: number;
  maxReserved?: number;
  idleTtlMs: number;
  requiredCapabilities: string[];
  preferredCapabilities: string[];
  capabilityMode: 'prefer' | 'strict';
}

interface ServiceRuntime {
  poolId: string;
  serviceId: string;
  queued: number;
  running: number;
  targetQuota: number;
  assignedResources: number;
  lastSeenAt: number;
  state: ServiceRuntimeState;
  forcedActive?: boolean;
  policy: NormalizedPolicy;
  capabilityDemandBySignature: Record<string, number>;
}

export interface ServiceAllocatorRebalanceInput {
  poolId?: string;
  nowMs: number;
  queuedByPoolService: Record<string, Record<string, number>>;
  runningByPoolService: Record<string, Record<string, number>>;
  capabilityDemandByPoolService?: Record<string, Record<string, Record<string, number>>>;
}

export interface ServiceAllocatorRebalanceResult {
  events: DispatchEvent[];
  nextWakeAt: number | null;
}

export class ServiceAllocator {
  private readonly registry: ResourceRegistry;
  private readonly policyByPool = new Map<string, Map<string, NormalizedPolicy>>();
  private readonly runtimeByPool = new Map<string, Map<string, ServiceRuntime>>();

  constructor(registry: ResourceRegistry) {
    this.registry = registry;
  }

  upsertServicePolicy(policy: ServicePolicy): void {
    const normalized = this.normalizePolicy(policy);
    let poolPolicies = this.policyByPool.get(normalized.poolId);
    if (!poolPolicies) {
      poolPolicies = new Map<string, NormalizedPolicy>();
      this.policyByPool.set(normalized.poolId, poolPolicies);
    }
    poolPolicies.set(normalized.serviceId, normalized);

    const runtime = this.ensureRuntime(normalized.poolId, normalized.serviceId);
    runtime.policy = normalized;
  }

  removeServicePolicy(poolId: string, serviceId: string): boolean {
    const poolPolicies = this.policyByPool.get(poolId);
    if (!poolPolicies) return false;
    const removed = poolPolicies.delete(serviceId);
    if (poolPolicies.size === 0) {
      this.policyByPool.delete(poolId);
    }
    return removed;
  }

  setServiceActive(poolId: string, serviceId: string, active: boolean): void {
    const runtime = this.ensureRuntime(poolId, serviceId);
    runtime.forcedActive = active;
  }

  rebalance(input: ServiceAllocatorRebalanceInput): ServiceAllocatorRebalanceResult {
    const events: DispatchEvent[] = [];
    const poolIds =
      input.poolId !== undefined
        ? [input.poolId]
        : this.getCandidatePoolIds(input.queuedByPoolService, input.runningByPoolService);

    let nextWakeAt: number | null = null;
    for (const poolId of poolIds) {
      if (!this.registry.hasPool(poolId)) continue;
      const poolResult = this.rebalancePool(
        poolId,
        input.nowMs,
        input.queuedByPoolService[poolId] ?? {},
        input.runningByPoolService[poolId] ?? {},
        input.capabilityDemandByPoolService?.[poolId] ?? {}
      );
      events.push(...poolResult.events);
      if (poolResult.nextWakeAt !== null && (nextWakeAt === null || poolResult.nextWakeAt < nextWakeAt)) {
        nextWakeAt = poolResult.nextWakeAt;
      }
    }

    return { events, nextWakeAt };
  }

  getServiceStatsByPool(): Record<string, ServiceRuntimeSnapshot[]> {
    const result: Record<string, ServiceRuntimeSnapshot[]> = {};
    for (const [poolId, poolRuntime] of this.runtimeByPool.entries()) {
      const list = [...poolRuntime.values()]
        .sort((a, b) => a.serviceId.localeCompare(b.serviceId))
        .map((runtime) => this.toSnapshot(runtime));
      result[poolId] = list;
    }
    return result;
  }

  getNextWakeAt(nowMs: number): number | null {
    let nextWakeAt: number | null = null;
    for (const poolRuntime of this.runtimeByPool.values()) {
      for (const runtime of poolRuntime.values()) {
        if (runtime.forcedActive === true || runtime.forcedActive === false) continue;
        if (runtime.queued > 0 || runtime.running > 0) continue;
        if (runtime.state !== 'idle') continue;
        const wakeAt = runtime.lastSeenAt + runtime.policy.idleTtlMs;
        if (wakeAt <= nowMs) continue;
        if (nextWakeAt === null || wakeAt < nextWakeAt) {
          nextWakeAt = wakeAt;
        }
      }
    }
    return nextWakeAt;
  }

  private rebalancePool(
    poolId: string,
    nowMs: number,
    queuedByService: Record<string, number>,
    runningByService: Record<string, number>,
    capabilityDemandByService: Record<string, Record<string, number>>
  ): ServiceAllocatorRebalanceResult {
    const events: DispatchEvent[] = [];
    const resources = this.registry.listPoolResources(poolId);
    const poolRuntime = this.ensurePoolRuntime(poolId);

    const observedServiceIds = new Set<string>([
      ...Object.keys(queuedByService),
      ...Object.keys(runningByService),
      ...Object.keys(capabilityDemandByService)
    ]);
    for (const resource of resources) {
      if (resource.assignedServiceId) observedServiceIds.add(resource.assignedServiceId);
    }
    for (const serviceId of poolRuntime.keys()) {
      observedServiceIds.add(serviceId);
    }

    for (const serviceId of observedServiceIds) {
      this.ensureRuntime(poolId, serviceId);
    }

    let nextWakeAt: number | null = null;
    const activeRuntimes: ServiceRuntime[] = [];

    for (const runtime of poolRuntime.values()) {
      runtime.queued = queuedByService[runtime.serviceId] ?? 0;
      runtime.running = runningByService[runtime.serviceId] ?? 0;
      runtime.capabilityDemandBySignature = capabilityDemandByService[runtime.serviceId] ?? {};

      if (runtime.queued > 0 || runtime.running > 0) {
        runtime.lastSeenAt = nowMs;
      }

      const previousState = runtime.state;
      const nextState = this.resolveServiceState(runtime, nowMs);
      runtime.state = nextState;

      if (nextState !== previousState) {
        const eventType =
          nextState === 'active'
            ? 'service_active'
            : nextState === 'idle'
              ? 'service_idle'
              : 'service_inactive';
        events.push({
          type: eventType,
          timestamp: nowMs,
          poolId,
          serviceId: runtime.serviceId,
          message: `Service moved to ${nextState}.`
        });
      }

      if (nextState !== 'inactive') {
        activeRuntimes.push(runtime);
      } else {
        runtime.targetQuota = 0;
      }

      if (
        runtime.forcedActive !== true &&
        runtime.forcedActive !== false &&
        runtime.queued === 0 &&
        runtime.running === 0 &&
        nextState === 'idle'
      ) {
        const wakeAt = runtime.lastSeenAt + runtime.policy.idleTtlMs;
        if (wakeAt > nowMs && (nextWakeAt === null || wakeAt < nextWakeAt)) {
          nextWakeAt = wakeAt;
        }
      }
    }

    const usableResources = resources.filter((resource) => resource.enabled);
    const targets = this.computeTargets(activeRuntimes, usableResources.length);
    for (const runtime of poolRuntime.values()) {
      const oldTarget = runtime.targetQuota;
      runtime.targetQuota = targets.get(runtime.serviceId) ?? 0;
      if (oldTarget !== runtime.targetQuota) {
        events.push({
          type: 'service_quota_rebalanced',
          timestamp: nowMs,
          poolId,
          serviceId: runtime.serviceId,
          oldQuota: oldTarget,
          newQuota: runtime.targetQuota
        });
      }
    }

    events.push(...this.applyAssignments(poolId, nowMs, resources));
    this.refreshAssignedCounts(poolId, resources);

    return { events, nextWakeAt };
  }

  private applyAssignments(poolId: string, nowMs: number, resources: ResourceRuntime[]): DispatchEvent[] {
    const events: DispatchEvent[] = [];
    const poolRuntime = this.ensurePoolRuntime(poolId);
    const inactiveServiceIds = new Set<string>();
    for (const runtime of poolRuntime.values()) {
      if (runtime.state === 'inactive') inactiveServiceIds.add(runtime.serviceId);
    }

    const orderedResourceIds = this.getResourceOrder(poolId, resources);
    const byId = new Map(resources.map((resource) => [resource.resourceId, resource]));

    const emitAssignmentChange = (
      resourceId: string,
      oldServiceId: string | null,
      newServiceId: string | null
    ): void => {
      events.push({
        type: 'resource_assignment_changed',
        timestamp: nowMs,
        poolId,
        resourceId,
        oldServiceId,
        newServiceId
      });
    };

    for (const resourceId of orderedResourceIds) {
      const resource = byId.get(resourceId);
      if (!resource) continue;
      if (!resource.assignedServiceId) continue;
      if (!inactiveServiceIds.has(resource.assignedServiceId)) continue;
      if (resource.inFlight > 0) continue;

      const oldServiceId = resource.assignedServiceId;
      const changed = this.registry.setResourceAssignment(poolId, resourceId, null);
      if (changed) emitAssignmentChange(resourceId, oldServiceId, null);
    }

    const activeRuntimes = [...poolRuntime.values()].filter((runtime) => runtime.state !== 'inactive');
    if (activeRuntimes.length === 0) return events;

    const getCounts = (): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const runtime of poolRuntime.values()) {
        counts.set(runtime.serviceId, 0);
      }
      for (const resource of this.registry.listPoolResources(poolId)) {
        if (!resource.enabled) continue;
        const assigned = resource.assignedServiceId;
        if (!assigned) continue;
        counts.set(assigned, (counts.get(assigned) ?? 0) + 1);
      }
      return counts;
    };

    const counts = getCounts();

    for (const resourceId of orderedResourceIds) {
      const resource = byId.get(resourceId);
      if (!resource || !resource.enabled || resource.inFlight > 0) continue;
      const assigned = resource.assignedServiceId;
      if (!assigned) continue;
      const runtime = poolRuntime.get(assigned);
      if (!runtime) continue;
      const serviceCount = counts.get(assigned) ?? 0;
      if (serviceCount <= runtime.targetQuota) continue;

      const changed = this.registry.setResourceAssignment(poolId, resourceId, null);
      if (!changed) continue;
      counts.set(assigned, Math.max(0, serviceCount - 1));
      emitAssignmentChange(resourceId, assigned, null);
    }

    const pickNextDeficitService = (resource: ResourceRuntime): ServiceRuntime | null => {
      const resourceCaps = new Set(resource.capabilities);
      const sorted = activeRuntimes
        .filter((runtime) => (counts.get(runtime.serviceId) ?? 0) < runtime.targetQuota)
        .map((runtime) => {
          const deficit = runtime.targetQuota - (counts.get(runtime.serviceId) ?? 0);
          const capabilityFit = this.computeCapabilityFit(runtime, resourceCaps);
          const capabilityDemandScore = this.computeCapabilityDemandScore(
            runtime.capabilityDemandBySignature,
            resourceCaps
          );
          return {
            runtime,
            deficit,
            capabilityFit,
            capabilityDemandScore,
            demand: runtime.queued + runtime.running
          };
        })
        .filter((item) => item.capabilityFit >= 0)
        .sort((a, b) => {
          if (a.deficit !== b.deficit) return b.deficit - a.deficit;
          if (a.capabilityFit !== b.capabilityFit) return b.capabilityFit - a.capabilityFit;
          if (a.capabilityDemandScore !== b.capabilityDemandScore) {
            return b.capabilityDemandScore - a.capabilityDemandScore;
          }
          if (a.demand !== b.demand) return b.demand - a.demand;
          return a.runtime.serviceId.localeCompare(b.runtime.serviceId);
        });
      return sorted[0]?.runtime ?? null;
    };

    for (const resourceId of orderedResourceIds) {
      const resource = byId.get(resourceId);
      if (!resource || !resource.enabled || resource.inFlight > 0) continue;
      if (resource.assignedServiceId) continue;

      const deficitService = pickNextDeficitService(resource);
      if (!deficitService) break;

      const changed = this.registry.setResourceAssignment(poolId, resourceId, deficitService.serviceId);
      if (!changed) continue;
      counts.set(deficitService.serviceId, (counts.get(deficitService.serviceId) ?? 0) + 1);
      emitAssignmentChange(resourceId, null, deficitService.serviceId);
    }

    for (const resourceId of orderedResourceIds) {
      const resource = byId.get(resourceId);
      if (!resource || !resource.enabled || resource.inFlight > 0) continue;
      const deficitService = pickNextDeficitService(resource);
      if (!deficitService) break;

      const assigned = resource.assignedServiceId;
      if (!assigned || assigned === deficitService.serviceId) continue;

      const donorRuntime = poolRuntime.get(assigned);
      if (!donorRuntime) continue;
      const donorCount = counts.get(assigned) ?? 0;
      if (donorCount <= donorRuntime.targetQuota) continue;

      const changed = this.registry.setResourceAssignment(poolId, resourceId, deficitService.serviceId);
      if (!changed) continue;

      counts.set(assigned, Math.max(0, donorCount - 1));
      counts.set(deficitService.serviceId, (counts.get(deficitService.serviceId) ?? 0) + 1);
      emitAssignmentChange(resourceId, assigned, deficitService.serviceId);
    }

    return events;
  }

  private refreshAssignedCounts(poolId: string, resources: ResourceRuntime[]): void {
    const poolRuntime = this.ensurePoolRuntime(poolId);
    for (const runtime of poolRuntime.values()) {
      runtime.assignedResources = 0;
    }
    for (const resource of resources) {
      if (!resource.assignedServiceId) continue;
      const runtime = poolRuntime.get(resource.assignedServiceId);
      if (!runtime) continue;
      runtime.assignedResources += 1;
    }
  }

  private resolveServiceState(runtime: ServiceRuntime, nowMs: number): ServiceRuntimeState {
    if (runtime.forcedActive === true) return 'active';
    if (runtime.forcedActive === false) return 'inactive';

    if (runtime.running > 0 || runtime.queued > 0) return 'active';
    if (nowMs - runtime.lastSeenAt <= runtime.policy.idleTtlMs) return 'idle';
    return 'inactive';
  }

  private computeTargets(activeRuntimes: ServiceRuntime[], resourceCount: number): Map<string, number> {
    const targets = new Map<string, number>();
    if (activeRuntimes.length === 0 || resourceCount <= 0) {
      for (const runtime of activeRuntimes) {
        targets.set(runtime.serviceId, 0);
      }
      return targets;
    }

    const canGuaranteeMin = resourceCount >= activeRuntimes.length;
    const scoreMap = new Map<string, number>();
    let scoreSum = 0;

    for (const runtime of activeRuntimes) {
      const demand = runtime.queued + runtime.running;
      const score = runtime.policy.weight * Math.max(1, demand);
      scoreMap.set(runtime.serviceId, score);
      scoreSum += score;
    }

    const remainders: Array<{ serviceId: string; rem: number }> = [];
    let totalAssigned = 0;

    for (const runtime of activeRuntimes) {
      const score = scoreMap.get(runtime.serviceId) ?? 0;
      const raw = scoreSum > 0 ? (resourceCount * score) / scoreSum : 0;
      let target = Math.floor(raw);

      if (canGuaranteeMin) {
        target = Math.max(target, runtime.policy.minReserved);
      }
      if (runtime.policy.maxReserved !== undefined) {
        target = Math.min(target, runtime.policy.maxReserved);
      }

      targets.set(runtime.serviceId, target);
      totalAssigned += target;
      remainders.push({ serviceId: runtime.serviceId, rem: raw - Math.floor(raw) });
    }

    if (totalAssigned < resourceCount) {
      const sortedRemainders = remainders.sort((a, b) => {
        if (b.rem !== a.rem) return b.rem - a.rem;
        return a.serviceId.localeCompare(b.serviceId);
      });

      let remaining = resourceCount - totalAssigned;
      let index = 0;
      while (remaining > 0 && sortedRemainders.length > 0) {
        const serviceId = sortedRemainders[index % sortedRemainders.length].serviceId;
        const runtime = activeRuntimes.find((item) => item.serviceId === serviceId);
        const current = targets.get(serviceId) ?? 0;
        if (runtime && runtime.policy.maxReserved !== undefined && current >= runtime.policy.maxReserved) {
          index += 1;
          if (index > sortedRemainders.length * 3) break;
          continue;
        }
        targets.set(serviceId, current + 1);
        remaining -= 1;
        index += 1;
      }
    }

    let totalAfter = 0;
    for (const value of targets.values()) totalAfter += value;
    if (totalAfter > resourceCount) {
      let overflow = totalAfter - resourceCount;
      const sortedForReduce = [...activeRuntimes].sort((a, b) => {
        const demandA = a.queued + a.running;
        const demandB = b.queued + b.running;
        if (demandA !== demandB) return demandA - demandB;
        if (a.policy.weight !== b.policy.weight) return a.policy.weight - b.policy.weight;
        return a.serviceId.localeCompare(b.serviceId);
      });

      while (overflow > 0) {
        let changed = false;
        for (const runtime of sortedForReduce) {
          const current = targets.get(runtime.serviceId) ?? 0;
          const minAllowed = canGuaranteeMin ? runtime.policy.minReserved : 0;
          if (current <= minAllowed) continue;
          targets.set(runtime.serviceId, current - 1);
          overflow -= 1;
          changed = true;
          if (overflow <= 0) break;
        }
        if (!changed) {
          for (const runtime of sortedForReduce) {
            const current = targets.get(runtime.serviceId) ?? 0;
            if (current <= 0) continue;
            targets.set(runtime.serviceId, current - 1);
            overflow -= 1;
            changed = true;
            if (overflow <= 0) break;
          }
        }
        if (!changed) break;
      }
    }

    for (const runtime of activeRuntimes) {
      const current = targets.get(runtime.serviceId) ?? 0;
      targets.set(runtime.serviceId, Math.max(0, current));
    }

    return targets;
  }

  private getResourceOrder(poolId: string, resources: ResourceRuntime[]): string[] {
    const ordered = this.registry.getPoolAllocationOrder(poolId);
    if (ordered.length === 0) {
      return resources.map((resource) => resource.resourceId);
    }
    const seen = new Set(ordered);
    const result = [...ordered];
    for (const resource of resources) {
      if (!seen.has(resource.resourceId)) {
        result.push(resource.resourceId);
      }
    }
    return result;
  }

  private getCandidatePoolIds(
    queuedByPoolService: Record<string, Record<string, number>>,
    runningByPoolService: Record<string, Record<string, number>>
  ): string[] {
    const poolIds = new Set<string>([
      ...this.registry.getAllPoolIds(),
      ...Object.keys(queuedByPoolService),
      ...Object.keys(runningByPoolService),
      ...this.policyByPool.keys(),
      ...this.runtimeByPool.keys()
    ]);
    return [...poolIds];
  }

  private ensurePoolRuntime(poolId: string): Map<string, ServiceRuntime> {
    let poolRuntime = this.runtimeByPool.get(poolId);
    if (!poolRuntime) {
      poolRuntime = new Map<string, ServiceRuntime>();
      this.runtimeByPool.set(poolId, poolRuntime);
    }
    return poolRuntime;
  }

  private ensureRuntime(poolId: string, serviceId: string): ServiceRuntime {
    const normalizedServiceId = serviceId.trim();
    const poolRuntime = this.ensurePoolRuntime(poolId);
    const existing = poolRuntime.get(normalizedServiceId);
    if (existing) return existing;

    const policy = this.getPolicy(poolId, normalizedServiceId);
    const nowMs = Date.now();
    const created: ServiceRuntime = {
      poolId,
      serviceId: normalizedServiceId,
      queued: 0,
      running: 0,
      targetQuota: 0,
      assignedResources: 0,
      lastSeenAt: nowMs,
      state: 'idle',
      policy,
      capabilityDemandBySignature: {}
    };
    poolRuntime.set(normalizedServiceId, created);
    return created;
  }

  private getPolicy(poolId: string, serviceId: string): NormalizedPolicy {
    const fromMap = this.policyByPool.get(poolId)?.get(serviceId);
    if (fromMap) return fromMap;
    return {
      poolId,
      serviceId,
      weight: 1,
      minReserved: 1,
      maxReserved: undefined,
      idleTtlMs: 30_000,
      requiredCapabilities: [],
      preferredCapabilities: [],
      capabilityMode: 'prefer'
    };
  }

  private normalizePolicy(policy: ServicePolicy): NormalizedPolicy {
    const poolId = policy.poolId?.trim();
    const serviceId = policy.serviceId?.trim();
    if (!poolId) {
      throw new Error('ServicePolicy.poolId is required.');
    }
    if (!serviceId) {
      throw new Error('ServicePolicy.serviceId is required.');
    }

    const weight = Number.isFinite(policy.weight) && (policy.weight ?? 0) > 0 ? policy.weight ?? 1 : 1;
    const minReserved =
      Number.isFinite(policy.minReserved) && (policy.minReserved ?? 0) >= 0
        ? Math.floor(policy.minReserved ?? 0)
        : 1;
    const maxReserved =
      Number.isFinite(policy.maxReserved) && (policy.maxReserved ?? 0) >= 0
        ? Math.floor(policy.maxReserved as number)
        : undefined;
    const idleTtlMs =
      Number.isFinite(policy.idleTtlMs) && (policy.idleTtlMs ?? 0) > 0
        ? Math.floor(policy.idleTtlMs as number)
        : 30_000;

    const capabilityMode = policy.capabilityMode === 'strict' ? 'strict' : 'prefer';

    return {
      poolId,
      serviceId,
      weight,
      minReserved,
      maxReserved,
      idleTtlMs,
      requiredCapabilities: this.normalizeCapabilities(policy.requiredCapabilities),
      preferredCapabilities: this.normalizeCapabilities(policy.preferredCapabilities),
      capabilityMode
    };
  }

  private computeCapabilityFit(runtime: ServiceRuntime, resourceCapabilities: Set<string>): number {
    const required = runtime.policy.requiredCapabilities;
    const preferred = runtime.policy.preferredCapabilities;
    const requiredMatched = this.matchesCapabilitySet(required, resourceCapabilities);

    if (runtime.policy.capabilityMode === 'strict' && !requiredMatched) {
      return -1;
    }

    let score = 0;
    if (required.length === 0) {
      score += 1;
    } else if (requiredMatched) {
      score += 3;
    }

    if (preferred.length > 0) {
      let preferredMatches = 0;
      for (const cap of preferred) {
        if (resourceCapabilities.has(cap)) preferredMatches += 1;
      }
      score += Math.min(2, preferredMatches);
    }

    return score;
  }

  private computeCapabilityDemandScore(
    demandBySignature: Record<string, number>,
    resourceCapabilities: Set<string>
  ): number {
    let score = 0;
    for (const [signature, count] of Object.entries(demandBySignature)) {
      if (!Number.isFinite(count) || count <= 0) continue;
      if (!signature) {
        score += count;
        continue;
      }

      const required = signature.split('|').filter(Boolean);
      if (required.length === 0) {
        score += count;
        continue;
      }

      let matched = true;
      for (const cap of required) {
        if (!resourceCapabilities.has(cap)) {
          matched = false;
          break;
        }
      }
      if (matched) score += count;
    }
    return score;
  }

  private matchesCapabilitySet(requiredCapabilities: string[], resourceCapabilities: Set<string>): boolean {
    if (requiredCapabilities.length === 0) return true;
    for (const required of requiredCapabilities) {
      if (!resourceCapabilities.has(required)) return false;
    }
    return true;
  }

  private normalizeCapabilities(capabilities?: string[]): string[] {
    if (!capabilities || capabilities.length === 0) return [];
    const unique = new Set<string>();
    for (const capability of capabilities) {
      const normalized = capability.trim().toLowerCase();
      if (!normalized) continue;
      unique.add(normalized);
    }
    return [...unique];
  }

  private toSnapshot(runtime: ServiceRuntime): ServiceRuntimeSnapshot {
    return {
      poolId: runtime.poolId,
      serviceId: runtime.serviceId,
      queued: runtime.queued,
      running: runtime.running,
      targetQuota: runtime.targetQuota,
      assignedResources: runtime.assignedResources,
      lastSeenAt: runtime.lastSeenAt,
      state: runtime.state,
      policy: {
        weight: runtime.policy.weight,
        minReserved: runtime.policy.minReserved,
        maxReserved: runtime.policy.maxReserved,
        idleTtlMs: runtime.policy.idleTtlMs,
        requiredCapabilities: [...runtime.policy.requiredCapabilities],
        preferredCapabilities: [...runtime.policy.preferredCapabilities],
        capabilityMode: runtime.policy.capabilityMode
      }
    };
  }
}
