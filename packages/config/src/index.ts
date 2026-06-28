import { z } from 'zod';

/**
 * Runtime configuration for safe-npm / safe-npx services.
 * Loaded from environment variables with safe defaults for local development.
 */

export const AppConfigSchema = z.object({
  apiHost: z.string().min(1),
  apiPort: z.number().int().min(1).max(65535),
  apiBaseUrl: z.string().url(),
  dbUrl: z.string().min(1),
  redisUrl: z.string().min(1),
  objectStoreEndpoint: z.string().min(1),
  objectStoreRegion: z.string().min(1),
  objectStoreAccessKey: z.string().min(1),
  objectStoreSecretKey: z.string().min(1),
  objectStoreBucket: z.string().min(1),
  objectStoreForcePathStyle: z.boolean(),
  publicRegistry: z.string().url(),
  devSigningKeyPath: z.string().min(1),
  telemetryEnabled: z.boolean(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * Load configuration from environment variables.
 * Throws a structured error listing all missing/invalid required variables.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = {
    apiHost: env.SAFE_NPM_API_HOST ?? '127.0.0.1',
    apiPort: Number(env.SAFE_NPM_API_PORT ?? 7480),
    apiBaseUrl: env.SAFE_NPM_API_BASE_URL ?? 'http://127.0.0.1:7480',
    dbUrl: env.SAFE_NPM_DB_URL,
    redisUrl: env.SAFE_NPM_REDIS_URL,
    objectStoreEndpoint: env.SAFE_NPM_OBJECT_STORE_ENDPOINT,
    objectStoreRegion: env.SAFE_NPM_OBJECT_STORE_REGION ?? 'us-east-1',
    objectStoreAccessKey: env.SAFE_NPM_OBJECT_STORE_ACCESS_KEY,
    objectStoreSecretKey: env.SAFE_NPM_OBJECT_STORE_SECRET_KEY,
    objectStoreBucket: env.SAFE_NPM_OBJECT_STORE_BUCKET ?? 'safenpm-tarballs',
    objectStoreForcePathStyle: boolEnv(env.SAFE_NPM_OBJECT_STORE_FORCE_PATH_STYLE, true),
    publicRegistry: env.SAFE_NPM_PUBLIC_REGISTRY ?? 'https://registry.npmjs.org',
    devSigningKeyPath: env.SAFE_NPM_DEV_SIGNING_KEY_PATH ?? './dev-signing-key.pem',
    telemetryEnabled: boolEnv(env.SAFE_NPM_TELEMETRY_ENABLED, false),
  };

  const parsed = AppConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${missing}`);
  }
  return parsed.data;
}

/**
 * Validate that required environment variables are present for a given service.
 * Returns a list of missing variable names (empty if all present).
 */
export function validateRequiredEnv(
  required: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return required.filter((key) => env[key] === undefined || env[key] === '');
}
