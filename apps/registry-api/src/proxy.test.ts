import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NpmProxy, PackumentCache } from './proxy.js';

describe('PackumentCache', () => {
  it('stores and retrieves entries', () => {
    const cache = new PackumentCache();
    cache.set('pkg-1', '{"name":"pkg-1"}', 'etag-1', 300);
    const entry = cache.get('pkg-1');
    expect(entry).toBeDefined();
    expect(entry?.body).toBe('{"name":"pkg-1"}');
    expect(entry?.etag).toBe('etag-1');
  });

  it('returns undefined for missing keys', () => {
    const cache = new PackumentCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('expires entries after TTL', () => {
    const cache = new PackumentCache();
    cache.set('pkg-1', '{}', undefined, 0);
    // Wait a tiny bit for TTL to expire.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.get('pkg-1')).toBeUndefined();
        resolve();
      }, 10);
    });
  });

  it('clears all entries', () => {
    const cache = new PackumentCache();
    cache.set('a', '{}');
    cache.set('b', '{}');
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe('NpmProxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has default config', () => {
    const proxy = new NpmProxy();
    const config = proxy.getConfig();
    expect(config.upstreamUrl).toBe('https://registry.npmjs.org');
    expect(config.cacheTtlSeconds).toBe(300);
    expect(config.enabled).toBe(true);
  });

  it('respects custom config', () => {
    const proxy = new NpmProxy({ upstreamUrl: 'https://mirror.example.com', cacheTtlSeconds: 60, enabled: false });
    const config = proxy.getConfig();
    expect(config.upstreamUrl).toBe('https://mirror.example.com');
    expect(config.cacheTtlSeconds).toBe(60);
    expect(config.enabled).toBe(false);
  });

  it('fetches packuments from upstream', async () => {
    const mockFetch = vi.fn(async () => new Response('{"name":"test-pkg"}', {
      status: 200,
      headers: { etag: 'etag-123' },
    }));
    vi.stubGlobal('fetch', mockFetch);

    const proxy = new NpmProxy();
    const result = await proxy.fetchPackument('test-pkg');
    expect(result.body).toBe('{"name":"test-pkg"}');
    expect(result.etag).toBe('etag-123');
    expect(result.fromCache).toBe(false);
    vi.unstubAllGlobals();
  });

  it('caches packuments and uses ETag for conditional fetch', async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async (_url: string, opts?: { headers?: Record<string, string> }) => {
      callCount++;
      const ifNoneMatch = opts?.headers?.['if-none-match'];
      if (ifNoneMatch === 'etag-123' && callCount > 1) {
        // Second call with ETag returns 304 (not modified).
        return new Response(null, { status: 304 });
      }
      return new Response('{"name":"test-pkg"}', { status: 200, headers: { etag: 'etag-123' } });
    });
    vi.stubGlobal('fetch', mockFetch);

    const proxy = new NpmProxy();
    // First fetch populates cache.
    const result1 = await proxy.fetchPackument('test-pkg');
    expect(result1.fromCache).toBe(false);
    // Second fetch uses ETag, gets 304, serves from cache.
    const result2 = await proxy.fetchPackument('test-pkg');
    expect(result2.fromCache).toBe(true);
    expect(result2.body).toBe('{"name":"test-pkg"}');
    vi.unstubAllGlobals();
  });

  it('uses ETag for conditional fetch', async () => {
    const mockFetch = vi.fn(async (_url: string, opts?: { headers?: Record<string, string> }) => {
      const ifNoneMatch = opts?.headers?.['if-none-match'];
      if (ifNoneMatch === 'etag-123') {
        return new Response(null, { status: 304 });
      }
      return new Response('{"name":"test-pkg"}', { status: 200, headers: { etag: 'etag-123' } });
    });
    vi.stubGlobal('fetch', mockFetch);

    const proxy = new NpmProxy();
    // First fetch populates cache with ETag.
    await proxy.fetchPackument('test-pkg');
    // Second fetch should use ETag.
    mockFetch.mockClear();
    const result = await proxy.fetchPackument('test-pkg');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/test-pkg',
      expect.objectContaining({ headers: { 'if-none-match': 'etag-123' } }),
    );
    expect(result.fromCache).toBe(true);
    vi.unstubAllGlobals();
  });

  it('serves stale cache on upstream error', async () => {
    const mockFetch = vi.fn(async () => new Response('Not Found', { status: 404 }));
    vi.stubGlobal('fetch', mockFetch);

    const cache = new PackumentCache();
    cache.set('test-pkg', '{"name":"cached"}', 'etag-1', 300);
    const proxy = new NpmProxy({}, cache);
    const result = await proxy.fetchPackument('test-pkg');
    expect(result.body).toBe('{"name":"cached"}');
    expect(result.fromCache).toBe(true);
    vi.unstubAllGlobals();
  });

  it('throws when disabled', async () => {
    const proxy = new NpmProxy({ enabled: false });
    await expect(proxy.fetchPackument('test-pkg')).rejects.toThrow('proxy is disabled');
  });

  it('merges risk summary without mutating upstream fields', () => {
    const proxy = new NpmProxy();
    const packument = { name: 'test-pkg', versions: { '1.0.0': { version: '1.0.0' } } };
    const merged = proxy.mergeRiskSummary(packument, { score: 85 });
    expect(merged.name).toBe('test-pkg');
    expect(merged.versions).toEqual(packument.versions);
    expect(merged['safe-npm']).toBeDefined();
    expect((merged['safe-npm'] as Record<string, unknown>).riskSummary).toEqual({ score: 85 });
  });
});
