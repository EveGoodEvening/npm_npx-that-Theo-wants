# Agent/CI JSON Mode Guide

## Overview

In agent or CI mode, `safe-npx` returns deterministic JSON output and exit codes, with no interactive prompts.

## Enabling Agent Mode

```bash
# Via flag
safe-npx --agent <package> [args...]

# Via environment variable
SAFE_NPM_AGENT=1 safe-npx <package> [args...]
```

## JSON Output

```json
{
  "decision": "allow",
  "score": 82,
  "tier": "good",
  "package": "create-react-app",
  "version": "5.0.1",
  "matchedRules": [],
  "overridesAvailable": [],
  "riskReport": { ... }
}
```

### Decision Values

| Decision | Description | Exit Code |
|---|---|---|
| `allow` | Execution permitted | 0 |
| `requires_approval` | Caution tier, needs approval | 11 |
| `block` | Hard block by policy | 10 |
| `error` | Analysis or fetch error | 20/30 |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Execution allowed and started |
| 10 | Blocked by policy (minimum score) |
| 11 | Requires approval (caution tier) |
| 20 | Package not found |
| 30 | Analysis failed |

## CI Integration

### GitHub Actions

```yaml
- name: Run with safe-npx
  run: |
    safe-npx --agent create-react-app my-app
  env:
    SAFE_NPM_REGISTRY: https://registry.my-org.com
    SAFE_NPM_TOKEN: ${{ secrets.SAFE_NPM_TOKEN }}
```

### Policy for CI

Use the `ci` preset for CI environments:

```bash
safe-npx policy init --preset ci
```

CI policy:
- Minimum score: 70
- Blocks install scripts
- Allows native binaries
- Requires exact version

### Agent Policy

Use the `agent` preset for AI agent environments:

```bash
safe-npx policy init --preset agent
```

Agent policy:
- Minimum score: 75
- Blocks install scripts and native binaries
- Requires exact version
- Blocks `latest` tag
- Requires permission enforcement

## Handling Block Decisions

```bash
result=$(safe-npx --agent <package> 2>&1)
exit_code=$?

case $exit_code in
  0)   echo "Execution started" ;;
  10)  echo "Blocked by policy: $result" ;;
  11)  echo "Requires approval: $result" ;;
  20)  echo "Package not found" ;;
  30)  echo "Analysis failed" ;;
esac
```
