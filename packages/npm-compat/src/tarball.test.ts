import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  downloadTarball,
  IntegrityMismatchError,
  OversizedTarballError,
  TarballFetchError,
} from '../src/index.js';

const PAYLOAD = Buffer.from('hello-tarball');

function mockFetch(body: Buffer, status = 200): typeof fetch {
  return (async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(body));
        controller.close();
      },
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      body: stream,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function sha512(buf: Buffer): string {
  return `sha512-${createHash('sha512').update(buf).digest('base64')}`;
}
function sha1(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex');
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'safe-npm-tarball-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('downloadTarball', () => {
  it('downloads and writes the file, computing integrity', async () => {
    const dest = join(tmp, 'pkg.tgz');
    const res = await downloadTarball('https://example.com/pkg.tgz', dest, {
      fetchImpl: mockFetch(PAYLOAD),
    });
    expect(res.size).toBe(PAYLOAD.length);
    expect(res.integrity).toBe(sha512(PAYLOAD));
    expect(res.shasum).toBe(sha1(PAYLOAD));
  });

  it('verifies sha512 integrity when provided', async () => {
    const dest = join(tmp, 'pkg.tgz');
    const res = await downloadTarball('https://example.com/pkg.tgz', dest, {
      fetchImpl: mockFetch(PAYLOAD),
      expectedIntegrity: sha512(PAYLOAD),
    });
    expect(res.integrity).toBe(sha512(PAYLOAD));
  });

  it('throws on sha512 integrity mismatch', async () => {
    const dest = join(tmp, 'pkg.tgz');
    await expect(
      downloadTarball('https://example.com/pkg.tgz', dest, {
        fetchImpl: mockFetch(PAYLOAD),
        expectedIntegrity: 'sha512-wrongbase64data==',
      }),
    ).rejects.toBeInstanceOf(IntegrityMismatchError);
  });

  it('verifies sha1 shasum when no sha512 integrity provided', async () => {
    const dest = join(tmp, 'pkg.tgz');
    const res = await downloadTarball('https://example.com/pkg.tgz', dest, {
      fetchImpl: mockFetch(PAYLOAD),
      expectedShasum: sha1(PAYLOAD),
    });
    expect(res.shasum).toBe(sha1(PAYLOAD));
  });

  it('throws on sha1 shasum mismatch', async () => {
    const dest = join(tmp, 'pkg.tgz');
    await expect(
      downloadTarball('https://example.com/pkg.tgz', dest, {
        fetchImpl: mockFetch(PAYLOAD),
        expectedShasum: 'deadbeef',
      }),
    ).rejects.toBeInstanceOf(IntegrityMismatchError);
  });

  it('blocks oversized tarballs', async () => {
    const dest = join(tmp, 'pkg.tgz');
    await expect(
      downloadTarball('https://example.com/pkg.tgz', dest, {
        fetchImpl: mockFetch(PAYLOAD),
        maxBytes: 4,
      }),
    ).rejects.toBeInstanceOf(OversizedTarballError);
  });

  it('throws on non-ok status', async () => {
    const dest = join(tmp, 'pkg.tgz');
    await expect(
      downloadTarball('https://example.com/pkg.tgz', dest, {
        fetchImpl: mockFetch(PAYLOAD, 404),
      }),
    ).rejects.toBeInstanceOf(TarballFetchError);
  });
});
