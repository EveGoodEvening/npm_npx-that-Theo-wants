/**
 * Repository for audit_jobs and audit_attestations (Section 20.1).
 */
import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { auditJobs, auditAttestations } from '../schema.js';

export class AuditRepository {
  constructor(private db: DbClient) {}

  async createJob(data: {
    packageVersionId: string;
    provider?: string;
    idempotencyKey?: string;
    tarballDigest?: string;
    evidenceBundle?: unknown;
    requesterUserId?: string;
    mode?: string;
    costCents?: number;
  }): Promise<typeof auditJobs.$inferSelect> {
    const [row] = await this.db.insert(auditJobs).values({
      packageVersionId: data.packageVersionId,
      provider: data.provider,
      idempotencyKey: data.idempotencyKey,
      tarballDigest: data.tarballDigest,
      evidenceBundle: data.evidenceBundle,
      requesterUserId: data.requesterUserId,
      mode: data.mode ?? 'paid',
      costCents: data.costCents,
    }).returning();
    return row!;
  }

  async findJobById(id: string): Promise<typeof auditJobs.$inferSelect | undefined> {
    const [row] = await this.db.select().from(auditJobs)
      .where(eq(auditJobs.id, id)).limit(1);
    return row;
  }

  async findJobByIdempotencyKey(key: string): Promise<typeof auditJobs.$inferSelect | undefined> {
    const [row] = await this.db.select().from(auditJobs)
      .where(eq(auditJobs.idempotencyKey, key)).limit(1);
    return row;
  }

  async updateJobStatus(id: string, status: string, updates?: {
    providerJobId?: string;
    result?: unknown;
    error?: string;
    completedAt?: Date;
  }): Promise<void> {
    await this.db.update(auditJobs).set({
      status,
      providerJobId: updates?.providerJobId,
      result: updates?.result,
      error: updates?.error,
      completedAt: updates?.completedAt,
      updatedAt: new Date(),
    }).where(eq(auditJobs.id, id));
  }

  async createAttestation(data: {
    auditJobId: string;
    packageVersionId: string;
    tarballDigest?: string;
    provider?: string;
    providerVersion?: string;
    judgment?: string;
    scoreAdjustment?: number;
    findings?: unknown;
    signedAt?: Date;
    statementType: string;
    signedPayload: unknown;
    signature: string;
    publicKeyId?: string;
    transparencyLogUrl?: string;
  }): Promise<typeof auditAttestations.$inferSelect> {
    const [row] = await this.db.insert(auditAttestations).values({
      auditJobId: data.auditJobId,
      packageVersionId: data.packageVersionId,
      tarballDigest: data.tarballDigest,
      provider: data.provider,
      providerVersion: data.providerVersion,
      judgment: data.judgment,
      scoreAdjustment: data.scoreAdjustment,
      findings: data.findings,
      signedAt: data.signedAt,
      statementType: data.statementType,
      signedPayload: data.signedPayload,
      signature: data.signature,
      publicKeyId: data.publicKeyId,
      transparencyLogUrl: data.transparencyLogUrl,
    }).returning();
    return row!;
  }

  async findAttestationByDigest(digest: string): Promise<typeof auditAttestations.$inferSelect | undefined> {
    const [row] = await this.db.select().from(auditAttestations)
      .where(eq(auditAttestations.tarballDigest, digest)).limit(1);
    return row;
  }

  async listAttestationsByVersion(packageVersionId: string): Promise<typeof auditAttestations.$inferSelect[]> {
    return this.db.select().from(auditAttestations)
      .where(eq(auditAttestations.packageVersionId, packageVersionId));
  }
}
