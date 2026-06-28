# TODO / implementation checklist: `safe-npm` and `safe-npx`

This checklist is written for a coding agent implementing the system step by step. Complete tasks in order unless a task explicitly says it can run in parallel.

Use the design in `design.md` as the source of truth.

---

## 0. Ground rules for the coding agent

- [ ] Do not execute untrusted package code while implementing analyzer/preflight tests.
- [ ] Do not call `npm install <untrusted-package>` as part of preflight. Resolve metadata and download tarballs only.
- [ ] Do not store real payment credentials. Use fake/test payment provider until production integration is explicitly requested.
- [ ] Do not create a binary named `npm` or `npx` by default. Use `safe-npm` and `safe-npx`.
- [ ] Keep every security decision explainable in JSON.
- [ ] Add tests for each security-sensitive branch before moving to the next feature.
- [ ] Prefer exact package versions in tests. Avoid `latest` in repeatable tests except when testing tag resolution itself.

---

## 1. Repository bootstrap

### 1.1 Create monorepo

- [x] Initialize a TypeScript monorepo.
- [x] Add package manager workspace config.
- [x] Create directories:
  - [x] `apps/cli`
  - [x] `apps/registry-api`
  - [x] `apps/web`
  - [x] `apps/workers`
  - [x] `packages/core-types`
  - [x] `packages/npm-compat`
  - [x] `packages/analyzer`
  - [x] `packages/scoring`
  - [x] `packages/auth`
  - [x] `packages/storage`
  - [x] `packages/audit-providers`
  - [x] `packages/sandbox`
  - [x] `infra/migrations`
  - [x] `infra/docker`

### 1.2 Tooling

- [x] Configure TypeScript project references.
- [x] Configure ESLint.
- [x] Configure Prettier.
- [x] Configure unit test runner.
- [x] Configure integration test runner.
- [x] Configure package build output.
- [x] Configure `safe-npm` and `safe-npx` bin entries in `apps/cli/package.json`.
- [x] Add a root `check` script that runs typecheck, lint, and tests.
- [x] Add CI workflow that runs the root `check` script.

### 1.3 Local infrastructure

- [x] Add `docker-compose.yml` for PostgreSQL, Redis, and MinIO.
- [x] Add `.env.example` with local dev values.
- [x] Add a config loader package or module.
- [x] Add startup validation for required environment variables.
- [x] Add local object storage bucket creation script.
- [x] Add database migration command.
- [x] Add seed command for local test user/org.

Definition of done:

- [x] `pnpm install` or chosen equivalent succeeds.
- [x] `pnpm check` or chosen equivalent succeeds.
- [ ] Local infra starts with one command.
- [ ] Empty API service can connect to database, Redis, and object storage.

---

## 2. Shared types and schemas

### 2.1 Core schema package

- [x] Create `packages/core-types`.
- [x] Add Zod schemas and TypeScript types for:
  - [x] `PackageName`
  - [x] `PackageVersion`
  - [x] `PackageSpec`
  - [x] `PublishId`
  - [x] `TarballIntegrity`
  - [x] `Visibility`
  - [x] `VersionStatus`
  - [x] `RiskTier`
  - [x] `RiskReport`
  - [x] `RiskFinding`
  - [x] `PermissionReport`
  - [x] `PolicySet`
  - [x] `PolicyDecision`
  - [x] `AuditJob`
  - [x] `AuditAttestation`
  - [x] `StageRecord`
  - [x] `RetractionRecord`

### 2.2 JSON compatibility

- [x] Ensure every schema can parse from JSON.
- [x] Ensure every schema serializes to stable JSON.
- [x] Add tests for invalid values.
- [x] Add tests for backward-compatible optional fields.

### 2.3 Error model

- [x] Define `SafeNpmError` base shape.
- [x] Define error codes:
  - [x] `PACKAGE_NOT_FOUND`
  - [x] `VERSION_NOT_FOUND`
  - [x] `TARBALL_INTEGRITY_FAILED`
  - [x] `POLICY_BLOCKED`
  - [x] `HUMAN_APPROVAL_REQUIRED`
  - [x] `AUDIT_REQUIRED`
  - [x] `SANDBOX_UNAVAILABLE`
  - [x] `RETRACTION_NOT_ELIGIBLE`
  - [x] `AUTH_REQUIRED`
  - [x] `FORBIDDEN`
  - [x] `RATE_LIMITED`
- [x] Add `toHttpStatus` mapping.
- [x] Add `toCliExitCode` mapping.

Definition of done:

- [ ] API, CLI, analyzer, and scoring packages import the same schemas.
- [x] Error objects include `code`, `message`, `details`, and optional `remediation`.

---

## 3. npm compatibility package

### 3.1 Package spec parsing

- [x] Add dependency on `npm-package-arg` or implement equivalent wrapper.
- [x] Implement `parsePackageSpec(input: string)`.
- [x] Support:
  - [x] unscoped names
  - [x] scoped names
  - [x] exact versions
  - [x] dist-tags
  - [x] semver ranges
- [x] Reject unsupported sources in strict mode:
  - [x] git
  - [x] file
  - [x] directory
  - [x] remote tarball
- [x] Add tests for all spec types.

### 3.2 Registry metadata fetching

- [x] Implement `fetchPackument(registryUrl, packageName)`.
- [x] Implement ETag/If-None-Match cache support.
- [x] Implement `resolveVersion(packument, spec)`.
- [x] Implement dist-tag resolution.
- [x] Implement semver range resolution.
- [x] Add tests using fixture packuments.

### 3.3 Tarball fetching

- [x] Implement `downloadTarball(url, destination, expectedIntegrity?)`.
- [x] Verify SHA-512 integrity when available.
- [x] Verify SHA-1 shasum when SHA-512 is unavailable.
- [x] Add timeout and max-size guard.
- [x] Add tests for good integrity.
- [x] Add tests for integrity mismatch.
- [x] Add tests for oversized tarball block.

