import { describe, expect, it, beforeEach } from 'vitest';
import { JobQueue } from './queue.js';
import type { JobType } from './types.js';

describe('JobQueue', () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue({ backoffBaseMs: 10 });
  });

  it('enqueues a pending job', () => {
    const job = queue.enqueue('analyze-tarball', { tarballObjectKey: 'test-key' });
    expect(job.status).toBe('pending');
    expect(job.type).toBe('analyze-tarball');
    expect(job.id).toBeTruthy();
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
  });

  it('processes a job with a registered handler', async () => {
    let called = false;
    queue.register('analyze-tarball', async (payload: { tarballObjectKey: string }) => {
      called = true;
      expect(payload.tarballObjectKey).toBe('test-key');
    });

    const job = queue.enqueue('analyze-tarball', { tarballObjectKey: 'test-key' });
    await queue.processAll();

    expect(called).toBe(true);
    const updated = queue.getJob(job.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.attempts).toBe(1);
    expect(updated?.completedAt).toBeTruthy();
  });

  it('retries failed jobs up to maxAttempts', async () => {
    let attempts = 0;
    queue.register('analyze-tarball', async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient failure');
    });

    const job = queue.enqueue('analyze-tarball', {}, { maxAttempts: 3 });
    // First attempt: fails, goes back to pending.
    await queue.processAll();
    expect(queue.getJob(job.id)?.status).toBe('pending');
    expect(queue.getJob(job.id)?.attempts).toBe(1);

    // Second attempt: fails, goes back to pending.
    await queue.processAll();
    expect(queue.getJob(job.id)?.status).toBe('pending');
    expect(queue.getJob(job.id)?.attempts).toBe(2);

    // Third attempt: succeeds.
    await queue.processAll();
    expect(queue.getJob(job.id)?.status).toBe('completed');
    expect(queue.getJob(job.id)?.attempts).toBe(3);
  });

  it('moves jobs to dead-letter after maxAttempts', async () => {
    queue.register('analyze-tarball', async () => {
      throw new Error('permanent failure');
    });

    const job = queue.enqueue('analyze-tarball', {}, { maxAttempts: 2 });
    await queue.processAll();
    await queue.processAll();

    const updated = queue.getJob(job.id);
    expect(updated?.status).toBe('dead-letter');
    expect(updated?.attempts).toBe(2);
    expect(updated?.lastError).toBe('permanent failure');
    expect(queue.getDeadLetter().length).toBe(1);
  });

  it('supports idempotency keys', () => {
    const job1 = queue.enqueue('analyze-tarball', { key: 'a' }, { idempotencyKey: 'idem-1' });
    const job2 = queue.enqueue('analyze-tarball', { key: 'b' }, { idempotencyKey: 'idem-1' });
    // Same idempotency key → same job, not a duplicate.
    expect(job2.id).toBe(job1.id);
    expect(queue.listJobs().length).toBe(1);
  });

  it('allows different idempotency keys', () => {
    queue.enqueue('analyze-tarball', { key: 'a' }, { idempotencyKey: 'idem-1' });
    queue.enqueue('analyze-tarball', { key: 'b' }, { idempotencyKey: 'idem-2' });
    expect(queue.listJobs().length).toBe(2);
  });

  it('retries dead-letter jobs', async () => {
    let shouldFail = true;
    queue.register('analyze-tarball', async () => {
      if (shouldFail) throw new Error('fail');
    });

    const job = queue.enqueue('analyze-tarball', {}, { maxAttempts: 1 });
    await queue.processAll();
    expect(queue.getJob(job.id)?.status).toBe('dead-letter');

    // Retry.
    shouldFail = false;
    expect(queue.retryDeadLetter(job.id)).toBe(true);
    expect(queue.getJob(job.id)?.status).toBe('pending');
    expect(queue.getDeadLetter().length).toBe(0);

    await queue.processAll();
    expect(queue.getJob(job.id)?.status).toBe('completed');
  });

  it('lists jobs by status', () => {
    queue.enqueue('analyze-tarball', {});
    queue.enqueue('score-version', {});
    expect(queue.listJobsByStatus('pending').length).toBe(2);
    expect(queue.listJobsByStatus('completed').length).toBe(0);
  });

  it('computes exponential backoff', () => {
    expect(queue.computeBackoff(1)).toBe(10);
    expect(queue.computeBackoff(2)).toBe(20);
    expect(queue.computeBackoff(3)).toBe(40);
  });

  it('throws when no handler is registered', async () => {
    queue.enqueue('audit-package', {});
    await expect(queue.processAll()).rejects.toThrow('no handler for job type: audit-package');
  });
});

describe('Job types', () => {
  it('all 5 job types are defined', () => {
    const types: JobType[] = [
      'analyze-tarball',
      'score-version',
      'rollup-install-counts',
      'audit-package',
      'sign-version',
    ];
    expect(types.length).toBe(5);
  });
});
