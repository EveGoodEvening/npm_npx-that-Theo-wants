# Architecture overview

safe-npm / safe-npx is a TypeScript monorepo implementing a compatibility-first package registry and CLI layer that makes package publication, installation, and one-off execution safer and more reversible.

## Design principles

1. **Compatibility first** — existing `package.json`, package-lock, npm specs, semver, dist-tags, and tarballs keep working.
2. **Private by default, public by intent** — accidental public publication is harder than intentional.
3. **Explainability beats a single number** — show a score, but always show which facts produced it.
4. **Lockfile safety** — retracting or republishing never mutates previously referenced artifacts silently.
5. **Agent-friendly operation** — all prompts have JSON equivalents and deterministic exit codes.
6. **No hidden execution** — never run install scripts, bins, or lifecycle hooks before the risk engine inspects the target.

## Components (implemented in the MVP)

### CLI (`apps/cli`)

- `safe-npm` — `view` (risk report), `publish` (private-first pack skeleton), `policy` (init/show/test).
- `safe-npx` — `preflight`, `<pkg>` (preflight + prompt + install + execute), `scan-skill`, `trust list/revoke`, `cache clean`, `policy init/test`.

### Packages

- `core-types` — Zod schemas for all entities (package, risk, policy, audit, errors).
- `npm-compat` — spec parsing, registry metadata fetching (ETag), version resolution (dist-tags + semver), tarball download (integrity + size guard), packument generation (publish-ID tarball URLs).
- `analyzer` — quarantine cache, safe tar extraction, metadata/script/static/readability analysis, diff analysis.
- `scoring` — deterministic score formula, JSON + TTY renderers, policy engine (5 presets), external signals (OSV, repo health, provenance), typosquat/name-risk.
- `auth` — ECDSA P-256 signing + verification, npm-compatible keys response.
- `config` — environment config loader with validation.

## Data flow: public preflight

```
spec → parsePackageSpec → fetchPackument → resolveVersion
  → downloadTarball (integrity verify) → analyzeTarball
  → scoreAnalysis → evaluatePolicy → decision (allow/approval/blocked)
```

For execution: after approval → `installIntoCache` (npm install --prefix --ignore-scripts) → `resolveInstalledBin` → `executeBin` (Node --permission when available).

## Risk score

Starts at 100, deducts for install scripts, native artifacts, static findings (by severity), obfuscation, missing repo/license, permission mismatches, size anomalies, diff risky deltas. Blockers (malware, integrity mismatch, provenance mismatch) force tier `blocked`. External signals (OSV, repo health, provenance) are merged via `enrichRiskReport` which recomputes tier and score.

## Policy engine

Policies are JSON documents evaluated before install/publish/exec. Five presets: `relaxed`, `default-human`, `strict`, `agent`, `ci`. Rules: minimum score, blocked tiers, require-no-blockers, allow/disallow install scripts, allow/disallow native binaries, require exact version, disallow `latest`, require permission enforcement, block known critical vulns.

## Exit codes (agent/CI mode)

```
0   success / allowed
10  policy requires human approval
11  policy blocked execution
12  audit/security data unavailable and required
13  package could not be resolved
14  no executable bin safely selectable
15  sandbox/permission enforcement unavailable but required
```

## Registry API (not yet implemented)

The registry API, persistence layer, workers, web UI, paid audit broker, and staging/public-promotion flows require PostgreSQL/Redis/MinIO infrastructure and are not part of the MVP CLI vertical slice. The design (`plan/design.md`) specifies the full architecture.