### 3.4 Packument generation

- [x] Define internal package/version model to npm packument converter.
- [x] Include `dist-tags`.
- [x] Include `versions`.
- [x] Include `time`.
- [x] Include `dist.tarball`.
- [x] Include `dist.integrity`.
- [x] Include `dist.signatures` when present.
- [x] Exclude retracted versions from normal packuments.
- [x] Include deprecation warnings for deprecated versions.
- [x] Add snapshot tests for generated packuments.

Definition of done:

- [x] The package can resolve and download a public npm tarball without executing code.
- [ ] The package can generate packuments accepted by `pacote` in tests.

---

## 4. Tarball quarantine and analyzer MVP

### 4.1 Quarantine cache

- [x] Create a local cache directory under OS-specific cache path.
- [x] Store tarballs by integrity digest.
- [x] Store unpacked contents by integrity digest.
- [x] Ensure unpack path is never inside the current project by default.
- [x] Add cache lock to prevent concurrent corruption.
- [x] Add cache cleanup command.

### 4.2 Safe tar extraction

- [x] Implement tar extraction that rejects absolute paths.
- [x] Reject `..` path traversal.
- [x] Reject symlink traversal unless explicitly allowed for analysis metadata only.
- [x] Reject hardlink traversal.
- [x] Add fixture tests with malicious tar paths.

### 4.3 Metadata analyzer

- [x] Extract `package.json`.
- [x] Validate name/version against resolved package.
- [x] Extract fields:
  - [x] name
  - [x] version
  - [x] description
  - [x] license
  - [x] author
  - [x] contributors
  - [x] maintainers from packument
  - [x] repository
  - [x] homepage
  - [x] bugs
  - [x] main
  - [x] exports
  - [x] bin
  - [x] scripts
  - [x] dependencies
  - [x] devDependencies
  - [x] optionalDependencies
  - [x] peerDependencies
  - [x] bundledDependencies
- [x] Count files.
- [x] Compute packed size.
- [x] Compute unpacked size.
- [x] Detect common binary file types.
- [x] Detect `.node` native addons.
- [x] Detect `binding.gyp`.

### 4.4 Script analyzer

- [x] Detect lifecycle scripts:
  - [x] `preinstall`
  - [x] `install`
  - [x] `postinstall`
  - [x] `prepare`
  - [x] `prepublish`
  - [x] `prepublishOnly`
- [x] Flag shell metacharacters.
- [x] Flag network tools in scripts:
  - [x] `curl`
  - [x] `wget`
  - [x] `nc`
  - [x] `ssh`
  - [x] `scp`
- [x] Flag package manager commands inside install scripts.
- [x] Flag `node-gyp` implicit native build when `binding.gyp` is present.
- [x] Add tests for package fixtures with and without scripts.

### 4.5 Static JS analyzer MVP

- [x] Parse `.js`, `.mjs`, `.cjs`, `.ts`, and `.tsx` files where feasible.
- [x] Do not fail entire analysis when one file cannot parse; emit finding with confidence.
- [x] Detect imports/requires of:
  - [x] `fs` / `node:fs`
  - [x] `child_process` / `node:child_process`
  - [x] `http` / `node:http`
  - [x] `https` / `node:https`
  - [x] `net` / `node:net`
  - [x] `dns` / `node:dns`
  - [x] `dgram` / `node:dgram`
  - [x] `os` / `node:os`
  - [x] `crypto` / `node:crypto`
- [x] Detect `process.env` access.
- [x] Detect common secret names.
- [x] Detect `eval`.
- [x] Detect `new Function`.
- [x] Detect dynamic import with nonliteral argument.
- [x] Detect base64 decode followed by eval/function/spawn where obvious.
- [x] Add file/line evidence where possible.

### 4.6 Obfuscation/readability MVP

- [x] Compute minified-line ratio.
- [x] Compute average identifier length where AST parse succeeds.
- [x] Compute string entropy for long strings.
- [x] Flag giant string arrays.
- [x] Flag source map availability.
- [x] Produce `readability` facts:
  - [x] `likelyMinified`
  - [x] `likelyObfuscated`
  - [x] `sourceMapsPresent`
  - [x] `humanReadableFileRatio`
- [x] Add tests for minified, obfuscated-like, and normal fixtures.

Definition of done:

- [x] Analyzer returns a stable `AnalysisReport` for a tarball digest.
- [x] Analyzer never executes package code.
- [x] Analyzer emits evidence paths for high-severity findings.

---

## 5. Scoring MVP

### 5.1 Scoring package

- [x] Create `packages/scoring`.
- [x] Implement deterministic `scoreAnalysis(report)`.
- [x] Start from score 100.
- [x] Deduct for:
  - [x] install scripts
  - [x] native addons/binaries
  - [x] child process usage
  - [x] network usage
  - [x] env/secret access
  - [x] dynamic code execution
  - [x] obfuscation/readability issues
  - [x] missing repository
  - [x] missing license
  - [x] package size anomaly placeholder
- [x] Add blockers for:
  - [ ] integrity mismatch
  - [x] known malware placeholder flag
  - [x] high-confidence exfiltration fixture
- [x] Map score to tier.
- [x] Compute confidence.

### 5.2 Risk report renderer

- [x] Implement JSON renderer.
- [x] Implement TTY summary renderer.
- [x] Include at minimum:
  - [x] package name/version
  - [x] tarball size
  - [x] unpacked size
  - [x] file count
  - [x] author/publisher when available
  - [x] maintainers when available
  - [x] bin command
  - [x] install scripts
  - [x] score/tier/confidence
  - [x] permissions inferred
  - [x] warnings/blockers
- [x] Add snapshot tests for risk reports.

