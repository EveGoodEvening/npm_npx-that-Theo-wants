#!/usr/bin/env node
/**
 * Seed local test user/org/token.
 *
 * Placeholder implementation: prints the seed plan. The real seed is wired
 * up in Section 7 once the storage repositories exist.
 *
 * Usage: node infra/scripts/seed.mjs
 */
function main() {
  const username = process.env.SAFE_NPM_DEV_ADMIN_USERNAME ?? 'devadmin';
  const org = 'safe-dev';
  console.log('seed: plan');
  console.log(`  - user: ${username}`);
  console.log(`  - org: ${org} (owner: ${username})`);
  console.log(`  - token: dev-local-admin-token (hashed at rest)`);
  console.log('seed: not yet implemented (placeholder).');
}

main();
