import { extract as tarExtract, list as tarList } from 'tar';
import { dirname, relative, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

/**
 * Safe tar extraction that rejects path-traversal and unsafe link entries.
 *
 * Guards (design 4.2):
 * - Reject absolute paths.
 * - Reject `..` path traversal.
 * - Reject symlink/hardlink targets that escape the destination directory.
 */

export interface SafeExtractOptions {
  /** Strip this many leading path components (npm tarballs use `package/`). */
  strip?: number;
}

export class UnsafeTarEntryError extends Error {
  readonly entry: string;
  readonly reason: string;
  constructor(entry: string, reason: string) {
    super(`Unsafe tar entry "${entry}": ${reason}`);
    this.name = 'UnsafeTarEntryError';
    this.entry = entry;
    this.reason = reason;
  }
}

/**
 * Validate a single tar entry path against traversal rules.
 * Returns the sanitized relative path, or throws {@link UnsafeTarEntryError}.
 */
export function validateEntryPath(rawPath: string, dest: string, strip = 0): string {
  let path = rawPath;
  if (strip > 0) {
    const parts = path.split('/');
    path = parts.slice(strip).join('/');
  }
  if (path === '') return '';

  // Reject absolute paths.
  if (rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath)) {
    throw new UnsafeTarEntryError(rawPath, 'absolute paths are not allowed');
  }

  const resolved = resolve(dest, path);
  const rel = relative(dest, resolved);
  if (rel.startsWith('..') || resolve(dest, rel) !== resolved) {
    throw new UnsafeTarEntryError(rawPath, 'path traversal outside destination');
  }
  return path;
}

/**
 * Extract a tarball safely into `destination`. Throws {@link UnsafeTarEntryError}
 * on any unsafe entry before any file is written.
 *
 * Two passes: (1) scan all entry headers via `tar.list` and reject unsafe
 * paths/links up front; (2) extract with `tar.extract`. The pre-scan avoids
 * unhandled stream errors that would otherwise occur if `onentry` threw mid-stream.
 */
export async function safeExtract(
  tarballPath: string,
  destination: string,
  options: SafeExtractOptions = {},
): Promise<void> {
  const strip = options.strip ?? 1;
  await mkdir(destination, { recursive: true });

  // Pass 1: scan entries and validate. Collect entry metadata first, then
  // validate after the stream closes, so a validation failure rejects the
  // promise cleanly instead of becoming an unhandled stream error.
  const entries: Array<{
    path: string;
    type: string;
    linkpath?: string;
  }> = [];
  await tarList({
    file: tarballPath,
    strict: true,
    onentry(entry) {
      entries.push({
        path: entry.path,
        type: entry.type,
        linkpath: entry.linkpath ? String(entry.linkpath) : undefined,
      });
    },
  });

  for (const entry of entries) {
    validateEntryPath(entry.path, destination, 0);
    const stripped = validateEntryPath(entry.path, destination, strip);
    if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
      const linkTarget = entry.linkpath ?? '';
      const targetResolved = resolve(destination, dirname(stripped || '.'), linkTarget);
      const rel = relative(destination, targetResolved);
      if (rel.startsWith('..')) {
        throw new UnsafeTarEntryError(
          entry.path,
          `link target "${linkTarget}" escapes destination`,
        );
      }
    }
  }

  // Pass 2: extract (entries already validated).
  await tarExtract({
    file: tarballPath,
    cwd: destination,
    strip,
    strict: true,
  });
}