### 5.3 Policy engine MVP

- [x] Define default human policy.
- [x] Define default agent policy.
- [x] Implement `evaluatePolicy(riskReport, action, policy)`.
- [x] Support actions:
  - [x] `install`
  - [x] `exec`
  - [x] `publish`
- [x] Support rules:
  - [x] minimum score
  - [x] blocked tiers
  - [x] require no blockers
  - [x] allow/disallow install scripts
  - [x] allow/disallow native binaries
  - [x] require exact version
  - [x] disallow `latest`
  - [x] require permission enforcement
- [x] Add tests for allow/warn/block/approval-required decisions.

Definition of done:

- [x] Given an analyzer report, scoring produces a deterministic risk report.
- [x] Given a risk report and policy, policy engine produces a deterministic decision.

---

## 6. CLI vertical slice: public package preflight

### 6.1 CLI scaffold

- [x] Implement `safe-npm --version`.
- [x] Implement `safe-npx --version`.
- [x] Implement global flags:
  - [x] `--json`
  - [x] `--registry <url>`
  - [x] `--policy <path>`
  - [x] `--agent`
  - [x] `--yes`
  - [x] `--no`
  - [x] `--verbose`
  - [x] `--debug`
- [x] Implement structured error output for JSON mode.

### 6.2 `safe-npm view --risk`

- [x] Parse package spec.
- [x] Fetch packument from registry.
- [x] Resolve exact version.
- [x] Download tarball to quarantine cache.
- [x] Run analyzer.
- [x] Run scoring.
- [x] Print risk report.
- [x] Add `--json` output.
- [x] Add tests with mocked registry.

### 6.3 `safe-npx preflight`

- [x] Implement `safe-npx preflight <pkg>[@version]`.
- [x] Reuse view-risk pipeline.
- [x] Resolve bin name using npm-compatible rules:
  - [x] single bin entry
  - [x] multiple aliases to same command
  - [x] bin matching unscoped package name
  - [x] error when ambiguous
- [x] Include bin decision in report.
- [x] Add JSON output.
- [x] Add tests for bin resolution.

### 6.4 `safe-npx <pkg>` no-exec prompt

- [x] Implement command path that preflights first.
- [x] If policy blocks, exit with code `11`.
- [x] If policy requires approval in agent mode, exit with code `10`.
- [x] If policy requires approval in TTY, prompt user.
- [x] Support `[y]es`, `[n]o`, `[d]etails`.
- [x] Do not execute child package yet. For this step, print `execution would start` after approval.
- [x] Add tests for prompt decisions using stdin fixtures.

Definition of done:

- [x] `safe-npx preflight is-odd@latest --json` returns valid JSON.
- [x] `safe-npm view is-odd --risk` renders a human risk card.
- [x] `safe-npx is-odd@latest --agent` exits deterministically based on policy.

---

## 7. Registry API and persistence MVP

### 7.1 Database migrations

- [x] Add migration for users.
- [x] Add migration for orgs.
- [x] Add migration for memberships.
- [x] Add migration for packages.
- [x] Add migration for package_versions.
- [x] Add migration for version_aliases.
- [x] Add migration for dist_tags.
- [x] Add migration for risk_reports.
- [x] Add migration for permission_reports.
- [x] Add migration for audit_logs.
- [x] Add migration for auth tokens.
- [x] Add migration tests or migration smoke test.

### 7.2 Storage layer

- [x] Implement repository for users.
- [x] Implement repository for orgs.
- [x] Implement repository for packages.
- [x] Implement repository for versions.
- [x] Implement repository for dist-tags.
- [x] Implement repository for risk reports.
- [x] Implement object store client.
- [x] Implement object key scheme:
  - [x] `tarballs/<sha512>.tgz`
  - [x] `analysis/<sha512>/<analyzer-version>.json`
  - [x] `attestations/<digest>.json`
- [x] Add tests using local MinIO or object-store mock.

### 7.3 API scaffold

- [x] Create Fastify API app.
- [x] Add health endpoint.
- [x] Add readiness endpoint.
- [x] Add request ID middleware.
- [x] Add structured logging.
- [x] Add error handler.
- [x] Add rate-limit middleware placeholder.
- [ ] Add OpenAPI generation.

### 7.4 Auth MVP

- [x] Implement local dev login endpoint.
- [x] Implement bearer token auth.
- [x] Implement token hashing at rest.
- [x] Implement token scopes.
- [x] Implement RBAC guard helper.
- [x] Seed local test user/org/token.
- [x] Add tests for auth required and forbidden responses.

Definition of done:

- [ ] API starts locally.
- [ ] API can authenticate a bearer token.
- [ ] API can read/write database and object storage.

---

## 8. Private publish MVP

### 8.1 CLI pack command

- [x] Implement `safe-npm publish` command skeleton.
- [x] Run `npm pack --json --dry-run` or equivalent to preview contents.
- [x] Run actual pack into temp directory.
- [x] Compute integrity.
- [x] Run local analyzer before upload.
- [x] Show local publish summary.
- [x] Default visibility to `private`.
- [x] Require `--public` or `--stage-public` for public intent.

### 8.2 Publish API

- [x] Implement `POST /v1/packages` or `POST /v1/packages/:name/versions`.
- [x] Validate auth scope.
- [x] Validate package name.
- [x] Validate version.
- [x] Validate tarball integrity.
- [x] Store tarball object.
- [x] Create package if absent.
- [x] Create package version with new `publish_id`.
- [x] Set `version_aliases` active publish ID.
- [x] Set default dist-tag if provided.
- [x] Store initial analysis and risk report if provided; otherwise enqueue analysis.
- [ ] Audit log publish.

### 8.3 Packument endpoint

