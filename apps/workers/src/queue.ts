/**
 * In-memory job queue with retry/backoff and dead-letter handling (design 10.1).
 *
 * This is a simple MVP queue that doesn't require external infrastructure
 * (Redis, etc.). Jobs are processed by registered handlers. Failed jobs
 * are retried with exponential backoff up to maxAttempts, then moved to
 * dead-letter.
 */
import { randomUUID } from 'node:crypto';
import type { Job, JobType, EnqueueOptions } from './types.js';
import { DEFAULT_MAX_ATTEMPTS, RETRY_BACKOFF_BASE_MS } from './types.js';

export type JobHandler<T = unknown> = (payload: T, job: Job<T>) => Promise<void>;

interface QueueOptions {
  /** Override backoff base (for tests). */
  backoffBaseMs?: number;
}

export class JobQueue {
  private jobs = new Map<string, Job>();
  private handlers = new Map<JobType, JobHandler>();
  private deadLetter: Job[] = [];
  private backoffBaseMs: number;

  constructor(options: QueueOptions = {}) {
    this.backoffBaseMs = options.backoffBaseMs ?? RETRY_BACKOFF_BASE_MS;
  }

  /** Register a handler for a job type. */
  register<T>(type: JobType, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  /** Enqueue a job. Returns the job. */
  enqueue<T>(type: JobType, payload: T, options: EnqueueOptions = {}): Job<T> {
    // Check idempotency: if a job with the same key exists and is not
    // failed/dead-letter, don't enqueue a duplicate.
    if (options.idempotencyKey) {
      for (const job of this.jobs.values()) {
        if (job.idempotencyKey === options.idempotencyKey &&
            job.status !== 'failed' && job.status !== 'dead-letter') {
          return job as Job<T>;
        }
      }
    }

    const now = new Date().toISOString();
    const job: Job<T> = {
      id: randomUUID(),
      type,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
      idempotencyKey: options.idempotencyKey,
    };
    this.jobs.set(job.id, job as Job);
    return job;
  }

  /** Process all pending jobs. Returns the number of jobs processed. */
  async processAll(): Promise<number> {
    const pending = [...this.jobs.values()].filter((j) => j.status === 'pending');
    let count = 0;
    for (const job of pending) {
      await this.processJob(job.id);
      count++;
    }
    return count;
  }

  /** Process a single job by ID. */
  async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`job not found: ${jobId}`);
    if (job.status !== 'pending') return;

    const handler = this.handlers.get(job.type);
    if (!handler) throw new Error(`no handler for job type: ${job.type}`);

    job.status = 'running';
    job.attempts++;
    job.startedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();

    try {
      await handler(job.payload, job as Job<unknown>);
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.updatedAt = new Date().toISOString();
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);
      job.updatedAt = new Date().toISOString();

      if (job.attempts >= job.maxAttempts) {
        job.status = 'dead-letter';
        this.deadLetter.push(job);
      } else {
        job.status = 'pending';
        // Backoff: wait before retry (in real impl, this would be delayed).
        // For MVP, we just set status back to pending.
      }
    }
  }

  /** Get a job by ID. */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /** List all jobs. */
  listJobs(): Job[] {
    return [...this.jobs.values()];
  }

  /** List jobs by status. */
  listJobsByStatus(status: Job['status']): Job[] {
    return this.listJobs().filter((j) => j.status === status);
  }

  /** Get dead-letter jobs. */
  getDeadLetter(): Job[] {
    return [...this.deadLetter];
  }

  /** Retry a dead-letter job. */
  retryDeadLetter(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'dead-letter') return false;
    job.status = 'pending';
    job.attempts = 0;
    job.lastError = undefined;
    job.updatedAt = new Date().toISOString();
    // Remove from dead-letter list.
    this.deadLetter = this.deadLetter.filter((j) => j.id !== jobId);
    return true;
  }

  /** Clear all jobs (for tests). */
  clear(): void {
    this.jobs.clear();
    this.deadLetter = [];
  }

  /** Compute the backoff delay for a retry attempt. */
  computeBackoff(attempt: number): number {
    return this.backoffBaseMs * Math.pow(2, attempt - 1);
  }
}
