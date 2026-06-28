import { describe, expect, it } from 'vitest';
import {
  fetchPackument,
  resolveBin,
  resolveVersion,
  type Packument,
  PackumentFetchError,
} from '../src/index.js';

const fixturePackument: Packument = {
  name: 'is-odd',
  'dist-tags': { latest: '3.0.1', next: '3.1.0-beta.0' },
  versions: {
    '2.0.0': makeVersion('is-odd', '2.0.0'),
    '3.0.0': makeVersion('is-odd', '3.0.0'),
    '3.0.1': makeVersion('is-odd', '3.0.1'),
    '3.1.0-beta.0': makeVersion('is-odd', '3.1.0-beta.0'),
  },
  time: { created: '2020-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
};

function makeVersion(name: string, version: string): Packument['versions'] extends Record<string, infer V> ? V : never {
  return {
    name,
    version,
    main: 'index.js',
    bin: { 'is-odd': 'bin.js' },
    scripts: { test: 'echo test' },
    dependencies: {},
    dist: { tarball: `https://registry.example.com/${name}/-/is-odd-${version}.tgz`, integrity: 'sha512-aaa', shasum: 'abc' },
  } as never;
}

describe('resolveVersion', () => {
  it('resolves a dist-tag', () => {
    expect(resolveVersion(fixturePackument, 'latest')).toBe('3.0.1');
    expect(resolveVersion(fixturePackument, 'next')).toBe('3.1.0-beta.0');
  });

  it('resolves an exact version', () => {
    expect(resolveVersion(fixturePackument, '3.0.0')).toBe('3.0.0');
  });

  it('resolves a semver range to the max satisfying version', () => {
    expect(resolveVersion(fixturePackument, '^3.0.0')).toBe('3.0.1');
    expect(resolveVersion(fixturePackument, '>=2.0.0 <3.0.0')).toBe('2.0.0');
  });

  it('resolves empty specifier to latest dist-tag', () => {
    expect(resolveVersion(fixturePackument, '')).toBe('3.0.1');
  });

  it('resolves wildcard range (excludes prereleases per semver default)', () => {
    expect(resolveVersion(fixturePackument, '*')).toBe('3.0.1');
  });

  it('returns null when nothing satisfies', () => {
    expect(resolveVersion(fixturePackument, '^99.0.0')).toBeNull();
  });

  it('returns null when packument has no versions', () => {
    expect(resolveVersion({ name: 'x' }, 'latest')).toBeNull();
  });
});

describe('resolveBin', () => {
  it('returns single string bin named after unscoped package', () => {
    const v = { name: 'x', version: '1.0.0', bin: 'cli.js' } as never;
    expect(resolveBin(v, 'x')).toEqual({ binName: 'x', binPath: 'cli.js' });
    expect(resolveBin(v, '@scope/x')).toEqual({ binName: 'x', binPath: 'cli.js' });
  });

  it('returns the single object bin entry', () => {
    const v = { name: 'x', version: '1.0.0', bin: { tool: 'cli.js' } } as never;
    expect(resolveBin(v, 'x')).toEqual({ binName: 'tool', binPath: 'cli.js' });
  });

  it('prefers the bin matching the unscoped package name when multiple exist', () => {
    const v = { name: 'x', version: '1.0.0', bin: { other: 'o.js', x: 'cli.js' } } as never;
    expect(resolveBin(v, 'x')).toEqual({ binName: 'x', binPath: 'cli.js' });
  });

  it('returns null for ambiguous bins with no name match', () => {
    const v = { name: 'x', version: '1.0.0', bin: { a: 'a.js', b: 'b.js' } } as never;
    expect(resolveBin(v, 'x')).toBeNull();
  });

  it('returns null when no bin', () => {
    const v = { name: 'x', version: '1.0.0' } as never;
    expect(resolveBin(v, 'x')).toBeNull();
  });
});

describe('fetchPackument', () => {
  function mockFetch(responses: {
    status?: number;
    body?: unknown;
    etag?: string;
  }): typeof fetch {
    return (async () => {
      const headers = new Map<string, string>();
      if (responses.etag) headers.set('etag', responses.etag);
      return {
        ok: (responses.status ?? 200) >= 200 && (responses.status ?? 200) < 300,
        status: responses.status ?? 200,
        headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
        json: async () => responses.body,
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('fetches and parses a packument with etag', async () => {
    const res = await fetchPackument('https://registry.example.com', 'is-odd', {
      fetchImpl: mockFetch({ body: fixturePackument, etag: 'W/"abc"' }),
    });
    expect(res.notModified).toBe(false);
    expect(res.etag).toBe('W/"abc"');
    expect(res.packument?.name).toBe('is-odd');
  });

  it('returns notModified on 304', async () => {
    const res = await fetchPackument('https://registry.example.com', 'is-odd', {
      etag: 'W/"abc"',
      fetchImpl: mockFetch({ status: 304 }),
    });
    expect(res.notModified).toBe(true);
    expect(res.packument).toBeNull();
    expect(res.etag).toBe('W/"abc"');
  });

  it('returns null packument on 404', async () => {
    const res = await fetchPackument('https://registry.example.com', 'missing', {
      fetchImpl: mockFetch({ status: 404 }),
    });
    expect(res.notModified).toBe(false);
    expect(res.packument).toBeNull();
  });

  it('throws on unexpected status', async () => {
    await expect(
      fetchPackument('https://registry.example.com', 'is-odd', {
        fetchImpl: mockFetch({ status: 500 }),
      }),
    ).rejects.toBeInstanceOf(PackumentFetchError);
  });
});
