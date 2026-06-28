import { z } from 'zod';

/** npm package name: optional @scope/ + lowercase name with -, _, . allowed. */
export const PackageNameSchema = z
  .string()
  .min(1)
  .max(214)
  .regex(
    /^(?:@([a-z0-9][\w-.]*)\/)?([a-z0-9][\w-.]*)$/,
    'invalid package name (must be optional @scope/ + lowercase name)',
  );
export type PackageName = z.infer<typeof PackageNameSchema>;

/** Semver-ish version string or dist-tag. */
export const PackageVersionSchema = z.string().min(1).max(256);
export type PackageVersion = z.infer<typeof PackageVersionSchema>;

/** A resolved exact version (semver X.Y.Z). */
export const ExactVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/, 'must be exact semver');
export type ExactVersion = z.infer<typeof ExactVersionSchema>;

/** A package specifier as input by a user (e.g. `is-odd`, `is-odd@latest`, `@scope/pkg@^1.0.0`). */
export const PackageSpecSchema = z.object({
  raw: z.string().min(1),
  /** Package name (validated as a registry name only when source is `registry`). */
  name: z.string().min(1),
  /** Specifier portion: a semver range, dist-tag, or undefined for bare name. */
  specifier: z.string().optional(),
  /** Source kind. */
  source: z.enum(['registry', 'git', 'file', 'directory', 'remote']),
});
export type PackageSpec = z.infer<typeof PackageSpecSchema>;

/** Unique publish identifier (content/random). */
export const PublishIdSchema = z.string().min(1).max(128);
export type PublishId = z.infer<typeof PublishIdSchema>;

/** Integrity string in subresource-integrity format: `sha512-...` or `sha1-...`. */
export const TarballIntegritySchema = z
  .string()
  .regex(/^(sha512|sha384|sha256|sha1)-[A-Za-z0-9+/=]+$/, 'invalid SRI integrity string');
export type TarballIntegrity = z.infer<typeof TarballIntegritySchema>;

export const VisibilitySchema = z.enum(['private', 'public', 'quarantined']);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const VersionStatusSchema = z.enum([
  'private',
  'staged_public',
  'public',
  'retracted',
  'deprecated',
  'quarantined',
  'deleted',
]);
export type VersionStatus = z.infer<typeof VersionStatusSchema>;

export const RiskTierSchema = z.enum(['excellent', 'good', 'caution', 'danger', 'blocked']);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const RiskFindingSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskFindingSeverity = z.infer<typeof RiskFindingSeveritySchema>;

export const RiskFindingSchema = z.object({
  code: z.string().min(1),
  severity: RiskFindingSeveritySchema,
  message: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  /** Optional score deduction contributed by this finding. */
  deduction: z.number().int().optional(),
});
export type RiskFinding = z.infer<typeof RiskFindingSchema>;

export const TarballFactsSchema = z.object({
  sizeBytes: z.number().int().nonnegative(),
  unpackedSizeBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  integrity: TarballIntegritySchema.optional(),
  shasum: z.string().optional(),
});
export type TarballFacts = z.infer<typeof TarballFactsSchema>;

export const PublisherFactsSchema = z.object({
  name: z.string().optional(),
  firstSeenAt: z.string().datetime().optional(),
  trustedPublisher: z.boolean().default(false),
  strongAuth: z.boolean().default(false),
});
export type PublisherFacts = z.infer<typeof PublisherFactsSchema>;

export const SourceFactsSchema = z.object({
  repository: z.string().url().optional(),
  provenance: z.enum(['verified', 'missing', 'mismatch', 'unsupported']).default('missing'),
  commit: z.string().optional(),
});
export type SourceFacts = z.infer<typeof SourceFactsSchema>;

export const PermissionScopeSchema = z.object({
  read: z.array(z.string()).default([]),
  write: z.array(z.string()).default([]),
});
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;

