import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type DbClient = PostgresJsDatabase<typeof schema>;

/**
 * Create a Drizzle database client from a connection URL.
 *
 * Returns both the drizzle client and the underlying postgres connection so
 * callers can close it when done.
 */
export function createDb(url: string): { db: DbClient; close: () => Promise<void> } {
  const conn = postgres(url, { max: 10, prepare: false });
  const db = drizzle(conn, { schema });
  return {
    db,
    close: () => conn.end(),
  };
}

/** Default connection URL from env. */
export function defaultDbUrl(): string {
  return process.env.SAFE_NPM_DB_URL ?? 'postgresql://safenpm:safenpm@localhost:5432/safenpm';
}

export * as schema from './schema.js';
