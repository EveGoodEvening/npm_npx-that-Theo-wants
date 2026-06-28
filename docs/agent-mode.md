# Agent / CI JSON mode guide

All safe-npm / safe-npx user-facing operations have JSON equivalents and deterministic exit codes for AI agents and CI systems.

## Enabling agent mode

Any of:
- `--agent` flag
- `--json` flag
- `SAFE_NPX_AGENT=1` environment variable
- non-interactive CI defaults

Agent mode never prompts.

## Preflight

```bash
safe-npx preflight is-odd@3.0.1 --json
```

```json
{
  "package": "is-odd",
  "version": "3.0.1",
  "score": 100,
  "tier": "excellent",
  "confidence": 90,
  "bin": "is-odd",
  "decision": { "allow": true, "decision": "allow", "action": "exec", ... },
  "riskReport": { ... }
}
```

## Execution

```bash
safe-npx --agent semver@7.8.5 -- 1.2.3
```

Emits JSON with `decision`, `package`, `version`, `score`, `tier`, `policy`, and `recommendedUserMessage`. After execution, emits `{ "executed": true, "exitCode": 0, "enforced": false }`.

## skill.md scanning

```bash
safe-npx scan-skill ./SKILL.md --json
```

```json
{
  "file": "SKILL.md",
  "commands": [
    {
      "line": 4,
      "raw": "npx some-tool@latest --fix",
      "tool": "npx",
      "package": "some-tool",
      "specifier": "latest",
      "spec": "some-tool@latest",
      "resolvedVersion": "1.9.0",
      "decision": "blocked",
      "reason": "blocked by policy: exec.blockTiers, exec.minimumScore"
    }
  ]
}
```

Exit codes: `0` all pass, `10` any requires approval, `11` any blocked.

## Policy testing

```bash
safe-npm policy test risk-report.json exec --json
```

Returns the `PolicyDecision` JSON. Exit codes: `0` allow, `10` requires approval, `11` blocked.

## Publish

```bash
safe-npm publish --json
```

Returns `{ "published": false, "summary": { ... }, "note": "upload not implemented in MVP" }`.

## Error output

In JSON mode, errors are structured:

```json
{ "error": { "code": "PACKAGE_NOT_FOUND", "message": "...", "details": {}, "remediation": "..." } }
```