export const PermissionsSchema = z.object({
  fs: PermissionScopeSchema.optional(),
  net: z.array(z.string()).default([]),
  env: z.array(z.string()).default([]),
  childProcess: z.boolean().default(false),
  workerThreads: z.boolean().default(false),
  ffi: z.boolean().default(false),
  native: z.boolean().default(false),
  installScripts: z.boolean().default(false),
});
export type Permissions = z.infer<typeof PermissionsSchema>;

export const PermissionReportSchema = z.object({
  declared: PermissionsSchema,
  inferred: PermissionsSchema,
  enforceable: z.boolean().default(false),
  enforcement: z
    .object({
      mode: z.string(),
      available: z.boolean(),
      limitations: z.array(z.string()).default([]),
      command: z.array(z.string()).default([]),
    })
    .optional(),
});
export type PermissionReport = z.infer<typeof PermissionReportSchema>;

export const RiskReportFactsSchema = z.object({
  tarball: TarballFactsSchema,
  publisher: PublisherFactsSchema.optional(),
  source: SourceFactsSchema.optional(),
  permissions: PermissionReportSchema.optional(),
});
export type RiskReportFacts = z.infer<typeof RiskReportFactsSchema>;

export const RiskReportSchema = z.object({
  package: PackageNameSchema,
  version: PackageVersionSchema,
  publishId: PublishIdSchema.optional(),
  score: z.number().int().min(0).max(100),
  tier: RiskTierSchema,
  confidence: z.number().int().min(0).max(100),
  generatedAt: z.string().datetime(),
  analyzerVersion: z.string().min(1),
  evidenceDigest: z.string().min(1),
  blockers: z.array(RiskFindingSchema).default([]),
  warnings: z.array(RiskFindingSchema).default([]),
  facts: RiskReportFactsSchema,
  /** Per-component score contributions, explainable. */
  components: z
    .array(
      z.object({
        name: z.string(),
        weight: z.number(),
        contribution: z.number(),
        signals: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});
export type RiskReport = z.infer<typeof RiskReportSchema>;

/** Internal analysis report produced by the analyzer package. */
export const AnalysisReportSchema = z.object({
  tarballDigest: TarballIntegritySchema,
  analyzerVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  package: z.object({
    name: PackageNameSchema,
    version: ExactVersionSchema,
    description: z.string().optional(),
    license: z.string().optional(),
    author: z.string().optional(),
    contributors: z.array(z.string()).default([]),
    maintainers: z.array(z.string()).default([]),
    repository: z.string().optional(),
    homepage: z.string().optional(),
    bugs: z.string().optional(),
    main: z.string().optional(),
    exports: z.record(z.string(), z.unknown()).default({}),
    bin: z.record(z.string(), z.string()).default({}),
    scripts: z.record(z.string(), z.string()).default({}),
    dependencies: z.record(z.string(), z.string()).default({}),
    devDependencies: z.record(z.string(), z.string()).default({}),
    optionalDependencies: z.record(z.string(), z.string()).default({}),
    peerDependencies: z.record(z.string(), z.string()).default({}),
    bundledDependencies: z.array(z.string()).default([]),
  }),
  tarball: TarballFactsSchema,
  lifecycleScripts: z.array(z.string()).default([]),
  scriptFindings: z.array(RiskFindingSchema).default([]),
  staticFindings: z.array(RiskFindingSchema).default([]),
  readability: z
    .object({
      likelyMinified: z.boolean().default(false),
      likelyObfuscated: z.boolean().default(false),
      sourceMapsPresent: z.boolean().default(false),
      humanReadableFileRatio: z.number().min(0).max(1).default(1),
      minifiedLineRatio: z.number().min(0).max(1).default(0),
      averageIdentifierLength: z.number().min(0).optional(),
    })
    .default({}),
  nativeArtifacts: z
    .object({
      nodeAddons: z.array(z.string()).default([]),
      binaries: z.array(z.string()).default([]),
      bindingGyp: z.boolean().default(false),
    })
    .default({}),
  inferredPermissions: PermissionsSchema,
  /** Resolved bin entry selected for execution, if any. */
  selectedBin: z.string().optional(),
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
