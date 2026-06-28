# Analyzer rule documentation

The analyzer (`packages/analyzer`) inspects tarballs without executing any package code.

## Metadata extraction

For every tarball: validates gzip/tar structure, prevents path traversal, computes SHA-512 integrity and SHA-1 shasum, extracts `package.json`, and records name, version, description, license, author, contributors, maintainers, repository, homepage, bugs, main, exports, bin, scripts, all dependency sections, files list, unpacked size, native files, and binary files.

## Script analyzer

Detects lifecycle scripts: `preinstall`, `install`, `postinstall`, `prepare`, `prepublish`, `prepublishOnly`.

Flags:
- shell metacharacters in scripts
- network tools: `curl`, `wget`, `nc`, `ssh`, `scp`
- package manager commands inside install scripts
- `node-gyp` implicit native build when `binding.gyp` is present

## Static JS analyzer

Parses `.js`, `.mjs`, `.cjs` files via acorn (AST) with regex fallback. Does not fail the whole analysis on a parse error — emits a `PARSE_FAILED` finding.

Detects imports/requires of: `fs`, `child_process`, `http`, `https`, `net`, `dns`, `dgram`, `os`, `crypto` (and `node:` variants).

Also detects:
- `process.env` access
- common secret names (`GITHUB_TOKEN`, `NPM_TOKEN`, `AWS_SECRET_ACCESS_KEY`, etc.)
- `eval`
- `new Function`
- dynamic `import()` with non-literal argument
- base64 decode followed by eval/Function/exec/spawn
- file/line evidence for high-severity findings

## Readability/obfuscation

Computes:
- minified-line ratio (lines > 500 chars with many statements)
- average identifier length (AST)
- string entropy (Shannon) for long strings
- giant string arrays (> 50 string literals)
- source map availability

Produces `readability` facts: `likelyMinified`, `likelyObfuscated`, `sourceMapsPresent`, `humanReadableFileRatio`.

## Native artifacts

Detects `.node` native addons, `binding.gyp`, and common binary file types.

## Diff analysis

Compares a version against the previous visible version:
- file added/removed/modified counts + changed bytes
- new/removed bin entries
- new/removed lifecycle scripts
- dependency changes
- repository URL changes
- maintainer set changes

Risky deltas emitted as findings: `DIFF_NEW_INSTALL_SCRIPT`, `DIFF_NEW_CHILD_PROCESS`, `DIFF_NEW_NETWORK`, `DIFF_NEW_NATIVE`, `DIFF_REPO_CHANGED`, `DIFF_MAINTAINER_CHANGED`.

## Inferred permissions

From detected imports: `fs` (read/write current dir), `net` (if http/https/net/dns/dgram), `childProcess`, `workerThreads`, `ffi`, `native`, `installScripts`. Compared against declared `safeNpm.permissions` in `package.json` to surface mismatches.

## No-exec guarantee

The analyzer never executes package code. The security test suite includes a marker-file test that fails if any preflight executes fixture package code.
