import { homedir, tmpdir } from 'node:os';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { mkdir, readdir, rm, stat, writeFile, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { safeExtract } from './extraction.js';

/**
 * Quarantine cache for downloaded tarballs and their unpacked contents.
 *
 * Tarballs and unpacked trees are stored by integrity digest so the same
 * artifact is never re-downloaded/re-extracted twice. The unpack path is kept
 * outside the current project by default to avoid polluting `node_modules`.
 */
export class QuarantineCache {
  readonly root: string;

  constructor(root?: string) {
    this.root = root ?? defaultCacheRoot();
  }

  get tarballsDir(): string {
    return join(this.root, 'tarballs');
  }

  get unpackedDir(): string {
    return join(this.root, 'unpacked');
  }

  tarballPath(digest: string): string {
    return join(this.tarballsDir, `${digest}.tgz`);
  }

  unpackedPath(digest: string): string {
    return join(this.unpackedDir, digest);
  }

  /** Ensure the cache directory structure exists. */
  async ensure(): Promise<void> {
    await mkdir(this.tarballsDir, { recursive: true });
    await mkdir(this.unpackedDir, { recursive: true });
  }

  /** True when a tarball for `digest` is already cached. */
  async hasTarball(digest: string): Promise<boolean> {
    try {
      await access(this.tarballPath(digest), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** True when unpacked contents for `digest` are already cached. */
  async hasUnpacked(digest: string): Promise<boolean> {
    try {
      await access(this.unpackedPath(digest), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Write tarball bytes for `digest`. Uses an atomic temp+rename write. */
  async writeTarball(digest: string, data: Buffer): Promise<string> {
    await this.ensure();
    const finalPath = this.tarballPath(digest);
    if (await this.hasTarball(digest)) return finalPath;
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, data);
    await rename(tmpPath, finalPath);
    return finalPath;
  }

  /**
   * Extract a cached tarball into the unpacked directory for `digest`.
   * Extraction is guarded by a per-digest lock directory to prevent concurrent
   * corruption; concurrent callers wait for the lock holder to finish.
   */
  async extract(digest: string): Promise<string> {
    await this.ensure();
    const dest = this.unpackedPath(digest);
    if (await this.hasUnpacked(digest)) return dest;

    const lockDir = `${dest}.lock`;
    await this.acquireLock(lockDir);
    try {
      // Re-check after acquiring the lock in case another process finished.
      if (await this.hasUnpacked(digest)) return dest;
      const tarball = this.tarballPath(digest);
      await safeExtract(tarball, dest, { strip: 1 });
      return dest;
    } finally {
      await rm(lockDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Remove cached tarball and unpacked contents for `digest`. */
  async evict(digest: string): Promise<void> {
    await rm(this.tarballPath(digest), { force: true }).catch(() => {});
    await rm(this.unpackedPath(digest), { recursive: true, force: true }).catch(() => {});
  }

  /** Remove all cached entries. */
  async cleanup(): Promise<void> {
    await rm(this.tarballsDir, { recursive: true, force: true }).catch(() => {});
    await rm(this.unpackedDir, { recursive: true, force: true }).catch(() => {});
    await this.ensure();
  }

  /** List cached digests. */
  async list(): Promise<{ tarballs: string[]; unpacked: string[] }> {
    const [t, u] = await Promise.all([
      readdirSafe(this.tarballsDir),
      readdirSafe(this.unpackedDir),
    ]);
    return {
      tarballs: t.filter((f) => f.endsWith('.tgz')).map((f) => f.slice(0, -'.tgz'.length)),
      unpacked: u.filter((f) => !f.endsWith('.lock')),
    };
  }

  private async acquireLock(lockDir: string): Promise<void> {
    // Simple spin-lock via mkdir atomicity. Bounded retries avoid infinite waits.
    for (let attempt = 0; attempt < 1000; attempt++) {
      try {
        await mkdir(lockDir, { recursive: false });
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        // Stale lock guard: if older than 5 minutes, reclaim it.
        try {
          const s = await stat(lockDir);
          if (Date.now() - s.mtimeMs > 5 * 60 * 1000) {
            await rm(lockDir, { recursive: true, force: true });
            continue;
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error(`quarantine cache lock timeout at ${lockDir}`);
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Default cache root: platform-specific, outside the current project. */
export function defaultCacheRoot(): string {
  const base = process.env.SAFE_NPM_CACHE_DIR ?? defaultOsCacheDir();
  return join(base, 'safe-npm', 'quarantine');
}

function defaultOsCacheDir(): string {
  const platform = process.platform;
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches');
  if (platform === 'win32') return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  // Linux and others: honor XDG_CACHE_HOME, fall back to ~/.cache, then os tmpdir.
  return process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache') ?? tmpdir();
}

/**
 * Assert that `path` is not inside `projectDir`. Used to guarantee the unpack
 * path never lands inside the current project by default.
 */
export function assertNotInsideProject(path: string, projectDir: string): void {
  const absPath = isAbsolute(path) ? path : resolve(path);
  const absProject = isAbsolute(projectDir) ? projectDir : resolve(projectDir);
  const rel = relative(absProject, absPath);
  if (!rel.startsWith('..') && rel !== '') {
    throw new Error(`quarantine path "${path}" is inside project "${projectDir}"`);
  }
}

/** Compute a digest key from an npm integrity string (`sha512-...`). */
export function digestFromIntegrity(integrity: string): string {
  return createHash('sha1').update(integrity).digest('hex');
}
