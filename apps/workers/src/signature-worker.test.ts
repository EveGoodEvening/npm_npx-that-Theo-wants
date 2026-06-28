import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { createSignatureWorker, canonicalizePayload, type SigningKey } from './signature-worker.js';

describe('signature-worker', () => {
  function makeSigningKey(): SigningKey {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const pub = createPublicKey(publicKey);
    const der = pub.export({ type: 'spki', format: 'der' });
    const keyId = `sha256:${der.toString('hex').slice(0, 16)}`;
    return { keyId, privateKeyPem: privateKey, publicKeyPem: publicKey, alg: 'ES256' };
  }

  it('signs a version and returns a verifiable signature', async () => {
    const signingKey = makeSigningKey();
    const worker = createSignatureWorker({ signingKey });

    const payload = {
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    };

    const result = await worker(payload);
    expect(result.signature).toBeTruthy();
    expect(result.keyId).toBe(signingKey.keyId);
    expect(result.alg).toBe('ES256');

    // Verify with the public key.
    const pub = createPublicKey(signingKey.publicKeyPem);
    const sigBuf = Buffer.from(result.signature, 'base64');
    const canonical = canonicalizePayload(payload);
    expect(verify(null, Buffer.from(canonical), pub, sigBuf)).toBe(true);
  });

  it('calls invalidateCache callback', async () => {
    const signingKey = makeSigningKey();
    const invalidateCache = vi.fn();
    const worker = createSignatureWorker({ signingKey, invalidateCache });

    await worker({
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    });

    expect(invalidateCache).toHaveBeenCalledWith('test-pkg');
  });

  it('canonicalizePayload produces sorted-key JSON', () => {
    const canonical = canonicalizePayload({
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    });
    const parsed = JSON.parse(canonical);
    expect(Object.keys(parsed)).toEqual(['packageName', 'publishId', 'tarballIntegrity', 'version']);
  });
});
