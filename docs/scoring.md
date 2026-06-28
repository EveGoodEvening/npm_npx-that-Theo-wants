# Scoring Formula

## Overview

The scoring engine converts an `AnalysisReport` into a `RiskReport` with:
- A numeric score (0-100, higher = safer)
- A risk tier (`good`, `caution`, `danger`, `blocked`)
- A confidence value (0-1)
- An evidence digest for reproducibility

## Score Calculation

The score starts at 100 and is reduced by penalties for each finding:

### Metadata Penalties

| Finding | Penalty |
|---|---|
| Missing license | -5 |
| Missing repository URL | -5 |
| Typosquat-like name | -30 |
| New maintainer (< 30 days) | -10 |
| No provenance/signature | -5 |

### Lifecycle Script Penalties

| Finding | Penalty |
|---|---|
| postinstall script | -10 |
| install script | -10 |
| preinstall script | -15 |
| Script with shell metacharacters | -10 |
| Script with network tool | -15 |
| Script with package manager | -5 |
| Native build (node-gyp) | -10 |

### Static Analysis Penalties

| Finding | Penalty |
|---|---|
| child_process usage | -15 |
| Network access (https/http) | -10 |
| Environment token access | -20 |
| Dynamic code execution (eval) | -20 |
| File system access (strict mode) | -5 |

### Readability Penalties

| Finding | Penalty |
|---|---|
| Low readability score | -10 |
| Hex-encoded strings | -10 |
| Obfuscated eval | -15 |

### Native Artifact Penalties

| Finding | Penalty |
|---|---|
| binding.gyp present | -5 |
| .node prebuilt addon | -10 |
| Native source files (.cc/.cpp) | -5 |

### External Data Penalties

| Finding | Penalty |
|---|---|
| OSV vulnerability match | -20 |
| No repo health data | -5 |
| Low repo health score | -10 |

## Tier Assignment

| Score Range | Tier |
|---|---|
| 75-100 | `good` |
| 50-74 | `caution` |
| 25-49 | `danger` |
| 0-24 | `blocked` |

## Confidence

Confidence is calculated based on:
- Analysis completeness (0-0.4)
- Data freshness (0-0.3)
- External data availability (0-0.3)

## Evidence Digest

The evidence digest is a SHA-256 hash of all findings, ensuring reproducible scores for identical analysis reports.
