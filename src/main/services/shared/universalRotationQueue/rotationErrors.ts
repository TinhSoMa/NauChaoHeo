import { RotationJobErrorCode } from './rotationTypes';

export class RotationQueueError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RotationQueueError';
    this.code = code;
  }
}

export class QueueShuttingDownError extends RotationQueueError {
  constructor(message = 'Scheduler is shutting down and cannot accept new jobs.') {
    super('QUEUE_SHUTTING_DOWN', message);
    this.name = 'QueueShuttingDownError';
  }
}

export class InvalidPoolDefinitionError extends RotationQueueError {
  constructor(poolId: string, message?: string) {
    super(
      'INVALID_POOL_DEFINITION',
      message ?? `Pool definition is invalid for poolId="${poolId}".`
    );
    this.name = 'InvalidPoolDefinitionError';
  }
}

export class PoolNotFoundError extends RotationQueueError {
  constructor(poolId: string) {
    super('POOL_NOT_FOUND', `Pool not found: "${poolId}".`);
    this.name = 'PoolNotFoundError';
  }
}

export class InvalidResourceDefinitionError extends RotationQueueError {
  constructor(poolId: string, resourceId: string, message?: string) {
    super(
      'INVALID_RESOURCE_DEFINITION',
      message ?? `Resource definition is invalid for ${poolId}/${resourceId}.`
    );
    this.name = 'InvalidResourceDefinitionError';
  }
}

export class ResourceNotFoundError extends RotationQueueError {
  constructor(poolId: string, resourceId: string) {
    super('RESOURCE_NOT_FOUND', `Resource not found: ${poolId}/${resourceId}.`);
    this.name = 'ResourceNotFoundError';
  }
}

export class InvalidJobRequestError extends RotationQueueError {
  constructor(message: string) {
    super('INVALID_JOB_REQUEST', message);
    this.name = 'InvalidJobRequestError';
  }
}

export class ResourceUnavailableError extends RotationQueueError {
  constructor(poolId: string, resourceId: string, message?: string) {
    super(
      'RESOURCE_UNAVAILABLE',
      message ?? `Resource unavailable: ${poolId}/${resourceId}.`
    );
    this.name = 'ResourceUnavailableError';
  }
}

export class RotationJobExecutionError extends RotationQueueError {
  readonly retryAfterMs?: number;

  constructor(code: RotationJobErrorCode, message: string, retryAfterMs?: number) {
    super(code, message);
    this.name = 'RotationJobExecutionError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class RateLimitJobError extends RotationJobExecutionError {
  constructor(retryAfterMs: number, message = 'Rate limit reached.') {
    super('RATE_LIMIT', message, retryAfterMs);
    this.name = 'RateLimitJobError';
  }
}

export class CancelledJobError extends RotationJobExecutionError {
  constructor(
    code: Extract<RotationJobErrorCode, 'CANCELLED_BY_USER' | 'CANCELLED_BY_SHUTDOWN'>,
    message?: string
  ) {
    super(code, message ?? (code === 'CANCELLED_BY_USER' ? 'Cancelled by user.' : 'Cancelled by shutdown.'));
    this.name = 'CancelledJobError';
  }
}
