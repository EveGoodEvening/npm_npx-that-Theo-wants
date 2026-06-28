import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generatePackument, type InternalPackage } from '../src/packument.js';

const pkg: InternalPackage = {
  name: '@scope/pkg',
  createdAt: '2026-01-01T00:00:00.000Z',
  distTags: { latest: '1.0.0' },
  versions: [
    {
      version: '1.0.0',
      publishId: 'pub-1',
      status: 'public',
      publishedAt: '2026-01-01T00:00:00.000Z',
      maintainers: [{ name: 'alice', email: 'a@x' }],
      tarballObjectKey: 'tarballs/abc.tgz',
      tarballIntegrity: 'sha512-aaa=',
      tarballShasum: 'abc123',
      signatures: [{ keyid: 'k1', sig: 'sig1' }],
      manifest: {
        description: 'a package',
        license: 'MIT',
        main: 'index.js',
        bin: { 'pkg': 'bin/cli.js' },
        scripts: { test: 'echo hi' },
        dependencies: { foo: '^1.0.0' },
      },
    },
    {
      version: '0.9.0',
      publishId: 'pub-0',
      status: 'retracted',
      publishedAt: '2025-12-01T00:00:00.000Z',
      tarballObjectKey: 'tarballs/old.tgz',
      manifest: { description: 'old' },
    },
    {
      version: '1.0.1',
      publishId: 'pub-2',
      status: 'deprecated',
      publishedAt: '2026-02-01T00:00:00.000Z',
      deprecated: 'use 1.0.0',
      tarballObjectKey: 'tarballs/dep.tgz',
      manifest: { description: 'deprecated' },
    },
  ],
};

describe('generatePackument', () => {
  test('excludes retracted versions by default', () => {
    const p = generatePackument(pkg, { registryBaseUrl: 'https://reg.example' }) as Record<
      string,
      unknown
    >;
    const versions = p.versions as Record<string, Record<string, unknown>>;
    assert.equal(versions['0.9.0'], undefined);
    assert.ok(versions['1.0.0']);
  });

  test('includes deprecated versions with warning', () => {
    const p = generatePackument(pkg, { registryBaseUrl: 'https://reg.example' }) as Record<
      string,
      unknown
    >;
    const versions = p.versions as Record<string, Record<string, unknown>>;
    assert.equal(versions['1.0.1']?.deprecated, 'use 1.0.0');
  });
  test('dist-tags preserved', () => {
    const p = generatePackument(pkg, { registryBaseUrl: 'https://reg.example' }) as Record<
      string,
      unknown
    >;
    assert.deepEqual(p['dist-tags'], { latest: '1.0.0' });
  });

  test('tarball URL includes publishId for lockfile safety', () => {
    const p = generatePackument(pkg, { registryBaseUrl: 'https://reg.example' }) as Record<
      string,
      unknown
    >;
    const versions = p.versions as Record<string, Record<string, unknown>>;
    const dist = versions['1.0.0']?.dist as Record<string, unknown>;
    assert.match(String(dist.tarball), /publishId=pub-1/);
  });

  test('dist includes integrity, shasum, signatures', () => {
    const p = generatePackument(pkg, { registryBaseUrl: 'https://reg.example' }) as Record<
      string,
      unknown
    >;
    const versions = p.versions as Record<string, Record<string, unknown>>;
    const dist = versions['1.0.0']?.dist as Record<string, unknown>;
    assert.equal(dist.integrity, 'sha512-aaa=');
    assert.equal(dist.shasum, 'abc123');
    assert.deepEqual(dist.signatures, [{ keyid: 'k1', sig: 'sig1' }]);
  });

  test('time includes created and per-version timestamps', () => {
    const p = generatePackument(pkg, { registryBaseUrl: 'https://reg.example' }) as Record<
      string,
      unknown
    >;
    const time = p.time as Record<string, string>;
    assert.equal(time.created, '2026-01-01T00:00:00.000Z');
    assert.equal(time['1.0.0'], '2026-01-01T00:00:00.000Z');
  });

  test('maintainers from latest visible version', () => {
    const p = generatePackument(pkg, { registryBaseUrl: 'https://reg.example' }) as Record<
      string,
      unknown
    >;
    assert.deepEqual(p.maintainers, [{ name: 'alice', email: 'a@x' }]);
  });

  test('includeRetracted brings back retracted version', () => {
    const p = generatePackument(pkg, {
      registryBaseUrl: 'https://reg.example',
      includeRetracted: true,
    }) as Record<string, unknown>;
    const versions = p.versions as Record<string, Record<string, unknown>>;
    assert.ok(versions['0.9.0']);
  });

  test('snapshot is stable JSON-serializable', () => {
    const p = generatePackument(pkg, { registryBaseUrl: 'https://reg.example' });
    const json = JSON.stringify(p);
    const reparsed = JSON.parse(json);
    assert.equal(reparsed.name, '@scope/pkg');
  });
});