- [x] Implement `GET /<encoded-package-name>`.
- [x] Enforce ACL for private package.
- [x] Generate packument.
- [x] Include only versions visible to caller.
- [x] Exclude retracted versions.
- [x] Include tarball URLs pointing to publish ID or digest-specific path.
- [ ] Add tests with npm-compatible client or `pacote`.

### 8.4 Tarball endpoint

- [x] Implement `GET /<encoded-package-name>/-/<tarball-name>.tgz`.
- [x] Resolve tarball to package version/publish ID.
- [x] Enforce ACL.
- [x] Stream from object storage.
- [x] Set content type.
- [x] Set immutable cache headers for digest/publish-ID URLs.
- [ ] Verify object digest before response in dev/test or background job.

### 8.5 CLI install integration

- [x] Implement `safe-npm install <pkg>` using private registry first.
- [x] Write temporary `.npmrc` or pass `--registry` to delegated npm command.
- [x] Run preflight before delegation.
- [x] Respect policy decision.
- [x] Delegate to npm only after approval.
- [ ] Add integration test installing a private fixture package.

Definition of done:

- [ ] `safe-npm publish` publishes a package privately to local registry.
- [ ] `safe-npm install @scope/pkg` can install it from local registry after preflight.
- [ ] Unauthenticated users cannot read private packument or tarball.

---

## 9. Registry signatures MVP

### 9.1 Key management

- [x] Generate local dev ECDSA P-256 signing key.
- [x] Store dev key outside source control.
- [x] Implement key ID calculation.
- [x] Implement `GET /-/npm/v1/keys`.
- [x] Add key rotation data model placeholder.

### 9.2 Sign dist metadata

- [x] Implement signing payload as package name, version, publish ID, and tarball integrity.
- [ ] Store signature with package version.
- [x] Include signature in packument `dist.signatures`.
- [x] Add tests for signature creation.
- [x] Add tests for signature verification.

### 9.3 CLI verification

- [x] Implement verification helper for registry signatures.
- [ ] In `safe-npm install` preflight, verify signatures when registry has keys.
- [ ] Add blocker on missing signature if registry advertises signatures and policy requires it.

Definition of done:

- [x] Local registry exposes keys.
- [x] Packuments include signatures.
- [ ] CLI can verify signatures before install/exec.

---

## 10. Worker system

### 10.1 Queue setup

- [x] Add queue library.
- [x] Define job types:
  - [x] `analyze-tarball`
  - [x] `score-version`
  - [x] `rollup-install-counts`
  - [x] `audit-package`
  - [x] `sign-version`
- [x] Add worker process entrypoint.
- [x] Add retry/backoff policy.
- [x] Add dead-letter handling.
- [x] Add idempotency keys per job.

### 10.2 Analyzer worker

- [x] Fetch tarball by object key.
- [x] Run analyzer.
- [x] Store analysis artifact.
- [ ] Store permission report.
- [x] Enqueue score job.
- [x] Mark job success/failure.

### 10.3 Score worker

- [x] Load analysis artifact.
- [ ] Load package/version metadata.
- [x] Generate risk report.
- [x] Store risk report.
- [x] Update package/version summary fields.

### 10.4 Signature worker

- [x] Sign new package version after tarball storage.
- [ ] Store signature metadata.
- [x] Trigger packument cache invalidation.

Definition of done:

- [ ] Publishing a package enqueues analysis and signature jobs.
- [ ] Risk report is eventually available through API.
- [ ] Failed jobs are visible and retryable.

---

## 11. Diff analysis

### 11.1 Previous version selection

- [x] Implement function to find previous visible version in same package.
- [x] Prefer previous semver version lower than current.
- [x] Fallback to current `latest` before publish.
- [x] Ignore retracted/quarantined versions unless comparing for forensic admin mode.

### 11.2 File diff

- [x] Unpack previous tarball.
- [x] Compute added/removed/modified files.
- [x] Compute total changed bytes.
- [x] Detect new/removed bin entries.
- [x] Detect new/removed lifecycle scripts.
- [x] Detect dependency changes.
- [x] Detect repository URL changes.

### 11.3 Risk integration

- [x] Add score deductions for risky deltas:
  - [x] new install script
  - [x] new child process usage
  - [ ] new network usage
  - [x] new native binary
  - [x] source repo changed
  - [x] maintainer/publisher changed
- [x] Add report section `diffRisk`.
- [x] Add tests with package fixture versions.

Definition of done:

- [ ] Risk report can explain what changed since the previous version.

---

## 12. Vulnerability and external signal integrations

### 12.1 OSV integration

- [x] Implement OSV query client.
- [x] Cache OSV responses by package/version.
- [x] Add timeout and graceful degradation.
- [x] Normalize OSV severity where available.
- [ ] Add risk findings for known vulnerabilities.
- [ ] Add policy option `blockKnownCriticalVulns`.
- [x] Add tests with mocked OSV responses.

### 12.2 Repository health integration

- [x] Extract repository URL from package metadata/provenance.
- [x] Normalize GitHub/GitLab URLs.
- [x] Implement OpenSSF Scorecard lookup or command adapter.
- [ ] Cache results by repo+commit/date.
- [x] Add score component for repo health.
- [x] Treat missing repo as lower confidence, not automatic block.

### 12.3 Provenance integration

- [x] Parse npm provenance metadata when available.
- [x] Validate provenance subject digest matches tarball digest where possible.
- [x] Validate source repo matches package metadata where possible.
- [x] Add `provenanceStatus`:
  - [x] `verified`
  - [x] `missing`
  - [x] `mismatch`
  - [x] `unsupported`
- [ ] Add blocker for mismatch.
- [x] Add score bonus for verified provenance.

Definition of done:

- [ ] Risk report includes vulnerability, repo health, and provenance sections.
- [ ] External service failures reduce confidence but do not crash preflight.

---

## 13. Typosquat and name-risk analysis

