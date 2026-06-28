import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  AnalysisReport,
  type AnalysisReport as AnalysisReportType,
  type TarballIntegrity,
} from '@safe-npm/core-types';
import { QuarantineCache, digestFromIntegrity } from './cache.js';
import { analyzeMetadata } from './metadata.js';
import { analyzeScripts } from './scripts.js';
import { analyzeStaticFiles } from './static.js';
import { analyzeReadability } from './readability.js';

export const ANALYZER_VERSION = '0.1.0';

export interface AnalyzeTarballOptions {
  /** Path to the downloaded tarball on disk. */
  tarballPath: string;
  /** npm integrity string (`sha512-...`) for the tarball. */
  integrity: TarballIntegrity;
  /** Resolved package name. */
  packageName: string;
  /** Resolved package version. */
  packageVersion: string;
  /** Publish ID (defaults to "unknown" when not known). */
  publishId?: string;
  /** Optional quarantine cache; a default one is created when omitted. */
  cache?: QuarantineCache;
  /** Generated-at timestamp override (ISO); defaults to now. */
  generatedAt?: string;
}

/**
 * Analyze a downloaded tarball and return a stable {@link AnalysisReport}.
 *
 * The tarball is extracted into a quarantine cache (never inside the current
 * project) and inspected without executing any package code.
 */
export async function analyzeTarball(
  options: AnalyzeTarballOptions,
): Promise<AnalysisReportType> {
  const cache = options.cache ?? new QuarantineCache();
  const digest = digestFromIntegrity(options.integrity);

  // Cache the tarball bytes if not already present, then extract.
  const tarballStat = await stat(options.tarballPath);
  if (!(await cache.hasTarball(digest))) {
    const { readFile } = await import('node:fs/promises');
    await cache.writeTarball(digest, await readFile(options.tarballPath));
  }
  const unpackedRoot = await cache.extract(digest);

  const meta = await analyzeMetadata(unpackedRoot, options.packageName, options.packageVersion);
  const hasBindingGyp = meta.nativeArtifacts.some((a) => a.type === 'binding_gyp');
  const lifecycleScripts = analyzeScripts(meta.metadata.scripts, hasBindingGyp);

  const files = await listFiles(unpackedRoot);
  const codeFiles = files.filter((f) => /\.(js|mjs|cjs|ts|tsx)$/i.test(f));
  const staticResult = await analyzeStaticFiles(unpackedRoot, codeFiles);
  const readability = await analyzeReadability(unpackedRoot, codeFiles);

  const report = AnalysisReport.parse({
    package: options.packageName,
    version: options.packageVersion,
    publishId: options.publishId ?? 'unknown',
    tarballDigest: options.integrity,
    analyzerVersion: ANALYZER_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    tarball: {
      sizeBytes: tarballStat.size,
      unpackedSizeBytes: meta.unpackedSizeBytes,
      fileCount: meta.fileCount,
    },
    metadata: meta.metadata,
    lifecycleScripts,
    staticFindings: staticResult.findings,
    readability,
    nativeArtifacts: meta.nativeArtifacts,
    builtinsUsed: staticResult.builtinsUsed,
  });
  return report;
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(relative(root, abs));
      }
    }
  }
  await walk(root);
  return out;
}

export * from './cache.js';
export * from './extraction.js';
export * from './metadata.js';
export * from './scripts.js';
export * from './static.js';
export * from './readability.js';
export * from './diff-version.js';
export * from './diff.js';
export * from './diff-risk.js';
