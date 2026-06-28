import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { downloadTarball } from '../src/tarball.js';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ssri from 'ssri';

function fakeFetch(buf: Buffer, status = 200): typeof fetch {
  return (async () =>
    new Response(buf, {
      status,
      headers: { 'content-length': String(buf.byteLength) },
    })) as unknown as typeof fetch;
}

describe('downloadTarball', () => {
  let dir: string;
  test('setup tmp dir', async () => {
    dir = await mkdtemp(join(tmpdir(), 'safe-tarball-'));
  });

  test('good integrity passes', async () => {
    const data = Buffer.from('hello tarball');
    const expected = ssri.fromData(data, { algorithms: ['sha512'] }).toString();
    const dest = join(dir, 'good.tgz');
    const res = await downloadTarball('https://x/good.tgz', dest, {
      expectedIntegrity: expected,
      fetchImpl: fakeFetch(data),
    });
    assert.equal(res.sizeBytes, data.byteLength);
    assert.equal(res.integrity, expected);
  });

  test('integrity mismatch throws', async () => {
    const data = Buffer.from('hello tarball');
    const wrong = ssri.fromData(Buffer.from('different'), { algorithms: ['sha512'] }).toString();
    const dest = join(dir, 'mismatch.tgz');
    await assert.rejects(
      downloadTarball('https://x/bad.tgz', dest, {
        expectedIntegrity: wrong,
        fetchImpl: fakeFetch(data),
      }),
      /integrity mismatch/,
    );
  });

  test('shasum fallback verified when no integrity', async () => {
    const data = Buffer.from('shasum test');
    const expectedSha = createHash('sha1').update(data).digest('hex');
    const dest = join(dir, 'sha.tgz');
    const res = await downloadTarball('https://x/sha.tgz', dest, {
      expectedShasum: expectedSha,
      fetchImpl: fakeFetch(data),
    });
    assert.equal(res.shasum, expectedSha);
  });

  test('shasum mismatch throws', async () => {
    const data = Buffer.from('shasum test');
    const dest = join(dir, 'shabad.tgz');
    await assert.rejects(
      downloadTarball('https://x/sha.tgz', dest, {
        expectedShasum: 'deadbeef',
        fetchImpl: fakeFetch(data),
      }),
      /shasum mismatch/,
    );
  });

  test('oversized tarball blocked by content-length', async () => {
    const data = Buffer.from('small');
    const dest = join(dir, 'over.tgz');
    await assert.rejects(
      downloadTarball('https://x/over.tgz', dest, {
        maxSizeBytes: 1,
        fetchImpl: fakeFetch(data),
      }),
      /oversized/,
    );
  });

  test('oversized tarball blocked by actual size when no content-length', async () => {
    const data = Buffer.from('toolarge for limit');
    const fetchNoLen = (async () =>
      new Response(data, { status: 200 })) as unknown as typeof fetch;
    const dest = join(dir, 'over2.tgz');
    await assert.rejects(
      downloadTarball('https://x/over2.tgz', dest, {
        maxSizeBytes: 2,
        fetchImpl: fetchNoLen,
      }),
      /oversized/,
    );
  });

  test('HTTP error throws', async () => {
    const dest = join(dir, 'err.tgz');
    await assert.rejects(
      downloadTarball('https://x/err.tgz', dest, {
        fetchImpl: fakeFetch(Buffer.from('not found'), 404),
      }),
      /HTTP 404/,
    );
  });

  test('cleanup tmp dir', async () => {
    await rm(dir, { recursive: true, force: true });
  });
});
