import { describe, expect, it } from 'vitest';
import { ObjectStore, computeSha512 } from '../src/index.js';

describe('ObjectStore key scheme', () => {
  it('generates tarball keys', () => {
    expect(ObjectStore.tarballKey('sha512-abc123')).toBe('tarballs/sha512-abc123.tgz');
  });

  it('generates analysis keys with analyzer version', () => {
    expect(ObjectStore.analysisKey('sha512-abc123', '0.1.0')).toBe('analysis/sha512-abc123/0.1.0.json');
  });

  it('generates attestation keys', () => {
    expect(ObjectStore.attestationKey('sha256-def456')).toBe('attestations/sha256-def456.json');
  });
});

describe('computeSha512', () => {
  it('computes sha512 integrity from buffer', () => {
    const data = Buffer.from('hello world');
    const result = computeSha512(data);
    expect(result).toMatch(/^sha512-/);
    // Verify it's a valid base64-encoded sha512 (88 chars after prefix).
    const b64 = result.slice('sha512-'.length);
    expect(b64.length).toBe(88);
  });

  it('produces different hashes for different inputs', () => {
    expect(computeSha512(Buffer.from('a'))).not.toBe(computeSha512(Buffer.from('b')));
  });
});

describe('ObjectStore.readAll', () => {
  it('reads a stream into a buffer', async () => {
    const { Readable } = await import('node:stream');
    const stream = Readable.from([Buffer.from('hello'), Buffer.from(' world')]);
    const buf = await ObjectStore.readAll(stream);
    expect(buf.toString()).toBe('hello world');
  });
});
