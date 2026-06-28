# Analyzer Rule Documentation

## Metadata Analysis

### Package.json Inspection

- **Name validation**: Checks for typosquat-like names (e.g., `lodsh` vs `lodash`).
- **Version parsing**: Validates semver compliance.
- **License check**: Flags missing or unusual licenses.
- **Repository URL**: Extracted for repo health analysis.

### Native Artifact Detection

- **binding.gyp**: Flags presence of `binding.gyp` (native build).
- **.node files**: Flags prebuilt native addons.
- **Source files**: Flags `.cc`, `.cpp`, `.h` native source files.

## Lifecycle Script Analysis

Detects and flags lifecycle scripts:

- `preinstall`, `install`, `postinstall`
- `preuninstall`, `uninstall`, `postuninstall`

### Script Flags

- `shell_metacharacters`: Script uses shell metacharacters (`|`, `&&`, `;`, `$()`).
- `network_tool`: Script invokes network tools (`curl`, `wget`, `nc`).
- `package_manager`: Script invokes package managers (`npm`, `yarn`, `pnpm`).
- `node_gyp_native_build`: Script triggers native build (with binding.gyp).

## Static Analysis (AST-based)

Uses `acorn` to parse JavaScript and detect dangerous patterns:

### Dangerous Builtins

- `child_process`: `exec`, `execSync`, `spawn`, `spawnSync`, `fork`
- `https`/`http`: `request`, `get`, `fetch`
- `net`: `connect`, `createConnection`
- `fs`: Sensitive file operations (in strict mode)

### Environment Token Access

Flags access to sensitive environment variables:
- `GITHUB_TOKEN`, `GH_TOKEN`
- `NPM_TOKEN`, `NODE_AUTH_TOKEN`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Generic patterns: `*_TOKEN`, `*_SECRET`, `*_KEY`

### Network Access

Flags outbound network access:
- `https.request()`, `http.request()`
- `fetch()` with external URLs
- `net.connect()` to external hosts

### Code Execution

Flags dynamic code execution:
- `eval()`, `Function()`
- `child_process.exec()`, `child_process.spawn()`
- `vm.runInNewContext()`

## Readability Analysis

Detects obfuscated or minified code:

- **Low readability score**: Files with high entropy, short variable names, escaped strings.
- **Hex-encoded strings**: Flags `\x68\x65\x6c\x6c\x6f` patterns.
- **Eval with encoded strings**: Flags `eval()` with encoded arguments.

## Diff Analysis

Compares versions to detect:

- **New lifecycle scripts**: Scripts added in new version.
- **New native artifacts**: Native addons added in new version.
- **Dependency changes**: Significant dependency additions/removals.
- **Repository URL changes**: Source repository changed.
- **Maintainer changes**: New maintainers added.
