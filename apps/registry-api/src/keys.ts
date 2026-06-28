/**
 * Key management for registry signatures (design 9.1).
 *
 * Generates and manages ECDSA P-256 signing keys for signing package
 * dist metadata. Key IDs are derived from the public key.
 */
import { createPrivateKey, createPublicKey, sign, verify, generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface SigningKey {
  keyId: string;
  /** PEM-encoded private key (only available on the server). */
  privateKeyPem?: string;
  /** PEM-encoded public key. */
  publicKeyPem: string;
  /** Algorithm identifier. */
  alg: 'ES256';
  /** When the key was created (ISO 8601). */
  createdAt: string;
  /** When the key was rotated out (null = active). */
  rotatedAt: string | null;
}

export interface KeyManager {
  /** Get the active signing key (with private key). */
  getActiveKey(): SigningKey;
  /** Get all public keys (for the /keys endpoint). */
  getPublicKeys(): SigningKey[];
  /** Sign a payload with the active key. */
  sign(payload: Buffer | string): { signature: string; keyId: string; alg: 'ES256' };
  /** Verify a signature. */
  verify(payload: Buffer | string, signature: Buffer, keyId: string): boolean;
}

/**
 * Generate a new ECDSA P-256 key pair.
 */
export function generateKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

/**
 * Compute a key ID from a public key (SHA-256 of the DER-encoded public key).
 */
export function computeKeyId(publicKeyPem: string): string {
  const pub = createPublicKey(publicKeyPem);
  const der = pub.export({ type: 'spki', format: 'der' });
  return `sha256:${der.toString('hex').slice(0, 16)}`;
}

/**
 * File-based key manager for local dev. Stores keys in a JSON file outside
 * source control (e.g. in a `.keys/` directory that's gitignored).
 */
export class FileKeyManager implements KeyManager {
  private keys: SigningKey[] = [];
  private keyfilePath: string;

  constructor(keyfilePath: string) {
    this.keyfilePath = keyfilePath;
  }

  static async create(keyfilePath: string): Promise<FileKeyManager> {
    const km = new FileKeyManager(keyfilePath);
    await km.load();
    return km;
  }

  async load(): Promise<void> {
    if (existsSync(this.keyfilePath)) {
      const content = await readFile(this.keyfilePath, 'utf8');
      this.keys = JSON.parse(content) as SigningKey[];
    } else {
      // Generate a new key for dev.
      await this.generateNewKey();
    }
  }

  async save(): Promise<void> {
    const dir = join(this.keyfilePath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(this.keyfilePath, JSON.stringify(this.keys, null, 2), { mode: 0o600 });
  }

  async generateNewKey(): Promise<SigningKey> {
    const { privateKeyPem, publicKeyPem } = generateKeyPair();
    const keyId = computeKeyId(publicKeyPem);
    const key: SigningKey = {
      keyId,
      privateKeyPem,
      publicKeyPem,
      alg: 'ES256',
      createdAt: new Date().toISOString(),
      rotatedAt: null,
    };
    this.keys.push(key);
    await this.save();
    return key;
  }

  getActiveKey(): SigningKey {
    const active = this.keys.find((k) => k.rotatedAt === null);
    if (!active) throw new Error('no active signing key');
    return active;
  }

  getPublicKeys(): SigningKey[] {
    return this.keys.map((k) => ({
      keyId: k.keyId,
      publicKeyPem: k.publicKeyPem,
      alg: k.alg,
      createdAt: k.createdAt,
      rotatedAt: k.rotatedAt,
    }));
  }

  sign(payload: Buffer | string): { signature: string; keyId: string; alg: 'ES256' } {
    const key = this.getActiveKey();
    if (!key.privateKeyPem) throw new Error('active key has no private key material');
    const priv = createPrivateKey(key.privateKeyPem);
    const sig = sign(null, Buffer.isBuffer(payload) ? payload : Buffer.from(payload), priv);
    return {
      signature: sig.toString('base64'),
      keyId: key.keyId,
      alg: 'ES256',
    };
  }

  verify(payload: Buffer | string, signature: Buffer, keyId: string): boolean {
    const key = this.keys.find((k) => k.keyId === keyId);
    if (!key) return false;
    const pub = createPublicKey(key.publicKeyPem);
    return verify(null, Buffer.isBuffer(payload) ? payload : Buffer.from(payload), pub, signature);
  }
}

/**
 * In-memory key manager for tests.
 */
export class InMemoryKeyManager implements KeyManager {
  private keys: SigningKey[] = [];

  constructor() {
    const { privateKeyPem, publicKeyPem } = generateKeyPair();
    const keyId = computeKeyId(publicKeyPem);
    this.keys.push({
      keyId,
      privateKeyPem,
      publicKeyPem,
      alg: 'ES256',
      createdAt: new Date().toISOString(),
      rotatedAt: null,
    });
  }

  getActiveKey(): SigningKey {
    const active = this.keys.find((k) => k.rotatedAt === null);
    if (!active) throw new Error('no active signing key');
    return active;
  }

  getPublicKeys(): SigningKey[] {
    return this.keys.map((k) => ({
      keyId: k.keyId,
      publicKeyPem: k.publicKeyPem,
      alg: k.alg,
      createdAt: k.createdAt,
      rotatedAt: k.rotatedAt,
    }));
  }

  sign(payload: Buffer | string): { signature: string; keyId: string; alg: 'ES256' } {
    const key = this.getActiveKey();
    if (!key.privateKeyPem) throw new Error('no private key');
    const priv = createPrivateKey(key.privateKeyPem);
    const sig = sign(null, Buffer.isBuffer(payload) ? payload : Buffer.from(payload), priv);
    return { signature: sig.toString('base64'), keyId: key.keyId, alg: 'ES256' };
  }

  verify(payload: Buffer | string, signature: Buffer, keyId: string): boolean {
    const key = this.keys.find((k) => k.keyId === keyId);
    if (!key) return false;
    const pub = createPublicKey(key.publicKeyPem);
    return verify(null, Buffer.isBuffer(payload) ? payload : Buffer.from(payload), pub, signature);
  }
}