### 13.1 Popular package corpus

- [x] Create table or JSON fixture for popular package names.
- [x] Include configurable popularity rank/download/install count.
- [x] Add scheduled update placeholder.
- [x] Add tests with fake popular corpus.

### 13.2 Name normalization

- [x] Strip punctuation variants.
- [x] Normalize Unicode confusables.
- [x] Normalize common substitutions:
  - [x] `0` ↔ `o`
  - [x] `1` ↔ `l` / `i`
  - [x] `_` ↔ `-` / `.`
- [x] Lowercase names.

### 13.3 Similarity scoring

- [x] Implement edit-distance comparison.
- [x] Implement Jaro-Winkler or equivalent.
- [x] Compare scoped and unscoped names separately.
- [x] Increase risk for new packages similar to high-popularity packages.
- [ ] Increase risk for author mismatch and no provenance.
- [x] Add high-confidence blocker threshold.

### 13.4 Publish-time name gate

- [ ] On public promotion, compute name risk.
- [ ] Block high-confidence typosquats.
- [ ] Require admin/human review for medium-confidence cases.
- [ ] Add API to store review decision.

Definition of done:

- [x] Fixture `is-0dd` is flagged as similar to `is-odd`.
- [ ] High-confidence typosquat blocks public promotion and strict installs.

---

## 14. Install counts and threshold retraction

### 14.1 Event capture

- [ ] Emit `manifest_resolve` event on packument request where package version is selected by native API.
- [ ] Emit `tarball_fetch` event on tarball response success.
- [ ] Emit `exec_preflight` event on `safe-npx` preflight if authenticated or telemetry enabled.
- [ ] Emit `install_success` event from CLI when delegated install returns success, when telemetry policy allows.
- [x] Ensure anonymous telemetry can be disabled.

### 14.2 Privacy buckets

- [x] Implement daily rotating salt.
- [x] For authenticated requests, bucket by user/org/day/package/version.
- [x] For anonymous requests, bucket by hashed IP prefix + user-agent family + day.
- [x] Do not expose raw bucket IDs.
- [x] Add data retention policy.

### 14.3 Rollup worker

- [x] Aggregate unique install count by package version.
- [x] Aggregate tarball fetch count by package version.
- [x] Store hourly or daily rollups.
- [ ] Provide fast query for current observed installs.

### 14.4 Retraction API

- [x] Implement `POST /v1/packages/:name/versions/:version/retract`.
- [x] Require auth.
- [x] Require write/admin permission.
- [x] Require reason.
- [x] Compute age seconds.
- [x] Compute observed installs.
- [x] Check eligibility: `observed_installs < 100 OR age < 5h`.
- [x] If eligible:
  - [x] Mark version `retracted`.
  - [x] Remove active alias if it points to publish ID.
  - [x] Move dist-tags to previous eligible version or remove tag.
  - [ ] Create retraction record.
  - [ ] Invalidate packument cache.
  - [ ] Audit log action.
- [x] If ineligible, return `RETRACTION_NOT_ELIGIBLE` with facts.

### 14.5 CLI retraction

- [x] Implement `safe-npm retract <pkg>@<version> --reason <text>`.
- [ ] Show eligibility facts before action.
- [ ] Require confirmation in TTY.
- [ ] Support `--yes` for non-interactive with strong auth token.
- [x] Print result and dist-tag changes.
- [x] Support `--json`.

### 14.6 Semver reuse

- [ ] Allow new publish with same version only if previous active version is retracted and reuse policy allows.
- [ ] Create new `publish_id`.
- [ ] Generate new tarball URL containing publish ID or digest.
- [ ] Keep old tarball URL serving old object during retention.
- [ ] Add tests for lockfile-safe behavior.

Definition of done:

- [ ] Eligible versions can be retracted.
- [ ] Ineligible versions cannot be retracted except admin quarantine.
- [ ] Republish same version uses a new tarball URL and does not mutate old content.

---

## 15. Staged public publishing

### 15.1 Stage data model

- [x] Add `stage_records` migration.
- [x] Fields:
  - [x] `id`
  - [x] `package_id`
  - [x] `package_version_id`
  - [x] `created_by`
  - [x] `status`
  - [x] `created_at`
  - [x] `approved_by`
  - [x] `approved_at`
  - [x] `rejected_by`
  - [x] `rejected_at`
  - [x] `review_notes`

### 15.2 Stage API

- [x] Implement `POST /v1/stage`.
- [x] Implement `GET /v1/stage`.
- [x] Implement `GET /v1/stage/:stageId`.
- [ ] Implement `GET /v1/stage/:stageId/tarball`.
- [x] Implement `DELETE /v1/stage/:stageId`.
- [x] Implement `POST /v1/stage/:stageId/approve`.
- [ ] Require risk report before approval.
- [ ] Require policy pass or recorded waiver.
- [x] Require strong auth for approval.

### 15.3 CLI stage commands

- [ ] Implement `safe-npm stage publish`.
- [x] Implement `safe-npm stage list`.
- [x] Implement `safe-npm stage view <stage-id>`.
- [ ] Implement `safe-npm stage download <stage-id>`.
- [x] Implement `safe-npm stage approve <stage-id>`.
- [x] Implement `safe-npm promote <pkg>@<version> --public` as stage + approve flow or stage creation.

### 15.4 Review UI MVP

- [ ] Create web app shell.
- [ ] Add login placeholder using dev token.
- [ ] Add staged packages list.
- [ ] Add stage detail page.
- [ ] Show metadata.
- [ ] Show risk score.
- [ ] Show warnings/blockers.
- [ ] Show diff summary when available.
- [ ] Add approve/reject buttons.
- [ ] Require typed confirmation for approvals with warnings.

Definition of done:

