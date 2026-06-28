/**
 * Execution cache for safe-npx (design 18.1).
 *
 * Isolated cache for installed packages used by safe-npx execution.
 * Never uses the project's node_modules.
 */
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export interface ExecutionCacheOptions {
  /** Base directory for the cache. Defaults to ~/.safe-npm/exec-cache. */
  baseDir?: string;
}

export class ExecutionCache {
  private baseDir: string;

  constructor(options: ExecutionCacheOptions = {}) {
    this.baseDir = options.baseDir ?? join(homedir(), '.safe-npm', 'exec-cache');
  }

  /** Get the cache key for a package/version/digest/policy combination. */
  cacheKey(packageName: string, version: string, tarballDigest: string, policyHash: string): string {
    const input = `${packageName}@${version}:${tarballDigest}:${policyHash}`;
    const hash = createHash('sha256').update(input).digest('hex').slice(0, 16);
    return hash;
  }

  /** Get the cache directory for a given cache key. */
  cacheDir(key: string): string {
    return join(this.baseDir, key);
  }

  /** Get the prefix (node_modules) path for a cache key. */
  prefixDir(key: string): string {
    return join(this.cacheDir(key), 'prefix');
  }

  /** Ensure the cache directory exists. */
  async ensureCacheDir(key: string): Promise<string> {
    const dir = this.cacheDir(key);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'prefix'), { recursive: true });
    return dir;
  }

  /** Check if a cache entry exists. */
  async has(key: string): Promise<boolean> {
    try {
      const s = await stat(this.cacheDir(key));
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  /** Remove a cache entry. */
  async remove(key: string): Promise<void> {
    await rm(this.cacheDir(key), { recursive: true, force: true }).catch(() => {});
  }

  /** Clean up the entire cache. */
  async cleanup(): Promise<{ removed: number; bytes: number }> {
    let removed = 0;
    const bytes = 0;
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await rm(join(this.baseDir, entry.name), { recursive: true, force: true });
          removed++;
        }
      }
    } catch {
      // Base dir doesn't exist.
    }
    return { removed, bytes };
  }

  /** Get the base directory. */
  getBaseDir(): string {
    return this.baseDir;
  }
}

/**
 * Compute a policy hash from a policy object.
 */
export function computePolicyHash(policy: unknown): string {
  const json = JSON.stringify(policy);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}
