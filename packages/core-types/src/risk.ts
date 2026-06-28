import { z } from 'zod';
import { PackageName, PackageVersion, PublishId, TarballIntegrity } from './package.js';

/**
 * Risk report model. Version-specific and immutable for a given tarball
 * digest and analyzer version.
 */

export const RiskTier = z.enum(['excellent', 'good', 'caution', 'danger', 'blocked']);
export type RiskTier = z.infer<typeof RiskTier>;

export const RiskSeverity = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const RiskFinding = z.object({
  code: z.string().min(1),
  severity: RiskSeverity,
  message: z.string().min(1),
  /** File/line pointers, e.g. `package.json:scripts.postinstall`. */
  evidence: z.array(z.string()).default([]),
});
export type RiskFinding = z.infer<typeof RiskFinding>;

export const TarballFacts = z.object({
  sizeBytes: z.number().int().nonnegative(),
  unpackedSizeBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  integrity: TarballIntegrity.optional(),
  shasum: z.string().optional(),
});
export type TarballFacts = z.infer<typeof TarballFacts>;

export const PublisherFacts = z.object({
  name: z.string().optional(),
  firstSeenAt: z.string().datetime().optional(),
  trustedPublisher: z.boolean().default(false),
  strongAuth: z.boolean().default(false),
});
export type PublisherFacts = z.infer<typeof PublisherFacts>;

export const SourceFacts = z.object({
  repository: z.string().optional(),
  provenance: z.enum(['verified', 'missing', 'mismatch', 'unsupported']).optional(),
  commit: z.string().optional(),
});
export type SourceFacts = z.infer<typeof SourceFacts>;

export const PermissionFacts = z.object({
  declared: z.record(z.string(), z.unknown()).default({}),
  inferred: z.record(z.string(), z.unknown()).default({}),
  enforceable: z.boolean().default(false),
});
export type PermissionFacts = z.infer<typeof PermissionFacts>;

export const RiskFacts = z.object({
  tarball: TarballFacts.optional(),
  publisher: PublisherFacts.optional(),
  source: SourceFacts.optional(),
  permissions: PermissionFacts.optional(),
});
export type RiskFacts = z.infer<typeof RiskFacts>;

export const RiskReport = z.object({
  package: PackageName,
  version: PackageVersion,
  publishId: PublishId,
  score: z.number().int().min(0).max(100),
  tier: RiskTier,
  confidence: z.number().int().min(0).max(100),
  generatedAt: z.string().datetime(),
  analyzerVersion: z.string().min(1),
  evidenceDigest: z.string().min(1),
  blockers: z.array(RiskFinding).default([]),
  warnings: z.array(RiskFinding).default([]),
  facts: RiskFacts.default({}),
  /** Per-component score contributions (see design 9.4). */
  components: z
    .array(
      z.object({
        component: z.string(),
        weight: z.number(),
        contribution: z.number(),
        signals: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
});
export type RiskReport = z.infer<typeof RiskReport>;