- [ ] A private version can be staged for public release.
- [ ] A maintainer can review and approve it.
- [ ] Approval changes status to public and updates packument visibility.

---

## 16. Auth hardening and trusted publishing

### 16.1 Strong auth placeholders

- [x] Add `strong_auth_at` field/session marker.
- [ ] Require strong auth marker for:
  - [ ] public approval
  - [ ] retraction
  - [ ] token creation
  - [ ] package access changes
- [x] Implement dev-only endpoint to simulate strong auth.
- [x] Add production TODO to integrate WebAuthn/passkeys.

### 16.2 Scoped tokens

- [ ] Implement token creation API.
- [x] Token fields:
  - [x] owner user/org
  - [x] scopes
  - [x] package allowlist
  - [x] command allowlist
  - [x] expiry
  - [x] revoked_at
- [x] Store token hash only.
- [ ] Implement token revocation.
- [ ] Audit log token create/use/revoke.

### 16.3 OIDC trusted publisher MVP

- [x] Add `trusted_publishers` table.
- [x] Store provider, repository/project, workflow, environment, allowed actions.
- [x] Implement OIDC token verification interface.
- [x] Add mock OIDC verifier for tests.
- [ ] Allow stage/publish when OIDC subject matches trusted publisher config.
- [x] Add tests for allowed and denied OIDC subjects.

Definition of done:

- [ ] Human-sensitive operations require strong-auth marker.
- [ ] Automation can use short-lived scoped tokens.
- [ ] Trusted publisher model exists even if only mock verifier is fully tested.

---

## 17. Private package sharing

### 17.1 ACL model

- [x] Add `package_acl` migration.
- [x] Support principals:
  - [x] user
  - [x] org
  - [x] team placeholder
  - [x] token
- [x] Support roles:
  - [x] read
  - [x] write
  - [x] admin
- [ ] Enforce ACL in packument and tarball endpoints.
- [ ] Enforce ACL in publish/stage/retract endpoints.

### 17.2 Share API

- [x] Implement `POST /v1/shares`.
- [x] Implement `DELETE /v1/shares/:shareId`.
- [x] Implement `GET /v1/packages/:name/shares`.
- [ ] Audit log share changes.

### 17.3 CLI sharing

- [x] Implement `safe-npm share <pkg> --user <user> --role read|write|admin`.
- [x] Implement `safe-npm share <pkg> --org <org> --role read|write|admin`.
- [ ] Implement `safe-npm grant-token <pkg> --ttl <duration> --command install|exec|publish`.
- [x] Print command example for recipient.
- [x] Add JSON output.

Definition of done:

- [ ] Package owner can grant another user read access.
- [ ] Recipient can install private package.
- [ ] Non-recipient still receives 403/404 according to privacy policy.

---

## 18. `safe-npx` execution implementation

### 18.1 Execution cache

- [x] Create isolated execution cache path.
- [x] Cache by package name, version, tarball digest, and policy hash.
- [x] Ensure cache path is not project `node_modules`.
- [x] Add cleanup command.

### 18.2 Install into execution cache

- [ ] After policy approval, install package into temp prefix/cache.
- [ ] Use exact resolved version.
- [ ] Disable install scripts unless policy allows.
- [ ] If package needs install scripts and policy blocks, exit with policy error.
- [ ] Verify installed package integrity.
- [ ] Resolve bin path after install.

### 18.3 Node permission runner

- [x] Detect whether bin is Node-based:
  - [x] shebang contains node
  - [x] file extension JS/MJS/CJS
  - [ ] package bin points to JS file
- [x] Implement permission flag builder from permission report.
- [x] Support fs read/write allowlists where Node version supports them.
- [x] Support child process/worker/native denial where Node version supports them.
- [x] Support network permission only when current Node supports it.
- [x] If required permission enforcement unavailable, exit code `15`.

### 18.4 Execution

- [ ] Execute child command with controlled environment.
- [ ] Pass user args after `--` correctly.
- [ ] Preserve stdio for TTY mode.
- [ ] Capture result for JSON mode.
- [ ] Return child exit code according to documented mapping.
- [ ] Audit log approved/blocked execution when authenticated.

### 18.5 Trust cache

- [x] Store local trust decisions by package name, version, tarball digest, and risk report digest.
- [x] Support trust scopes:
  - [x] once
  - [x] exact version
  - [x] digest
  - [x] package name only, discouraged
- [ ] Implement `safe-npx trust list`.
- [ ] Implement `safe-npx trust revoke`.

Definition of done:

- [ ] `safe-npx <safe-fixture>` preflights, prompts, installs into execution cache, and runs.
- [ ] `safe-npx --agent <package>` never prompts.
- [ ] Node permission enforcement is used when available and required.

---

## 19. `skill.md` scanner

### 19.1 Command extraction

- [x] Implement Markdown code block parser.
- [x] Extract shell-like command lines.
- [x] Detect commands:
  - [x] `npx`
  - [x] `npm exec`
  - [x] `npm x`
  - [x] `pnpm dlx`
  - [x] `yarn dlx`
  - [x] `bunx`
- [x] Parse package spec from each command.
- [x] Preserve line number and raw command.

### 19.2 Preflight integration

- [x] For each detected package, run preflight.
- [x] Deduplicate same package spec.
- [x] Return per-command decision.
- [x] Do not execute anything.

### 19.3 CLI command

- [x] Implement `safe-npx scan-skill <path> --json`.
- [x] Implement human summary output.
- [x] Exit with code `11` if any command is blocked.
- [x] Exit with code `10` if any command requires approval and none are blocked.
- [x] Exit with code `0` if all pass.

Definition of done:

- [x] Scanner finds `npx some-tool@latest` in a Markdown fixture.
- [x] Scanner reports blocked/approval/pass decisions in JSON.

---

## 20. Paid audit broker

### 20.1 Audit schema and API

