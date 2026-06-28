# `safe-npm publish` private-first guide

`safe-npm publish` is private by default. Accidental public publication should be harder than intentional public publication.

## Basic private publish

```bash
safe-npm publish
```

This:
1. Previews the tarball contents (`npm pack --json --dry-run`).
2. Packs the project into a temp directory.
3. Computes SHA-512 integrity and SHA-1 shasum.
4. Runs the local analyzer and scoring.
5. Prints a publish summary with visibility `private`.

No upload occurs in the MVP; the command produces a local summary and tarball.

## Public intent

Public publication requires explicit intent:

```bash
safe-npm publish --public --yes
safe-npm publish --stage-public --yes
safe-npm publish --public --json
```

Without `--yes` (or `--json` for non-interactive use), `--public`/`--stage-public` is rejected.

## JSON output

```bash
safe-npm publish --json
```

Returns a JSON object with `summary` (name, version, visibility, tarball size, integrity, shasum, score, tier, blockers, warnings).

## Staged public release

`--stage-public` creates a staged release for review (the staging/approval flow requires the registry API, not yet implemented in the MVP).
