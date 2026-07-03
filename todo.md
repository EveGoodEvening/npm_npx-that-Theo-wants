# TODO / Progress tracker

> Companion to `design.md` (read that first — section references like §4.4 point there).
> Rules for implementing agents:
> 1. Work phases in order; within a phase, tasks are ordered by dependency.
> 2. Mark a task `[x]` only when its **Accept** criteria pass locally. Add nothing else to
>    the task line; put notes in the Decisions log at the bottom.
> 3. Every phase ends with a "Phase gate" — all listed commands must succeed from repo root.
> 4. Commit at least once per completed task (small commits, message `P<phase>.<n>: <what>`).
> 5. If you must deviate from design.md, update design.md in the same commit and add a
>    Decisions-log entry explaining why.

## Phase 0 — Scaffolding

- [ ] **P0.1 Workspace skeleton**: root `package.json` (private, `"type": "module"`, scripts
      `build/test/lint/format/typecheck/e2e` fanning out via `pnpm -r`), `pnpm-workspace.yaml`
      (`packages/*`, `e2e`), `tsconfig.base.json` (strict, NodeNext, ES2022 target,
      declaration on), `.gitignore` (node_modules, dist, data/, *.sqlite, .env),
      `biome.json` (recommended rules, 100-col width).
      **Accept**: `pnpm install` clean; `pnpm lint` passes on empty repo.
- [ ] **P0.2 Package stubs**: `packages/core`, `packages/registry`, `packages/cli` each with
      `package.json` (names `@tnpm/core|registry|cli`, ESM, `exports`, `dist/` build via
      `tsc -b`), `src/index.ts` placeholder, project references wired
      (`cli`/`registry` → `core`). `cli` declares `"bin": { "tnpm": "dist/tnpm.js",
      "tnpx": "dist/tnpx.js" }`.
      **Accept**: `pnpm build` emits dist in all three; `pnpm typecheck` passes.
- [ ] **P0.3 Repo docs & env**: create `CLAUDE.md` (repo-level: pnpm commands, Node >= 22
      requirement, "read design.md first", empty `## Lessons` section) and `env.example`
      with every var from §4.1 (exact filename `env.example`, no leading dot).
      **Accept**: files exist; `env.example` lists all 9 vars.
- [ ] **P0.4 CI**: `.github/workflows/ci.yml` per §8 (Node 22 + pnpm cache; lint,
      typecheck, test, build, e2e as separate steps).
      **Accept**: `act`-style dry run not required; YAML is valid (`node -e` yaml parse or
      review) and step commands match root scripts.

**Phase gate**: `pnpm install && pnpm lint && pnpm typecheck && pnpm build`

## Phase 1 — Core library (`@tnpm/core`)

- [ ] **P1.1 Types module** (`src/types.ts`): `Permission` union
      (`net|fs:read|fs:write|proc|env|native|shell|worker`), `Grade`, `ScoreFinding`,
      `ScoreReport`, `GateReport` (§4.8), `AuditReport` (§7.2), error-code const enum
      (`E_VERSION_BURNED`, `E_UNPUBLISH_THRESHOLD`, `E_NO_CREDITS`,
      `E_NAME_SHADOWS_UPSTREAM`, `E_NO_BIN`, ...), plus zod schemas for each JSON shape
      (schemas are the runtime source of truth; infer TS types from them).
      **Accept**: unit test parses a hand-written valid GateReport fixture and rejects a
      broken one.
- [ ] **P1.2 Capability scanner** (`src/scanner/`): implement §6.2 detection tables +
      obfuscation signals. Input: `{path, content}[]` + manifest. Output: capabilities +
      findings. Include entropy helper with its own test.
      **Accept**: fixture-driven tests — ≥ 1 fixture file per capability row and per
      obfuscation signal, plus a clean file that yields zero findings.
- [ ] **P1.3 Scoring engine** (`src/scoring/`): rubric as a data table (§6.3), pure
      function `score(files, manifest, context)`, grade mapping, `engineVersion` const.
      Include Damerau-Levenshtein + bundled `top-packages.json` (hand-pick ~1000 names from
      memory/upstream; a plain JSON array; exactness doesn't matter, include the obvious
      giants: react, lodash, express, chalk, is-odd...).
      **Accept**: table-driven tests: clean package → A; each rubric row individually
      triggers its penalty; typosquat `expresss` flags, `express` itself doesn't;
      floor at 0.
