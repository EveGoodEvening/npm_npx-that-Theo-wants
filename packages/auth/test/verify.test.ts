import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSigningKeyPair,
  signPayload,
  buildKeysResponse,
  verifyRegistrySignatures,
  type RegistryKey,
} from '../src/index.js';

describe('verifyRegistrySignatures', () => {
  test('verified when signature matches key', () => {
    const kp = generateSigningKeyPair();
    const payload = { name: 'pkg', version: '1.0.0', publishId: 'pub1', tarballIntegrity: 'sha512-abc' };
    const sig = signPayload(payload, kp.privateKeyPem);
    const keysResp = buildKeysResponse([{ keyId: kp.keyId, publicKeyPem: kp.publicKeyPem }]);
    const keys: RegistryKey[] = keysResp.keys as unknown as RegistryKey[];
    const result = verifyRegistrySignatures(payload, [{ keyid: kp.keyId, sig }], keys);
    assert.equal(result.verified, true);
    assert.equal(result.checked, true);
  });

  test('checked=false when no signatures', () => {
    const result = verifyRegistrySignatures(
      { name: 'p', version: '1.0.0', publishId: 'x', tarballIntegrity: 'sha512-a' },
      undefined,
      [],
    );
    assert.equal(result.checked, false);
  });

  test('checked=false when no keys', () => {
    const result = verifyRegistrySignatures(
      { name: 'p', version: '1.0.0', publishId: 'x', tarballIntegrity: 'sha512-a' },
      [{ keyid: 'k1', sig: 'abc' }],
      undefined,
    );
    assert.equal(result.checked, false);
  });

  test('verified=false when no matching key', () => {
    const kp = generateSigningKeyPair();
    const payload = { name: 'pkg', version: '1.0.0', publishId: 'pub1', tarballIntegrity: 'sha512-abc' };
    const sig = signPayload(payload, kp.privateKeyPem);
    const otherKp = generateSigningKeyPair();
    const keysResp = buildKeysResponse([{ keyId: otherKp.keyId, publicKeyPem: otherKp.publicKeyPem }]);
    const keys: RegistryKey[] = keysResp.keys as unknown as RegistryKey[];
    const result = verifyRegistrySignatures(payload, [{ keyid: kp.keyId, sig }], keys);
    assert.equal(result.verified, false);
    assert.equal(result.checked, true);
  });
});