- [x] Add audit job migrations.
- [x] Add audit attestation migrations.
- [x] Implement `POST /v1/audits`.
- [x] Implement `GET /v1/audits/:auditId`.
- [x] Implement `GET /v1/audit-attestations/:digest`.
- [x] Validate package/version access.
- [x] Validate idempotency key.
- [x] Enqueue audit job.

### 20.2 Mock provider

- [x] Define provider adapter interface.
- [x] Implement mock provider that returns deterministic results from fixtures.
- [x] Implement provider public key endpoint for tests.
- [x] Implement provider signature creation and verification.
- [x] Add tests for valid/invalid signatures.

### 20.3 Audit worker

- [x] Load package tarball digest and analysis evidence.
- [x] Build evidence bundle.
- [x] Submit to provider.
- [x] Poll or await result.
- [x] Verify provider signature.
- [x] Store audit job result.
- [x] Store signed attestation.
- [x] Enqueue score recomputation.

### 20.4 Payment ledger stub

- [x] Add billing account migration.
- [x] Add ledger entry migration.
- [x] Implement fake credit balance.
- [x] Reserve audit cost before provider submission.
- [x] Capture or refund after provider result/error.
- [ ] Add tests for idempotent charges.

### 20.5 CLI audit command

- [x] Implement `safe-npm audit <pkg>@<version> --paid`.
- [x] Show cost before submission.
- [x] Require confirmation unless `--yes`.
- [x] Print audit status.
- [x] Support `--json`.

Definition of done:

- [ ] A paid audit request creates a job, uses mock provider, stores signed attestation, and updates risk report.

---

## 21. Web UI MVP

### 21.1 App foundation

- [x] Create web app.
- [x] Add API client.
- [x] Add auth token input for dev.
- [x] Add layout.
- [x] Add error boundary.

### 21.2 Package pages

- [x] Package list page.
- [x] Package detail page.
- [x] Version detail page.
- [x] Risk report panel.
- [x] Permissions panel.
- [x] Audit report panel.
- [x] Retraction history panel.

### 21.3 Stage review pages

- [x] Staged package list.
- [x] Stage detail page.
- [x] Download tarball link.
- [x] Risk findings list.
- [x] Diff summary.
- [x] Approve action.
- [x] Reject action.
- [x] Typed confirmation for risky approval.

### 21.4 Access management

- [x] Show package ACLs.
- [x] Add user share form.
- [x] Revoke share action.
- [x] Show short-lived token creation form.

Definition of done:

- [ ] A maintainer can review and approve a staged package from the UI.
- [ ] A package owner can grant/revoke read access from the UI.

---

## 22. Policy configuration

### 22.1 Policy storage

- [x] Add policy set migrations.
- [x] Implement `GET /v1/policies/:scope`.
- [x] Implement `PUT /v1/policies/:scope`.
- [x] Validate policy with schema.
- [ ] Audit log policy changes.

### 22.2 CLI policy commands

- [x] Implement `safe-npm policy init`.
- [x] Implement `safe-npm policy show`.
- [x] Implement `safe-npm policy test <risk-report.json>`.
- [x] Implement `safe-npx policy init`.
- [x] Implement `safe-npx policy test <risk-report.json>`.

### 22.3 Presets

- [x] Add `relaxed` preset.
- [x] Add `default-human` preset.
- [x] Add `strict` preset.
- [x] Add `agent` preset.
- [x] Add `ci` preset.

Definition of done:

- [ ] Policy decisions are reproducible locally and on the server.
- [x] Agent policy blocks `latest` and requires exact versions by default.

---

## 23. Public npm proxy/cache

### 23.1 Proxy packuments

- [x] Add registry source config.
- [x] Implement public npm packument fetch through API.
- [x] Cache packuments with ETag/TTL.
- [x] Preserve upstream metadata.
- [x] Merge local risk summary without mutating upstream version fields unless under namespaced extension.

### 23.2 Proxy tarballs

- [x] Download upstream tarball on first request.
- [x] Verify integrity from upstream packument.
- [ ] Store content-addressed.
- [ ] Serve cached tarball.
- [x] Preserve upstream content exactly.

### 23.3 Policy controls

- [x] Allow org/project policy to disable public fallback.
- [ ] Allow org/project policy to block nonregistry sources.
- [ ] Add risk warning for upstream package lacking signatures/provenance.

Definition of done:

- [ ] Private registry can install a public npm dependency through proxy/cache after preflight.

---

## 24. Admin and quarantine

### 24.1 Quarantine model

- [ ] Add admin role.
- [ ] Add `quarantined` status support.
- [ ] Implement quarantine API.
- [ ] Implement unquarantine API.
- [ ] Require admin strong auth.
- [ ] Audit log quarantine actions.

### 24.2 Malware block behavior

- [ ] Quarantined versions are removed from normal packuments.
- [ ] Tarball endpoint returns explicit malware/quarantine error by default.
- [ ] Admin forensic mode can download with extra permission.
- [ ] Existing lockfile tarball URL does not serve malware unless forensic mode.

### 24.3 Name dispute placeholder

- [ ] Add package name review state.
- [ ] Add admin note field.
- [ ] Add manual decision API.
- [ ] Add public promotion block while name dispute is open.

Definition of done:

- [ ] Admin can quarantine a malicious version and block future installs/execs.

---

## 25. Observability and audit logs

### 25.1 Audit logs

- [ ] Add `audit_logs` migration if not already present.
- [ ] Log publish.
- [ ] Log stage create/approve/reject.
- [ ] Log retraction.
- [ ] Log deprecation.
- [ ] Log share changes.
- [ ] Log token create/revoke/use.
- [ ] Log policy changes.
- [ ] Log admin quarantine.
- [ ] Log paid audit request/result.

### 25.2 Metrics

