# Design: `tnpm` / `tnpx` — the npm & npx that Theo wants

> **Audience**: coding agents implementing this project. This document plus `todo.md` is the
> complete context you need. When this doc and `todo.md` disagree, this doc wins; fix `todo.md`.
> When something is genuinely unspecified, prefer the simplest choice consistent with the
> "Design principles" section, and record the decision in the `Decisions log` at the bottom of
> `todo.md`.

## 1. What we are building

A reimagined npm + npx, per the project `README.md`:

1. **Registry server** (`@tnpm/registry`) — an npm-compatible package registry that is
   *private-by-default*, supports *threshold-based unpublishing*, computes *security scores*,
   runs *AI audits* of release diffs (Anthropic API), and *proxies/caches* the public
   registry.npmjs.org so normal public packages still work.
2. **CLI** (`@tnpm/cli`, bins `tnpm` and `tnpx`) — replaces `npm`/`npx` UX:
   - `tnpm`: login, publish (private by default), unpublish (threshold-checked), install
     (wraps `npm` against our registry after a security gate), share private packages, view
     scores/reports, request audits.
   - `tnpx`: before executing anything, shows a **security gate panel** (size, author,
     publish age, install scripts, declared vs detected permissions, security score, audit
     verdict, typosquat warnings) and asks run/abort/always-allow. Fully scriptable for AI
     agents via `--json` / `--report-only` / `--max-risk` and deterministic exit codes.
3. **Core library** (`@tnpm/core`) — shared TypeScript types, the heuristic scoring engine,
   the static capability scanner, signature verification, and a typed registry API client.

### Non-goals for v1 (do NOT build these)

- A full dependency resolver / lockfile format (we wrap the `npm` CLI for tree installs).
- Real payment processing (Stripe etc.). Audits are **bring-your-own-Anthropic-key** or use
  the server's key against a stubbed per-user credit ledger.
- A web UI, org/teams management, SSO/OAuth, package search UI, replication/mirroring.
- Runtime *network* sandboxing (Node's permission model can't restrict net; we report only).
- Windows support (target Linux/macOS; don't gratuitously break Windows, but don't test it).

## 2. Design principles

1. **Wrap, don't reimplement.** Dependency resolution and tree installation are delegated to
   the stock `npm` CLI pointed at our registry. Our value-add is the metadata, policy, and
   the gate in front.
2. **Fail closed for security, fail open for availability.** If the score can't be computed,
   say so loudly and treat it as risk. If the *upstream proxy* is down but a tarball is
   cached, keep serving the cache.
