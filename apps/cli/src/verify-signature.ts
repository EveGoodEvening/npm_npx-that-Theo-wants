/**
 * Registry signature verification helper (design 9.3).
 *
 * Fetches the registry's public keys and verifies dist signatures
 * in packuments before install/exec.
 */

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

export interface RegistryKeysResponse {
  keys: Array<{
    keyid: string;
    key: string;
    expires: string | null;
  }>;
}

export interface VerifyOptions {
  registryUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the registry's public keys.
 */
export async function fetchRegistryKeys(options: VerifyOptions): Promise<RegistryKeysResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.registryUrl}/-/npm/v1/keys`;
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    throw new SignatureError(`failed to fetch keys: ${resp.status}`, 'KEYS_FETCH_FAILED');
  }
  return (await resp.json()) as RegistryKeysResponse;
}

/**
 * Verify a dist signature from a packument.
 *
 * Returns true if the signature is valid, false if it's invalid or
 * no matching key is found.
 */
export async function verifySignature(
  payload: SigningPayload,
  signature: DistSignature,
  keys: RegistryKeysResponse,
): Promise<boolean> {
  const keyEntry = keys.keys.find((k) => k.keyid === signature.keyId);
  if (!keyEntry) return false;

  const { createPublicKey, verify } = await import('node:crypto');
  const pub = createPublicKey(keyEntry.key);
  const canonical = canonicalizePayload(payload);
  const sigBuf = Buffer.from(signature.signature, 'base64');
  return verify(null, Buffer.from(canonical), pub, sigBuf);
}

/**
 * Canonicalize the signing payload into a deterministic JSON string.
 * Must match the server-side canonicalization.
 */
export function canonicalizePayload(payload: SigningPayload): string {
  return JSON.stringify({
    packageName: payload.packageName,
    publishId: payload.publishId,
    tarballIntegrity: payload.tarballIntegrity,
    version: payload.version,
  });
}

export class SignatureError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SignatureError';
    this.code = code;
  }
}
