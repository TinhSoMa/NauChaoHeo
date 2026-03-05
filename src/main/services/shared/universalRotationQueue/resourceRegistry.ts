import {
  InvalidPoolDefinitionError,
  InvalidResourceDefinitionError,
  PoolNotFoundError,
  ResourceNotFoundError,
  ResourceUnavailableError
} from './rotationErrors';
import {
  PoolDefinition,
  ResourceDefinition,
  ResourceRuntimeSnapshot,
  ResourceState,
  ResourceStateCounts
} from './rotationTypes';

interface SelectionCriteria {
  poolId: string;
  serviceId?: string;
  requiredCapabilities?: string[];
  preferredResourceId?: string;
  nowMs: number;
}

export interface ResourceSelectionResult {
  resource: ResourceRuntime | null;
  nextWakeAt: number | null;
}

export interface ResourceAvailabilityResult {
  hasAvailableResource: boolean;
  nextWakeAt: number | null;
}

interface PoolRuntime {
  poolId: string;
  label: string;
  selector: 'round_robin' | 'weighted_round_robin';
  dispatchSpacingMs: number;
  defaultCooldownMinMs: number;
  defaultCooldownMaxMs: number;
  defaultMaxConcurrencyPerResource: number;
  metadata?: Record<string, unknown>;
  resources: Map<string, ResourceRuntime>;
  roundRobinCursor: number;
  roundRobinOrder: string[];
  smoothCurrentWeightByResourceId: Map<string, number>;
  hasCustomWeight: boolean;
}

export interface ResourceRuntime {
  poolId: string;
  resourceId: string;
  label: string;
  capabilities: string[];
  enabled: boolean;
  weight: number;
  maxConcurrency: number;
  cooldownMinMs: number;
  cooldownMaxMs: number;
  metadata?: Record<string, unknown>;
  inFlight: number;
  cooldownUntil: number;
  errorUntil: number;
  assignedServiceId: string | null;
  assignmentUpdatedAt: number;
  lastError?: string;
  lastAcquiredAt?: number;
  insertedOrder: number;
}

const EMPTY_COUNTS: ResourceStateCounts = {
  ready: 0,
  busy: 0,
  cooldown: 0,
  disabled: 0,
  error: 0
};

export interface ResourceRegistryOptions {
  defaultCooldownMinMs: number;
  defaultCooldownMaxMs: number;
  defaultMaxConcurrencyPerResource: number;
  defaultDispatchSpacingMs: number;
  enforceSingleFlightPerResource: boolean;
}

export class ResourceRegistry {
  private readonly pools = new Map<string, PoolRuntime>();
  private insertSequence = 0;
  private readonly options: ResourceRegistryOptions;

  constructor(options: ResourceRegistryOptions) {
    this.options = options;
  }

  hasPool(poolId: string): boolean {
    return this.pools.has(poolId);
  }

  registerPool(poolDef: PoolDefinition): void {
    const poolId = poolDef.poolId?.trim();
    if (!poolId) throw new InvalidPoolDefinitionError(String(poolDef.poolId));

    const previous = this.pools.get(poolId);
    const resources = previous?.resources ?? new Map<string, ResourceRuntime>();

    const poolRuntime: PoolRuntime = {
      poolId,
      label: poolDef.label?.trim() || poolId,
      selector: poolDef.selector ?? previous?.selector ?? 'round_robin',
      dispatchSpacingMs: this.normalizeMs(
        poolDef.dispatchSpacingMs ?? previous?.dispatchSpacingMs ?? this.options.defaultDispatchSpacingMs
      ),
      defaultCooldownMinMs: this.normalizeMs(
        poolDef.defaultCooldownMinMs ?? previous?.defaultCooldownMinMs ?? this.options.defaultCooldownMinMs
      ),
      defaultCooldownMaxMs: this.normalizeMaxMs(
        poolDef.defaultCooldownMinMs ?? previous?.defaultCooldownMinMs ?? this.options.defaultCooldownMinMs,
        poolDef.defaultCooldownMaxMs ?? previous?.defaultCooldownMaxMs ?? this.options.defaultCooldownMaxMs
      ),
      defaultMaxConcurrencyPerResource: this.normalizeConcurrency(
        poolDef.defaultMaxConcurrencyPerResource ??
          previous?.defaultMaxConcurrencyPerResource ??
          this.options.defaultMaxConcurrencyPerResource
      ),
      metadata: poolDef.metadata ?? previous?.metadata,
      resources,
      roundRobinCursor: previous?.roundRobinCursor ?? 0,
      roundRobinOrder: [],
      smoothCurrentWeightByResourceId: previous?.smoothCurrentWeightByResourceId ?? new Map(),
      hasCustomWeight: false
    };

    this.pools.set(poolId, poolRuntime);
    this.rebuildOrders(poolRuntime);
  }

