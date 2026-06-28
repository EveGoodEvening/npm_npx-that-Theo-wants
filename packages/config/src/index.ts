import { z } from 'zod';

/**
 * Central environment configuration for safe-npm / safe-npx services.
 * Loaded once at process startup and validated with Zod.
 */

export const envSchema = z.object({
  // Registry API
  SAFE_NPM_API_HOST: z.string().default('0.0.0.0'),
  SAFE_NPM_API_PORT: z.coerce.number().int().positive().default(3000),
  SAFE_NPM_API_BASE_URL: z.string().url().default('http://localhost:3000'),

  // PostgreSQL
  SAFE_NPM_DB_HOST: z.string().default('localhost'),
  SAFE_NPM_DB_PORT: z.coerce.number().int().positive().default(5432),
  SAFE_NPM_DB_NAME: z.string().default('safenpm'),
  SAFE_NPM_DB_USER: z.string().default('safenpm'),
  SAFE_NPM_DB_PASSWORD: z.string().default('safenpm'),
  SAFE_NPM_DB_URL: z.string().optional(),

  // Redis
  SAFE_NPM_REDIS_HOST: z.string().default('localhost'),
  SAFE_NPM_REDIS_PORT: z.coerce.number().int().positive().default(6379),
  SAFE_NPM_REDIS_URL: z.string().optional(),

  // Object storage
  SAFE_NPM_OBJECT_STORE_ENDPOINT: z.string().default('http://localhost:9000'),
  SAFE_NPM_OBJECT_STORE_REGION: z.string().default('us-east-1'),
  SAFE_NPM_OBJECT_STORE_ACCESS_KEY: z.string().optional(),
  SAFE_NPM_OBJECT_STORE_SECRET_KEY: z.string().optional(),
  SAFE_NPM_OBJECT_STORE_BUCKET: z.string().default('safenpm-tarballs'),
  SAFE_NPM_OBJECT_STORE_FORCE_PATH_STYLE: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .default(true),

  // Public npm proxy
  SAFE_NPM_PUBLIC_REGISTRY: z.string().url().default('https://registry.npmjs.org'),

  // Signing
  SAFE_NPM_SIGNING_KEY_PATH: z.string().optional(),
  SAFE_NPM_SIGNING_KEY_ID: z.string().default('dev-local'),

  // Auth
  SAFE_NPM_JWT_SECRET: z.string().default('dev-local-secret-change-me'),
  SAFE_NPM_DEV_ADMIN_USERNAME: z.string().default('devadmin'),
  SAFE_NPM_DEV_ADMIN_TOKEN: z.string().default('dev-local-admin-token'),

  // Telemetry
  SAFE_NPM_TELEMETRY_ENABLED: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .default(true),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export type Config = Env;

export class ConfigError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    const summary = issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    super(`Invalid environment configuration: ${summary}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Required env vars that must be present in non-test environments.
 * Used by {@link assertRequiredEnv} to fail fast on misconfiguration.
 */
export const REQUIRED_IN_PRODUCTION: ReadonlyArray<keyof Env> = [
  'SAFE_NPM_DB_URL',
  'SAFE_NPM_REDIS_URL',
  'SAFE_NPM_OBJECT_STORE_ACCESS_KEY',
  'SAFE_NPM_OBJECT_STORE_SECRET_KEY',
  'SAFE_NPM_JWT_SECRET',
];

/**
 * Load and validate environment configuration from `process.env`.
 * Throws {@link ConfigError} on validation failure.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(result.error.issues);
  }
  return result.data;
}

/**
 * Assert that required env vars are present. In `test`/`development` env,
 * missing infra URLs are tolerated because defaults/local services are used.
 */
export function assertRequiredEnv(config: Config, required: ReadonlyArray<keyof Env> = REQUIRED_IN_PRODUCTION): void {
  if (config.NODE_ENV === 'test') return;
  const missing: string[] = [];
  for (const key of required) {
    const value = config[key];
    if (value === undefined || value === '') {
      missing.push(String(key));
    }
  }
  if (missing.length > 0) {
    throw new ConfigError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: [missing[0]!],
        message: `Missing required environment variables: ${missing.join(', ')}`,
      },
    ]);
  }
}
