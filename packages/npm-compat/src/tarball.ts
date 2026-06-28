import ssri from 'ssri';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SafeNpmError, type TarballIntegrity } from '@safe-npm/core-types';

export interface DownloadTarballOptions {
  /** Expected SRI integrity string (`sha512-...`). Verified when provided. */
  expectedIntegrity?: string;
  /** Expected SHA-1 shasum (hex). Verified when SHA-512 integrity is unavailable. */
  expectedShasum?: string;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Fetch implementation (for testing). */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Maximum allowed tarball size in bytes. */
  maxSizeBytes?: number;
}

export interface DownloadTarballResult {
  /** Path to the written tarball. */
  path: string;
  /** Computed SHA-512 SRI integrity. */
  integrity: TarballIntegrity;
  /** Computed SHA-1 hex shasum. */
  shasum: string;
  /** Size in bytes. */
  sizeBytes: number;
}

/**
 * Download a tarball to a destination path without executing any package code.
 * Verifies integrity (SHA-512 preferred, SHA-1 fallback) and enforces a max
 * size guard.
 */
export async function downloadTarball(
  url: string,
  destination: string,
  options: DownloadTarballOptions = {},
): Promise<DownloadTarballResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeout);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new SafeNpmError({
      code: 'PACKAGE_NOT_FOUND',
      message: `tarball fetch failed: HTTP ${res.status}`,
      details: { url, status: res.status },
    });
  }

  const maxSize = options.maxSizeBytes ?? 200 * 1024 * 1024; // 200 MB default
  const contentLength = Number(res.headers.get('content-length') ?? 0);
  if (contentLength && contentLength > maxSize) {
    throw new SafeNpmError({
      code: 'TARBALL_INTEGRITY_FAILED',
      message: `tarball oversized: ${contentLength} bytes exceeds ${maxSize} bytes`,
      details: { url, contentLength, maxSize },
    });
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxSize) {
    throw new SafeNpmError({
      code: 'TARBALL_INTEGRITY_FAILED',
      message: `tarball oversized: ${buf.byteLength} bytes exceeds ${maxSize} bytes`,
      details: { url, size: buf.byteLength, maxSize },
    });
  }

  const integrity = ssri.fromData(buf, { algorithms: ['sha512'] }).toString() as TarballIntegrity;
  const shasum = createHash('sha1').update(buf).digest('hex');

  // Verify integrity.
  if (options.expectedIntegrity) {
    const ok = ssri.checkData(buf, options.expectedIntegrity);
    if (!ok) {
      throw new SafeNpmError({
        code: 'TARBALL_INTEGRITY_FAILED',
        message: 'tarball SHA-512 integrity mismatch',
        details: { url, expected: options.expectedIntegrity, actual: integrity },
      });
    }
  } else if (options.expectedShasum) {
    if (shasum !== options.expectedShasum) {
      throw new SafeNpmError({
        code: 'TARBALL_INTEGRITY_FAILED',
        message: 'tarball SHA-1 shasum mismatch',
        details: { url, expected: options.expectedShasum, actual: shasum },
      });
    }
  }

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, buf);

  return { path: destination, integrity, shasum, sizeBytes: buf.byteLength };
}
