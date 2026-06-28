import * as tar from 'tar';
import { join, normalize, relative, isAbsolute } from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { SafeNpmError } from '@safe-npm/core-types';

export interface SafeExtractOptions {
  /** Allow symlink entries (default false; only metadata extraction should ever enable). */
  allowSymlinks?: boolean;
  /** Allow hardlink entries (default false). */
  allowHardlinks?: boolean;
}

/**
 * Safely extract a tarball to a destination directory.
 *
 * Rejects:
 * - absolute paths
 * - `..` path traversal
 * - symlink traversal (unless `allowSymlinks`)
 * - hardlink traversal (unless `allowHardlinks`)
 *
 * Does not execute any package code.
 */
export async function safeExtract(
  tarballPath: string,
  destDir: string,
  options: SafeExtractOptions = {},
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const destAbs = normalize(destDir);

  const blocked: string[] = [];

  await tar.x({
    file: tarballPath,
    cwd: destAbs,
    strip: 0,
    preservePaths: false, // tar strips leading / and rejects .. by default
    noChmod: true,
    filter: (entryPath: string, entry: tar.ReadEntry | Stats) => {
      const normalized = normalize(entryPath);
      if (isAbsolute(normalized)) {
        blocked.push(`absolute path: ${entryPath}`);
        return false;
      }
      const full = join(destAbs, normalized);
      const rel = relative(destAbs, full);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        blocked.push(`path traversal: ${entryPath}`);
        return false;
      }
      // Reject symlink/hardlink targets that escape destDir.
      const isSymlink =
        typeof (entry as tar.ReadEntry).type === 'string'
          ? (entry as tar.ReadEntry).type === 'SymbolicLink'
          : (entry as Stats).isSymbolicLink();
      const isHardlink =
        typeof (entry as tar.ReadEntry).type === 'string'
          ? (entry as tar.ReadEntry).type === 'Link'
          : false;
      if (isSymlink && !options.allowSymlinks) {
        blocked.push(`symlink entry: ${entryPath}`);
        return false;
      }
      if (isHardlink && !options.allowHardlinks) {
        blocked.push(`hardlink entry: ${entryPath}`);
        return false;
      }
      return true;
    },
  });

  if (blocked.length > 0) {
    throw new SafeNpmError({
      code: 'TARBALL_INTEGRITY_FAILED',
      message: `tarball contained unsafe entries: ${blocked.join('; ')}`,
      details: { blocked },
      remediation: 'reject this tarball; it contains path traversal or unsafe links',
    });
  }
}

/** Read a file from the unpacked tree, returning null if missing. */
export async function readUnpackedFile(
  unpackDir: string,
  relativePath: string,
): Promise<string | null> {
  const full = join(unpackDir, relativePath);
  const norm = normalize(full);
  const base = normalize(unpackDir);
  const rel = relative(base, norm);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new SafeNpmError({
      code: 'TARBALL_INTEGRITY_FAILED',
      message: `refusing to read outside unpack dir: ${relativePath}`,
      details: { relativePath },
    });
  }
  try {
    return await readFile(full, 'utf8');
  } catch {
    return null;
  }
}

/** Stat a file in the unpacked tree. */
export async function statUnpackedFile(
  unpackDir: string,
  relativePath: string,
): Promise<boolean> {
  const full = join(unpackDir, relativePath);
  const norm = normalize(full);
  const base = normalize(unpackDir);
  const rel = relative(base, norm);
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  try {
    await stat(full);
    return true;
  } catch {
    return false;
  }
}
