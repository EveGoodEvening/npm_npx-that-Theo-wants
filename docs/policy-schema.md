# Policy Schema Documentation

## PolicySet

A `PolicySet` defines rules for install and exec actions.

```typescript
interface PolicySet {
  install: InstallPolicy;
  exec: ExecPolicy;
  publish: PublishPolicy;
}
```

## Install Policy

```typescript
interface InstallPolicy {
  minimumScore: number;        // Minimum risk score (0-100)
  blockTiers: RiskTier[];      // Tiers to block (e.g., ['danger', 'blocked'])
  requireNoBlockers: boolean;  // Block if any blockers present
  allowInstallScripts: boolean; // Allow lifecycle scripts
  allowNativeBinaries: boolean; // Allow native addons
  allowNonRegistrySources: boolean; // Allow non-registry sources
  requireExactVersion: boolean; // Require exact version (no ranges)
  disallowLatestTag: boolean;  // Block `latest` tag
  requirePermissionEnforcement: boolean; // Require sandbox enforcement
}
```

## Exec Policy

```typescript
interface ExecPolicy {
  minimumScore: number;
  blockTiers: RiskTier[];
  requireNoBlockers: boolean;
  allowInstallScripts: boolean;
  allowNativeBinaries: boolean;
  requireExactVersion: boolean;
  disallowLatestTag: boolean;
  requirePermissionEnforcement: boolean;
  promptForCautionTier: boolean; // Prompt user for caution tier
}
```

## Publish Policy

```typescript
interface PublishPolicy {
  defaultVisibility: 'private' | 'public';
  publicPromotionRequiresAudit: boolean;
  publicPromotionMinimumScore: number;
  requireTrustedPublisherForPublic: boolean;
}
```

## Presets

### relaxed
- Minimum score: 20
- Allows install scripts, native binaries, non-registry sources
- No exact version required
- For development/exploration only

### default-human
- Minimum score: 55
- Allows install scripts and native binaries
- Prompts for caution tier
- For interactive developer use

### strict
- Minimum score: 85
- Blocks install scripts and native binaries
- Requires exact version
- For security-sensitive environments

### agent
- Minimum score: 75
- Blocks install scripts and native binaries
- Requires exact version
- Blocks `latest` tag
- Requires permission enforcement
- For AI agent/CI use (no prompts)

### ci
- Minimum score: 70
- Blocks install scripts
- Allows native binaries
- Requires exact version
- For CI/CD pipelines

## Policy Decisions

`evaluatePolicy` returns a `PolicyDecision`:

```typescript
interface PolicyDecision {
  decision: 'allow' | 'warn' | 'requires_approval' | 'block';
  matchedRules: MatchedRule[];
  overridesAvailable: string[];
}
```

- `allow`: All rules pass.
- `warn`: Some rules trigger warnings but none block.
- `requires_approval`: Action needs human/agent approval.
- `block`: A hard rule blocks the action.

## Policy Storage

Policies are stored per scope:

- `org:<orgId>` — Organization-level policy
- `project:<projectId>` — Project-level policy
- `user:<userId>` — User-level policy

Priority: project > org > user > preset default.
