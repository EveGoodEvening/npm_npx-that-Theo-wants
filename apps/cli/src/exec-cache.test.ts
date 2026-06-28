import { describe, expect, it, beforeEach } from 'vitest';
import { ExecutionCache, computePolicyHash } from './exec-cache.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, stat } from 'node:fs/promises';

describe('ExecutionCache', () => {
  let cache: ExecutionCache;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'safe-npx-cache-test-'));
    cache = new ExecutionCache({ baseDir: testDir });
  });

  it('computes a stable cache key', () => {
    const key1 = cache.cacheKey('pkg', '1.0.0', 'sha512-abc', 'policy-hash-1');
    const key2 = cache.cacheKey('pkg', '1.0.0', 'sha512-abc', 'policy-hash-1');
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(16);
  });

  it('computes different keys for different inputs', () => {
    const key1 = cache.cacheKey('pkg', '1.0.0', 'sha512-abc', 'policy-hash-1');
    const key2 = cache.cacheKey('pkg', '1.1.0', 'sha512-abc', 'policy-hash-1');
    expect(key1).not.toBe(key2);
  });

  it('creates cache directory', async () => {
    const key = cache.cacheKey('pkg', '1.0.0', 'sha512-abc', 'policy-hash');
    const dir = await cache.ensureCacheDir(key);
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
    const prefixStat = await stat(join(dir, 'prefix'));
    expect(prefixStat.isDirectory()).toBe(true);
  });

  it('checks if cache entry exists', async () => {
    const key = cache.cacheKey('pkg', '1.0.0', 'sha512-abc', 'policy-hash');
    expect(await cache.has(key)).toBe(false);
    await cache.ensureCacheDir(key);
    expect(await cache.has(key)).toBe(true);
  });

  it('removes a cache entry', async () => {
    const key = cache.cacheKey('pkg', '1.0.0', 'sha512-abc', 'policy-hash');
    await cache.ensureCacheDir(key);
    expect(await cache.has(key)).toBe(true);
    await cache.remove(key);
    expect(await cache.has(key)).toBe(false);
  });

  it('cleans up all cache entries', async () => {
    await cache.ensureCacheDir(cache.cacheKey('pkg1', '1.0.0', 'd1', 'p1'));
    await cache.ensureCacheDir(cache.cacheKey('pkg2', '1.0.0', 'd2', 'p2'));
    const result = await cache.cleanup();
    expect(result.removed).toBe(2);
  });
});

describe('computePolicyHash', () => {
  it('produces a stable hash', () => {
    const h1 = computePolicyHash({ a: 1, b: 2 });
    const h2 = computePolicyHash({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different policies', () => {
    const h1 = computePolicyHash({ a: 1 });
    const h2 = computePolicyHash({ a: 2 });
    expect(h1).not.toBe(h2);
  });
});
