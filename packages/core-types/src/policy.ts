import { z } from 'zod';
import { RiskTier } from './risk.js';

/**
 * Policy engine model (design 15).
 */

export const PolicyMode = z.enum(['relaxed', 'default-human', 'strict', 'agent', 'ci']);
export type PolicyMode = z.infer<typeof PolicyMode>;

export const PolicyAction = z.enum(['install', 'exec', 'publish']);
export type PolicyAction = z.infer<typeof PolicyAction>;

export const PolicyDecisionKind = z.enum(['allow', 'warn', 'requires_approval', 'block']);
export type PolicyDecisionKind = z.infer<typeof PolicyDecisionKind>;

export const InstallPolicy = z.object({
  minimumScore: z.number().int().min(0).max(100).default(0),
  blockTiers: z.array(RiskTier).default([]),
  requireNoBlockers: z.boolean().default(false),
  allowInstallScripts: z.boolean().default(true),
  allowNativeBinaries: z.boolean().default(true),
  allowNonRegistrySources: z.boolean().default(true),
  requireExactVersion: z.boolean().default(false),
  disallowLatestTag: z.boolean().default(false),
  requirePermissionEnforcement: z.boolean().default(false),
  blockKnownCriticalVulns: z.boolean().default(false),
});
export type InstallPolicy = z.infer<typeof InstallPolicy>;

export const ExecPolicy = z.object({
  minimumScore: z.number().int().min(0).max(100).default(0),
  blockTiers: z.array(RiskTier).default([]),
  requireNoBlockers: z.boolean().default(false),
  allowInstallScripts: z.boolean().default(false),
  allowNativeBinaries: z.boolean().default(true),
  requireExactVersion: z.boolean().default(false),
  disallowLatestTag: z.boolean().default(false),
  requirePermissionEnforcement: z.boolean().default(false),
  allowNetwork: z.enum(['any', 'declared', 'declared-and-approved', 'none']).default('any'),
});
export type ExecPolicy = z.infer<typeof ExecPolicy>;

export const PublishPolicy = z.object({
  defaultVisibility: z.enum(['private', 'public', 'staged_public']).default('private'),
  publicPromotionRequiresAudit: z.boolean().default(false),
  publicPromotionMinimumScore: z.number().int().min(0).max(100).default(0),
  requireTrustedPublisherForPublic: z.boolean().default(false),
});
export type PublishPolicy = z.infer<typeof PublishPolicy>;

export const PolicySet = z.object({
  name: z.string().min(1),
  mode: PolicyMode.default('default-human'),
  install: InstallPolicy.default({}),
  exec: ExecPolicy.default({}),
  publish: PublishPolicy.default({}),
});
export type PolicySet = z.infer<typeof PolicySet>;

export const MatchedRule = z.object({
  path: z.string().min(1),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type MatchedRule = z.infer<typeof MatchedRule>;

export const PolicyDecision = z.object({
  allow: z.boolean(),
  decision: PolicyDecisionKind,
  action: PolicyAction,
  matchedRules: z.array(MatchedRule).default([]),
  overridesAvailable: z.array(z.string()).default([]),
  reason: z.string().optional(),
});
export type PolicyDecision = z.infer<typeof PolicyDecision>;
