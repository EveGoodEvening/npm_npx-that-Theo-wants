import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: '../../infra/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.SAFE_NPM_DB_URL ?? 'postgresql://safenpm:safenpm@localhost:5432/safenpm',
  },
  verbose: true,
  strict: true,
});
