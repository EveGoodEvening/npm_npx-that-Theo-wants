import {
  generateKeyPairSync,
  sign as signCb,
  verify as verifyCb,
  createSign,
  createVerify,
  createHash,
  type KeyObject,
} from 'node:crypto';

/** ECDSA P-256 signing key pair (local dev; production uses KMS/HSM). */
export interface SigningKeyPair {
  /** PEM-encoded private key. */
  privateKeyPem: string;
  /** PEM-encoded public key. */
  publicKeyPem: string;
  /** Key ID (sha256 of public key DER, hex, first 16 chars). */
  keyId: string;
}

/**
 * Key rotation data model placeholder. Production would track multiple keys
 * with activation/retirement timestamps so old signatures remain verifiable
 * during the rotation window.
 */
export interface KeyRotationRecord {
  keyId: string;
  publicKeyPem: string;
  activatedAt: string;
  retiredAt?: string;
  status: 'active' | 'retired';
}

/** Generate a local dev ECDSA P-256 signing key pair. */
export function generateSigningKeyPair(): SigningKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const keyId = computeKeyId(publicKey);
  return { privateKeyPem: privateKey, publicKeyPem: publicKey, keyId };
}

/** Compute a stable key ID from a public key PEM (sha256 of DER, hex, 16 chars). */
export function computeKeyId(publicKeyPem: string): string {
  // hash the PEM string directly for a stable, portable key id
  return createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

/** Signing payload: package name, version, publish ID, tarball integrity. */
export interface SigningPayload {
  name: string;
  version: string;
  publishId: string;
  tarballIntegrity: string;
}

/** Canonicalize the signing payload to a deterministic string. */
export function canonicalSigningPayload(payload: SigningPayload): string {
  return `${payload.name}@${payload.version}|publishId=${payload.publishId}|integrity=${payload.tarballIntegrity}`;
}

/** Sign a payload with a private key (ECDSA P-256, SHA-256). Returns base64 signature. */
export function signPayload(payload: SigningPayload, privateKeyPem: string): string {
  const data = canonicalSigningPayload(payload);
  const signer = createSign('SHA256');
  signer.update(data);
  signer.end();
  return signer.sign(privateKeyPem).toString('base64');
}

/** Verify a payload signature against a public key. Returns true if valid. */
export function verifyPayload(
  payload: SigningPayload,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  const data = canonicalSigningPayload(payload);
  const verifier = createVerify('SHA256');
  verifier.update(data);
  verifier.end();
  try {
    return verifier.verify(publicKeyPem, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

/** npm-compatible keys endpoint response shape (`/-/npm/v1/keys`). */
export interface NpmKeysResponse {
  keys: Array<{
    keyid: string;
    keytype: 'ecdsa-sha2-nistp256';
    scheme: 'ecdsa-sha2-nistp256';
    key: string;
  }>;
}

/** Build an npm-compatible keys response from one or more public keys. */
export function buildKeysResponse(publicKeys: Array<{ keyId: string; publicKeyPem: string }>): NpmKeysResponse {
  return {
    keys: publicKeys.map((k) => ({
      keyid: k.keyId,
      keytype: 'ecdsa-sha2-nistp256' as const,
      scheme: 'ecdsa-sha2-nistp256' as const,
      key: pemToBase64(k.publicKeyPem),
    })),
  };
}

/** Convert a PEM public key to a compact base64 form (strip PEM headers). */
function pemToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
}

/** Re-export crypto types for callers that need KeyObject. */
export type { KeyObject };

// Suppress unused-import warnings for the callback-style APIs (kept for API parity).
void signCb;
void verifyCb;
