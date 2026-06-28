import semver from 'semver';
import type { PackageSpec } from '@safe-npm/core-types';
import { isDistTag } from './spec.js';

/** Minimal npm packument shape (read-only). */
export interface Packument {
  name: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, PackumentVersion>;
  time?: Record<string, string>;
  maintainers?: Array<{ name?: string; email?: string }>;
  deprecated?: string;
}

export interface PackumentVersion {
  name: string;
  version: string;
  description?: string;
  license?: string | { type?: string };
  author?: string | { name?: string; email?: string; url?: string };
  contributors?: Array<string | { name?: string }>;
  maintainers?: Array<{ name?: string; email?: string }>;
  repository?: string | { type?: string; url?: string };
  homepage?: string;
  bugs?: string | { url?: string; email?: string };
  main?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bundledDependencies?: string[] | boolean;
  dist?: {
    tarball: string;
    integrity?: string;
    shasum?: string;
    signatures?: Array<{ keyid: string; sig: string }>;
  };
  deprecated?: string;
  _hasShrinkwrap?: boolean;
}

export interface FetchPackumentOptions {
  /** ETag from a previous fetch; if the server returns 304, returns `{ notModified: true }`. */
  etag?: string;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Fetch implementation (for testing). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

export interface FetchPackumentResult {
  packument: Packument | null;
  etag?: string;
  notModified: boolean;
}

/**
 * Fetch a packument from a registry endpoint.
 *
 * The registry URL should be the base (e.g. `https://registry.npmjs.org`); the
 * encoded package name is appended. Does not execute any package code.
 */
export async function fetchPackument(
  registryUrl: string,
  packageName: string,
  options: FetchPackumentOptions = {},
): Promise<FetchPackumentResult> {
  const base = registryUrl.replace(/\/$/, '');
  const encoded = encodePackageName(packageName);
  const url = `${base}/${encoded}`;
  const fetchImpl = options.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
  };
  if (options.etag) {
    headers['if-none-match'] = options.etag;
  }

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const res = await fetchImpl(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (res.status === 304) {
      return { packument: null, etag: options.etag, notModified: true };
    }
    if (res.status === 404) {
      return { packument: null, notModified: false };
    }
    if (!res.ok) {
      throw new Error(`registry returned ${res.status} for ${packageName}`);
    }
    const etag = res.headers.get('etag') ?? undefined;
    const packument = (await res.json()) as Packument;
    return { packument, etag, notModified: false };
  } finally {
    clearTimeout(timer);
  }
}

/** npm encodes scoped names by replacing `/` with `%2f` (lowercase). */
export function encodePackageName(name: string): string {
  if (name.startsWith('@')) {
    return '@' + encodeURIComponent(name.slice(1)).replace('%2F', '%2f');
  }
  return encodeURIComponent(name);
}

/**
 * Resolve a spec to an exact version + packument version using dist-tags and
 * semver range resolution.
 */
export function resolveVersion(
  packument: Packument,
  spec: PackageSpec,
): { version: string; versionData: PackumentVersion } {
  const versions = packument.versions ?? {};
  const distTags = packument['dist-tags'] ?? {};
  const allVersions = Object.keys(versions);

  let target: string | undefined;

  if (!spec.specifier) {
    // bare name -> use latest dist-tag
    target = distTags.latest;
    if (!target) {
      // fall back to highest version
      target = semver.maxSatisfying(allVersions, '*') ?? undefined;
    }
  } else if (isDistTag(spec.specifier)) {
    target = distTags[spec.specifier];
    if (!target) {
      throw new Error(`dist-tag ${spec.specifier} not found for ${spec.name}`);
    }
  } else {
    // semver range
    target = semver.maxSatisfying(allVersions, spec.specifier) ?? undefined;
  }

  if (!target) {
    throw new Error(`no version of ${spec.name} satisfies ${spec.specifier ?? 'latest'}`);
  }
  const versionData = versions[target];
  if (!versionData) {
    throw new Error(`no version of ${spec.name} satisfies ${spec.specifier ?? 'latest'}`);
  }
  return { version: target, versionData };
}