- [ ] **P1.4 Signing** (`src/signing.ts`): `canonicalJson`, Ed25519 `sign`/`verify`
      (node:crypto), `keyId` derivation (§7.3).
      **Accept**: roundtrip test; verify fails on 1-byte tamper; canonicalJson stable under
      key reordering.
- [ ] **P1.5 Registry client** (`src/client.ts`): typed fetch wrapper for every endpoint in
      §4.3/§4.5–4.8 (auth header injection, error envelope → typed `RegistryError` with
      `code`). No CLI/UI concerns here.
      **Accept**: unit tests against `undici` MockAgent for: happy path, error envelope
      mapping, 404 vs network-failure distinction.

**Phase gate**: `pnpm -r --filter @tnpm/core test` green; `pnpm typecheck`.

## Phase 2 — Registry server (`@tnpm/registry`)

- [ ] **P2.1 DB layer**: `schema.sql` exactly per §4.2, migration runner
      (`migrations` table, applies `db/migrations/*.sql` in name order — put schema.sql
      contents in `001_init.sql`), `queries.ts` with typed prepared-statement helpers.
      **Accept**: test boots temp DB, migrations idempotent (run twice), CRUD smoke test.
- [ ] **P2.2 App skeleton + auth**: Fastify app factory (`app.ts`, takes `{dbPath, ...cfg}`
      so tests can inject temp paths), env loading + zod-validated config, bearer-token
      auth decorator, `/api/v1/auth/register|login`, `/api/v1/whoami`, `/-/ping`,
      legacy `PUT /-/user/...` login shim. Argon2id hashing; token = 32 random bytes hex,
      stored as HMAC per §4.2.
      **Accept**: inject tests — register→whoami; bad password 401; duplicate username 409.
- [ ] **P2.3 Storage service** (`services/storage.ts`): tarball write/read/delete under
      `STORAGE_DIR`, sha512 SRI computation, size accounting.
      **Accept**: unit test writes/reads/verifies a fixture tarball.
- [ ] **P2.4 Publish** (§4.4): `PUT /:name` accepting real npm publish payloads
      (grab shape by running `npm publish --dry-run --json` on a fixture or from npm docs),
      private-by-default, name-shadow rejection, version-burn rejection, synchronous
      scoring via core, maintainer_events on first publish.
      **Accept**: inject tests — fresh publish 201 + score in response; republish same
      version 409 `E_VERSION_EXISTS`; publish over tombstone 409 `E_VERSION_BURNED`;
      stranger publishing to existing package 403.
- [ ] **P2.5 Packument + tarball GET** (§4.3): with `tnpm` extension block, private-package
      auth (stranger gets **404**, not 403), download counting on tarball GET, dist-tags.
      **Accept**: inject tests incl. count increments and private 404.
- [ ] **P2.6 Upstream proxy** (§4.3 proxy paragraph): read-through packument + lazy tarball
      cache + integrity verify + stale-if-upstream-down + upstream weekly downloads fetch
      (1-day cache). All upstream HTTP via one injectable `Upstream` interface.
      **Accept**: MockAgent tests — miss→fetch→cache; second hit no upstream call
      (within TTL); upstream 404; upstream down + warm cache → stale serve; tarball
      integrity mismatch → 502 + no cache write.
- [ ] **P2.7 Unpublish** (§4.6): version + whole-package endpoints, threshold matrix,
      tombstoning (row kept, file deleted, packument hides version, `tnpm.tombstones`
      lists it), dist-tag retargeting, 30-day ownership-release background job (job loop
      from §4 — `setInterval`, injectable clock).
      **Accept**: inject tests for the §8 threshold matrix + tombstone visibility +
      dist-tag retarget; job test with fake clock.
- [ ] **P2.8 Sharing & access API** (§4.5): collaborators CRUD + roles enforced on
      publish/read/unpublish paths, `PATCH` access flip, maintainer_events recorded.
      **Accept**: inject tests — read-role can GET private but not publish; admin can
      share; events appear in report's `maintainers.recentChanges`.
