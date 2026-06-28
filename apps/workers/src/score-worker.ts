/**
 * Score worker (design 10.3).
 *
 * Loads the analysis artifact, generates a risk report, stores it,
 * and updates package/version summary fields.
 */
import { ObjectStore } from '@safe-npm/object-store';
import { RiskReportsRepository, PackageVersionsRepository, type DbClient } from '@safe-npm/db';
import { scoreAnalysis } from '@safe-npm/scoring';
import type { AnalysisReport } from '@safe-npm/core-types';

export interface ScoreVersionPayload {
  packageVersionId: string;
  analysisKey: string;
}

export interface ScoreWorkerDeps {
  db: DbClient;
  objectStore: ObjectStore;
}

export function createScoreWorker(deps: ScoreWorkerDeps) {
  return async (payload: ScoreVersionPayload): Promise<void> => {
    const { db, objectStore } = deps;

    // Step 1: Load analysis artifact from object storage.
    const obj = await objectStore.getObject(payload.analysisKey);
    const analysisReport: AnalysisReport = JSON.parse(
      Buffer.from(await new Response(obj.body as unknown as ArrayBuffer).arrayBuffer()).toString('utf8'),
    );

    // Step 2: Generate risk report.
    const riskReport = scoreAnalysis(analysisReport);

    // Step 3: Store risk report.
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

    // Step 4: Update package version summary fields.
    const versionsRepo = new PackageVersionsRepository(db);
    await versionsRepo.updateStatus(payload.packageVersionId, 'scored');
  };
}
