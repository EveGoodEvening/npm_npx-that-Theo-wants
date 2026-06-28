#!/usr/bin/env node
/**
 * Run database migrations.
 *
 * Usage: node infra/scripts/migrate.mjs [up|status]
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMigrations } from '../../packages/db/dist/migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');
const direction = process.argv[2] ?? 'up';
const dbUrl = process.env.SAFE_NPM_DB_URL ?? 'postgresql://safenpm:safenpm@localhost:5432/safenpm';

async function main() {
  if (direction === 'status') {
    // For status, we just run migrations in dry-run mode (skip applied).
    const result = await runMigrations(dbUrl, migrationsDir);
    console.log(`migrations: ${result.applied.length} applied, ${result.skipped.length} already applied`);
    for (const f of result.skipped) console.log(`  [applied] ${f}`);
    for (const f of result.applied) console.log(`  [new] ${f}`);
    return;
  }

  if (direction !== 'up') {
    console.error(`migrate: unsupported direction "${direction}" (use "up" or "status")`);
    process.exit(1);
  }

  const result = await runMigrations(dbUrl, migrationsDir);
  console.log(`migrate up: ${result.applied.length} applied, ${result.skipped.length} skipped`);
  for (const f of result.applied) console.log(`  [applied] ${f}`);
  for (const f of result.skipped) console.log(`  [skipped] ${f}`);
}

main().catch((err) => {
  console.error('migrate failed:', err);
  process.exit(1);
});
