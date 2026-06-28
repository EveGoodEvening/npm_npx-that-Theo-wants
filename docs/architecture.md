# Architecture Overview

## Design Principles

1. **Private-first**: All packages start private; public promotion is an explicit, reviewed action.
2. **Preflight before fetch**: Risk analysis happens before any package code is downloaded or executed.
3. **Policy-driven**: Deterministic policy engine decides allow/block/requires_approval.
4. **Content-addressed storage**: Tarballs stored by SHA-512 digest for integrity and dedup.
5. **Immutable version tuples**: `name@version` is immutable; republish creates a new publish ID and tarball URL.

## Components

### CLI (`apps/cli`)

- `safe-npm`: Publish, retract, policy, audit commands.
- `safe-npx`: Preflight, exec, scan-skill, policy commands.
- Preflight fetches packument, runs analyzer, scores risk, evaluates policy, prompts user (or returns JSON in agent mode).

### Registry API (`apps/registry-api`)

Fastify-based HTTP API implementing npm registry compatibility:

- **Publish** (`PUT /v1/packages/:name`): Accepts npm pack tarball, stores content-addressed, runs analysis, creates risk report.
- **Packument** (`GET /:name`): Returns npm-compatible packument with `safe-npm` extension for risk summary.
- **Tarball** (`GET /:name/-/:tarball`): Streams tarball from object storage.
- **Stage** (`POST /v1/stage`, `POST /v1/stage/:id/approve|reject`): Staged public release workflow.
- **Retract** (`POST /v1/packages/:name/versions/:version/retract`): Threshold-based retraction.
- **Quarantine** (`POST /v1/packages/:name/versions/:version/quarantine`): Admin malware quarantine.
- **Policy** (`GET/PUT /v1/policies/:scope`): Org/project policy management.
- **Audit** (`POST /v1/audits`): Paid audit job creation.
- **Proxy** (`GET /:name` fallback): Public npm proxy/cache for packages not in private registry.
- **Metrics** (`GET /-/metrics`): Prometheus-format metrics.

### Workers (`apps/workers`)

- `analysis-worker`: Processes analysis jobs from queue.
- `audit-worker`: Processes paid audit jobs, calls audit providers, stores attestations.

### Analyzer (`packages/analyzer`)

Static analysis of tarballs without executing code:

- **Metadata analysis**: package.json inspection, native artifact detection.
- **Script analysis**: Lifecycle script detection (postinstall, install, etc.).
- **Static analysis**: AST-based detection of dangerous patterns (child_process, network access, env token access).
- **Readability analysis**: Detects obfuscated/minified code.
- **Diff analysis**: Version-to-version diff for maintainer drift detection.

### Scoring (`packages/scoring`)

- `scoreAnalysis`: Converts AnalysisReport to RiskReport (0-100 score, tier: good/caution/danger/blocked).
- `evaluatePolicy`: Deterministic policy evaluation against PolicySet.
- `presets`: 5 policy presets (relaxed, default-human, strict, agent, ci).
- `name-risk`: Typosquat and name similarity detection.
- `osv`: OSV vulnerability integration.
- `provenance`: Sigstore provenance verification.
- `repo-health`: Repository health metrics.

### Database (`packages/db`)

Drizzle ORM schema and repositories:

- `users`, `auth_tokens`: User management and authentication.
- `packages`, `package_versions`, `version_aliases`, `dist_tags`: Package metadata.
- `risk_reports`: Analysis results per version.
- `stage_records`: Staged public release workflow.
- `package_acl`: Package access control.
- `audit_jobs`, `audit_attestations`: Paid audit workflow.
- `billing_accounts`, `ledger_entries`: Billing for paid audits.
- `policy_sets`: Org/project policy storage.
- `audit_logs`: Security-relevant action logging.
- `install_events`: Install tracking for retraction thresholds.

## Data Flow

### Publish Flow

```
CLI pack -> PUT /v1/packages/:name -> Store tarball -> Analyze -> Score -> Risk report
```

### Install/Preflight Flow

```
CLI preflight -> GET /:name (packument) -> Analyze tarball -> Score -> Evaluate policy -> Prompt/JSON
```

### Public Promotion Flow

```
Publish (private) -> Stage create -> Admin review -> Stage approve -> Version status: public
```

### Quarantine Flow

```
Admin detects malware -> POST quarantine -> Version status: quarantined -> Packument excludes -> Tarball returns 451
```
