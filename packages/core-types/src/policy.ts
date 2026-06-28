import { z } from 'zod';
import {
  PackageNameSchema,
  PackageVersionSchema,
  PublishIdSchema,
  RiskReportSchema,
} from './package.js';

export const PolicyModeSchema = z.enum(['relaxed', 'default', 'strict', 'agent', 'ci']);
export type PolicyMode = z.infer<typeof PolicyModeSchema>;

export const PolicyInstallSchema = z.object({
  minimumScore: z.number().int().min(0).max(100).optional(),
  blockTiers: z.array(z.enum(['danger', 'blocked'])).default([]),
  requireNoBlockers: z.boolean().default(false),
  allowInstallScripts: z.boolean().default(true),
  allowNonRegistrySources: z.boolean().default(true),
  blockKnownCriticalVulns: z.boolean().default(false),
});
export type PolicyInstall = z.infer<typeof PolicyInstallSchema>;

export const PolicyExecSchema = z.object({
  minimumScore: z.number().int().min(0).max(100).optional(),
  blockTiers: z.array(z.enum(['danger', 'blocked'])).default([]),
  requireNoBlockers: z.boolean().default(false),
  requireExactVersion: z.boolean().default(false),
  disallowLatestTag: z.boolean().default(false),
  requirePermissionEnforcement: z.boolean().default(false),
  allowNativeBinaries: z.boolean().default(true),
  allowNetwork: z.enum(['any', 'declared', 'declared-and-approved', 'none']).default('any'),
  blockKnownCriticalVulns: z.boolean().default(false),
});
export type PolicyExec = z.infer<typeof PolicyExecSchema>;
export const PolicyPublishSchema = z.object({
  defaultVisibility: z.enum(['private', 'public']).default('private'),
  publicPromotionRequiresAudit: z.boolean().default(false),
  publicPromotionMinimumScore: z.number().int().min(0).max(100).optional(),
  requireTrustedPublisherForPublic: z.boolean().default(false),
  requireNoBlockers: z.boolean().default(true),
  blockTiers: z.array(z.enum(['danger', 'blocked'])).default(['blocked']),
});
export type PolicyPublish = z.infer<typeof PolicyPublishSchema>;

export const PolicySetSchema = z.object({
  name: z.string().min(1),
  mode: PolicyModeSchema,
  install: PolicyInstallSchema.default({}),
  exec: PolicyExecSchema.default({}),
  publish: PolicyPublishSchema.default({}),
});
export type PolicySet = z.infer<typeof PolicySetSchema>;

export const PolicyActionSchema = z.enum(['install', 'exec', 'publish']);
export type PolicyAction = z.infer<typeof PolicyActionSchema>;

export const PolicyDecisionKindSchema = z.enum(['allow', 'requires_approval', 'blocked']);
export type PolicyDecisionKind = z.infer<typeof PolicyDecisionKindSchema>;

export const MatchedRuleSchema = z.object({
  path: z.string().min(1),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type MatchedRule = z.infer<typeof MatchedRuleSchema>;

export const PolicyDecisionSchema = z.object({
  allow: z.boolean(),
  decision: PolicyDecisionKindSchema,
  action: PolicyActionSchema,
  matchedRules: z.array(MatchedRuleSchema).default([]),
  overridesAvailable: z.array(z.string()).default([]),
  reason: z.string().optional(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

/** Record used to evaluate policy against a risk report. */
export const PolicyEvaluationInputSchema = z.object({
  riskReport: RiskReportSchema,
  action: PolicyActionSchema,
  /** Whether the spec used `latest` (for disallowLatestTag). */
  usedLatestTag: z.boolean().default(false),
  /** Whether the version is exact (for requireExactVersion). */
  isExactVersion: z.boolean().default(true),
  /** Whether permission enforcement is available (for requirePermissionEnforcement). */
  permissionEnforcementAvailable: z.boolean().default(false),
});
export type PolicyEvaluationInput = z.infer<typeof PolicyEvaluationInputSchema>;

export const StageRecordSchema = z.object({
  id: z.string().min(1),
  package: PackageNameSchema,
  version: PackageVersionSchema,
  publishId: PublishIdSchema,
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).default('pending'),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  rejectedBy: z.string().optional(),
  rejectedAt: z.string().datetime().optional(),
  reviewNotes: z.string().optional(),
});
export type StageRecord = z.infer<typeof StageRecordSchema>;

export const RetractionModeSchema = z.enum([
  'threshold_retract',
  'admin_quarantine',
  'policy_yank',
]);
export type RetractionMode = z.infer<typeof RetractionModeSchema>;

export const RetractionRecordSchema = z.object({
  id: z.string().min(1),
  packageVersionId: z.string().min(1),
  actorUserId: z.string().min(1),
  reason: z.string().min(1),
  mode: RetractionModeSchema,
  observedInstallsAtRetract: z.number().int().nonnegative(),
  ageSecondsAtRetract: z.number().int().nonnegative(),
  semverReuseAllowed: z.boolean(),
  createdAt: z.string().datetime(),
});
export type RetractionRecord = z.infer<typeof RetractionRecordSchema>;

export const AuditJobModeSchema = z.enum(['basic', 'paid', 'byo_advisory']);
export type AuditJobMode = z.infer<typeof AuditJobModeSchema>;

export const AuditJobStatusSchema = z.enum([
  'queued',
  'running',
  'passed',
  'warned',
  'failed',
  'errored',
  'cancelled',
]);
export type AuditJobStatus = z.infer<typeof AuditJobStatusSchema>;

export const AuditJobSchema = z.object({
  id: z.string().min(1),
  package: PackageNameSchema,
  version: PackageVersionSchema,
  publishId: PublishIdSchema.optional(),
  requesterUserId: z.string().min(1),
  providerId: z.string().min(1),
  mode: AuditJobModeSchema,
  status: AuditJobStatusSchema,
  costCents: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  result: z.unknown().optional(),
});
export type AuditJob = z.infer<typeof AuditJobSchema>;

export const AuditAttestationSchema = z.object({
  id: z.string().min(1),
  auditJobId: z.string().min(1),
  package: PackageNameSchema,
  version: PackageVersionSchema,
  tarballDigest: z.string().min(1),
  statementType: z.string().min(1),
  signedPayload: z.record(z.string(), z.unknown()),
  signature: z.string().min(1),
  transparencyLogUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
});
export type AuditAttestation = z.infer<typeof AuditAttestationSchema>;