3. **Machine-first output.** Every human-readable panel has a `--json` twin with a stable
   schema. AI agents are first-class consumers (this is Theo's key npx point).
4. **Audits must be unforgeable.** Audit results are produced server-side and Ed25519-signed
   by the registry. The CLI verifies the signature against a pinned public key.
5. **Simple, boring tech.** SQLite + filesystem storage, one process, no queues/brokers.
   Everything runs locally with `pnpm dev`.

## 3. Repository layout & toolchain

```
.
├── README.md
├── design.md                  # this file
├── todo.md                    # phased checklist (keep updated as you work)
├── CLAUDE.md                  # repo instructions for agents (create in P0; include Lessons section)
├── package.json               # private root, pnpm workspace scripts
├── pnpm-workspace.yaml        # packages/*
├── tsconfig.base.json         # strict, ESM, NodeNext
├── biome.json                 # lint + format (Biome, replaces eslint+prettier)
├── env.example                # NOTE: filename is exactly `env.example` (no leading dot)
├── .github/workflows/ci.yml   # lint + typecheck + test on Node 22
├── packages/
│   ├── core/                  # @tnpm/core
│   │   └── src/{types.ts, scoring/, scanner/, client.ts, signing.ts, permissions.ts}
│   ├── registry/              # @tnpm/registry
│   │   └── src/{server.ts, app.ts, db/{schema.sql,migrate.ts,queries.ts},
│   │            routes/{npm.ts, auth.ts, packages.ts, audits.ts, keys.ts},
│   │            services/{publish.ts, proxy.ts, unpublish.ts, score.ts, audit.ts,
│   │                      storage.ts, signing.ts, credits.ts}}
│   └── cli/                   # @tnpm/cli  (bins: tnpm, tnpx)
│       └── src/{tnpm.ts, tnpx.ts, commands/*, gate/{panel.ts, policy.ts, trust.ts},
│                run/{fetch.ts, exec.ts}, config.ts, output.ts}
└── e2e/                       # end-to-end shell/vitest scenarios + fixture packages
    └── fixtures/{hello-pkg, evil-pkg, scripts-pkg}
```

**Toolchain (fixed choices):**

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript, `"strict": true`, ESM only (`"type": "module"`, moduleResolution NodeNext) | |
| Runtime | Node >= 22 | needed for stable-ish permission model flags |
| Workspace | pnpm workspaces | root scripts fan out with `pnpm -r` |
| HTTP server | Fastify v5 | use `app.inject()` in tests |
| Validation | zod | all route bodies & CLI-facing JSON |
| DB | better-sqlite3 (raw SQL + tiny hand-rolled migration runner) | no ORM |
| CLI framework | commander | |
| Prompts/UI | @clack/prompts + picocolors | fall back to plain text when not TTY |
| Tarballs | `tar` (npm package) + `node:zlib` | |
| Semver | `semver` | |
| AI | `@anthropic-ai/sdk` | default model from env `AUDIT_MODEL`, default `claude-sonnet-5` |
| Signing | `node:crypto` Ed25519 | zero extra deps |
| Tests | vitest (+ Fastify inject); e2e via vitest running child processes | |
| Lint/format | Biome | `pnpm lint`, `pnpm format` |

Install "latest stable" of each dependency at implementation time; do not copy version
numbers from this document.

## 4. Registry server (`@tnpm/registry`)

Single Fastify process. SQLite file + tarball directory on disk. In-process background jobs
(audit runner, upstream score refresh) via a minimal `setInterval`-driven job loop — no
external queue.

### 4.1 Configuration (env; ship `env.example` with all of these)

```
PORT=4873
DATABASE_PATH=./data/tnpm.sqlite
STORAGE_DIR=./data/store              # tarballs: <STORAGE_DIR>/<name>/<name>-<version>.tgz
UPSTREAM_REGISTRY=https://registry.npmjs.org
SIGNING_KEY_PATH=./data/signing.key   # Ed25519 PKCS8 PEM; auto-generated on first boot
TOKEN_PEPPER=change-me                # HMAC pepper for API token hashing
ANTHROPIC_API_KEY=                    # optional: enables server-paid audits (credit ledger)
AUDIT_MODEL=claude-sonnet-5
AUDIT_MAX_DIFF_BYTES=400000           # truncate diffs sent to the model beyond this
PUBLIC_URL=http://localhost:4873      # used in packument tarball URLs
```

### 4.2 Database schema (SQLite)

Write as `db/schema.sql`, applied by a migration runner that tracks
`migrations(name TEXT PRIMARY KEY, applied_at)`. Types below are the source of truth.

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,        -- [a-z0-9-], 3..32 chars
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,                -- argon2id (use `argon2` package)
  audit_credits INTEGER NOT NULL DEFAULT 5,   -- stubbed payment: free starter credits
  created_at INTEGER NOT NULL                 -- unix ms, everywhere below too
);

CREATE TABLE tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,      -- sha256(token + TOKEN_PEPPER) hex
  name TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE packages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,            -- validate against npm name rules
  owner_id INTEGER REFERENCES users(id),-- NULL for proxied upstream packages
  access TEXT NOT NULL DEFAULT 'private',  -- 'private' | 'public' | 'proxied'
  created_at INTEGER NOT NULL
);

CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES packages(id),
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,          -- the version's package.json as published
  tarball_path TEXT,                    -- NULL until cached (proxied pkgs cache lazily)
  tarball_sha512 TEXT NOT NULL,         -- SRI: "sha512-<base64>"
  size_bytes INTEGER NOT NULL,
  published_by INTEGER REFERENCES users(id),   -- NULL for proxied
  published_at INTEGER NOT NULL,        -- for proxied: upstream time field
  download_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',-- 'active' | 'unpublished'
  UNIQUE(package_id, version)
);
-- IMPORTANT: rows are never deleted. 'unpublished' versions are tombstones:
-- their tarball file is deleted, but the (package, version) pair is burned forever
-- and can never be re-published (prevents content-swap attacks).

