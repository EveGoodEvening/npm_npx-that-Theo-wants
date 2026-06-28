/**
 * Worker process entrypoint (design 10.1).
 *
 * Runs the job queue processor. In MVP, this is a simple polling loop
 * that processes pending jobs.
 */
import { createDb } from '@safe-npm/db';
import { createObjectStoreFromEnv } from '@safe-npm/object-store';
import { JobQueue } from './queue.js';
import { createAnalyzerWorker } from './analyzer-worker.js';
import { createScoreWorker } from './score-worker.js';

export interface WorkerProcessOptions {
  dbUrl?: string;
  pollIntervalMs?: number;
}

export async function startWorkerProcess(options: WorkerProcessOptions = {}): Promise<JobQueue> {
  const { db } = createDb(options.dbUrl ?? process.env.SAFE_NPM_DB_URL ?? 'postgresql://safenpm:safenpm@localhost:5432/safenpm');
  const objectStore = createObjectStoreFromEnv();

  const queue = new JobQueue();

  // Register handlers.
  queue.register('analyze-tarball', createAnalyzerWorker({ db, objectStore, queue }));
  queue.register('score-version', createScoreWorker({ db, objectStore }));

  // Signature worker needs a signing key — for MVP, skip if not configured.
  // In production, this would load the key from the key manager.

  // Start polling loop.
  const pollInterval = options.pollIntervalMs ?? 5000;
  const interval = setInterval(async () => {
    try {
      await queue.processAll();
    } catch (err) {
      console.error('worker poll error:', err);
    }
  }, pollInterval);

  // Don't keep the process alive just for the interval.
  interval.unref();

  return queue;
}

export { JobQueue } from './queue.js';
export * from './types.js';
export { createAnalyzerWorker } from './analyzer-worker.js';
export { createScoreWorker } from './score-worker.js';
export { createSignatureWorker, canonicalizePayload } from './signature-worker.js';
export { createAuditWorker } from './audit-worker.js';
export type { AuditJobPayload, AuditWorkerOptions } from './audit-worker.js';
