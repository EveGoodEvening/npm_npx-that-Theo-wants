/**
 * Lightweight migration runner that applies SQL files from the migrations
 * directory in order, tracking applied migrations in a `_migrations` table.
 *
 * This avoids a hard dependency on drizzle-kit's CLI at runtime — the API
 * server calls `runMigrations()` on startup to ensure the schema is current.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  dbUrl: string,
  migrationsDir: string,
): Promise<MigrationResult> {
  const conn = postgres(dbUrl, { max: 1, prepare: false });

  try {
    // Ensure migrations tracking table exists.
    await conn.unsafe(`
      CREATE TABLE IF NOT EXISTS safenpm._migrations (
        id serial primary key,
        filename text unique not null,
        applied_at timestamptz not null default now()
      );
    `);

    // List applied migrations.
    const applied = await conn<{ filename: string }[]>`
      SELECT filename FROM safenpm._migrations ORDER BY filename
    `;
    const appliedSet = new Set(applied.map((r) => r.filename));

    // List migration files (only .sql files).
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const toApply: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        skipped.push(file);
      } else {
        toApply.push(file);
      }
    }

    // Apply pending migrations in a transaction each.
    for (const file of toApply) {
    const content = await readFile(join(migrationsDir, file), 'utf8');
      await conn.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`
          INSERT INTO safenpm._migrations (filename) VALUES (${file})
        `;
      });
    }

    return { applied: toApply, skipped };
  } finally {
    await conn.end();
  }
}
