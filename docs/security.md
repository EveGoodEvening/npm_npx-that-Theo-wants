# Security documentation

## Threat model

| Threat | Mitigation |
|---|---|
| Maintainer account takeover | Passkeys/2FA (design), trusted publishing, staged approval, maintainer drift scoring. |
| Malicious new package | typosquat detection, low-history scoring, install-time risk card, public-promotion review. |
| Malicious update to trusted package | diff analysis, maintainer drift detection, paid audits, staged public release. |
| Install script exfiltration | deny-by-default in strict/agent modes, static analysis, explicit allowlist, Node permission model. |
| `npx` one-off execution compromise | preflight before fetch/exec, exact version pinning, risk report, policy engine, permission enforcement. |
| Registry mirror tampering | ECDSA signatures, integrity verification, content-addressed storage. |
| Faked audit result | provider signatures, audit evidence digests, transparency log (design). |
| Republish cache poisoning | publish IDs, immutable object keys, lockfile-safe tarball URLs. |
| Name squatting/typosquatting | name-risk scoring, public-publish blocks, disputes/admin workflow (design). |
| Privacy leakage from install counts | aggregation, rotating salted hashes, no raw IP retention (design). |

## Sandbox limitations

- **Node permission model** applies only to Node execution under supported Node versions (>= 20) and supported flags.
- Native binaries, shell scripts, and postinstall scripts may need OS-level sandboxing (not yet implemented).
- If enforcement cannot be guaranteed, `enforceable = false` and policy decides (strict/agent modes block; exit code `15` when required).
- The `--permission` flags are best-effort: `--deny-net`, `--deny-child-process`, `--deny-worker`, `--deny-addons`, and fs read/write allowlists.

## Install count privacy

Install counts are approximate (caches and mirrors hide some installs). The threshold (< 100 installs or < 5 hours live) is blast-radius-based, not legal-grade. Privacy buckets use a daily rotating server-side salt and coarse dimensions (account/org when authenticated, hashed IP prefix + user-agent family when anonymous). Raw bucket IDs are never exposed. Telemetry can be disabled (`SAFE_NPM_TELEMETRY_ENABLED=false`).

> The install-count infrastructure requires the registry API and is not yet implemented in the MVP.

## Semver reuse and lockfile safety

`package_versions` is unique by `(package_id, version, publish_id)`, not only `(package_id, version)`. This allows safe semver tuple reuse by creating a new `publish_id` and a new tarball URL. Old lockfile tarball URLs keep resolving to their original content during the configured retention window.

Retraction effects:
- Remove version from normal packument resolution.
- Remove or move affected dist-tags.
- Mark `package_versions.status = retracted`.
- Preserve tarball object for retention.
- Republish of the same `name@version` allowed only as a new `publish_id` + tarball URL.

| Case | Reuse allowed? |
|---|---|
| Private version, zero installs | Yes (hide previous completely) |
| < 100 installs or < 5h live | Yes, with new publish ID |
| >= 100 installs and >= 5h | No (use deprecate/yank/quarantine) |
| Malware | Admin decision (may hard-block fetches) |

> The retraction/republish infrastructure requires the registry API and is not yet implemented in the MVP. The packument generator (`packages/npm-compat`) already produces publish-ID-specific tarball URLs for lockfile safety.

## False positive override process

- Strict/agent policies block by default; overrides require explicit `--yes` / `--json` and are audit-logged (when authenticated).
- Trust cache (`safe-npx trust`) allows recording an exact-version trust decision to skip prompts.
- Policy presets can be tuned via `safe-npm policy init <preset>` and custom policy files (`--policy <path>`).
- All security decisions are explainable in JSON (`matchedRules`, `reason`, `overridesAvailable`).
