import { describe, expect, it, beforeEach } from 'vitest';
import { TrustCache, type TrustEntry } from './trust-cache.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';

describe('TrustCache', () => {
  let cache: TrustCache;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'safe-npx-trust-test-'));
    testFile = join(testDir, 'trust.json');
    cache = new TrustCache(testFile);
  });

  it('starts empty', async () => {
    const entries = await cache.list();
    expect(entries).toEqual([]);
  });

  it('adds and retrieves trust entries', async () => {
    const entry: TrustEntry = {
      packageName: 'test-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-abc',
      scope: 'exact',
      createdAt: new Date().toISOString(),
    };
    await cache.trust(entry);
    const trusted = await cache.isTrusted('test-pkg', '1.0.0');
    expect(trusted).not.toBeNull();
    expect(trusted?.scope).toBe('exact');
  });

  it('trusts by package name only', async () => {
    await cache.trust({
      packageName: 'test-pkg',
      scope: 'package',
      createdAt: new Date().toISOString(),
    });
    expect(await cache.isTrusted('test-pkg')).not.toBeNull();
    expect(await cache.isTrusted('test-pkg', '2.0.0')).not.toBeNull();
  });

  it('trusts by digest', async () => {
    await cache.trust({
      packageName: 'test-pkg',
      tarballDigest: 'sha512-abc',
      scope: 'digest',
      createdAt: new Date().toISOString(),
    });
    expect(await cache.isTrusted('test-pkg', undefined, 'sha512-abc')).not.toBeNull();
    expect(await cache.isTrusted('test-pkg', undefined, 'sha512-wrong')).toBeNull();
  });

  it('revokes trust', async () => {
    await cache.trust({
      packageName: 'test-pkg',
      version: '1.0.0',
      scope: 'exact',
      createdAt: new Date().toISOString(),
    });
    expect(await cache.isTrusted('test-pkg', '1.0.0')).not.toBeNull();
    await cache.revoke('test-pkg', '1.0.0');
    expect(await cache.isTrusted('test-pkg', '1.0.0')).toBeNull();
  });

  it('lists all entries', async () => {
    await cache.trust({ packageName: 'pkg-a', scope: 'package', createdAt: new Date().toISOString() });
    await cache.trust({ packageName: 'pkg-b', version: '1.0.0', scope: 'exact', createdAt: new Date().toISOString() });
    const entries = await cache.list();
    expect(entries.length).toBe(2);
  });

  it('replaces existing entry for same package/version', async () => {
    await cache.trust({ packageName: 'pkg', version: '1.0.0', scope: 'exact', createdAt: new Date().toISOString() });
    await cache.trust({ packageName: 'pkg', version: '1.0.0', scope: 'digest', createdAt: new Date().toISOString() });
    const entries = await cache.list();
    expect(entries.length).toBe(1);
    expect(entries[0]?.scope).toBe('digest');
  });
});
