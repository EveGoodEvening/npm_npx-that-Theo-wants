/**
 * Dist metadata signing (design 9.2).
 *
 * The signing payload is: package name, version, publish ID, and tarball
 * integrity. This is signed with the registry's active ECDSA P-256 key.
 */
import type { KeyManager } from './keys.js';

export interface SigningPayload {
  packageName: string;
  version: string;
  publishId: string;
  tarballIntegrity: string;
}

export interface DistSignature {
  signature: string;
  keyId: string;
  alg: 'ES256';
}

/**
 * Canonicalize the signing payload into a deterministic JSON string.
 * Keys are sorted alphabetically for reproducibility.
 */
export function canonicalizePayload(payload: SigningPayload): string {
  return JSON.stringify({
    packageName: payload.packageName,
    publishId: payload.publishId,
    tarballIntegrity: payload.tarballIntegrity,
    version: payload.version,
  });
}

/**
 * Sign a dist metadata payload.
 */
export function signDistMetadata(payload: SigningPayload, keyManager: KeyManager): DistSignature {
  const canonical = canonicalizePayload(payload);
  const result = keyManager.sign(canonical);
  return {
    signature: result.signature,
    keyId: result.keyId,
    alg: result.alg,
  };
}

/**
 * Verify a dist metadata signature.
 */
export function verifyDistMetadata(
  payload: SigningPayload,
  signature: DistSignature,
  keyManager: KeyManager,
): boolean {
  const canonical = canonicalizePayload(payload);
  const sigBuf = Buffer.from(signature.signature, 'base64');
  return keyManager.verify(canonical, sigBuf, signature.keyId);
}
