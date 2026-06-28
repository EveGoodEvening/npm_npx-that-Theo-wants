import semver from 'semver';
import type { PackageVersion } from '@safe-npm/core-types';

/**
 * npm packument types (subset compatible with `pacote`/npm CLI).
 */
export interface PackumentVersion {
  name: string;
  version: string;
  deprecated?: string;
  _hasShrinkwrap?: boolean;
  dist?: {
    tarball: string;
    integrity?: string;
    shasum?: string;
    fileCount?: number;
    unpackedSize?: number;
    signatures?: Array<{ keyid: string; sig: string }>;
  };
  main?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bundledDependencies?: string[] | boolean;
  license?: string;
  author?: unknown;
  maintainers?: Array<{ name?: string; email?: string }>;
  repository?: unknown;
  homepage?: string;
  bugs?: unknown;
  [key: string]: unknown;
}

export interface Packument {
  name: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, PackumentVersion>;
  time?: Record<string, string>;
  maintainers?: Array<{ name?: string; email?: string }>;
  deprecated?: string;
  [key: string]: unknown;
}

export interface FetchPackumentOptions {
  /** ETag from a previous successful fetch, to enable conditional requests. */
  etag?: string;
  /** AbortSignal for the request. */
  signal?: AbortSignal;
  /** Custom fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

export interface FetchPackumentResult {
  packument: Packument | null;
  /** ETag returned by the registry, to cache for the next request. */
  etag?: string;
  /** True when the registry responded 304 Not Modified. */
  notModified: boolean;
}

/**
 * Fetch a packument from a registry, with ETag/If-None-Match cache support.
 * Returns `{ packument: null, notModified: true }` when the registry replies
 * 304 Not Modified (caller should reuse its cached copy).
 */
export async function fetchPackument(
  registryUrl: string,
  packageName: string,
  options: FetchPackumentOptions = {},
): Promise<FetchPackumentResult> {
  const base = registryUrl.replace(/\/$/, '');
  const encoded = encodePackageName(packageName);
  const url = `${base}/${encoded}`;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.etag) headers['if-none-match'] = options.etag;

  const res = await withTimeout(
    doFetch(url, { headers, signal: options.signal }),
    options.timeoutMs,
  );

  if (res.status === 304) {
    return { packument: null, notModified: true, etag: options.etag };
  }
  if (res.status === 404) {
    return { packument: null, notModified: false };
  }
  if (!res.ok) {
    throw new PackumentFetchError(packageName, `unexpected status ${res.status}`);
  }

  const etag = res.headers.get('etag') ?? undefined;
  const packument = (await res.json()) as Packument;
  return { packument, notModified: false, etag };
}

export class PackumentFetchError extends Error {
  readonly packageName: string;
  constructor(packageName: string, message: string) {
    super(`Failed to fetch packument for "${packageName}": ${message}`);
    this.name = 'PackumentFetchError';
    this.packageName = packageName;
  }
}

/**
 * Resolve an exact version from a packument given a specifier.
 *
 * Supports:
 * - exact version (`1.2.3`)
 * - dist-tag (`latest`, `next`)
 * - semver range (`^1.2.3`, `>=2`, `*`)
 */
export function resolveVersion(
  packument: Packument,
  specifier: string,
): PackageVersion | null {
  const versions = packument.versions;
  if (!versions) return null;

  // Empty specifier defaults to the `latest` dist-tag.
  const spec = specifier === '' ? 'latest' : specifier;

  // Dist-tag resolution.
  if (packument['dist-tags'] && spec in packument['dist-tags']) {
    const tagged = packument['dist-tags'][spec]!;
    if (versions[tagged]) return tagged;
  }

  // Exact version match.
  if (versions[spec]) return spec;

  // Semver range resolution: pick the maximum satisfying version.
  const available = Object.keys(versions);
  const max = semver.maxSatisfying(available, spec);
  if (max && versions[max]) return max;

  return null;
}

/** Resolve the bin entry for a version using npm-compatible rules. */
export function resolveBin(
  version: PackumentVersion,
  packageName: string,
): { binName: string; binPath: string } | null {
  const bin = version.bin;
  if (!bin) return null;
  if (typeof bin === 'string') {
    // Single bin: name is the unscoped package name.
    const name = packageName.startsWith('@') ? packageName.split('/').pop()! : packageName;
    return { binName: name, binPath: bin };
  }
  const entries = Object.entries(bin);
  if (entries.length === 0) return null;
  if (entries.length === 1) {
    const [binName, binPath] = entries[0]!;
    return { binName, binPath };
  }
  // Multiple bins: prefer one matching the unscoped package name.
  const unscoped = packageName.startsWith('@') ? packageName.split('/').pop()! : packageName;
  const match = entries.find(([name]) => name === unscoped);
  if (match) {
    const [binName, binPath] = match;
    return { binName, binPath };
  }
  // Ambiguous: caller must decide.
  return null;
}

/** Encode a (possibly scoped) package name for registry URLs. */
export function encodePackageName(name: string): string {
  if (name.startsWith('@')) {
    return `@${encodeURIComponent(name.slice(1))}`;
  }
  return encodeURIComponent(name);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return promise;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`request timed out after ${timeoutMs}ms`)),
        ),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
