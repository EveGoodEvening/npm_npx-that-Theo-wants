/**
 * Public npm proxy/cache (Section 23).
 *
 * Proxies packuments and tarballs from the public npm registry,
 * caching them locally with ETag/TTL support.
 */
import { computeSha512 } from '@safe-npm/object-store';

export interface ProxyConfig {
  /** Upstream registry URL (default: https://registry.npmjs.org). */
  upstreamUrl: string;
  /** Cache TTL in seconds (default: 300 = 5 minutes). */
  cacheTtlSeconds: number;
  /** Whether the proxy is enabled. */
  enabled: boolean;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  upstreamUrl: 'https://registry.npmjs.org',
  cacheTtlSeconds: 300,
  enabled: true,
};

interface CacheEntry {
  body: string;
  etag?: string;
  cachedAt: number;
  ttlSeconds: number;
}

/**
 * In-memory packument cache with ETag/TTL support.
 */
export class PackumentCache {
  private cache = new Map<string, CacheEntry>();

  /** Get a cached packument if fresh. */
  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    const age = (Date.now() - entry.cachedAt) / 1000;
    if (age > entry.ttlSeconds) {
      this.cache.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Store a packument in the cache. */
  set(key: string, body: string, etag?: string, ttlSeconds?: number): void {
    this.cache.set(key, {
      body,
      etag,
      cachedAt: Date.now(),
      ttlSeconds: ttlSeconds ?? 300,
    });
  }

  /** Clear the cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Get cache size. */
  size(): number {
    return this.cache.size;
  }
}

export interface ProxyResult {
  body: string;
  etag?: string;
  fromCache: boolean;
}

/**
 * Public npm proxy that fetches packuments from upstream with caching.
 */
export class NpmProxy {
  private config: ProxyConfig;
  private cache: PackumentCache;

  constructor(config: Partial<ProxyConfig> = {}, cache?: PackumentCache) {
    this.config = { ...DEFAULT_PROXY_CONFIG, ...config };
    this.cache = cache ?? new PackumentCache();
  }

  /**
   * Fetch a packument from upstream or cache.
   */
  async fetchPackument(name: string): Promise<ProxyResult> {
    if (!this.config.enabled) {
      throw new Error('proxy is disabled');
    }

    const cacheKey = name;
    const cached = this.cache.get(cacheKey);

    // Try conditional fetch with ETag.
    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers['if-none-match'] = cached.etag;
    }

    const url = `${this.config.upstreamUrl}/${encodeURIComponent(name).replace('%40', '@')}`;
    const resp = await fetch(url, { headers });

    if (resp.status === 304 && cached) {
      // Cache is still fresh.
      return { body: cached.body, etag: cached.etag, fromCache: true };
    }

    if (!resp.ok) {
      if (cached) {
        // Serve stale cache on upstream error.
        return { body: cached.body, etag: cached.etag, fromCache: true };
      }
      throw new Error(`upstream returned ${resp.status}`);
    }

    const body = await resp.text();
    const etag = resp.headers.get('etag') ?? undefined;
    this.cache.set(cacheKey, body, etag, this.config.cacheTtlSeconds);

    return { body, etag, fromCache: false };
  }

  /**
   * Fetch a tarball from upstream.
   * Returns the buffer and its integrity hash.
   */
  async fetchTarball(tarballUrl: string): Promise<{ buffer: Buffer; integrity: string }> {
    if (!this.config.enabled) {
      throw new Error('proxy is disabled');
    }

    const resp = await fetch(tarballUrl);
    if (!resp.ok) {
      throw new Error(`upstream tarball fetch returned ${resp.status}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const integrity = computeSha512(buffer);

    return { buffer, integrity };
  }

  /**
   * Merge local risk summary into an upstream packument.
   * Does not mutate upstream version fields — adds namespaced extension.
   */
  mergeRiskSummary(packument: Record<string, unknown>, riskSummary: Record<string, unknown>): Record<string, unknown> {
    return {
      ...packument,
      'safe-npm': {
        riskSummary,
        proxiedFrom: this.config.upstreamUrl,
        proxiedAt: new Date().toISOString(),
      },
    };
  }

  /** Get the cache instance. */
  getCache(): PackumentCache {
    return this.cache;
  }

  /** Get the config. */
  getConfig(): ProxyConfig {
    return this.config;
  }
}
