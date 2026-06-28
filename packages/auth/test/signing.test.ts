import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSigningKeyPair,
  computeKeyId,
  canonicalSigningPayload,
  signPayload,
  verifyPayload,
  buildKeysResponse,
} from '../src/signing.js';

describe('generateSigningKeyPair', () => {
  test('produces PEM keys and a keyId', () => {
    const kp = generateSigningKeyPair();
    assert.match(kp.privateKeyPem, /BEGIN PRIVATE KEY/);
    assert.match(kp.publicKeyPem, /BEGIN PUBLIC KEY/);
    assert.ok(kp.keyId.length === 16);
  });

  test('different generations yield different keys', () => {
    const a = generateSigningKeyPair();
    const b = generateSigningKeyPair();
    assert.notEqual(a.privateKeyPem, b.privateKeyPem);
    assert.notEqual(a.keyId, b.keyId);
  });
});

describe('computeKeyId', () => {
  test('deterministic for same PEM', () => {
    const kp = generateSigningKeyPair();
    assert.equal(computeKeyId(kp.publicKeyPem), kp.keyId);
    assert.equal(computeKeyId(kp.publicKeyPem), computeKeyId(kp.publicKeyPem));
  });
});

describe('canonicalSigningPayload', () => {
  test('deterministic canonical form', () => {
    const p = { name: 'pkg', version: '1.0.0', publishId: 'pub1', tarballIntegrity: 'sha512-abc' };
    assert.equal(
      canonicalSigningPayload(p),
      'pkg@1.0.0|publishId=pub1|integrity=sha512-abc',
    );
  });
});

describe('signPayload + verifyPayload', () => {
  test('valid signature verifies', () => {
    const kp = generateSigningKeyPair();
    const payload = { name: 'pkg', version: '1.0.0', publishId: 'pub1', tarballIntegrity: 'sha512-abc' };
    const sig = signPayload(payload, kp.privateKeyPem);
    assert.equal(typeof sig, 'string');
    assert.ok(verifyPayload(payload, sig, kp.publicKeyPem));
  });

  test('tampered payload fails verification', () => {
    const kp = generateSigningKeyPair();
    const payload = { name: 'pkg', version: '1.0.0', publishId: 'pub1', tarballIntegrity: 'sha512-abc' };
    const sig = signPayload(payload, kp.privateKeyPem);
    const tampered = { ...payload, version: '2.0.0' };
    assert.equal(verifyPayload(tampered, sig, kp.publicKeyPem), false);
  });

  test('wrong key fails verification', () => {
    const kp1 = generateSigningKeyPair();
    const kp2 = generateSigningKeyPair();
    const payload = { name: 'pkg', version: '1.0.0', publishId: 'pub1', tarballIntegrity: 'sha512-abc' };
    const sig = signPayload(payload, kp1.privateKeyPem);
    assert.equal(verifyPayload(payload, sig, kp2.publicKeyPem), false);
  });

  test('malformed signature returns false (not throw)', () => {
    const kp = generateSigningKeyPair();
    const payload = { name: 'pkg', version: '1.0.0', publishId: 'pub1', tarballIntegrity: 'sha512-abc' };
    assert.equal(verifyPayload(payload, 'not-valid-base64-sig', kp.publicKeyPem), false);
  });
});

describe('buildKeysResponse', () => {
  test('npm-compatible keys response', () => {
    const kp = generateSigningKeyPair();
    const resp = buildKeysResponse([{ keyId: kp.keyId, publicKeyPem: kp.publicKeyPem }]);
    assert.equal(resp.keys.length, 1);
    assert.equal(resp.keys[0]!.keyid, kp.keyId);
    assert.equal(resp.keys[0]!.keytype, 'ecdsa-sha2-nistp256');
    assert.equal(resp.keys[0]!.scheme, 'ecdsa-sha2-nistp256');
    assert.ok(resp.keys[0]!.key.length > 0);
    assert.ok(!resp.keys[0]!.key.includes('BEGIN'));
  });
});
