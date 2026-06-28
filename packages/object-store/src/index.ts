/**
 * S3-compatible object store client (design 7.2).
 *
 * Provides a thin wrapper over @aws-sdk/client-s3 with content-addressed key
 * schemes for tarballs, analysis artifacts, and attestations.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

export interface ObjectStoreConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle?: boolean;
}

export interface PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface GetResult {
  body: Readable;
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
  metadata: Record<string, string> | undefined;
}

/**
 * Object store client with content-addressed key schemes:
 *   tarballs/<sha512>.tgz
 *   analysis/<sha512>/<analyzer-version>.json
 *   attestations/<digest>.json
 */
export class ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ObjectStoreConfig) {
    const s3Config: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    };
    this.client = new S3Client(s3Config);
    this.bucket = config.bucket;
  }

  /** Tarball key: `tarballs/<sha512>.tgz` */
  static tarballKey(sha512: string): string {
    return `tarballs/${sha512}.tgz`;
  }

  /** Analysis key: `analysis/<sha512>/<analyzer-version>.json` */
  static analysisKey(sha512: string, analyzerVersion: string): string {
    return `analysis/${sha512}/${analyzerVersion}.json`;
  }

  /** Attestation key: `attestations/<digest>.json` */
  static attestationKey(digest: string): string {
    return `attestations/${digest}.json`;
  }

  async putObject(key: string, data: Buffer | Uint8Array, options: PutOptions = {}): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: options.contentType,
        Metadata: options.metadata,
      }),
    );
    return key;
  }

  async getObject(key: string): Promise<GetResult> {
    const resp = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      body: resp.Body as Readable,
      contentType: resp.ContentType,
      contentLength: resp.ContentLength,
      etag: resp.ETag,
      metadata: resp.Metadata,
    };
  }

  async headObject(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /** Convenience: put a tarball with content-addressed key. */
  async putTarball(sha512: string, data: Buffer): Promise<string> {
    return this.putObject(ObjectStore.tarballKey(sha512), data, {
      contentType: 'application/gzip',
    });
  }

  /** Convenience: put an analysis report. */
  async putAnalysis(sha512: string, analyzerVersion: string, data: Buffer): Promise<string> {
    return this.putObject(ObjectStore.analysisKey(sha512, analyzerVersion), data, {
      contentType: 'application/json',
    });
  }

  /** Read an object fully into a Buffer. */
  static async readAll(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

/** Create an ObjectStore from environment variables. */
export function createObjectStoreFromEnv(): ObjectStore {
  return new ObjectStore({
    endpoint: process.env.SAFE_NPM_OBJECT_STORE_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.SAFE_NPM_OBJECT_STORE_REGION ?? 'us-east-1',
    accessKey: process.env.SAFE_NPM_OBJECT_STORE_ACCESS_KEY ?? 'safenpm',
    secretKey: process.env.SAFE_NPM_OBJECT_STORE_SECRET_KEY ?? 'safenpmpassword',
    bucket: process.env.SAFE_NPM_OBJECT_STORE_BUCKET ?? 'safenpm-tarballs',
    forcePathStyle: (process.env.SAFE_NPM_OBJECT_STORE_FORCE_PATH_STYLE ?? 'true') === 'true',
  });
}

/** Compute sha512 integrity string from a buffer. */
export function computeSha512(data: Buffer): string {
  return `sha512-${createHash('sha512').update(data).digest('base64')}`;
}
