import type { SigningPayload } from './signing.js';
import { verifyPayload } from './signing.js';

/** A dist.signatures entry from a packument. */
export interface DistSignature {
  keyid: string;
  sig: string;
}

/** A registry key entry from `/-/npm/v1/keys`. */
export interface RegistryKey {
  keyid: string;
  keytype: string;
  scheme: string;
  /** base64-encoded public key (compact, no PEM headers) or PEM. */
  key: string;
}

export interface SignatureVerificationResult {
  verified: boolean;
  /** True if signatures/keys were present and checked. */
  checked: boolean;
  /** Reason when not verified. */
  reason?: string;
}

/**
 * Verify registry dist signatures for a package version.
 * Returns checked=false when no signatures or keys are present (graceful).
 */
export function verifyRegistrySignatures(
  payload: SigningPayload,
  signatures: DistSignature[] | undefined,
  keys: RegistryKey[] | undefined,
): SignatureVerificationResult {
  if (!signatures || signatures.length === 0) {
    return { verified: false, checked: false, reason: 'no signatures present' };
  }
  if (!keys || keys.length === 0) {
    return { verified: false, checked: false, reason: 'no registry keys available' };
  }
  for (const sig of signatures) {
    const key = keys.find((k) => k.keyid === sig.keyid);
    if (!key) continue;
    const publicKeyPem = keyToPem(key.key);
    if (verifyPayload(payload, sig.sig, publicKeyPem)) {
      return { verified: true, checked: true };
    }
  }
  return { verified: false, checked: true, reason: 'no matching key verified the signature' };
}

/** Convert a compact base64 public key back to PEM form for verification. */
function keyToPem(key: string): string {
  if (key.includes('BEGIN PUBLIC KEY')) return key;
  // wrap base64 at 64 chars and add PEM headers
  const wrapped = key.replace(/(.{64})/g, '$1\n').trim();
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`;
}
