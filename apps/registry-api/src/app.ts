/**
 * Fastify app factory (design 7.3).
 *
 * Creates a configured Fastify instance with health/readiness endpoints,
 * request ID middleware, structured logging, error handler, and rate-limit
 * placeholder. Does not start listening — callers do that.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { createDb, type DbClient } from '@safe-npm/db';
import { createObjectStoreFromEnv, type ObjectStore } from '@safe-npm/object-store';
import { registerAuth } from './auth.js';
import { registerRegistryRoutes } from './routes.js';

export interface AppOptions {
  logger?: boolean;
  dbUrl?: string;
  enableRateLimit?: boolean;
  /** Override object store (for tests). */
  objectStore?: ObjectStore;
  /** Override db client (for tests). */
  db?: DbClient;
  /** Close db on close. */
  closeDb?: () => Promise<void>;
}

export interface AppInstance extends FastifyInstance {
  db: DbClient;
  objectStore: ObjectStore;
}

export async function createApp(options: AppOptions = {}): Promise<AppInstance> {
  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.SAFE_NPM_LOG_LEVEL ?? 'info',
    },
    genReqId: () => randomUUID(),
  });

  // --- Plugins ---

  await app.register(helmet, {
    contentSecurityPolicy: false, // API, not browser
  });

  await app.register(cors, {
    origin: true,
  });

  if (options.enableRateLimit !== false) {
    await app.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      // Placeholder: in production, use Redis backend.
    });
  }

  // --- Database and object store ---

  let db: DbClient;
  let closeDb: () => Promise<void> | undefined;

  if (options.db) {
    db = options.db;
    closeDb = options.closeDb ?? (async () => {});
  } else {
    const { db: d, close } = createDb(options.dbUrl ?? defaultDbUrl());
    db = d;
    closeDb = close;
  }

  const objectStore = options.objectStore ?? createObjectStoreFromEnv();

  // Decorate with db and object store.
  app.decorate('db', db);
  app.decorate('objectStore', objectStore);

  // --- Error handler ---

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    request.log.error({ err: error, statusCode }, 'request error');
    reply.status(statusCode).send({
      error: error.message,
      statusCode,
      requestId: request.id,
    });
  });

  // --- Health and readiness ---

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/ready', async (request, reply) => {
    try {
      // Check database connectivity by running a simple query.
      await db.execute('SELECT 1');
      return { status: 'ready' };
    } catch (err) {
      request.log.error({ err }, 'readiness check failed');
      reply.status(503);
      return { status: 'not_ready', error: (err as Error).message };
    }
  });

  // --- Not found handler ---

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'not found',
      statusCode: 404,
      requestId: request.id,
    });
  });

  // --- Auth ---

  await registerAuth(app, db);

  // --- Registry routes (publish, packument, tarball) ---

  const registryBaseUrl = process.env.SAFE_NPM_API_BASE_URL ?? `http://localhost:${process.env.SAFE_NPM_API_PORT ?? 3000}`;
  await registerRegistryRoutes(app, { db, objectStore, registryBaseUrl });

  // Close db on shutdown.
  app.addHook('onClose', async () => {
    await closeDb();
  });

  return app as unknown as AppInstance;
}

function defaultDbUrl(): string {
  return process.env.SAFE_NPM_DB_URL ?? 'postgresql://safenpm:safenpm@localhost:5432/safenpm';
}

/** Start the server. */
export async function startServer(port?: number, host?: string): Promise<AppInstance> {
  const app = await createApp();
  const p = port ?? Number(process.env.SAFE_NPM_API_PORT ?? 3000);
  const h = host ?? process.env.SAFE_NPM_API_HOST ?? '0.0.0.0';
  await app.listen({ port: p, host: h });
  return app;
}
