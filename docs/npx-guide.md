# safe-npx Risk Card Guide

## What is a Risk Card?

When you run `safe-npx <package>`, a risk card is displayed before any code is downloaded or executed. The risk card shows:

- **Package name and version**
- **Risk score** (0-100, higher = safer)
- **Risk tier** (good, caution, danger, blocked)
- **Findings** (list of detected issues)
- **Policy decision** (allow, requires approval, block)

## Interactive Mode

```bash
$ safe-npx create-react-app my-app

┌─────────────────────────────────────────┐
│  Risk Card: create-react-app@5.0.1      │
│  Score: 82/100  Tier: good              │
│  Decision: allow                         │
├─────────────────────────────────────────┤
│  Findings:                               │
│  • postinstall script detected           │
│  • network access (https)                │
└─────────────────────────────────────────┘

Proceed? [y/N/details]
```

### Prompt Options

- `y` or `yes`: Proceed with execution.
- `n` or `N`: Cancel (default).
- `details`: Show full risk report JSON.

## Agent/CI Mode

```bash
$ safe-npx --agent create-react-app my-app

{"decision":"allow","score":82,"tier":"good",...}
```

In agent mode:
- No prompts (deterministic).
- JSON output to stdout.
- Exit codes indicate decision (0=allow, 10=block, 11=requires approval).

## Policy-Based Decisions

The risk card is evaluated against your policy:

- **allow**: Score meets minimum, no blockers.
- **requires_approval**: Caution tier, needs user confirmation.
- **block**: Score below minimum or hard blocker.

## Custom Policy

Create a `.safe-npx-policy.json` file:

```json
{
  "install": {
    "minimumScore": 70,
    "blockTiers": ["danger", "blocked"],
    "allowInstallScripts": true,
    "allowNativeBinaries": true,
    "requireExactVersion": false,
    "disallowLatestTag": false
  },
  "exec": {
    "minimumScore": 75,
    "blockTiers": ["danger", "blocked"],
    "allowInstallScripts": false,
    "allowNativeBinaries": false,
    "requireExactVersion": true,
    "disallowLatestTag": true,
    "requirePermissionEnforcement": true,
    "promptForCautionTier": true
  }
}
```

Or initialize from a preset:

```bash
safe-npx policy init --preset agent
```
