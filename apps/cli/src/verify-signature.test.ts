import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, createPublicKey, createPrivateKey, sign } from 'node:crypto';
import { fetchRegistryKeys, verifySignature, canonicalizePayload, SignatureError, type SigningPayload } from './verify-signature.js';

/** Helper: generate a key pair and sign a payload (mirrors server-side logic). */
function makeKeyAndSignature(payload: SigningPayload) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const pub = createPublicKey(publicKey);
  const der = pub.export({ type: 'spki', format: 'der' });
  const keyId = `sha256:${der.toString('hex').slice(0, 16)}`;
  const priv = createPrivateKey(privateKey);
  const sig = sign(null, Buffer.from(canonicalizePayload(payload)), priv);
  return { keyId, publicKeyPem: publicKey, signature: sig.toString('base64') };
}

describe('verify-signature', () => {
  it('fetchRegistryKeys fetches and parses keys response', async () => {
    const { publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const pub = createPublicKey(publicKey);
    const der = pub.export({ type: 'spki', format: 'der' });
    const keyId = `sha256:${der.toString('hex').slice(0, 16)}`;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [{ keyid: keyId, key: publicKey, expires: null }] }),
    });
    const result = await fetchRegistryKeys({
      registryUrl: 'http://localhost:3000',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.keys.length).toBe(1);
    expect(result.keys[0].keyid).toBe(keyId);
  });

  it('fetchRegistryKeys throws SignatureError on non-OK response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      fetchRegistryKeys({ registryUrl: 'http://localhost:3000', fetchImpl: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow(SignatureError);
  });

  it('verifySignature returns true for valid signature', async () => {
    const payload = {
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    };
    const { keyId, publicKeyPem, signature } = makeKeyAndSignature(payload);
    const keys = { keys: [{ keyid: keyId, key: publicKeyPem, expires: null }] };
    const sig = { signature, keyId, alg: 'ES256' as const };

    const result = await verifySignature(payload, sig, keys);
    expect(result).toBe(true);
  });

  it('verifySignature returns false for unknown key ID', async () => {
    const payload = {
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    };
    const { signature, keyId } = makeKeyAndSignature(payload);
    const keys = { keys: [] };
    const sig = { signature, keyId, alg: 'ES256' as const };

    const result = await verifySignature(payload, sig, keys);
    expect(result).toBe(false);
  });

  it('verifySignature returns false for tampered payload', async () => {
    const payload = {
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    };
    const { keyId, publicKeyPem, signature } = makeKeyAndSignature(payload);
    const keys = { keys: [{ keyid: keyId, key: publicKeyPem, expires: null }] };
    const sig = { signature, keyId, alg: 'ES256' as const };

    const tampered = { ...payload, version: '2.0.0' };
    const result = await verifySignature(tampered, sig, keys);
    expect(result).toBe(false);
  });

  it('canonicalizePayload produces sorted-key JSON', () => {
    const payload = {
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    };
    const canonical = canonicalizePayload(payload);
    const parsed = JSON.parse(canonical);
    expect(Object.keys(parsed)).toEqual(['packageName', 'publishId', 'tarballIntegrity', 'version']);
  });
});
