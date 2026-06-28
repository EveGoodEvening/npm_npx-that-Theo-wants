import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AnalysisReport,
  TarballIntegrity,
  ExactVersion,
  PackageName,
  Permissions,
} from '@safe-npm/core-types';
import { PermissionsSchema, SafeNpmError } from '@safe-npm/core-types';
import {
  buildMetadataReport,
  parseDeclaredPermissions,
  type AnalysisInput,
} from './metadata.js';
import { analyzeScripts, applyScriptAnalysis } from './scripts.js';
import { analyzeStaticFiles, applyStaticAnalysis } from './static.js';
import { analyzeReadability, applyReadability } from './readability.js';
import { safeExtract } from './extract.js';

export const ANALYZER_VERSION = '0.1.0';

export interface AnalyzeTarballInput {
  tarballPath: string;
  unpackDir: string;
  expectedName: PackageName;
  expectedVersion: ExactVersion;
  maintainersFromPackument?: Array<{ name?: string; email?: string }>;
}

/**
 * Analyze a tarball: extract metadata, scripts, static code, and readability.
 * Never executes any package code.
 */
export async function analyzeTarball(input: AnalyzeTarballInput): Promise<{
  report: AnalysisReport;
  declaredPermissions?: Permissions;
}> {
  // extract tarball into unpackDir (safe extraction, no code execution)
  await safeExtract(input.tarballPath, input.unpackDir);

  // compute tarball digest
  const buf = await readFile(input.tarballPath);
  const tarballDigest = `sha512-${createHash('sha512').update(buf).digest('base64')}` as TarballIntegrity;
  const metaInput: AnalysisInput = {
    tarballDigest,
    analyzerVersion: ANALYZER_VERSION,
    tarballSizeBytes: buf.byteLength,
    unpackDir: input.unpackDir,
    expectedName: input.expectedName,
    expectedVersion: input.expectedVersion,
    maintainersFromPackument: input.maintainersFromPackument,
  };

  const { report, facts, pkg, pkgRoot } = await buildMetadataReport(metaInput);

  // Validate name/version against resolved package.
  if (pkg.name !== input.expectedName) {
    throw new SafeNpmError({
      code: 'TARBALL_INTEGRITY_FAILED',
      message: `package name mismatch: expected ${input.expectedName}, got ${pkg.name}`,
      details: { expected: input.expectedName, actual: pkg.name },
    });
  }
  if (pkg.version !== input.expectedVersion) {
    throw new SafeNpmError({
      code: 'TARBALL_INTEGRITY_FAILED',
      message: `package version mismatch: expected ${input.expectedVersion}, got ${pkg.version}`,
      details: { expected: input.expectedVersion, actual: pkg.version },
    });
  }
  // scripts
  const scriptResult = analyzeScripts(pkg, facts.bindingGyp);
  applyScriptAnalysis(report, scriptResult);

  // static analysis
  const staticResult = await analyzeStaticFiles(pkgRoot, facts.codeFiles);
  applyStaticAnalysis(report, staticResult);

  // readability
  const readabilityResult = await analyzeReadability(pkgRoot, facts.codeFiles, facts.sourceMaps.length > 0);
  applyReadability(report, readabilityResult);

  // declared permissions
  const declaredPermissions = parseDeclaredPermissions(pkg.safeNpm?.permissions);

  return { report, declaredPermissions };
}

/**
 * Resolve a bin entry for execution using npm-compatible rules.
 * Returns the selected bin name, or throws if ambiguous.
 */
export function resolveBin(
  bin: Record<string, string>,
  packageName: PackageName,
): string {
  const names = Object.keys(bin);
  if (names.length === 0) {
    throw new Error('package has no bin entries');
  }
  if (names.length === 1) {
    return names[0]!;
  }
  // multiple aliases: if all point to the same command, pick the one matching the unscoped name
  const unscoped = packageName.startsWith('@') ? packageName.split('/')[1]! : packageName;
  const match = names.find((n) => n === unscoped);
  if (match) return match;
  // if all aliases point to the same target, pick the first
  const targets = new Set(names.map((n) => bin[n]));
  if (targets.size === 1) return names[0]!;
  throw new Error(`ambiguous bins: ${names.join(', ')}`);
}

/** Re-export for callers needing the empty permissions default. */
export function emptyPermissions(): Permissions {
  return PermissionsSchema.parse({});
}

export { join };
