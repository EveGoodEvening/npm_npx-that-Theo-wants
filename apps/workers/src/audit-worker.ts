/**
 * Audit broker worker (Section 20.3).
 *
 * Loads package tarball digest and analysis evidence, builds evidence bundle,
 * submits to provider, polls for result, verifies signature, stores result
 * and attestation, and enqueues score recomputing.
 */
import type { DbClient } from '@safe-npm/db';
import { AuditRepository, RiskReportsRepository } from '@safe-npm/db';
import type { AuditProvider, ProviderAuditResult } from '@safe-npm/scoring';
import type { JobQueue } from './queue.js';

export interface AuditJobPayload {
  auditJobId: string;
  packageVersionId: string;
  packageName: string;
  version: string;
  tarballDigest: string;
}

export interface AuditWorkerOptions {
  db: DbClient;
  provider: AuditProvider;
  queue?: JobQueue;
}

export function createAuditWorker(options: AuditWorkerOptions) {
  const { db, provider, queue } = options;
  const auditRepo = new AuditRepository(db);
  const riskRepo = new RiskReportsRepository(db);

  return async function auditWorker(payload: AuditJobPayload): Promise<void> {
    const { auditJobId, packageVersionId, packageName, version, tarballDigest } = payload;

    // 1. Load analysis evidence from risk reports.
    const riskReports = await riskRepo.listByVersion(packageVersionId);
    const evidenceBundle = {
      packageName,
      version,
      tarballDigest,
      riskReports,
      analysisTimestamp: new Date().toISOString(),
    };

    // 2. Submit to provider.
    const { jobId: providerJobId } = await provider.submit({
      package: packageName,
      version,
      tarballDigest,
      evidenceBundle,
    });

    await auditRepo.updateJobStatus(auditJobId, 'submitted', { providerJobId });

    // 3. Poll for result (synchronous in MVP — real impl would poll async).
    let result: ProviderAuditResult | undefined;
    for (let i = 0; i < 60; i++) {
      result = await provider.getResult(providerJobId);
      if (result) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!result) {
      await auditRepo.updateJobStatus(auditJobId, 'failed', {
        error: 'provider did not return result',
        completedAt: new Date(),
      });
      throw new Error('audit provider did not return result');
    }

    // 4. Verify provider signature.
    const valid = await provider.verifyResult(result);
    if (!valid) {
      await auditRepo.updateJobStatus(auditJobId, 'failed', {
        error: 'provider signature verification failed',
        completedAt: new Date(),
      });
      throw new Error('provider signature verification failed');
    }

    // 5. Store attestation.
    await auditRepo.createAttestation({
      auditJobId,
      packageVersionId,
      tarballDigest,
      provider: result.provider,
      providerVersion: result.providerVersion,
      judgment: result.judgment,
      scoreAdjustment: result.scoreAdjustment,
      findings: result.findings,
      signedAt: new Date(result.signedAt),
      statementType: 'paid-audit',
      signedPayload: result as unknown as Record<string, unknown>,
      signature: result.signature,
      publicKeyId: (provider as { getPublicKeyId?: () => string }).getPublicKeyId?.() ?? 'unknown',
    });

    // 6. Update job status.
    await auditRepo.updateJobStatus(auditJobId, 'completed', {
      result: result as unknown as Record<string, unknown>,
      completedAt: new Date(),
    });

    // 7. Enqueue score recomputing.
    if (queue) {
      queue.enqueue('score-version', {
        packageVersionId,
        packageName,
        version,
      });
    }
  };
}
