/**
 * Analyzer worker (design 10.2).
 *
 * Fetches tarball by object key, runs the analyzer, stores the analysis
 * artifact, and enqueues a score job.
 */
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeTarball, QuarantineCache } from '@safe-npm/analyzer';
import { ObjectStore } from '@safe-npm/object-store';
import { RiskReportsRepository, PackageVersionsRepository, type DbClient } from '@safe-npm/db';
import { scoreAnalysis } from '@safe-npm/scoring';
import type { JobQueue } from './queue.js';
import type { Job } from './types.js';

export interface AnalyzeTarballPayload {
  packageVersionId: string;
  tarballObjectKey: string;
  tarballSha512: string;
  packageName: string;
  packageVersion: string;
}

export interface AnalyzerWorkerDeps {
  db: DbClient;
  objectStore: ObjectStore;
  queue: JobQueue;
}

export function createAnalyzerWorker(deps: AnalyzerWorkerDeps) {
  return async (payload: AnalyzeTarballPayload, _job: Job<AnalyzeTarballPayload>): Promise<void> => {
    const { db, objectStore, queue } = deps;

    // Step 1: Fetch tarball by object key.
    const obj = await objectStore.getObject(payload.tarballObjectKey);
    const tarballBuffer = Buffer.from(await new Response(obj.body as unknown as ArrayBuffer).arrayBuffer());

    // Verify integrity.
    const { computeSha512 } = await import('@safe-npm/object-store');
    const computedSha512 = computeSha512(tarballBuffer);
    if (computedSha512 !== payload.tarballSha512) {
      throw new Error(`tarball integrity mismatch: expected ${payload.tarballSha512}, got ${computedSha512}`);
    }

    // Step 2: Run analyzer.
    const tmpDir = await mkdtemp(join(tmpdir(), 'safe-npm-worker-'));
    const tarballPath = join(tmpDir, 'tarball.tgz');
    try {
      await writeFile(tarballPath, tarballBuffer);
      const cache = new QuarantineCache();
      const analysisReport = await analyzeTarball({
        tarballPath,
        integrity: payload.tarballSha512,
        packageName: payload.packageName,
        packageVersion: payload.packageVersion,
        cache,
      });

      // Step 3: Store analysis artifact in object storage.
      const analysisKey = ObjectStore.analysisKey(payload.tarballSha512, analysisReport.analyzerVersion);
      await objectStore.putObject(analysisKey, Buffer.from(JSON.stringify(analysisReport)), {
        contentType: 'application/json',
      });

      // Step 4: Generate and store risk report (score worker inlined for MVP).
      const riskReport = scoreAnalysis(analysisReport);
      const riskRepo = new RiskReportsRepository(db);
      await riskRepo.create({
        packageVersionId: payload.packageVersionId,
        score: riskReport.score,
        tier: riskReport.tier,
        confidence: riskReport.confidence,
        analyzerVersion: riskReport.analyzerVersion,
        evidenceDigest: riskReport.evidenceDigest,
        report: riskReport as unknown as Record<string, unknown>,
      });

      // Step 5: Update package version summary fields.
      const versionsRepo = new PackageVersionsRepository(db);
      await versionsRepo.updateStatus(payload.packageVersionId, 'analyzed');

      // Step 6: Enqueue score job (for separate processing if needed).
      queue.enqueue('score-version', {
        packageVersionId: payload.packageVersionId,
        analysisKey,
      }, {
        idempotencyKey: `score:${payload.packageVersionId}`,
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