  upsertResource(resourceDef: ResourceDefinition): void {
    const pool = this.getPoolOrThrow(resourceDef.poolId);

    const resourceId = resourceDef.resourceId?.trim();
    if (!resourceId) {
      throw new InvalidResourceDefinitionError(resourceDef.poolId, String(resourceDef.resourceId));
    }

    const existing = pool.resources.get(resourceId);
    const normalizedMaxConcurrency = this.normalizeConcurrency(
      resourceDef.maxConcurrency ??
        existing?.maxConcurrency ??
        pool.defaultMaxConcurrencyPerResource
    );
    const nextResource: ResourceRuntime = {
      poolId: pool.poolId,
      resourceId,
      label: resourceDef.label?.trim() || existing?.label || resourceId,
      capabilities: this.normalizeCapabilities(resourceDef.capabilities ?? existing?.capabilities),
      enabled: resourceDef.enabled ?? existing?.enabled ?? true,
      weight: this.normalizeWeight(resourceDef.weight ?? existing?.weight ?? 1),
      maxConcurrency: this.options.enforceSingleFlightPerResource ? 1 : normalizedMaxConcurrency,
      cooldownMinMs: this.normalizeMs(
        resourceDef.cooldownMinMs ?? existing?.cooldownMinMs ?? pool.defaultCooldownMinMs
      ),
      cooldownMaxMs: this.normalizeMaxMs(
        resourceDef.cooldownMinMs ?? existing?.cooldownMinMs ?? pool.defaultCooldownMinMs,
        resourceDef.cooldownMaxMs ?? existing?.cooldownMaxMs ?? pool.defaultCooldownMaxMs
      ),
      metadata: resourceDef.metadata ?? existing?.metadata,
      inFlight: existing?.inFlight ?? 0,
      cooldownUntil: existing?.cooldownUntil ?? 0,
      errorUntil: existing?.errorUntil ?? 0,
      assignedServiceId: existing?.assignedServiceId ?? null,
      assignmentUpdatedAt: existing?.assignmentUpdatedAt ?? 0,
      lastError: existing?.lastError,
      lastAcquiredAt: existing?.lastAcquiredAt,
      insertedOrder: existing?.insertedOrder ?? this.insertSequence++
    };

    pool.resources.set(resourceId, nextResource);
    this.rebuildOrders(pool);
  }

  removeResource(poolId: string, resourceId: string): boolean {
    const pool = this.getPoolOrThrow(poolId);
    const deleted = pool.resources.delete(resourceId);
    if (deleted) this.rebuildOrders(pool);
    return deleted;
  }

  setResourceCooldown(poolId: string, resourceId: string, untilMs: number): void {
    const resource = this.getResourceOrThrow(poolId, resourceId);
    resource.cooldownUntil = Math.max(resource.cooldownUntil, untilMs);
  }

  setResourceEnabled(poolId: string, resourceId: string, enabled: boolean): void {
    const resource = this.getResourceOrThrow(poolId, resourceId);
    resource.enabled = enabled;
  }

  markResourceFailure(
    poolId: string,
    resourceId: string,
    reason: string,
    retryAfterMs?: number
  ): void {
    const resource = this.getResourceOrThrow(poolId, resourceId);
    const nowMs = Date.now();

    resource.lastError = reason || 'Resource failure';
    if ((retryAfterMs ?? 0) > 0) {
      resource.errorUntil = Math.max(resource.errorUntil, nowMs + (retryAfterMs ?? 0));
    } else {
      resource.errorUntil = Math.max(resource.errorUntil, nowMs);
    }
  }

  getResource(poolId: string, resourceId: string): ResourceRuntime {
    return this.getResourceOrThrow(poolId, resourceId);
  }

  getPoolDispatchSpacingMs(poolId: string): number {
    const pool = this.getPoolOrThrow(poolId);
    return pool.dispatchSpacingMs;
  }

  listPoolResources(poolId: string): ResourceRuntime[] {
    const pool = this.getPoolOrThrow(poolId);
    return [...pool.resources.values()].sort((a, b) => a.insertedOrder - b.insertedOrder);
  }

  getAllPoolIds(): string[] {
    return [...this.pools.keys()];
  }

