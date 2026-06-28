# Policy schema documentation

Policies are JSON documents evaluated before install, publish, or exec. The schema is defined in `packages/core-types` (`PolicySetSchema`) and validated with Zod.

## PolicySet

```json
{
  "name": "default-agent-policy",
  "mode": "agent",
  "install": { ... },
  "exec": { ... },
  "publish": { ... }
}
```

`mode` is one of: `relaxed`, `default`, `strict`, `agent`, `ci`.

## install rules

| Field | Type | Default | Description |
|---|---|---|---|
| `minimumScore` | int 0–100 (optional) | — | minimum score to allow |
| `blockTiers` | `["danger","blocked"]` | `[]` | tiers that block |
| `requireNoBlockers` | boolean | false | block if any blockers present |
| `allowInstallScripts` | boolean | true | allow lifecycle scripts |
| `allowNonRegistrySources` | boolean | true | allow git/file/remote specs |
| `blockKnownCriticalVulns` | boolean | false | block on critical OSV vulnerabilities |

## exec rules

| Field | Type | Default | Description |
|---|---|---|---|
| `minimumScore` | int 0–100 (optional) | — | minimum score to allow |
| `blockTiers` | `["danger","blocked"]` | `[]` | tiers that block |
| `requireNoBlockers` | boolean | false | block if any blockers present |
| `requireExactVersion` | boolean | false | require exact semver (no ranges/tags) |
| `disallowLatestTag` | boolean | false | block `latest` dist-tag resolution |
| `requirePermissionEnforcement` | boolean | false | require Node permission model (exit 15 if unavailable) |
| `allowNativeBinaries` | boolean | true | allow native addons/binaries |
| `allowNetwork` | enum | `any` | `any`, `declared`, `declared-and-approved`, `none` |
| `blockKnownCriticalVulns` | boolean | false | block on critical vulnerabilities |

## publish rules

| Field | Type | Default | Description |
|---|---|---|---|
| `defaultVisibility` | `private`/`public` | `private` | default publish visibility |
| `publicPromotionRequiresAudit` | boolean | false | require audit for public promotion |
| `publicPromotionMinimumScore` | int 0–100 (optional) | — | minimum score for public promotion |
| `requireTrustedPublisherForPublic` | boolean | false | require trusted publisher for public |
| `requireNoBlockers` | boolean | true | block if any blockers present |
| `blockTiers` | `["danger","blocked"]` | `["blocked"]` | tiers that block |

## Presets

| Preset | install minScore | exec minScore | install scripts | exact version | latest tag | enforcement |
|---|---|---|---|---|---|---|
| relaxed | 20 | 30 | allowed | no | allowed | no |
| default-human | 50 | 60 | allowed | no | allowed | no |
| strict | 75 | 85 | denied | required | denied | required |
| agent | 80 | 90 | denied | required | denied | required |
| ci | 80 | 90 | denied | required | denied | no |

## Decision output

```json
{
  "allow": false,
  "decision": "requires_approval",
  "action": "exec",
  "matchedRules": [{ "path": "exec.minimumScore", "expected": 90, "actual": 82 }],
  "overridesAvailable": ["human-approve-exact-version"],
  "reason": "requires approval: exec.minimumScore"
}
```

`decision` is `allow`, `requires_approval`, or `blocked`.
