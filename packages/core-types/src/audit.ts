import { z } from 'zod';
import { PackageName, PackageVersion, PublishId, TarballIntegrity } from './package.js';

/**
 * Audit job and signed attestation model (design 11).
 */

export const AuditMode = z.enum(['basic', 'paid', 'byo_advisory']);
export type AuditMode = z.infer<typeof AuditMode>;

export const AuditStatus = z.enum([
  'queued',
  'running',
  'passed',
  'warned',
  'failed',
  'errored',
  'cancelled',
]);
export type AuditStatus = z.infer<typeof AuditStatus>;

export const AuditFinding = z.object({
  id: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
  summary: z.string(),
});
export type AuditFinding = z.infer<typeof AuditFinding>;

export const AuditJob = z.object({
  id: z.string().uuid(),
  package: PackageName,
  version: PackageVersion,
  publishId: PublishId,
  tarballDigest: TarballIntegrity,
  requesterUserId: z.string().uuid().optional(),
  providerId: z.string().min(1),
  mode: AuditMode,
  status: AuditStatus,
  costCents: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  judgment: z.enum(['pass', 'warn', 'fail', 'needs-human']).optional(),
  scoreAdjustment: z.number().int().optional(),
  findings: z.array(AuditFinding).default([]),
  idempotencyKey: z.string().min(1).optional(),
});
export type AuditJob = z.infer<typeof AuditJob>;

export const AuditAttestation = z.object({
  id: z.string().uuid(),
  auditJobId: z.string().uuid(),
  package: PackageName,
  version: PackageVersion,
  publishId: PublishId,
  tarballDigest: TarballIntegrity,
  statementType: z.string().min(1),
  signedPayload: z.record(z.string(), z.unknown()),
  signature: z.string().min(1),
  provider: z.string().min(1),
  providerVersion: z.string().min(1),
  transparencyLogUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
});
export type AuditAttestation = z.infer<typeof AuditAttestation>;