- [ ] Add metrics endpoint.
- [ ] Track API latency.
- [ ] Track worker job latency.
- [ ] Track analysis failures.
- [ ] Track risk decisions.
- [ ] Track policy blocks.
- [ ] Track audit provider errors.
- [ ] Track signature failures.

### 25.3 Logs

- [ ] Use structured JSON logs in API and workers.
- [ ] Include request ID.
- [ ] Include user/org ID where authenticated.
- [ ] Never log tokens.
- [ ] Never log raw payment data.

Definition of done:

- [ ] Security-relevant actions can be reconstructed from audit logs.
- [ ] Metrics show preflight and analysis health.

---

## 26. Security tests

### 26.1 Fixture packages

Create local fixture tarballs for:

- [ ] benign package with simple bin.
- [ ] package with `postinstall` script.
- [ ] package reading `process.env.GITHUB_TOKEN`.
- [ ] package using `child_process.exec`.
- [ ] package using `https.request`.
- [ ] package with obfuscated/minified file.
- [ ] package with `.node` native addon placeholder.
- [ ] package with `binding.gyp`.
- [ ] package with ambiguous bins.
- [ ] typosquat-like package name.
- [ ] malicious tar path traversal.
- [ ] integrity mismatch fixture.

### 26.2 Analyzer tests

- [ ] Analyzer flags each malicious/suspicious fixture.
- [ ] Analyzer does not execute fixture code.
- [ ] Analyzer records evidence file paths.
- [ ] Analyzer handles parse failures gracefully.

### 26.3 Policy tests

- [ ] Strict policy blocks install scripts.
- [ ] Strict policy blocks native binaries.
- [ ] Agent policy requires exact version.
- [ ] Agent policy blocks `latest`.
- [ ] Human policy prompts for caution tier.
- [ ] Blocker always blocks.

### 26.4 Registry tests

- [ ] Private package is invisible to unauthenticated users.
- [ ] Authorized user can install private package.
- [ ] Retraction eligibility works below threshold.
- [ ] Retraction ineligibility works above threshold.
- [ ] Republish same version uses new publish ID and URL.
- [ ] Quarantine blocks tarball fetch.

### 26.5 CLI tests

- [ ] `safe-npx preflight` JSON schema valid.
- [ ] `safe-npx` TTY prompt accepts yes/no/details.
- [ ] `safe-npx --agent` never prompts.
- [ ] Exit codes match spec.
- [ ] `scan-skill` finds commands and returns correct decisions.

Definition of done:

- [ ] Security test suite fails if any preflight executes fixture package code.

---

## 27. Documentation

### 27.1 Developer docs

- [ ] Write local setup guide.
- [ ] Write architecture overview.
- [ ] Write API docs from OpenAPI.
- [ ] Write CLI command reference.
- [ ] Write analyzer rule documentation.
- [ ] Write scoring formula documentation.
- [ ] Write policy schema documentation.

### 27.2 User docs

- [ ] Write `safe-npm publish` private-first guide.
- [ ] Write public promotion guide.
- [ ] Write threshold retraction guide.
- [ ] Write `safe-npx` risk card guide.
- [ ] Write agent/CI JSON mode guide.
- [ ] Write private sharing guide.
- [ ] Write paid audit guide.

### 27.3 Security docs

- [ ] Document threat model.
- [ ] Document sandbox limitations.
- [ ] Document install count privacy.
- [ ] Document semver reuse and lockfile safety.
- [ ] Document false positive override process.

Definition of done:

- [ ] A new coding agent can run the project locally using docs only.
- [ ] A user can publish private, stage public, retract eligible, and run `safe-npx` using docs only.

---

## 28. Release readiness checklist

### 28.1 MVP release gate

- [ ] All root checks pass.
- [ ] All security fixtures pass.
- [ ] Local registry install works.
- [ ] Public package preflight works.
- [ ] Private publish works.
- [ ] Stage/approve works.
- [ ] Eligible retract works.
- [ ] `safe-npx` executes benign fixture after approval.
- [ ] Agent mode returns deterministic JSON and exit codes.
- [ ] Risk reports include package size, publisher/maintainers, score, scripts, permissions, source/provenance, and audit status.
- [ ] Audit logs record sensitive actions.

### 28.2 Hardening gate

- [ ] No raw tokens in logs.
- [ ] Object storage denies public access by default.
- [ ] Signing private key is not in repository.
- [ ] Rate limits exist on public endpoints.
- [ ] Tar extraction blocks traversal.
- [ ] API validates all inputs with schemas.
- [ ] Database migrations are reversible or clearly marked irreversible.
- [ ] Backups configured for metadata DB.
- [ ] Disaster recovery notes written.

### 28.3 Demo script

- [ ] Demo `safe-npx preflight` on a benign package.
- [ ] Demo blocked `safe-npx` on suspicious fixture.
- [ ] Demo `scan-skill` detecting `npx` command.
- [ ] Demo private publish.
- [ ] Demo private install by authorized user.
- [ ] Demo public stage and approval.
- [ ] Demo threshold retraction.
- [ ] Demo paid audit with mock provider.

---

## 29. Suggested implementation order summary

Complete in this order:

1. Repo/tooling.
2. Shared schemas.
3. npm compatibility helpers.
4. Tarball quarantine and analyzer MVP.
5. Scoring and policy MVP.
6. CLI public preflight vertical slice.
7. Registry API and database.
8. Private publish/install.
9. Registry signatures.
10. Workers.
11. Diff/vulnerability/provenance/name-risk enrichment.
12. Install counts and threshold retraction.
13. Staged public publishing.
14. Auth hardening and sharing.
15. `safe-npx` actual execution and sandboxing.
16. `skill.md` scanning.
17. Paid audit broker.
18. Web UI.
19. Observability and full security tests.
20. Documentation and release readiness.

