#!/usr/bin/env node
/**
 * Seed local test user/org/token.
 *
 * Creates a dev admin user, a dev org, and a dev admin token.
 * Requires a running PostgreSQL with migrations applied.
 *
 * Usage: node infra/scripts/seed.mjs
 */
import { createDb, UsersRepository, OrgsRepository, MembershipsRepository, AuthTokensRepository } from '../../packages/db/dist/index.js';

const dbUrl = process.env.SAFE_NPM_DB_URL ?? 'postgresql://safenpm:safenpm@localhost:5432/safenpm';
const username = process.env.SAFE_NPM_DEV_ADMIN_USERNAME ?? 'devadmin';
const devToken = process.env.SAFE_NPM_DEV_ADMIN_TOKEN ?? 'dev-local-admin-token';
const orgName = 'safe-dev';

async function main() {
  const { db, close } = createDb(dbUrl);

  try {
    const usersRepo = new UsersRepository(db);
    const orgsRepo = new OrgsRepository(db);
    const membershipsRepo = new MembershipsRepository(db);
    const tokensRepo = new AuthTokensRepository(db);

    // Create or find dev admin user.
    let user = await usersRepo.findByUsername(username);
    if (!user) {
      user = await usersRepo.create({ username });
      console.log(`Created user: ${username} (${user.id})`);
    } else {
      console.log(`User exists: ${username} (${user.id})`);
    }

    // Create or find dev org.
    let org = await orgsRepo.findByName(orgName);
    if (!org) {
      org = await orgsRepo.create({ name: orgName });
      console.log(`Created org: ${orgName} (${org.id})`);
    } else {
      console.log(`Org exists: ${orgName} (${org.id})`);
    }

    // Add membership.
    await membershipsRepo.create({ orgId: org.id, userId: user.id, role: 'owner' });
    console.log(`Membership: ${username} is owner of ${orgName}`);

    // Create dev admin token (hashed at rest).
    const existing = await tokensRepo.findByPlaintext(devToken);
    if (!existing) {
      await tokensRepo.create({
        userId: user.id,
        plaintext: devToken,
        scopes: ['read', 'publish', 'admin', 'delete'],
        label: 'dev-admin',
      });
      console.log(`Created token: ${devToken.slice(0, 12)}... (hashed at rest)`);
    } else {
      console.log(`Token exists: ${devToken.slice(0, 12)}...`);
    }

    console.log('\nSeed complete. Use this token for API auth:');
    console.log(`  Authorization: Bearer ${devToken}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
