# Local Setup Guide

## Prerequisites

- Node.js 22+
- pnpm 11+
- PostgreSQL 16+ (or Docker for local DB)

## Quick Start

```bash
# Clone and install dependencies
git clone <repo-url>
cd npm_npx-that-Theo-wants
pnpm install

# Start a local PostgreSQL (optional, via Docker)
docker run -d --name safe-npm-pg \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=safenpm \
  -p 5432:5432 \
  postgres:16

# Run database migrations
DATABASE_URL=postgresql://postgres:dev@localhost:5432/safenpm \
  pnpm db:migrate

# Run all checks (typecheck, lint, test)
pnpm run check
```

## Environment Variables

Copy `env.example` to `.env` and configure:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:dev@localhost:5432/safenpm` | PostgreSQL connection string |
| `SAFE_NPM_DEV_ADMIN_TOKEN` | `dev-local-admin-token` | Dev admin bearer token |
| `SAFE_NPM_DEV_ADMIN_USERNAME` | `devadmin` | Dev admin username |
| `REGISTRY_BASE_URL` | `http://localhost:3000` | Registry API base URL |
| `OBJECT_STORE_TYPE` | `memory` | Object storage backend (`memory` or `s3`) |

## Project Structure

```
apps/
  cli/           # safe-npm and safe-npx CLI
  registry-api/  # Registry API server
  web/           # Web UI
  workers/       # Background workers (analysis, audit)
packages/
  analyzer/      # Tarball static analysis
  auth/          # Authentication
  config/        # Configuration
  core-types/    # Shared types and Zod schemas
  db/            # Database schema and repositories
  npm-compat/    # npm registry compatibility layer
  object-store/  # Content-addressed object storage
  sandbox/       # Execution sandbox
  scoring/       # Risk scoring and policy engine
  storage/       # Storage abstraction
```

## Running Services

### Registry API

```bash
DATABASE_URL=postgresql://postgres:dev@localhost:5432/safenpm \
  pnpm --filter @safe-npm/registry-api dev
```

### Workers

```bash
DATABASE_URL=postgresql://postgres:dev@localhost:5432/safenpm \
  pnpm --filter @safe-npm/workers dev
```

### Web UI

```bash
pnpm --filter @safe-npm/web dev
```

### CLI

```bash
# Publish a package
node apps/cli/src/bin/safe-npm.ts publish

# Run npx with preflight
node apps/cli/src/bin/safe-npx.ts <package>

# Scan a skill.md file
node apps/cli/src/bin/safe-npx.ts scan-skill path/to/skill.md
```

## Database

```bash
# Generate migrations
pnpm db:generate

# Run migrations
pnpm db:migrate

# Run migrations test
pnpm --filter @safe-npm/db test
```
