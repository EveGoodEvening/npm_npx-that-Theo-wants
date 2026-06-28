/**
 * Job queue types and definitions (design 10.1).
 */

export type JobType =
  | 'analyze-tarball'
  | 'score-version'
  | 'rollup-install-counts'
  | 'audit-package'
  | 'sign-version';

export interface Job<T = unknown> {
  id: string;
  type: JobType;
  payload: T;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'dead-letter';
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  idempotencyKey?: string;
}

export interface EnqueueOptions {
  maxAttempts?: number;
  idempotencyKey?: string;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const RETRY_BACKOFF_BASE_MS = 1000;
