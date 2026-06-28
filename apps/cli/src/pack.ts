/**
 * Pack a package directory into a tarball for publishing (design 8.1).
 *
 * Uses `npm pack --json` to produce a standard npm tarball, then computes
 * integrity and runs the local analyzer before upload.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { analyzeTarball, QuarantineCache } from '@safe-npm/analyzer';
import type { AnalysisReport } from '@safe-npm/core-types';

export interface PackResult {
  tarballPath: string;
  tarballBuffer: Buffer;
  sha512: string;
  shasum: string;
  size: number;
  filename: string;
  analysisReport: AnalysisReport;
  packageJson: {
    name: string;
    version: string;
    [key: string]: unknown;
  };
}

export interface PackOptions {
  /** Directory to pack (defaults to cwd). */
  cwd?: string;
  /** Quarantine cache for analysis. */
  cache?: QuarantineCache;
}

/**
 * Pack a package directory into a tarball and analyze it.
 *
 * 1. Runs `npm pack --json --dry-run` to preview contents.
 * 2. Runs `npm pack` to produce the actual tarball.
 * 3. Computes sha512 and shasum integrity.
 * 4. Runs the local analyzer on the tarball.
 */
export async function packAndAnalyze(options: PackOptions = {}): Promise<PackResult> {
  const cwd = options.cwd ?? process.cwd();

  // Read package.json.
  const pkgJsonPath = join(cwd, 'package.json');
  const pkgJsonContent = await readFile(pkgJsonPath, 'utf8');
  const packageJson = JSON.parse(pkgJsonContent) as { name: string; version: string; [k: string]: unknown };

  if (!packageJson.name || !packageJson.version) {
    throw new PackError('package.json must have name and version', 'INVALID_PACKAGE_JSON');
  }

  // Step 1: Preview contents with dry-run.
  await runNpmPack(cwd, true);

  // Step 2: Actual pack into temp directory.
  const tmpDir = await mkdtemp(join(tmpdir(), 'safe-npm-pack-'));
  try {
    const packResult = await runNpmPack(cwd, false, tmpDir);
    const filename = packResult.filename;
    const tarballPath = join(tmpDir, filename);
    const tarballBuffer = await readFile(tarballPath);

    // Step 3: Compute integrity.
    const sha512 = `sha512-${createHash('sha512').update(tarballBuffer).digest('base64')}`;
    const shasum = createHash('sha1').update(tarballBuffer).digest('hex');

    // Step 4: Run analyzer.
    const cache = options.cache ?? new QuarantineCache();
    const analysisReport = await analyzeTarball({
      tarballPath,
      integrity: sha512,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      cache,
    });

    return {
      tarballPath,
      tarballBuffer,
      sha512,
      shasum,
      size: tarballBuffer.length,
      filename,
      analysisReport,
      packageJson,
    };
  } finally {
    // Don't clean up tmpDir here — caller may need the tarball.
    // Cleanup is the caller's responsibility.
  }
}

interface NpmPackResult {
  filename: string;
  shasum: string;
  size: number;
  entryCount: number;
}

async function runNpmPack(cwd: string, dryRun: boolean, outDir?: string): Promise<NpmPackResult> {
  return new Promise((resolve, reject) => {
    const args = ['pack', '--json'];
    if (dryRun) args.push('--dry-run');
    if (outDir) args.push('--pack-destination', outDir);

    const child = spawn('npm', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new PackError(`npm pack failed (exit ${code}): ${stderr}`, 'NPM_PACK_FAILED'));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        const entry = Array.isArray(result) ? result[0] : result;
        resolve({
          filename: entry.filename ?? entry.name,
          shasum: entry.shasum,
          size: entry.size,
          entryCount: entry.entryCount ?? (entry.files ?? []).length,
        });
      } catch {
        reject(new PackError(`npm pack produced invalid JSON output`, 'NPM_PACK_INVALID_OUTPUT'));
      }
    });

    child.on('error', (err) => {
      reject(new PackError(`npm pack failed: ${err.message}`, 'NPM_PACK_ERROR'));
    });
  });
}

export class PackError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PackError';
    this.code = code;
  }
}

/** Clean up a pack temp directory. */
export async function cleanupPack(result: PackResult): Promise<void> {
  const dir = join(result.tarballPath, '..');
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
