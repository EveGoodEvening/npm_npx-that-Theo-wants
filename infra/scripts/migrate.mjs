#!/usr/bin/env node
/**
 * Run database migrations.
 *
 * Placeholder implementation: prints the migrations directory and exits 0.
 * The real migration runner is wired up in Section 7 once the storage layer
 * and migration files are added.
 *
 * Usage: node infra/scripts/migrate.mjs [up|down|status]
 */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');
const direction = process.argv[2] ?? 'up';

async function main() {
  const files = await readdir(migrationsDir).catch(() => []);
  console.log(`migrate ${direction}: ${files.length} migration file(s) in ${migrationsDir}`);
  for (const f of files) console.log(`  - ${f}`);
  console.log('migrate: migration runner not yet implemented (placeholder).');
}

main().catch((err) => {
  console.error('migrate failed:', err);
  process.exit(1);
});