  getPoolAllocationOrder(poolId: string): string[] {
    const pool = this.getPoolOrThrow(poolId);
    const order = pool.roundRobinOrder;
    const cursor = pool.roundRobinCursor;
    if (order.length === 0) return [];

    const rotated: string[] = [];
    for (let offset = 0; offset < order.length; offset += 1) {
      rotated.push(order[(cursor + offset) % order.length]);
    }

    // unique + preserve order
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const item of rotated) {
      if (seen.has(item)) continue;
      seen.add(item);
      unique.push(item);
    }
    return unique;
  }

  getResourceAssignmentsByPool(): Record<string, Record<string, string | null>> {
    const result: Record<string, Record<string, string | null>> = {};
    for (const [poolId, pool] of this.pools.entries()) {
      const assignments: Record<string, string | null> = {};
      for (const [resourceId, resource] of pool.resources.entries()) {
        assignments[resourceId] = resource.assignedServiceId;
      }
      result[poolId] = assignments;
    }
    return result;
  }

  getResourceAssignment(poolId: string, resourceId: string): string | null {
    return this.getResourceOrThrow(poolId, resourceId).assignedServiceId;
  }

  setResourceAssignment(poolId: string, resourceId: string, serviceId: string | null): boolean {
    const resource = this.getResourceOrThrow(poolId, resourceId);
    const normalized = serviceId?.trim() || null;
    if (resource.assignedServiceId === normalized) return false;

    resource.assignedServiceId = normalized;
    resource.assignmentUpdatedAt = Date.now();
    return true;
  }

  isResourceReassignable(poolId: string, resourceId: string): boolean {
    const resource = this.getResourceOrThrow(poolId, resourceId);
    return resource.inFlight === 0;
  }

  acquireResource(poolId: string, resourceId: string, nowMs: number, serviceId?: string): void {
    const resource = this.getResourceOrThrow(poolId, resourceId);
    if (!this.isEligible(resource, nowMs, undefined, serviceId)) {
      throw new ResourceUnavailableError(poolId, resourceId);
    }

    resource.inFlight += 1;
    resource.lastAcquiredAt = nowMs;
  }

  releaseResource(poolId: string, resourceId: string): void {
    const resource = this.getResourceOrThrow(poolId, resourceId);
    resource.inFlight = Math.max(0, resource.inFlight - 1);
  }

  selectResource(criteria: SelectionCriteria): ResourceSelectionResult {
    return this.computeResourceSelection(criteria, true);
  }

  peekResourceAvailability(criteria: SelectionCriteria): ResourceAvailabilityResult {
    const result = this.computeResourceSelection(criteria, false);
    return {
      hasAvailableResource: result.resource !== null,
      nextWakeAt: result.nextWakeAt
    };
  }

  private computeResourceSelection(
    criteria: SelectionCriteria,
    mutateState: boolean
  ): ResourceSelectionResult {
    const pool = this.getPoolOrThrow(criteria.poolId);
    const nowMs = criteria.nowMs;
    const serviceId = criteria.serviceId?.trim() || undefined;
    const requiredCaps = this.normalizeCapabilities(criteria.requiredCapabilities);
    const preferredId = criteria.preferredResourceId?.trim();

    if (preferredId) {
      const preferred = pool.resources.get(preferredId) ?? null;
      if (preferred && this.isEligible(preferred, nowMs, requiredCaps, serviceId)) {
        return { resource: preferred, nextWakeAt: null };
      }
    }

    const useWeighted = pool.selector === 'weighted_round_robin' || pool.hasCustomWeight;
    const order = pool.roundRobinOrder;
    const cursor = pool.roundRobinCursor;
    const orderLength = order.length;

    if (orderLength === 0) {
      return { resource: null, nextWakeAt: null };
    }

    let nextWakeAt: number | null = null;

    if (!useWeighted) {
      for (let offset = 0; offset < orderLength; offset += 1) {
        const orderIndex = (cursor + offset) % orderLength;
        const resourceId = order[orderIndex];
        const resource = pool.resources.get(resourceId);
        if (!resource) continue;

        if (!this.matchesCapabilities(resource, requiredCaps)) {
          continue;
        }

        if (this.isEligible(resource, nowMs, requiredCaps, serviceId)) {
          if (mutateState) {
            pool.roundRobinCursor = (orderIndex + 1) % Math.max(1, pool.roundRobinOrder.length);
          }
          return { resource, nextWakeAt };
        }

        const wakeCandidate = this.getResourceWakeAt(resource, nowMs);
        if (wakeCandidate !== null && (nextWakeAt === null || wakeCandidate < nextWakeAt)) {
          nextWakeAt = wakeCandidate;
        }
      }

      return { resource: null, nextWakeAt };
    }

    const eligibleCandidates: ResourceRuntime[] = [];
    for (let offset = 0; offset < orderLength; offset += 1) {
      const orderIndex = (cursor + offset) % orderLength;
      const resourceId = order[orderIndex];
      const resource = pool.resources.get(resourceId);
      if (!resource) continue;
      if (!this.matchesCapabilities(resource, requiredCaps)) continue;

      if (this.isEligible(resource, nowMs, requiredCaps, serviceId)) {
        eligibleCandidates.push(resource);
      } else {
        const wakeCandidate = this.getResourceWakeAt(resource, nowMs);
        if (wakeCandidate !== null && (nextWakeAt === null || wakeCandidate < nextWakeAt)) {
          nextWakeAt = wakeCandidate;
        }
      }
    }

    if (eligibleCandidates.length === 0) {
      return { resource: null, nextWakeAt };
    }

    let totalWeight = 0;
    let selected: ResourceRuntime | null = null;
    let selectedWeight = Number.NEGATIVE_INFINITY;

    for (const candidate of eligibleCandidates) {
      const weight = this.normalizeWeight(candidate.weight);
      totalWeight += weight;
      const currentWeight = (pool.smoothCurrentWeightByResourceId.get(candidate.resourceId) ?? 0) + weight;
      if (mutateState) {
        pool.smoothCurrentWeightByResourceId.set(candidate.resourceId, currentWeight);
      }

      if (
        selected === null ||
        currentWeight > selectedWeight ||
        (currentWeight === selectedWeight && candidate.insertedOrder < selected.insertedOrder)
      ) {
        selected = candidate;
        selectedWeight = currentWeight;
      }
    }

    if (!selected) {
      return { resource: null, nextWakeAt };
    }

    if (mutateState) {
      const finalWeight =
        (pool.smoothCurrentWeightByResourceId.get(selected.resourceId) ?? 0) - Math.max(1, totalWeight);
      pool.smoothCurrentWeightByResourceId.set(selected.resourceId, finalWeight);
    }
    return { resource: selected, nextWakeAt };
  }

  getPoolNextWakeAt(
    poolId: string,
    nowMs: number,
    requiredCapabilities?: string[]
  ): number | null {
    const pool = this.getPoolOrThrow(poolId);
    const requiredCaps = this.normalizeCapabilities(requiredCapabilities);
    let nextWakeAt: number | null = null;

    for (const resource of pool.resources.values()) {
      if (!this.matchesCapabilities(resource, requiredCaps)) continue;
      const wakeAt = this.getResourceWakeAt(resource, nowMs);
      if (wakeAt !== null && (nextWakeAt === null || wakeAt < nextWakeAt)) {
        nextWakeAt = wakeAt;
      }
    }

    return nextWakeAt;
  }

  getResourceState(poolId: string, resourceId: string, nowMs: number): ResourceState {
    const resource = this.getResourceOrThrow(poolId, resourceId);
    return this.computeResourceState(resource, nowMs);
  }

  getResourceStateCountsByPool(nowMs: number): Record<string, ResourceStateCounts> {
    const result: Record<string, ResourceStateCounts> = {};

    for (const [poolId, pool] of this.pools.entries()) {
      const counts: ResourceStateCounts = { ...EMPTY_COUNTS };
      for (const resource of pool.resources.values()) {
        const state = this.computeResourceState(resource, nowMs);
        counts[state] += 1;
      }
      result[poolId] = counts;
    }

    return result;
  }

  getResourceSnapshots(nowMs: number): ResourceRuntimeSnapshot[] {
    const snapshots: ResourceRuntimeSnapshot[] = [];
    for (const pool of this.pools.values()) {
      for (const resource of pool.resources.values()) {
        snapshots.push({
          poolId: resource.poolId,
          resourceId: resource.resourceId,
          label: resource.label,
          state: this.computeResourceState(resource, nowMs),
          enabled: resource.enabled,
          inFlight: resource.inFlight,
          maxConcurrency: resource.maxConcurrency,
          cooldownUntil: resource.cooldownUntil,
          errorUntil: resource.errorUntil,
          assignedServiceId: resource.assignedServiceId,
          assignmentUpdatedAt: resource.assignmentUpdatedAt,
          lastError: resource.lastError,
          lastAcquiredAt: resource.lastAcquiredAt,
          metadata: resource.metadata
        });
      }
    }
    return snapshots;
  }

  getGlobalNextWakeAt(nowMs: number): number | null {
    let nextWakeAt: number | null = null;
    for (const pool of this.pools.values()) {
      for (const resource of pool.resources.values()) {
        const wakeAt = this.getResourceWakeAt(resource, nowMs);
        if (wakeAt !== null && (nextWakeAt === null || wakeAt < nextWakeAt)) {
          nextWakeAt = wakeAt;
        }
      }
    }
    return nextWakeAt;
  }

  private getPoolOrThrow(poolId: string): PoolRuntime {
    const pool = this.pools.get(poolId);
    if (!pool) throw new PoolNotFoundError(poolId);
    return pool;
  }

  private getResourceOrThrow(poolId: string, resourceId: string): ResourceRuntime {
    const pool = this.getPoolOrThrow(poolId);
    const resource = pool.resources.get(resourceId);
    if (!resource) throw new ResourceNotFoundError(poolId, resourceId);
    return resource;
  }

  private computeResourceState(resource: ResourceRuntime, nowMs: number): ResourceState {
    if (!resource.enabled) return 'disabled';
    if (nowMs < resource.errorUntil) return 'error';
    if (nowMs < resource.cooldownUntil) return 'cooldown';
    if (resource.inFlight > 0) return 'busy';
    return 'ready';
  }

  private isEligible(
    resource: ResourceRuntime,
    nowMs: number,
    requiredCapabilities?: string[],
    serviceId?: string
  ): boolean {
    if (!resource.enabled) return false;
    if (nowMs < resource.errorUntil) return false;
    if (nowMs < resource.cooldownUntil) return false;
    if (resource.inFlight >= resource.maxConcurrency) return false;
    if (serviceId && resource.assignedServiceId && resource.assignedServiceId !== serviceId) {
      return false;
    }
    return this.matchesCapabilities(resource, requiredCapabilities);
  }

  private matchesCapabilities(
    resource: ResourceRuntime,
    requiredCapabilities?: string[]
  ): boolean {
    if (!requiredCapabilities || requiredCapabilities.length === 0) return true;
    if (resource.capabilities.length === 0) return false;

    const capabilitySet = new Set(resource.capabilities);
    for (const required of requiredCapabilities) {
      if (!capabilitySet.has(required)) return false;
    }
    return true;
  }

  private getResourceWakeAt(resource: ResourceRuntime, nowMs: number): number | null {
    if (!resource.enabled) return null;
    if (resource.inFlight >= resource.maxConcurrency) return null;

    const candidates: number[] = [];
    if (resource.errorUntil > nowMs) candidates.push(resource.errorUntil);
    if (resource.cooldownUntil > nowMs) candidates.push(resource.cooldownUntil);
    if (candidates.length === 0) return null;

    let minValue = candidates[0];
    for (let i = 1; i < candidates.length; i += 1) {
      if (candidates[i] < minValue) minValue = candidates[i];
    }
    return minValue;
  }

  private rebuildOrders(pool: PoolRuntime): void {
    const resources = [...pool.resources.values()].sort(
      (a, b) => a.insertedOrder - b.insertedOrder
    );

    pool.roundRobinOrder = resources.map((resource) => resource.resourceId);
    pool.hasCustomWeight = resources.some((resource) => resource.weight !== 1);
    pool.roundRobinCursor = this.normalizeCursor(pool.roundRobinCursor, pool.roundRobinOrder.length);

    const existingKeys = new Set(pool.roundRobinOrder);
    for (const key of [...pool.smoothCurrentWeightByResourceId.keys()]) {
      if (!existingKeys.has(key)) {
        pool.smoothCurrentWeightByResourceId.delete(key);
      }
    }
    for (const key of pool.roundRobinOrder) {
      if (!pool.smoothCurrentWeightByResourceId.has(key)) {
        pool.smoothCurrentWeightByResourceId.set(key, 0);
      }
    }
  }

  private normalizeCursor(cursor: number, orderLength: number): number {
    if (orderLength <= 0) return 0;
    const normalized = cursor % orderLength;
    return normalized < 0 ? normalized + orderLength : normalized;
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

  private normalizeWeight(weight: number): number {
    if (!Number.isFinite(weight) || weight <= 0) return 1;
    return weight;
  }

  private normalizeConcurrency(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.floor(value);
  }

  private normalizeMs(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
  }

  private normalizeMaxMs(minCandidate: number, maxCandidate: number): number {
    const min = this.normalizeMs(minCandidate);
    const max = this.normalizeMs(maxCandidate);
    return Math.max(min, max);
  }
}