- [ ] **P2.9 Score & report endpoints**: `GET .../score`, `GET .../report` (§4.8) with
      version resolution (exact/range/dist-tag), typosquat block, effectiveRisk (§6.4),
      lazy scoring for proxied packages (score on first report request, cached by
      `engine_version`).
      **Accept**: inject tests — report for local pkg matches GateReport zod schema; range
      `^1.0.0` resolves; proxied package gets scored on demand; `engineVersion` bump
      triggers rescore.
- [ ] **P2.10 Audit pipeline** (§7): endpoints (§4.7) with BYOK/credits logic + dedupe,
      runner loop with injectable Anthropic client, diff builder (previous-version unified
      diff, first-release listing, byte budget + truncation note), strict zod parse with
      one retry, signing on completion, `GET /api/v1/keys/public`.
      **Accept**: inject tests with mocked client — queued→done happy path produces
      verifiable signature; malformed model output → one retry → failed; no credits + no
      BYOK → 402; dedupe returns existing audit; diff builder unit tests (budget,
      truncation, first release).
- [ ] **P2.11 Server entrypoint**: `server.ts` — load env, generate signing key if absent,
      run migrations, start app + job loop; `pnpm --filter @tnpm/registry dev` runs it
      with tsx/watch.
      **Accept**: manual smoke — boot, `curl /-/ping`, register via curl, publish fixture
      with real `npm publish --registry http://localhost:4873` (using token from register).

**Phase gate**: `pnpm --filter @tnpm/registry test` green; manual smoke of P2.11 done
(record output snippet in Decisions log).

## Phase 3 — `tnpm` CLI

- [ ] **P3.1 CLI skeleton**: commander setup for both bins, global flags
      (`--registry --json --yes`), config load/save (`~/.config/tnpm/config.json`,
      chmod 600, env overrides per §5.1), `output.ts` (panel rendering + JSON mode +
      no-TTY fallback), error handler mapping `RegistryError` codes → messages + exit
      codes (§5.4).
      **Accept**: `tnpm --help` lists all commands; `tnpm config set/get registry` works;
      `--json` on any command yields parseable JSON only (no ANSI) — assert in test.
- [ ] **P3.2 Auth commands**: register/login/logout/whoami per §5.2.
      **Accept**: e2e-lite test against a spawned temp registry: register→whoami→logout.
- [ ] **P3.3 info / score**: GateReport panel renderer (highlight rules §5.4) + `--json`.
      **Accept**: run against temp registry; snapshot panel for a fixture package
      (strip volatile fields); JSON matches core schema.
- [ ] **P3.4 publish**: `npm pack --json` → local pre-upload score panel + confirm → PUT →
      print returned score; `--public`, `--audit` flags (§5.2).
      **Accept**: test publishes `hello-pkg` to temp registry; `--yes` skips prompt;
      response score printed.
- [ ] **P3.5 unpublish**: threshold-error rendering with server-provided numbers.
      **Accept**: test: publish, download 0 times, unpublish OK; mock a 403
      `E_UNPUBLISH_THRESHOLD` and snapshot message.
- [ ] **P3.6 install/add**: gate-then-wrap flow per §5.2 — named-package gating, temp
      npmrc with `_authToken`, delegate to `npm install --registry`, post-install
      `scan --new` one-liner. Bare `tnpm install` bypasses gate.
      **Accept**: e2e: `tnpm install hello-pkg` in a temp project against temp registry
      (which proxies a mocked upstream) produces working node_modules; blocked package
      (evil-pkg, agent mode) exits 3 before npm runs.
- [ ] **P3.7 share/unshare + audit-pkg**: per §5.2 incl. `--wait` polling and signature
      verification on display (§7.3 TOFU pinning implemented here in client bootstrap).
      **Accept**: e2e: share private pkg to second user, second user installs; audit-pkg
      `--wait` against mocked-audit registry prints verdict; tampered signature → exit 5.
