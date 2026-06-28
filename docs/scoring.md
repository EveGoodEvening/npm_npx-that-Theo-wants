# Scoring formula documentation

The scoring package (`packages/scoring`) produces a deterministic, explainable risk report.

## Score

Starts at 100. Deductions:

| Component | Deduction |
|---|---|
| Install scripts | 4 per lifecycle script (max 10) |
| Native addons/binaries | 10 + 3 per artifact |
| Static/script findings | per severity: low 2, medium 6, high 12, critical 25 (capped per-finding at 25) |
| Obfuscation | 12 |
| Minification | 6 |
| Missing repository | 4 |
| Missing license | 4 |
| Package size anomaly (> 50 MB unpacked) | 5 |
| Permission mismatch | 5 per mismatch (max 15) |
| Diff risky deltas | via finding severity |

Bonus:
- Provenance verified: +5 (clamped to 100)

Score is clamped to 0–100.

## Tiers

| Score | Tier | Default behavior |
|---|---|---|
| 90–100 | excellent | allow |
| 75–89 | good | allow with warnings |
| 55–74 | caution | prompt in TTY; require policy allow in agent/CI |
| 25–54 | danger | block by default; allow only with override |
| 0–24 | blocked | do not install/execute |

Any **blocker** forces tier `blocked` regardless of numeric score.

## Blockers

- `KNOWN_MALWARE`
- `TARBALL_INTEGRITY_MISMATCH`
- `EXFILTRATION_FIXTURE`
- `PROVENANCE_MISMATCH`
- `COMPROMISED_PUBLISHER`
- `SIGNATURE_MISMATCH` (from registry signature verification)

## Confidence

Starts at 90. Reduced by parse failures, missing repo/license, many warnings, blockers. Clamped to 10–100.

## External signals (enrichment)

`enrichRiskReport` merges OSV vulnerabilities, OpenSSF Scorecard repo health, and provenance validation into the risk report:
- OSV findings added as warnings; unavailable OSV reduces confidence.
- Repo health: low score (< 3) adds a `LOW_REPO_HEALTH` warning; bonus/penalty applied to score; unavailable reduces confidence.
- Provenance: critical findings (digest/repo mismatch) become blockers; `verified` sets `facts.source.provenance`.
- Tier is recomputed after enrichment (blockers → `blocked`).

## Evidence digest

`sha256` of the canonical analysis report JSON — deterministic for a given tarball digest and analyzer version.

## Components

Each deduction is stored in `riskReport.components` with `name`, `weight`, `contribution`, and `signals` so the score is fully explainable.
