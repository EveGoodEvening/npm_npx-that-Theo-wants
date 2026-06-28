import { z } from 'zod';
import { PackageName, PackageVersion, PublishId, TarballIntegrity } from './package.js';

/**
 * Package analysis report (design 10). Produced by the analyzer from a tarball
 * digest, without executing package code. Consumed by the scoring package.
 */

export const NodeBuiltin = z.enum([
  'fs',
  'child_process',
  'http',
  'https',
  'net',
  'dns',
  'dgram',
  'os',
  'crypto',
  'worker_threads',
  'inspector',
  'v8',
  'vm',
]);
export type NodeBuiltin = z.infer<typeof NodeBuiltin>;

export const ScriptKind = z.enum([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
]);
export type ScriptKind = z.infer<typeof ScriptKind>;

export const LifecycleScriptFinding = z.object({
  kind: ScriptKind,
  command: z.string(),
  flags: z
    .array(
      z.enum([
        'shell_metacharacters',
        'network_tool',
        'package_manager',
        'node_gyp_native_build',
      ]),
    )
    .default([]),
});
export type LifecycleScriptFinding = z.infer<typeof LifecycleScriptFinding>;

export const StaticFindingCode = z.enum([
  'BUILTIN_FS',
  'BUILTIN_CHILD_PROCESS',
  'BUILTIN_HTTP',
  'BUILTIN_HTTPS',
  'BUILTIN_NET',
  'BUILTIN_DNS',
  'BUILTIN_DGRAM',
  'BUILTIN_OS',
  'BUILTIN_CRYPTO',
  'PROCESS_ENV_ACCESS',
  'SECRET_NAME_ACCESS',
  'EVAL',
  'NEW_FUNCTION',
  'DYNAMIC_IMPORT_NONLITERAL',
  'BASE64_DECODE_EXEC',
  'PARSE_FAILURE',
]);
export type StaticFindingCode = z.infer<typeof StaticFindingCode>;

export const StaticFinding = z.object({
  code: StaticFindingCode,
  file: z.string(),
  line: z.number().int().positive().optional(),
  evidence: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
});
export type StaticFinding = z.infer<typeof StaticFinding>;

export const ReadabilityFacts = z.object({
  likelyMinified: z.boolean().default(false),
  likelyObfuscated: z.boolean().default(false),
  sourceMapsPresent: z.boolean().default(false),
  humanReadableFileRatio: z.number().min(0).max(1).default(1),
  minifiedLineRatio: z.number().min(0).max(1).default(0),
  averageIdentifierLength: z.number().min(0).optional(),
  maxStringEntropy: z.number().min(0).optional(),
  giantStringArrays: z.boolean().default(false),
});
export type ReadabilityFacts = z.infer<typeof ReadabilityFacts>;

export const NativeArtifactFinding = z.object({
  type: z.enum(['node_addon', 'binding_gyp', 'binary', 'prebuilt']),
  file: z.string(),
});
export type NativeArtifactFinding = z.infer<typeof NativeArtifactFinding>;

export const MetadataFacts = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  license: z.string().optional(),
  author: z.unknown().optional(),
  contributors: z.array(z.unknown()).default([]),
  maintainers: z.array(z.unknown()).default([]),
  repository: z.unknown().optional(),
  homepage: z.string().optional(),
  bugs: z.unknown().optional(),
  main: z.string().optional(),
  exports: z.unknown().optional(),
  bin: z.unknown().optional(),
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
  bundledDependencies: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
});
export type MetadataFacts = z.infer<typeof MetadataFacts>;

export const AnalysisReport = z.object({
  package: PackageName,
  version: PackageVersion,
  publishId: PublishId.default('unknown'),
  tarballDigest: TarballIntegrity,
  analyzerVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  tarball: z.object({
    sizeBytes: z.number().int().nonnegative(),
    unpackedSizeBytes: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
  }),
  metadata: MetadataFacts,
  lifecycleScripts: z.array(LifecycleScriptFinding).default([]),
  staticFindings: z.array(StaticFinding).default([]),
  readability: ReadabilityFacts.default({}),
  nativeArtifacts: z.array(NativeArtifactFinding).default([]),
  /** Built-in node modules referenced by the package code. */
  builtinsUsed: z.array(NodeBuiltin).default([]),
});
export type AnalysisReport = z.infer<typeof AnalysisReport>;
