import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { mkdir, rm, readdir, stat, access, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * Quarantine cache for downloaded tarballs and unpacked contents.
 *
 * Tarballs are stored by integrity digest; unpacked contents by digest too.
 * The unpack path is never inside the current project by default.
 */
export interface QuarantineCache {
  rootDir: string;
  tarballDir: string;
  unpackDir: string;
}

/** Resolve the OS-specific cache root for safe-npm/safe-npx. */
export function defaultCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const envDir = env.SAFE_NPM_CACHE_DIR;
  if (envDir) return envDir;
  const home = homedir();
  const p = platform();
  if (p === 'darwin') return join(home, 'Library', 'Caches', 'safe-npm');
  if (p === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return join(localAppData, 'safe-npm', 'Cache');
  }
  // linux / others: XDG_CACHE_HOME or ~/.cache
  return join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'safe-npm');
}

export async function createQuarantineCache(
  rootDir: string = defaultCacheRoot(),
): Promise<QuarantineCache> {
  const tarballDir = join(rootDir, 'tarballs');
  const unpackDir = join(rootDir, 'unpacked');
  await mkdir(tarballDir, { recursive: true });
  await mkdir(unpackDir, { recursive: true });
  return { rootDir, tarballDir, unpackDir };
}

/** Path for a tarball cached by integrity digest. */
export function tarballPath(cache: QuarantineCache, integrity: string): string {
  const digest = digestFromIntegrity(integrity);
  return join(cache.tarballDir, `${digest}.tgz`);
}

/** Path for an unpacked package cached by integrity digest. */
export function unpackPath(cache: QuarantineCache, integrity: string): string {
  const digest = digestFromIntegrity(integrity);
  return join(cache.unpackDir, digest);
}

/** Check whether a tarball is already cached. */
export async function hasTarball(cache: QuarantineCache, integrity: string): Promise<boolean> {
  try {
    await access(tarballPath(cache, integrity));
    return true;
  } catch {
    return false;
  }
}

/** Check whether an unpacked dir is already cached. */
export async function hasUnpacked(cache: QuarantineCache, integrity: string): Promise<boolean> {
  try {
    await access(unpackPath(cache, integrity));
    return true;
  } catch {
    return false;
  }
}

/** Remove all cached tarballs and unpacked contents. */
export async function cleanCache(cache: QuarantineCache): Promise<void> {
  await rm(cache.tarballDir, { recursive: true, force: true });
  await rm(cache.unpackDir, { recursive: true, force: true });
  await mkdir(cache.tarballDir, { recursive: true });
  await mkdir(cache.unpackDir, { recursive: true });
}

/** Current size of the cache in bytes. */
export async function cacheSize(cache: QuarantineCache): Promise<number> {
  let total = 0;
  for (const dir of [cache.tarballDir, cache.unpackDir]) {
    total += await dirSize(dir);
  }
  return total;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      total += await dirSize(full);
    } else {
      total += s.size;
    }
  }
  return total;
}

/** Extract the hex/base64 digest portion from an SRI integrity string. */
function digestFromIntegrity(integrity: string): string {
  // sha512-<base64> -> hash the integrity string itself for a safe filename
  return createHash('sha256').update(integrity).digest('hex').slice(0, 32);
}


/**
 * Simple file-based cache lock to prevent concurrent corruption.
 * Acquires an exclusive lockfile under the cache root; resolves when held.
 * Returns a release function. Lock is best-effort (O_EXCL creation).
 */
export async function acquireCacheLock(
  cache: QuarantineCache,
  name: string,
  timeoutMs = 10_000,
): Promise<() => Promise<void>> {
  const lockPath = join(cache.rootDir, `${name}.lock`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fh = await open(lockPath, 'wx');
      await fh.writeFile(String(process.pid));
      await fh.close();
      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          /* already removed */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const { promise: wait, resolve: wake } = Promise.withResolvers<void>();
      setTimeout(wake, 50);
      await wait;
    }
  }
  throw new Error(`cache lock acquire timed out: ${name}`);
}
