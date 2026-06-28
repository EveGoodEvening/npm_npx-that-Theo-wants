import { describe, expect, it, vi } from 'vitest';
import { publishTarball, PublishError } from './publish.js';
import type { PackResult } from './pack.js';

/**
 * Tests for the publish client (Section 8.1).
 * Uses a mock fetch to avoid needing a live registry.
 */

function makeMockPackResult(): PackResult {
  return {
    tarballPath: '/tmp/test.tgz',
    tarballBuffer: Buffer.from('fake-tarball'),
    sha512: 'sha512-fake',
    shasum: 'abc123',
    size: 12,
    filename: 'test-pkg-1.0.0.tgz',
    analysisReport: {
      package: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-1',
      tarballDigest: 'sha512-fake',
      analyzerVersion: '0.1.0',
      generatedAt: new Date().toISOString(),
      tarball: { sizeBytes: 12, unpackedSizeBytes: 20, fileCount: 1 },
      metadata: { name: 'test-pkg', version: '1.0.0', scripts: {}, dependencies: {}, devDependencies: {}, optionalDependencies: {}, peerDependencies: {}, bundledDependencies: [], files: [], contributors: [], maintainers: [] },
      lifecycleScripts: [],
      staticFindings: [],
      readability: { likelyMinified: false, likelyObfuscated: false, sourceMapsPresent: false, humanReadableFileRatio: 1, minifiedLineRatio: 0, giantStringArrays: false },
      nativeArtifacts: [],
      builtinsUsed: [],
    },
    packageJson: { name: 'test-pkg', version: '1.0.0' },
  };
}

describe('publishTarball', () => {
  it('returns dry-run result without making HTTP request', async () => {
    const fetchMock = vi.fn();
    const pack = makeMockPackResult();
    const result = await publishTarball(pack, {
      registryUrl: 'http://localhost:3000',
      token: 'test-token',
      visibility: 'private',
      dryRun: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.publishId).toBe('dry-run');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends PUT request with packument body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        package: 'test-pkg',
        version: '1.0.0',
        publishId: 'pub-123',
        visibility: 'private',
      }),
    });
    const pack = makeMockPackResult();
    const result = await publishTarball(pack, {
      registryUrl: 'http://localhost:3000',
      token: 'test-token',
      visibility: 'private',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.publishId).toBe('pub-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/v1/packages/test-pkg');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('test-pkg');
    expect(body.versions['1.0.0'].dist.integrity).toBe('sha512-fake');
    expect(body._attachments['test-pkg-1.0.0.tgz'].data).toBeTruthy();
  });

  it('throws PublishError on non-OK response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    });
    const pack = makeMockPackResult();
    await expect(
      publishTarball(pack, {
        registryUrl: 'http://localhost:3000',
        token: 'bad-token',
        visibility: 'private',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(PublishError);
  });
});

describe('PublishError', () => {
  it('has a code property', () => {
    const err = new PublishError('test', 'TEST_CODE');
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.name).toBe('PublishError');
  });
});
