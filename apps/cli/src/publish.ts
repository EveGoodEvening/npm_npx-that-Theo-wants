/**
 * Publish client: uploads a packed tarball to the safe-npm registry API.
 *
 * Uses the standard npm publish protocol (PUT with packument body containing
 * the tarball as base64 in `_attachments`).
 */
import type { PackResult } from './pack.js';

export interface PublishOptions {
  registryUrl: string;
  token: string;
  visibility: 'private' | 'public' | 'staged_public';
  /** Whether to actually upload (false = dry run). */
  dryRun?: boolean;
  /** Custom fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
}

export interface PublishResult {
  ok: boolean;
  package: string;
  version: string;
  publishId: string;
  visibility: string;
  tarballUrl?: string;
}

/**
 * Publish a packed tarball to the registry.
 *
 * Uses the npm-compatible PUT protocol: sends the packument with the tarball
 * as base64 in `_attachments`.
 */
export async function publishTarball(
  pack: PackResult,
  options: PublishOptions,
): Promise<PublishResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { packageJson, tarballBuffer, sha512, shasum, size } = pack;

  // Build the npm-compatible publish body.
  const tarballBase64 = tarballBuffer.toString('base64');
  const tarballFilename = pack.filename;

  const body = {
    name: packageJson.name,
    _id: packageJson.name,
    'dist-tags': { latest: packageJson.version },
    versions: {
      [packageJson.version]: {
        ...packageJson,
        dist: {
          tarball: `${options.registryUrl}/${encodeURIComponent(packageJson.name).replace('%40', '@')}/-/${tarballFilename}`,
          shasum,
          integrity: sha512,
          fileCount: pack.analysisReport.tarball.fileCount,
          unpackedSize: pack.analysisReport.tarball.unpackedSizeBytes,
        },
        _hasShrinkwrap: false,
      },
    },
    _attachments: {
      [tarballFilename]: {
        content_type: 'application/octet-stream',
        data: tarballBase64,
        length: size,
      },
    },
    _safeNpm: {
      visibility: options.visibility,
      riskReport: {
        score: 0, // Will be filled by the server
        tier: 'unknown',
      },
    },
  };

  if (options.dryRun) {
    return {
      ok: true,
      package: packageJson.name,
      version: packageJson.version,
      publishId: 'dry-run',
      visibility: options.visibility,
    };
  }

  const url = `${options.registryUrl}/v1/packages/${encodeURIComponent(packageJson.name).replace('%40', '@')}`;

  const resp = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.token}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown error');
    throw new PublishError(`publish failed (${resp.status}): ${text}`, 'PUBLISH_FAILED');
  }

  const result = (await resp.json()) as PublishResult;
  return result;
}

export class PublishError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
  }
}
