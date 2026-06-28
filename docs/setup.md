# Local setup guide

This guide gets a new coding agent or developer running the safe-npm / safe-npx monorepo locally.

## Prerequisites

- Node.js >= 20 (tested on Node 24)
- npm (workspaces are used; pnpm is not required)
- Network access to `https://registry.npmjs.org` for public package preflight

## Install

```bash
npm install
```

This installs all workspace packages (`apps/*`, `packages/*`) and links them via npm workspaces.

## Build

```bash
npm run build
```

Runs `tsc -b` with project references. Output goes to each package's `dist/` directory.

## Check (typecheck + lint + tests)

```bash
npm run check
```

- `npm run build` — TypeScript build
- `npm run lint` — ESLint
- `npm test` — node:test runner via `scripts/run-tests.mjs` (discovers `**/dist/test/**/*.test.js`)

Tests run against compiled output, so always build before testing.

## Run the CLIs

```bash
# safe-npm
node apps/cli/dist/src/safe-npm.js --version
node apps/cli/dist/src/safe-npm.js view is-odd@3.0.1

# safe-npx
node apps/cli/dist/src/safe-npx.js --version
node apps/cli/dist/src/safe-npx.js preflight is-odd@3.0.1 --json
node apps/cli/dist/src/safe-npx.js scan-skill ./SKILL.md --json
```

## Local infrastructure (optional, for the registry API)

The registry API, workers, and web UI require PostgreSQL, Redis, and MinIO. A `docker-compose.yml` is provided at `infra/docker/docker-compose.yml`:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

> Note: the registry API service itself is not yet implemented in the MVP. The CLI public-preflight vertical slice works without any local infrastructure.

## Configuration

Copy `.env.example` to `.env` and adjust. The config loader (`packages/config`) validates required environment variables at startup. Key variables:

- `SAFE_NPM_PUBLIC_REGISTRY` — public npm registry for preflight (default `https://registry.npmjs.org`)
- `SAFE_NPM_CACHE_DIR` — quarantine cache root (default OS-specific)
- `SAFE_NPX_EXEC_CACHE_DIR` — execution cache root (default OS-specific)
- `SAFE_NPM_TELEMETRY_ENABLED` — enable install telemetry (default `false`)

## Project layout

```
apps/cli/              safe-npm and safe-npx binaries
apps/registry-api/     Fastify API (not yet implemented)
apps/web/              review UI (not yet implemented)
apps/workers/          analyzer/scorer/audit workers (not yet implemented)
packages/core-types/   shared Zod schemas and TypeScript types
packages/npm-compat/   packument, semver, tarball helpers
packages/analyzer/     static/diff/permission analyzers
packages/scoring/      score formula, policy engine, external signals, name-risk
packages/auth/         signing + signature verification
packages/config/       env config loader
packages/storage/      object store + metadata repositories (not yet implemented)
packages/audit-providers/  paid audit provider adapters (not yet implemented)
packages/sandbox/      Node permission + OS sandbox adapters (not yet implemented)
infra/docker/          docker-compose for local services
```
