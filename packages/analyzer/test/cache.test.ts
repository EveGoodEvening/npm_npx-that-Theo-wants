import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createQuarantineCache,
  tarballPath,
  unpackPath,
  hasTarball,
  hasUnpacked,
  acquireCacheLock,
  cleanCache,
  cacheSize,
  defaultCacheRoot,
} from '../src/cache.js';

describe('QuarantineCache', () => {
  let root: string;
  test('setup', async () => {
    root = await mkdtemp(join(tmpdir(), 'safe-cache-'));
  });

  test('create creates dirs', async () => {
    const cache = await createQuarantineCache(root);
    assert.equal(cache.rootDir, root);
    assert.ok(cache.tarballDir);
    assert.ok(cache.unpackDir);
  });

  test('tarballPath and unpackPath are deterministic by digest', async () => {
    const cache = await createQuarantineCache(root);
    const p1 = tarballPath(cache, 'sha512-abc');
    const p2 = tarballPath(cache, 'sha512-abc');
    assert.equal(p1, p2);
    assert.notEqual(tarballPath(cache, 'sha512-abc'), tarballPath(cache, 'sha512-def'));
    assert.notEqual(unpackPath(cache, 'sha512-abc'), tarballPath(cache, 'sha512-abc'));
  });

  test('hasTarball/hasUnpacked false for missing', async () => {
    const cache = await createQuarantineCache(root);
    assert.equal(await hasTarball(cache, 'sha512-missing'), false);
    assert.equal(await hasUnpacked(cache, 'sha512-missing'), false);
  });

  test('cache lock acquires and releases', async () => {
    const cache = await createQuarantineCache(root);
    const release = await acquireCacheLock(cache, 'test-lock');
    // second acquire on same name should time out (lock held)
    await assert.rejects(acquireCacheLock(cache, 'test-lock', 200), /timed out/);
    await release();
    // now acquirable again
    const release2 = await acquireCacheLock(cache, 'test-lock');
    await release2();
  });

  test('cleanCache empties and cacheSize is 0', async () => {
    const cache = await createQuarantineCache(root);
    await cleanCache(cache);
    assert.equal(await cacheSize(cache), 0);
  });

  test('defaultCacheRoot respects env override', () => {
    const dir = defaultCacheRoot({ SAFE_NPM_CACHE_DIR: '/custom/cache' } as NodeJS.ProcessEnv);
    assert.equal(dir, '/custom/cache');
  });

  test('cleanup', async () => {
    await rm(root, { recursive: true, force: true });
  });
});
