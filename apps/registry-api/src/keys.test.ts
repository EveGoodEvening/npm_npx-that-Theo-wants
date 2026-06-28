import { describe, expect, it } from 'vitest';
import { InMemoryKeyManager, generateKeyPair, computeKeyId } from './keys.js';
import { signDistMetadata, verifyDistMetadata, canonicalizePayload } from './signing.js';

describe('keys', () => {
  it('generateKeyPair produces valid ECDSA P-256 PEM keys', () => {
    const { privateKeyPem, publicKeyPem } = generateKeyPair();
    expect(privateKeyPem).toContain('PRIVATE KEY');
    expect(publicKeyPem).toContain('PUBLIC KEY');
  });

  it('computeKeyId produces a stable key ID from a public key', () => {
    const { publicKeyPem } = generateKeyPair();
    const keyId = computeKeyId(publicKeyPem);
    expect(keyId).toMatch(/^sha256:[0-9a-f]+$/);
    // Same key → same ID.
    expect(computeKeyId(publicKeyPem)).toBe(keyId);
  });

  it('InMemoryKeyManager generates an active key on construction', () => {
    const km = new InMemoryKeyManager();
    const key = km.getActiveKey();
    expect(key.keyId).toMatch(/^sha256:/);
    expect(key.alg).toBe('ES256');
    expect(key.rotatedAt).toBeNull();
  });

  it('getPublicKeys excludes private key material', () => {
    const km = new InMemoryKeyManager();
    const publicKeys = km.getPublicKeys();
    expect(publicKeys.length).toBeGreaterThan(0);
    for (const k of publicKeys) {
      expect(k.privateKeyPem).toBeUndefined();
    }
  });

  it('sign and verify round-trip', () => {
    const km = new InMemoryKeyManager();
    const payload = 'test payload';
    const result = km.sign(payload);
    expect(result.signature).toBeTruthy();
    expect(result.keyId).toBe(km.getActiveKey().keyId);
    expect(result.alg).toBe('ES256');

    const sigBuf = Buffer.from(result.signature, 'base64');
    expect(km.verify(payload, sigBuf, result.keyId)).toBe(true);
  });

  it('verify returns false for unknown key ID', () => {
    const km = new InMemoryKeyManager();
    const result = km.sign('test');
    const sigBuf = Buffer.from(result.signature, 'base64');
    expect(km.verify('test', sigBuf, 'unknown-key-id')).toBe(false);
  });

  it('verify returns false for tampered payload', () => {
    const km = new InMemoryKeyManager();
    const result = km.sign('original');
    const sigBuf = Buffer.from(result.signature, 'base64');
    expect(km.verify('tampered', sigBuf, result.keyId)).toBe(false);
  });
});

describe('signing', () => {
  it('canonicalizePayload produces deterministic sorted-key JSON', () => {
    const payload = {
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    };
    const c1 = canonicalizePayload(payload);
    const c2 = canonicalizePayload(payload);
    expect(c1).toBe(c2);
    // Keys should be sorted alphabetically.
    const keys = Object.keys(JSON.parse(c1));
    expect(keys).toEqual(['packageName', 'publishId', 'tarballIntegrity', 'version']);
  });

  it('signDistMetadata produces a verifiable signature', () => {
    const km = new InMemoryKeyManager();
    const payload = {
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    };
    const sig = signDistMetadata(payload, km);
    expect(sig.signature).toBeTruthy();
    expect(sig.keyId).toBe(km.getActiveKey().keyId);
    expect(sig.alg).toBe('ES256');

    expect(verifyDistMetadata(payload, sig, km)).toBe(true);
  });

  it('verifyDistMetadata returns false for tampered payload', () => {
    const km = new InMemoryKeyManager();
    const payload = {
      packageName: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-123',
      tarballIntegrity: 'sha512-abc',
    };
    const sig = signDistMetadata(payload, km);
    const tampered = { ...payload, version: '2.0.0' };
    expect(verifyDistMetadata(tampered, sig, km)).toBe(false);
  });
});