- [ ] **P3.8 scan**: local heuristic scan of dir / node_modules, worst-offenders table,
      `--json`.
      **Accept**: run on fixture node_modules containing evil-pkg → nonzero findings,
      exit 0 (scan reports, doesn't block).

**Phase gate**: `pnpm --filter @tnpm/cli test` green.

## Phase 4 — `tnpx` gated runner

- [ ] **P4.1 Gate + policy engine** (`gate/policy.ts`): pure function
      `decide(report, opts, trustStore, tty) → {action, reason}` implementing §5.4 exactly
      (incl. `--max-risk`, `--report-only`, `--yes`, `--force-malicious`, TNPM_AGENT).
      **Accept**: exhaustive table-driven unit tests over the §5.4 decision matrix.
- [ ] **P4.2 trust.json store**: exact name+version+integrity match; `Always allow`
      writes entry; changed integrity re-prompts.
      **Accept**: unit tests for match/mismatch/persist.
- [ ] **P4.3 Fetch & extract** (`run/fetch.ts`): tarball download, SRI verify (exit 5 on
      mismatch), cache layout per §5.1, dep install with `--ignore-scripts` default +
      `--allow-scripts` path (§5.3 step 4).
      **Accept**: tests: cache hit skips download; corrupted tarball → exit 5; scripts-pkg
      postinstall does NOT run by default (assert side-effect file absent), runs with
      `--allow-scripts`.
- [ ] **P4.4 Execute** (`run/exec.ts`): bin resolution rules (§5.3 step 5, `E_NO_BIN`,
      `--bin`), permission-flag mapping table, `--no-enforce`, `--allow`, exit-code
      passthrough, ERR_ACCESS_DENIED hint.
      **Accept**: e2e: hello-pkg bin runs and its stdout passes through, exit code
      passthrough verified with a fixture bin exiting 7; fs-writing fixture without
      declared `fs:write` fails under enforcement and succeeds with `--allow fs:write`.
- [ ] **P4.5 Wire `tnpx` bin end-to-end** + `--report-only`/`--json` agent surface.
      **Accept**: e2e (agent mode): evil-pkg → exit 3 + valid GateReport JSON on stdout;
      hello-pkg → runs; `--report-only` never executes (assert side-effect absent).

**Phase gate**: full e2e suite (`pnpm e2e`) green, covering the three §8 fixture flows.

## Phase 5 — Hardening & docs

- [ ] **P5.1 Negative-path sweep**: registry — zod-reject bad bodies everywhere, oversized
      tarball limit (50 MB, 413), rate-limit auth endpoints (in-memory bucket, 20/min/IP);
      CLI — friendly errors for: registry down, not logged in, key-pin mismatch.
      **Accept**: tests per case.
- [ ] **P5.2 README rewrite**: keep Theo rationale at bottom; add quickstart (boot
      registry, register, publish, install, tnpx), agent-integration section (exit codes,
      `--report-only`, TNPM_AGENT), limitations from §9.
      **Accept**: every command in README quickstart actually works copy-pasted (verify in
      a scratch dir).
- [ ] **P5.3 Coverage & polish**: `vitest --coverage` ≥ 80% lines in core, ≥ 70% registry;
      `pnpm lint` zero warnings; remove dead code/TODOs.
      **Accept**: coverage thresholds enforced in vitest config; CI green.
- [ ] **P5.4 Final self-review**: re-read design.md top to bottom; every MUST-level
      behavior either implemented or logged as a deviation in Decisions log; update this
      file's checkboxes truthfully.
      **Accept**: no unchecked task above without a Decisions-log entry explaining why.

## Backlog (v2 — do not start without user request)

- Full-tree pre-install gating (own resolver or lockfile-diff gating before linking).
- Real payments (Stripe) replacing `services/credits.ts` stub.
- Web UI for reports/sharing; org/teams; OAuth login.
- AST-based scanner; provenance (repo↔tarball diff); registry federation.
- Windows support; publish signed CLI binaries.

## Decisions log

> Append entries as: `YYYY-MM-DD — P<x.y> — decision — why`. Design deviations MUST also
> patch design.md in the same commit.

- 2026-07-03 — bootstrap — design.md + todo.md authored from README; no code exists yet.
