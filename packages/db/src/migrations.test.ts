import { describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', '..', '..', 'infra', 'migrations');

describe('migrations', () => {
  it('generates at least one SQL migration file', async () => {
    const files = await readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql'));
    expect(sqlFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('migration creates the safenpm schema', async () => {
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const first = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(first).toContain('CREATE SCHEMA "safenpm"');
  });

  it('migration creates all core tables', async () => {
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const content = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    // Note: audit_logs in the design maps to audit_jobs + audit_attestations.
    // We check for the design's core entities.
    const coreTables = [
      'users',
      'orgs',
      'memberships',
      'packages',
      'package_versions',
      'version_aliases',
      'dist_tags',
      'risk_reports',
      'permission_reports',
      'auth_tokens',
    ];
    for (const table of coreTables) {
      expect(content).toContain(`"${table}"`);
    }
  });

  it('migration includes indexes for performance', async () => {
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const content = readFileSync(join(migrationsDir, files[0]!), 'utf8');
    expect(content).toContain('CREATE INDEX');
  });
});

/**
 * Live migration smoke test — requires a running PostgreSQL.
 * Skipped unless SAFE_NPM_RUN_NETWORK_TESTS=1.
 */
const RUN_NETWORK = process.env.SAFE_NPM_RUN_NETWORK_TESTS === '1';
const describeNetwork = RUN_NETWORK ? describe : describe.skip;

describeNetwork('migration smoke test (live)', () => {
  it('applies migrations to a live database', async () => {
    const { runMigrations } = await import('../src/migrations.js');
    const dbUrl = process.env.SAFE_NPM_DB_URL ?? 'postgresql://safenpm:safenpm@localhost:5432/safenpm';
    const result = await runMigrations(dbUrl, migrationsDir);
    expect(result.applied.length + result.skipped.length).toBeGreaterThanOrEqual(1);
  });
});
