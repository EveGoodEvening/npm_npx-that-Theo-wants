import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface DownloadTarballOptions {
  /** Expected integrity string, e.g. `sha512-...`. Verified when provided. */
  expectedIntegrity?: string;
  /** Expected SHA-1 shasum (hex). Used when no SHA-512 integrity is available. */
  expectedShasum?: string;
  /** AbortSignal for the request. */
  signal?: AbortSignal;
  /** Custom fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Maximum allowed tarball size in bytes. */
  maxBytes?: number;
}

export interface DownloadTarballResult {
  /** Absolute path the tarball was written to. */
  path: string;
  /** Computed SHA-512 integrity string. */
  integrity: string;
  /** Computed SHA-1 shasum (hex). */
  shasum: string;
  /** Number of bytes written. */
  size: number;
}

/**
 * Download a tarball to `destination` and verify its integrity.
 *
 * Verification order:
 * 1. SHA-512 integrity (npm `dist.integrity`) when `expectedIntegrity` is set.
 * 2. SHA-1 shasum (legacy `dist.shasum`) when only `expectedShasum` is set.
 *
 * Throws {@link IntegrityMismatchError} on mismatch, {@link OversizedTarballError}
 * when the response exceeds `maxBytes`.
 */
export async function downloadTarball(
  url: string,
  destination: string,
  options: DownloadTarballOptions = {},
): Promise<DownloadTarballResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const res = await withFetchTimeout(
    doFetch(url, { signal: options.signal }),
    options.timeoutMs,
  );
  if (!res.ok) {
    throw new TarballFetchError(url, `unexpected status ${res.status}`);
  }
  if (!res.body) {
    throw new TarballFetchError(url, 'no response body');
  }

  const maxBytes = options.maxBytes;
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        size += value.byteLength;
        if (maxBytes !== undefined && size > maxBytes) {
          throw new OversizedTarballError(url, size, maxBytes);
        }
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    reader.releaseLock();
  }

  const buf = Buffer.concat(chunks);
  const sha512 = createHash('sha512').update(buf).digest('base64');
  const sha1 = createHash('sha1').update(buf).digest('hex');
  const integrity = `sha512-${sha512}`;

  if (options.expectedIntegrity) {
    if (!verifyIntegrity(options.expectedIntegrity, buf)) {
      throw new IntegrityMismatchError(url, 'sha512', options.expectedIntegrity, integrity);
    }
  } else if (options.expectedShasum) {
    if (options.expectedShasum !== sha1) {
      throw new IntegrityMismatchError(url, 'sha1', options.expectedShasum, sha1);
    }
  }

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, buf);

  return { path: destination, integrity, shasum: sha1, size };
}

export class TarballFetchError extends Error {
  readonly url: string;
  constructor(url: string, message: string) {
    super(`Failed to download tarball from "${url}": ${message}`);
    this.name = 'TarballFetchError';
    this.url = url;
  }
}

export class IntegrityMismatchError extends Error {
  readonly url: string;
  readonly algorithm: string;
  readonly expected: string;
  readonly actual: string;
  constructor(url: string, algorithm: string, expected: string, actual: string) {
    super(`Integrity mismatch for "${url}" (${algorithm}): expected ${expected}, got ${actual}`);
    this.name = 'IntegrityMismatchError';
    this.url = url;
    this.algorithm = algorithm;
    this.expected = expected;
    this.actual = actual;
  }
}

export class OversizedTarballError extends Error {
  readonly url: string;
  readonly size: number;
  readonly maxBytes: number;
  constructor(url: string, size: number, maxBytes: number) {
    super(`Tarball from "${url}" exceeded max size: ${size} > ${maxBytes} bytes`);
    this.name = 'OversizedTarballError';
    this.url = url;
    this.size = size;
    this.maxBytes = maxBytes;
  }
}

async function withFetchTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Verify a buffer against an npm-style integrity string (`<algo>-<base64>`).
 * Supports sha512 and sha1 integrity strings (sha1 hex-form is also tolerated).
 */
export function verifyIntegrity(integrity: string, data: Buffer): boolean {
  const match = /^(sha512|sha1)-([A-Za-z0-9+/=]+)$/.exec(integrity);
  if (!match) return false;
  const algo = match[1] as 'sha512' | 'sha1';
  const expected = match[2]!;
  const digest = createHash(algo).update(data).digest('base64');
  return timingSafeEqual(digest, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
