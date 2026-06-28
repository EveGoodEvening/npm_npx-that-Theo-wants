# CLI Command Reference

## safe-npm

### `safe-npm publish`

Publish a package to the private registry.

```bash
safe-npm publish [--access public|private] [--registry <url>]
```

- Default visibility: `private`.
- Runs analysis and generates risk report automatically.
- Public promotion requires staged approval.

### `safe-npm retract <name>@<version>`

Retract a published version.

```bash
safe-npm retract lodash@1.0.0 [--reason <text>] [--force]
```

- Eligibility checked against install count and age thresholds.
- `--force` bypasses eligibility check (admin only).

### `safe-npm policy <subcommand>`

Manage policy configuration.

```bash
# Initialize a local policy file
safe-npm policy init [--preset relaxed|default-human|strict|agent|ci]

# Show current policy
safe-npm policy show

# Test a risk report against policy
safe-npm policy test <risk-report.json>
```

### `safe-npm audit <subcommand>`

Request and check paid audits.

```bash
# Request a paid audit
safe-npm audit request <name>@<version> --provider <provider>

# Check audit status
safe-npm audit status <auditId>
```

## safe-npx

### `safe-npx <package> [args...]`

Run a package with preflight risk analysis.

```bash
# Interactive mode (prompts on caution)
safe-npx create-react-app my-app

# Agent mode (JSON output, no prompts)
safe-npx --agent create-react-app my-app

# Specify exact version
safe-npx create-react-app@5.0.1 my-app
```

**Exit codes:**
- `0`: Execution allowed and started.
- `10`: Execution blocked by policy (minimum score).
- `11`: Execution requires approval (caution tier).
- `20`: Package not found.
- `30`: Analysis failed.

### `safe-npx scan-skill <path>`

Scan a skill.md file for package commands and evaluate risk.

```bash
safe-npx scan-skill path/to/skill.md
```

Returns JSON with commands and policy decisions.

### `safe-npx policy <subcommand>`

Manage npx policy configuration.

```bash
# Initialize a local npx policy file
safe-npx policy init [--preset agent]

# Test a risk report against policy
safe-npx policy test <risk-report.json>
```

## Environment Variables

| Variable | Description |
|---|---|
| `SAFE_NPM_REGISTRY` | Registry URL (default: `http://localhost:3000`) |
| `SAFE_NPM_TOKEN` | Bearer token for authentication |
| `SAFE_NPM_AGENT` | Set to `1` for agent mode (JSON output) |
| `SAFE_NPM_POLICY_FILE` | Path to local policy file (default: `.safe-npm-policy.json`) |
