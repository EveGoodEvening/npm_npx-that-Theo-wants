/**
 * Signature worker (design 10.4).
 *
 * Signs new package versions after tarball storage. Stores signature
 * metadata and triggers packument cache invalidation.
 */

export interface SignVersionPayload {
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

export interface SigningKey {
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
  alg: 'ES256';
}

export interface SignatureWorkerDeps {
  /** Active signing key (with private key material). */
  signingKey: SigningKey;
  /** Callback to invalidate packument cache. */
  invalidateCache?: (packageName: string) => void;
}

/**
 * Canonicalize the signing payload into a deterministic JSON string.
 * Keys are sorted alphabetically for reproducibility.
 * Must match the server-side canonicalization in registry-api/src/signing.ts.
 */
export function canonicalizePayload(payload: SignVersionPayload): string {
  return JSON.stringify({
    packageName: payload.packageName,
    publishId: payload.publishId,
    tarballIntegrity: payload.tarballIntegrity,
    version: payload.version,
  });
}

export function createSignatureWorker(deps: SignatureWorkerDeps) {
  return async (payload: SignVersionPayload): Promise<DistSignature> => {
    const { signingKey, invalidateCache } = deps;

    // Step 1: Sign the dist metadata.
    const { createPrivateKey, sign } = await import('node:crypto');
    const priv = createPrivateKey(signingKey.privateKeyPem);
    const canonical = canonicalizePayload(payload);
    const sig = sign(null, Buffer.from(canonical), priv);

    const signature: DistSignature = {
      signature: sig.toString('base64'),
      keyId: signingKey.keyId,
      alg: 'ES256',
    };

    // Step 2: Trigger packument cache invalidation.
    if (invalidateCache) {
      invalidateCache(payload.packageName);
    }

    return signature;
  };
}
