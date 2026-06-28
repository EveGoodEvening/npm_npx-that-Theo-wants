# `safe-npx` risk card guide

`safe-npx` shows a risk card before running a package not previously trusted.

## Basic execution

```bash
safe-npx <pkg>[@version] [args...]
```

Flow:
1. Parse the package spec.
2. Resolve the exact version from the registry.
3. Download the tarball to a quarantine cache (integrity verified).
4. Analyze the tarball (metadata, scripts, static code, readability, native artifacts).
5. Compute a security score.
6. Render a risk card (TTY) or JSON (agent mode).
7. Apply policy.
8. If allowed (or approved), install into an isolated execution cache and run the selected bin.

## TTY risk card

```
Package: create-example@2.4.1

Bin:        create-example -> bin/cli.js
Author:     alice
Maintainers: alice

Tarball
  Size:       412 kB / 1.8 MB unpacked / 64 files
Permissions
  Inferred:   fs write current directory, net none, child_process false
Security
  Score:      82/100 good
  Confidence: 91/100
  Blockers:   0
  Warnings:   1

Proceed? [y]es [n]o [d]etails
```

## Agent / CI mode

```bash
safe-npx --agent <pkg> -- [args...]
safe-npx --json <pkg>
SAFE_NPX_AGENT=1 safe-npx <pkg>
```

Agent mode never prompts. It emits deterministic JSON and exit codes:

| Code | Meaning |
|---|---|
| 0 | allowed and executed successfully |
| 10 | policy requires human approval |
| 11 | policy blocked execution |
| 13 | package could not be resolved |
| 14 | no safe bin selectable |
| 15 | permission enforcement unavailable but required |

## Preflight only

```bash
safe-npx preflight <pkg>[@version] --json
```

Runs the full pipeline without executing. Includes bin resolution and the policy decision.

## Trust cache

After approving a package, the trust cache records the decision so subsequent runs of the same exact version + digest skip the prompt:

```bash
safe-npx trust list
safe-npx trust revoke <pkg> [version]
```

## Execution cache

Installed packages are cached by package name, version, tarball digest, and policy hash — never in the project's `node_modules`.

```bash
safe-npx cache clean
```

## Permission enforcement

For Node-based bins, `safe-npx` applies the Node permission model (`--permission` with `--allow-fs-read/write`, `--deny-child-process`, `--deny-worker`, `--deny-addons`, `--deny-net`) when the policy requires enforcement and the Node version supports it. If enforcement is required but unavailable, `safe-npx` exits with code `15`.
