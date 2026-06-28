# CLAUDE.md — repo-level notes

## Lessons

- **`tsc -b --noEmit` conflicts with composite project references.** Referenced projects in a composite build may not disable emit. Use `tsc -b` (which emits `.d.ts`/`.js` into each package's `dist/`) for typecheck scripts across the monorepo.
- **`acorn` has no default export under ESM/`esModuleInterop` strictness.** Use `import * as acorn from 'acorn'` instead of `import acorn from 'acorn'`.
- **`tar` (npm) `list`/`extract` with `onentry` swallowing throws causes unhandled stream errors.** Do not throw inside `onentry`; collect entries during the stream and validate after it closes, then run a second `extract` pass.
- **`ssri` types are unreliable in this setup.** Implement integrity verification directly with `node:crypto` (`sha512`/`sha1` base64 digests + timing-safe compare) instead of depending on `ssri`/`@types/ssri`.
- **`npm-package-arg` `Result` is a discriminated union; `subSpec` only exists on `AliasResult`.** Narrow with `result.type === 'alias'` and cast to `AliasResult` before accessing `subSpec`.
- **`semver.maxSatisfying` excludes prereleases by default.** `*` will not match `3.1.0-beta.0` unless `includePrerelease` is set.
- **`file:./pkg` is classified as `directory` by `npm-package-arg`, while `file:./pkg.tgz` is `file`.** Test both cases separately.
- **Zod schemas used as parse boundaries should convert errors to domain errors.** Wrap `PackageSpec.parse(...)` in try/catch and rethrow as `InvalidSpecError` so callers don't see `ZodError`.
- **`PackageSpec.name` must allow empty strings for non-registry sources** (git/file/directory/remote) where `npm-package-arg` does not produce a name. Validate registry names separately with `PackageName`.
- **Live network tests should be gated by an env var** (e.g. `SAFE_NPM_RUN_NETWORK_TESTS=1`) and skipped by default so CI doesn't hit the network.

## Conventions

- Use `env.example` (not `.env.example`) for the env template.
- New configuration goes under `.devin/` (skills, config) — never `.claude/` or `.cursor/`.
- Package manager: pnpm with workspace + `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`.
- Build/test: `pnpm run check` (lint + typecheck + test across all workspaces).