CREATE TABLE collaborators (
  package_id INTEGER NOT NULL REFERENCES packages(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,                   -- 'read' | 'publish' | 'admin'
  added_at INTEGER NOT NULL,
  PRIMARY KEY (package_id, user_id)
);

CREATE TABLE scores (
  version_id INTEGER PRIMARY KEY REFERENCES versions(id),
  heuristic_score INTEGER NOT NULL,     -- 0..100
  grade TEXT NOT NULL,                  -- 'A'..'F'
  report_json TEXT NOT NULL,            -- ScoreReport (see §6.3)
  computed_at INTEGER NOT NULL,
  engine_version TEXT NOT NULL          -- bump when rubric changes to invalidate caches
);

CREATE TABLE audits (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions(id),
  status TEXT NOT NULL,                 -- 'queued' | 'running' | 'done' | 'failed'
  model TEXT NOT NULL,
  requested_by INTEGER REFERENCES users(id),
  paid_with TEXT NOT NULL,              -- 'byok' | 'credits'
  verdict TEXT,                         -- 'clean' | 'suspicious' | 'malicious' (when done)
  ai_score INTEGER,                     -- 0..100
  report_json TEXT,                     -- AuditReport (see §7.2)
  signature TEXT,                       -- base64 Ed25519 over canonical JSON (see §7.3)
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE maintainer_events (      -- feeds "recent maintainer change" scoring signal
  id INTEGER PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES packages(id),
  actor TEXT NOT NULL,                  -- username or upstream maintainer name
  action TEXT NOT NULL,                 -- 'added' | 'removed' | 'first-publish'
  at INTEGER NOT NULL
);
```

### 4.3 npm-compatible endpoints (so stock `npm` works against us)

These must accept/emit the shapes the real npm CLI uses:

- `GET /:name` → **packument**: `{ name, dist-tags, versions: { [v]: manifest }, time }`.
  Each version manifest's `dist` = `{ tarball: "<PUBLIC_URL>/<name>/-/<name>-<v>.tgz",
  integrity, shasum? }`. Add our extension block per version:
  `manifest.tnpm = { score, grade, audit: { verdict, score } | null, permissions }`.
  Auth rules: `public`/`proxied` packages are world-readable; `private` requires a token
  belonging to owner or a collaborator.
- `GET /:name/-/:name-:version.tgz` → tarball bytes. Increments
  `versions.download_count` (this is the "installs" counter used by unpublish policy).
  For proxied packages not yet cached: stream from upstream, tee to disk, verify integrity.
- `PUT /:name` → npm publish payload (`versions`, `_attachments` with base64 tarball,
  `dist-tags`). Behavior in §4.4.
- `GET /-/ping` → `{}` (npm uses it).
- `PUT /-/user/org.couchdb.user::username` → npm's legacy login. Implement it to return
  `{ token }` so `npm login --registry` also works, but the primary auth flow is §4.5.

**Upstream proxy (read-through):** on `GET /:name` miss (no local `packages` row, or row
with `access='proxied'` whose cached packument is older than 5 minutes), fetch
`UPSTREAM_REGISTRY/:name`, upsert `packages(access='proxied')` + `versions` rows (manifest,
integrity, published_at from upstream `time`), rewrite tarball URLs to point at us, return.
If upstream 404s and we have nothing → 404. If upstream is unreachable → serve stale cache
if present, else 502. Also fetch upstream weekly download counts
(`https://api.npmjs.org/downloads/point/last-week/:name`) lazily, cache 1 day, for scoring.

### 4.4 Publish flow (`services/publish.ts`)

1. Authenticate (bearer token). Validate payload with zod; extract manifest + tarball.
2. Name rules: lowercase, npm-legal, not equal to an upstream-proxied *popular* name unless
   you already own it locally (prevents shadowing: if the name exists upstream at all and
   has >10k weekly downloads, reject with 409 `E_NAME_SHADOWS_UPSTREAM`).
3. Reject if `(package, version)` already exists **in any status** (tombstones burn
   versions) → 409 `E_VERSION_BURNED` / `E_VERSION_EXISTS`.
4. New package: create row with `access='private'` (Theo: private by default), owner =
   publisher, `maintainer_events(action='first-publish')`. Existing: require role
   `publish`+. `--public` maps to manifest field `tnpm.access: "public"` honored only on
   first publish; later changes go through `PATCH /api/v1/packages/:name` (admin role).
5. Store tarball, compute sha512 SRI + size, insert `versions` row.
6. **Synchronously** run the heuristic scoring engine (§6) on the tarball; insert `scores`
   row. Target < 2s for typical packages; it's just static analysis.
7. Return `{ ok, name, version, score, grade }` so the CLI can print the score at publish
   time.

### 4.5 Auth & sharing API (`/api/v1`)

All JSON; errors are `{ error: { code: string, message: string } }` with proper HTTP status.
Error `code` values are stable API surface — the CLI switches on them.

- `POST /api/v1/auth/register` `{username, email, password}` → `{token, user}`
  (auto-login; token shown once, stored hashed).
- `POST /api/v1/auth/login` `{username, password}` → `{token, user}`
- `GET  /api/v1/whoami` → `{username, email, audit_credits}`
- `POST /api/v1/packages/:name/collaborators` `{username, role}` (admin only) → 204.
  Records `maintainer_events('added')`.
- `DELETE /api/v1/packages/:name/collaborators/:username` (admin only) → 204. Records event.
- `GET /api/v1/packages/:name/collaborators` (read+) → `[{username, role}]`
- `PATCH /api/v1/packages/:name` `{access}` (admin) → change private↔public.

### 4.6 Threshold-based unpublish (`services/unpublish.ts`)

- `DELETE /api/v1/packages/:name/versions/:version` (role publish+):
  eligible iff `download_count < 100` **OR** `now - published_at < 5h`
  (README: "fewer than 100 installs **or** live less than 5 hours").
  Effect: `status='unpublished'`, delete tarball file, keep row forever (burned),
  remove from packument `versions` (but list under a `tnpm.tombstones` array),
  retarget `dist-tags` pointing at it to the highest remaining active version (or drop the
  tag if none). Ineligible → 403 `E_UNPUBLISH_THRESHOLD` with `{downloads, ageHours}` detail.
- `DELETE /api/v1/packages/:name` → allowed only if **every** active version is eligible;
  tombstones all of them. The name remains owned (squat-grief prevention) for 30 days, then
  a background job releases ownership but keeps version tombstones.
- Downloads by the package's own collaborators are still counted (keep it simple; document).

### 4.7 Audit endpoints

- `POST /api/v1/packages/:name/versions/:version/audit` body `{model?}`, optional header
  `x-anthropic-key: <user's own key>` →
  BYOK if header present (`paid_with='byok'`), else requires `audit_credits > 0`
  (decrement; `paid_with='credits'`; 402 `E_NO_CREDITS` if broke or server has no
  `ANTHROPIC_API_KEY`). Dedupe: if a `done` audit exists for this version+model, return it;
  if `queued/running`, return that one. → `{auditId, status}`.
- `GET /api/v1/audits/:id` → full audit row incl. `report_json`, `signature`.
- `GET /api/v1/packages/:name/versions/:version/audit` → latest audit for version or 404.
- `GET /api/v1/keys/public` → `{ keyId, publicKeyPem, algorithm: "ed25519" }`.

### 4.8 The report endpoint (single source of truth for the gate)

`GET /api/v1/packages/:name/report?version=<range|tag|exact>` → resolves the version
(semver range/dist-tag → concrete version) and returns **`GateReport`** — the exact JSON the
CLI renders and agents consume:

```ts
interface GateReport {
  schemaVersion: 1;
  package: { name: string; version: string; description?: string };
  resolved: { requested: string; via: 'exact' | 'range' | 'dist-tag' };
  publisher: { username: string | null; source: 'local' | 'upstream' };
  publishedAt: string;               // ISO
  ageHours: number;
  sizeBytes: number;                 // tarball size
  unpackedSizeBytes: number | null;
  downloads: { local: number; upstreamWeekly: number | null };
  repository: string | null;
  license: string | null;
  installScripts: string[];          // e.g. ["postinstall"] — from manifest.scripts
  permissions: {
    declared: Permission[];          // manifest.tnpm.permissions ?? []
    detected: Permission[];          // scanner output (§6.2)
    undeclared: Permission[];        // detected − declared
  };
  score: { heuristic: number; grade: Grade; findings: ScoreFinding[] } | null;
  audit: {                           // null if never audited
    verdict: 'clean' | 'suspicious' | 'malicious';
    score: number; model: string; completedAt: string;
    summary: string; signature: string; keyId: string;
  } | null;
  maintainers: { current: string[]; recentChanges: MaintainerEvent[] };  // last 90 days
  typosquat: { suspect: boolean; similarTo: string | null; distance: number | null };
  tombstonedVersions: string[];
  effectiveRisk: Grade;              // min(heuristic grade, audit-derived grade), see §6.4
}
```

## 5. CLI (`@tnpm/cli`)

Two bins from one package: `tnpm` (package manager UX) and `tnpx` (runner). Both share
config, client, and gate code. Global flags: `--registry <url>`, `--json`, `--yes`.

### 5.1 Config & state (all under `~/.config/tnpm/`)

- `config.json` — `{ registry: string, token?: string, riskThreshold: Grade /* default 'C' */,
  registryKey?: { keyId, publicKeyPem } /* TOFU-pinned on first use, see §7.3 */ }`
- `trust.json` — tnpx allowlist: `[{ name, version, integrity, decidedAt }]`. An entry
  matches only on exact name+version+integrity triple; any change re-prompts.
- Cache dir `~/.cache/tnpm/`: `store/<name>/<version>/` extracted packages for tnpx,
  `tarballs/` verified downloads.
- Env overrides: `TNPM_REGISTRY`, `TNPM_TOKEN`, `TNPM_RISK_THRESHOLD`, `TNPM_AGENT=1`
  (forces non-interactive mode, implies `--json`).

### 5.2 `tnpm` commands

| Command | Behavior |
|---|---|
| `tnpm register` / `tnpm login` / `tnpm logout` / `tnpm whoami` | Auth against `/api/v1/auth/*`; store token in config.json (chmod 600). |
| `tnpm publish [--public] [--audit]` | Pack cwd with `npm pack --json` (into a temp dir), locally run the scoring engine and **show the panel + score before uploading**, confirm (unless `--yes`), then PUT to registry. `--audit` immediately requests an audit (BYOK from `ANTHROPIC_API_KEY` env if set). Print returned score + shareable report URL. |
| `tnpm unpublish <name>[@version] [--yes]` | Calls DELETE endpoints; on 403 threshold error, print the exact numbers ("2,417 downloads ≥ 100 and 72h ≥ 5h — permanent"). |
| `tnpm install [pkg[@range]...]` / alias `add`, `i` | **Gate first, install second.** For each named package: fetch GateReport, render panel, apply policy (§5.4). Then run the real installer: `npm install <args> --registry <our> --userconfig <generated tmp npmrc>` where the tmp npmrc contains `//host/:_authToken=<token>` so private packages resolve. Bare `tnpm install` (no args, lockfile restore) skips gating and just wraps npm. After any install, run `tnpm scan --new` summary (heuristic scan of packages newly added to node_modules, from `npm install --json` output diff) and print a one-line risk summary. |
| `tnpm info <pkg>[@v]` | Human panel of GateReport (or raw JSON with `--json`). |
| `tnpm score <pkg>[@v] [--json]` | Just the score block + findings. |
| `tnpm audit-pkg <pkg>@<v> [--wait] [--model m]` | Request audit; `--wait` polls `GET /api/v1/audits/:id` every 3s until done/failed, then prints verdict + verifies signature. (Named `audit-pkg` to avoid colliding with npm's `audit` muscle memory; also accept `tnpm audit` as alias.) |
| `tnpm share <pkg> --with <username> [--role read\|publish\|admin]` | Collaborators API. Default role `read`. |
| `tnpm unshare <pkg> --with <username>` | Remove collaborator. |
| `tnpm scan [dir]` | Run the local heuristic scanner over a directory or each package in `./node_modules` (no network needed); table of worst offenders. |
| `tnpm config get\|set <key> [value]` | Manage config.json (registry, riskThreshold). |

### 5.3 `tnpx` — the gated runner

`tnpx <pkg>[@version-or-range] [-- args...]`

Pipeline (implement in `run/`):
1. **Resolve & report**: `GET /api/v1/packages/:name/report?version=...`.
2. **Gate** (§5.4). On approval, optionally record in `trust.json` ("always allow this
   exact version").
3. **Fetch**: download tarball, verify SRI integrity against the report, extract to
   `~/.cache/tnpm/store/<name>/<version>/package/`.
4. **Install deps**: in that dir, `npm install --omit=dev --ignore-scripts
   --registry <ours> --userconfig <tmp npmrc>`. If the package or any dep declares install
   scripts, they were already listed in the panel; scripts run **only** if the user passed
   `--allow-scripts` or approved the explicit follow-up prompt. (Default: scripts stay
   disabled; many packages work anyway. This is a deliberate hard-line default.)
5. **Execute**: resolve the bin (manifest `bin` string → that file; map → entry matching
   the package name, else the single entry, else error `E_NO_BIN` listing choices for
   `tnpx <pkg> --bin <name>`). Spawn:
   `node [permission flags] <binfile> <args...>` with stdio inherited, exit code passed
   through. Permission flags (best-effort enforcement, Node >= 22):
   - Always: `--permission`.
   - `fs:read` declared → `--allow-fs-read=<cache-pkg-dir>,<cwd>`; `fs:write` →
     `--allow-fs-write=<cwd>,<os tmpdir>`; `proc` → `--allow-child-process`;
     `native` → `--allow-addons`; `worker` → `--allow-worker`.
   - `net` cannot be restricted by Node — if the package uses net it's shown in the panel;
     no enforcement (document this limitation in `--help` and README).
   - `--no-enforce` skips `--permission` entirely (escape hatch; some tools break under it —
     if the child exits with a Node `ERR_ACCESS_DENIED`, print a hint suggesting
     `--allow <perm>` or `--no-enforce`).
   - `--allow <perm>` (repeatable) grants extra permissions beyond declared ones.
6. Cache hit (same name+version+integrity already extracted, deps installed): skip 3–4;
   still gate (cheap — report may have new audit info; trust.json makes it silent).

### 5.4 Gate policy & exit codes (shared by tnpm install / tnpx)

- Interactive TTY: render panel via @clack/prompts →
  `Run / Abort / Always allow this version`. Red highlights for: grade worse than
  threshold, `undeclared` permissions non-empty, install scripts, `typosquat.suspect`,
  audit verdict != clean, age < 5h.
- Non-interactive (`TNPM_AGENT=1`, `--json`, or no TTY): never prompt.
  - `effectiveRisk` better-or-equal to threshold (default C; `--max-risk` overrides) and
    audit verdict is not `malicious` → proceed.
  - Otherwise → **exit 3**, print GateReport JSON to stdout (always, so the agent can decide),
    diagnostic line to stderr.
- `--report-only` → print GateReport JSON, exit 0, never execute (for agents that want to
  decide themselves).
- `--yes` → skip prompt, proceed regardless of grade **unless** audit verdict is
  `malicious`, which additionally requires `--force-malicious` (make deliberately scary).
- Exit codes (document in `--help`; stable API): `0` ok, `1` unexpected error,
  `2` package/version not found, `3` blocked by risk policy, `4` user aborted at prompt,
  `5` integrity/signature verification failure. Child process exit codes pass through
  as-is (tnpx prefixes its own failures before spawn only).

## 6. Security scoring (in `@tnpm/core`, runs server-side and in `tnpm scan`/`publish`)

### 6.1 Inputs

A scored unit = one extracted tarball + its manifest + registry context
(`RegistryContext`: local downloads, upstream weekly downloads, published_at, maintainer
events, name corpus for typosquat). The engine must be pure/deterministic:
`score(files, manifest, context) → ScoreReport` — unit-testable with fixtures.

### 6.2 Capability scanner (`core/src/scanner/`)

Static scan of all `.js/.cjs/.mjs/.ts` files (skip `.d.ts`, skip files > 2 MB). Use regex +
lightweight AST-free heuristics (do NOT pull in a full parser for v1; precision over
recall is not required — findings feed a score, not a verdict):

| Capability | Detect via (any match) |
|---|---|
| `net` | `require/import` of `http`, `https`, `net`, `dgram`, `tls`, `undici`, `axios`, `node-fetch`; `fetch(` |
| `fs:read` / `fs:write` | `node:fs` import; write if `writeFile|appendFile|createWriteStream|rmSync|unlink|mkdir` matches |
| `proc` | `child_process`, `execa`, `cross-spawn`, `Bun.spawn` |
| `env` | `process.env` reads |
| `native` | `.node` files present, `node-gyp`/`prebuild` in deps or scripts, `bindings` require |
| `shell` | any of `preinstall|install|postinstall|prepare` in manifest.scripts |
| `worker` | `worker_threads` |

Obfuscation signals (separate list, not capabilities): `eval(`, `new Function(`,
`String.fromCharCode` chains (>10 args), hex-escape density > 5% of a file,
base64 literals > 1 KB, single-line files > 5 KB (minified-in-source), Shannon entropy of a
code file > 5.2 bits/byte, `Buffer.from(<literal>, 'base64')` followed by call-execution
within 3 lines. Each hit becomes a `ScoreFinding { id, severity, file, message, evidence }`.

### 6.3 Rubric (start at 100, subtract; floor 0; keep table in code as data, not ifs)

| id | Signal | Penalty |
|---|---|---|
| `install-scripts` | any lifecycle script | −15 |
| `obfuscation-eval` | eval / new Function | −15 |
| `obfuscation-minified` | minified/packed source in tarball | −20 |
| `obfuscation-blob` | large base64/hex blobs or entropy hit | −10 |
| `undeclared-caps` | per capability category detected but not declared | −10 each, cap −30 |
| `no-repository` | no repository/homepage link in manifest | −5 |
| `fresh-package` | age < 72h −10; additionally < 5h −10 more | −10/−20 |
| `maintainer-churn` | maintainer added/removed within 30d | −10 |
| `new-maintainer-publish` | publisher's first publish to this package within 7d of being added | −10 |
| `typosquat` | Damerau-Levenshtein ≤ 2 to a top-1000 package name (bundle a static `top-packages.json` corpus in core; the popular package itself is exempt) | −25 |
| `low-adoption` | upstream weekly + local downloads < 100 | −5 |
| `no-license` | no license field | −3 |

Grades: `A ≥ 90, B ≥ 80, C ≥ 65, D ≥ 50, F < 50`. `ScoreReport = { score, grade,
findings: ScoreFinding[], engineVersion, capabilities: {declared, detected} }`.

### 6.4 Combining with audits → `effectiveRisk`

- audit `malicious` → effectiveRisk `F` and CLI treats as hard-block (see §5.4).
- audit `suspicious` → cap score at 40 (grade ≤ D).
- audit `clean` with ai_score ≥ 80 → lift **one** grade step if heuristic grade was B/C/D
  (audits can vouch, not launder: never lift to A, never lift F).
- no audit → effectiveRisk = heuristic grade.

## 7. AI audit pipeline (`registry/src/services/audit.ts`)

### 7.1 Runner

In-process loop: every 5s pick oldest `queued` audit, mark `running`, execute, mark
`done`/`failed` (store `error`). One at a time (v1). Steps:

1. Load target version tarball + the **previous active version** (by semver) if any.
2. Build the diff: for changed/added text files (≤ `AUDIT_MAX_DIFF_BYTES` total, truncate
   with a note listing omitted files), unified diff via the `diff` npm package; first
   release → full file listing + contents under same budget, prioritizing:
   manifest, lifecycle scripts, entry points, smallest-to-largest.
3. Call Anthropic Messages API (`model = audit.model`), with the heuristic ScoreReport
   included as context. System prompt (keep in `audit-prompt.ts`, exported const so it's
   testable/versionable): instruct the model to look for exfiltration, env harvesting,
   install-script abuse, obfuscated payloads, protestware, dependency confusion, and to
   respond **only** with JSON matching §7.2. Use `max_tokens: 2048`, temperature 0.
4. Parse strictly with zod. One retry on parse failure with an error-correction message.
   Still bad → `failed`.

### 7.2 `AuditReport` (stored as `report_json`)

```ts
{
  schemaVersion: 1,
  verdict: 'clean' | 'suspicious' | 'malicious',
  score: number,            // 0..100 safety
  summary: string,          // 1-3 sentences, shown in panels
  findings: [{ severity: 'info'|'low'|'medium'|'high'|'critical',
               title: string, file?: string, rationale: string }],
  confidence: 'low' | 'medium' | 'high',
  diffTruncated: boolean
}
```

### 7.3 Signing & verification (anti-fake — Theo's requirement)

- Registry boot: load or generate Ed25519 keypair at `SIGNING_KEY_PATH`;
  `keyId = first 8 hex chars of sha256(publicKeyDer)`.
- Sign `canonicalJson({ keyId, package, version, tarballSha512, model, completedAt,
  report })` where `canonicalJson` = recursively key-sorted `JSON.stringify` (implement in
  `core/src/signing.ts`, share both sides). Store base64 signature.
- CLI: on first contact with a registry, fetch `/api/v1/keys/public` and pin it in
  config.json (TOFU). Every displayed audit is verified; mismatch → treat audit as absent
  + loud warning + exit 5 in non-interactive mode. Key changed at registry → refuse until
  `tnpm config set registryKey --refresh` (explicit re-pin).

## 8. Testing strategy

- **Unit (core)**: scoring rubric table-driven tests; scanner against fixture files (one
  fixture per capability + obfuscation signal); canonical JSON + sign/verify roundtrip;
  typosquat distance.
- **Integration (registry)**: Fastify `inject()` against a temp SQLite file per test:
  register→publish→packument→tarball→download-count; publish name-shadowing rejection;
  version burning; unpublish threshold matrix (99 dl/4h ✓, 100 dl/4h ✓ by age, 100 dl/6h ✗);
  private access control (owner ✓, stranger 404 — return 404 not 403 for private packages
  to avoid name disclosure); collaborator roles; proxy with mocked upstream (use `undici`'s
  `MockAgent`); audit runner end-to-end with a **mocked Anthropic client** (inject the
  client into the service; never call the real API in tests).
- **E2E (`e2e/`)**: vitest spec that spawns the built registry on an ephemeral port, then
  drives the **built** CLI (`node dist/tnpm.js ...`) as child processes with
  `TNPM_AGENT=1` against fixture packages: `hello-pkg` (clean, has bin) → publish, install,
  tnpx runs and prints; `evil-pkg` (eval + undeclared net + postinstall) → tnpx exits 3
  with parseable GateReport JSON; `scripts-pkg` → scripts blocked by default. Snapshot the
  JSON shapes (with volatile fields normalized).
- CI (`.github/workflows/ci.yml`): Node 22, pnpm, `pnpm lint && pnpm typecheck &&
  pnpm test && pnpm build && pnpm e2e`.

## 9. Threat-model notes & known v1 limitations (document in README when done)

- Scanner is heuristic; determined attackers evade it. The AI audit is the deeper layer;
  neither is a guarantee. Never present the score as proof of safety.
- `tnpm install` gates the packages you *name*; the transitive tree is only summarized
  post-install by `tnpm scan`. Full-tree pre-gating needs a resolver (v2).
- Node permission flags don't cover network; `net` is disclosure-only.
- Tokens are bearer tokens over whatever transport the registry runs on — deploy behind
  TLS; `PUBLIC_URL` should be https in production.
- Credits ledger is a stub for the payment integration point (`services/credits.ts` is the
  only file that would change for Stripe).
- The top-1000 typosquat corpus is a static snapshot; refresh it manually when needed.
