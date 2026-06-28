# CLI command reference

## `safe-npm`

### `safe-npm --version`
Print the version.

### `safe-npm view <pkg>[@version] [--json] [--registry <url>] [--policy <path>] [--agent]`
Resolve, download, analyze, and score a package. Prints a TTY risk card by default, or JSON with `--json`.

### `safe-npm publish [--private | --public | --stage-public] [--yes] [--json]`
Pack the current project (`npm pack`), compute integrity, run the local analyzer, and print a publish summary. Defaults to **private** visibility. Public intent requires `--public` or `--stage-public` with `--yes` (or `--json`).

> Upload to the registry is not yet implemented in the MVP; the command produces a local summary and tarball.

### `safe-npm policy init [preset] [path]`
Write a policy JSON file. Presets: `relaxed`, `default`, `strict`, `agent`, `ci`. Default path: `./safe-npm-policy.json`.

### `safe-npm policy show [--policy <path>] [--json]`
Print the effective policy.

### `safe-npm policy test <risk-report.json> [action] [--policy <path>] [--json]`
Evaluate a risk-report JSON against the policy. `action` is `install`, `exec`, or `publish` (default `exec`). Exit codes: `0` allow, `10` requires approval, `11` blocked.

## `safe-npx`

### `safe-npx --version`
Print the version.

### `safe-npx preflight <pkg>[@version] [--json]`
Run the full preflight pipeline and print the risk report + bin resolution + decision.

### `safe-npx <pkg>[@version] [args...]`
Preflight, prompt (TTY) or return JSON (agent), and — after approval — install into the execution cache and run the selected bin. User args after `--` are forwarded to the bin.

### `safe-npx scan-skill <path> [--json]`
Scan a Markdown file for `npx`/`npm exec`/`npm x`/`pnpm dlx`/`yarn dlx`/`bunx` commands and preflight each. Exit codes: `0` all pass, `10` any requires approval, `11` any blocked.

### `safe-npx trust list [--json]`
List local trust cache entries.

### `safe-npx trust revoke <pkg> [version]`
Revoke a trust entry.

### `safe-npx cache clean`
Clean the execution cache.

### `safe-npx policy init [preset] [path]` / `safe-npx policy test <risk-report.json> [action]`
Same as `safe-npm policy`.

## Global flags

| Flag | Description |
|---|---|
| `--json` | JSON output (agent/CI friendly) |
| `--registry <url>` | registry URL (default `https://registry.npmjs.org`) |
| `--policy <path>` | path to a policy JSON file |
| `--agent` | agent/CI mode (no prompts, deterministic exit codes) |
| `--yes` / `-y` | non-interactive approval |
| `--no` / `-n` | non-interactive denial |
| `--verbose` | verbose output |
| `--debug` | debug output |

## Agent/CI exit codes

| Code | Meaning |
|---|---|
| 0 | success / allowed |
| 10 | policy requires human approval |
| 11 | policy blocked execution |
| 12 | audit/security data unavailable and required |
| 13 | package could not be resolved |
| 14 | no executable bin safely selectable |
| 15 | sandbox/permission enforcement unavailable but required |
