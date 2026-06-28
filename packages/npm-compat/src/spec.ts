import { PackageSpecSchema, PackageNameSchema, type PackageSpec, SafeNpmError } from '@safe-npm/core-types';

/**
 * Parse an npm package specifier into a structured spec.
 *
 * Supports registry specs: `name`, `name@version`, `@scope/name`, `@scope/name@^1.0.0`.
 * Detects non-registry sources (git, file, directory, remote tarball) and classifies them;
 * callers can reject these in strict mode.
 *
 * This does NOT execute any package code.
 * @param options.strict - when true, reject non-registry sources (git/file/directory/remote).
 */
export function parsePackageSpec(input: string, options: { strict?: boolean } = {}): PackageSpec {
  const raw = input.trim();
  if (raw.length === 0) {
    throw new SafeNpmError({
      code: 'INVALID_SPEC',
      message: 'empty package specifier',
      details: { input },
      remediation: 'provide a package name like `is-odd` or `is-odd@3.0.1`',
    });
  }
  // Non-registry sources.
  const source = detectSource(raw);
  if (source !== 'registry') {
    if (options.strict) {
      throw new SafeNpmError({
        code: 'INVALID_SPEC',
        message: `non-registry source (${source}) rejected in strict mode`,
        details: { input, source },
        remediation: 'use a registry package spec like `is-odd@3.0.1`',
      });
    }
    // For non-registry sources we still try to extract a name best-effort, but
    // the name field is not validated as a registry name.
    return PackageSpecSchema.parse({
      raw,
      name: extractNameBestEffort(raw) ?? raw,
      specifier: undefined,
      source,
    });
  }

  // Registry spec: split name@specifier. Scoped names start with @.
  const { name, specifier } = splitNameAndSpecifier(raw);
  const nameCheck = PackageNameSchema.safeParse(name);
  if (!nameCheck.success) {
    throw new SafeNpmError({
      code: 'INVALID_SPEC',
      message: `invalid package name: ${nameCheck.error.issues.map((i) => i.message).join('; ')}`,
      details: { input, name },
      remediation: 'use a valid npm package name (lowercase, optional @scope/)',
    });
  }
  const parsed = PackageSpecSchema.safeParse({
    raw,
    name,
    specifier,
    source: 'registry',
  });
  if (!parsed.success) {
    throw new SafeNpmError({
      code: 'INVALID_SPEC',
      message: `invalid package specifier: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      details: { input, issues: parsed.error.issues },
      remediation: 'use a valid npm package name with optional @version',
    });
  }
  return parsed.data;
}

function detectSource(raw: string): PackageSpec['source'] {
  // git URLs: git+https://, git+ssh://, git://, github:user/repo
  if (/^(git\+?ssh:|git\+?https?:|git:)/i.test(raw)) return 'git';
  if (/^github:/.test(raw)) return 'git';
  // remote tarball: http(s) ending in .tgz or .tar.gz
  if (/^https?:\/\//i.test(raw) && /\.(tgz|tar\.gz|tar)(\?|$)/i.test(raw)) return 'remote';
  // file/directory: file: URL or path-like
  if (/^file:/i.test(raw)) return 'file';
  if (/^(\.\/|\/|\.\.\/|~\/)/.test(raw)) return 'directory';
  return 'registry';
}

function splitNameAndSpecifier(raw: string): { name: string; specifier?: string } {
  // Scoped name: @scope/name[@specifier]
  if (raw.startsWith('@')) {
    // find the second @ (after the scope/name part)
    const secondAt = raw.indexOf('@', 1);
    if (secondAt === -1) return { name: raw };
    return { name: raw.slice(0, secondAt), specifier: raw.slice(secondAt + 1) };
  }
  // Unscoped: name@specifier
  const at = raw.indexOf('@');
  if (at === -1) return { name: raw };
  return { name: raw.slice(0, at), specifier: raw.slice(at + 1) };
}

function extractNameBestEffort(raw: string): string | undefined {
  // For github:user/repo, use repo as name hint
  const gh = raw.match(/^github:([^/]+)\/([^/#@]+)/);
  if (gh) return gh[2];
  return undefined;
}

/** Whether a specifier string is a dist-tag (non-semver identifier like `latest`). */
export function isDistTag(specifier: string | undefined): boolean {
  if (!specifier) return false;
  // dist-tags cannot start with a digit or semver operator; if it parses as a
  // semver range it is not a dist-tag.
  return !isSemverRange(specifier);
}

/** Whether a specifier is a semver range (including exact versions). */
export function isSemverRange(specifier: string | undefined): boolean {
  if (!specifier) return false;
  // cheap check: semver ranges start with digit, ^, ~, >, <, =, *, x, or contain range syntax
  return /^[0-9^~><=*x]/i.test(specifier);
}
