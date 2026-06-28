#!/usr/bin/env node
/**
 * Create the local object storage bucket used for tarballs/analysis/attestations.
 * Uses the S3-compatible API (MinIO for local dev).
 *
 * Usage: node infra/scripts/create-bucket.mjs
 */
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

const endpoint = process.env.SAFE_NPM_OBJECT_STORE_ENDPOINT ?? 'http://localhost:9000';
const region = process.env.SAFE_NPM_OBJECT_STORE_REGION ?? 'us-east-1';
const accessKey = process.env.SAFE_NPM_OBJECT_STORE_ACCESS_KEY ?? 'safenpm';
const secretKey = process.env.SAFE_NPM_OBJECT_STORE_SECRET_KEY ?? 'safenpmpassword';
const bucket = process.env.SAFE_NPM_OBJECT_STORE_BUCKET ?? 'safenpm-tarballs';
const forcePathStyle =
  (process.env.SAFE_NPM_OBJECT_STORE_FORCE_PATH_STYLE ?? 'true') === 'true';

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle,
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
});

async function main() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" already exists.`);
  } catch (err) {
    if (err && (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404)) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`Bucket "${bucket}" created.`);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('create-bucket failed:', err);
  process.exit(1);
});
