import { z } from 'zod';

/**
 * Package identity and versioning primitives.
 */

/** Unscoped: `is-odd`. Scoped: `@scope/name`. */
export const PackageName = z
  .string()
  .min(1)
  .regex(
    /^(@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9._-]*$/i,
    'invalid npm package name',
  );
export type PackageName = z.infer<typeof PackageName>;

/** Semver-ish version string, or dist-tag. Kept permissive for compatibility. */
export const PackageVersion = z.string().min(1);
export type PackageVersion = z.infer<typeof PackageVersion>;

/** Specifier resolved from `npm-package-arg` style input. */
export const PackageSpecSource = z.enum([
  'registry',
  'git',
  'file',
  'directory',
  'remote',
]);
export type PackageSpecSource = z.infer<typeof PackageSpecSource>;

export const PackageSpec = z.object({
  /** Raw input string, e.g. `is-odd@latest` or `@scope/pkg@1.2.3`. */
  raw: z.string().min(1),
  /**
   * Package name. Always present for registry sources; may be empty for
   * non-registry sources (git/file/directory/remote) where npm-package-arg
   * does not produce a name. Use {@link PackageName} to validate registry names.
   */
  name: z.string(),
  /** Semver range, exact version, dist-tag, or empty for `latest`. */
  specifier: z.string(),
  /** Resolved source type. */
  source: PackageSpecSource,
});
export type PackageSpec = z.infer<typeof PackageSpec>;

/** Unique publish identifier; allows safe semver tuple reuse. */
export const PublishId = z.string().min(1);
export type PublishId = z.infer<typeof PublishId>;

/** Integrity string in npm format, e.g. `sha512-...`. */
export const TarballIntegrity = z
  .string()
  .regex(/^(sha512|sha1)-[A-Za-z0-9+/=]+$/, 'invalid integrity string');
export type TarballIntegrity = z.infer<typeof TarballIntegrity>;

export const Visibility = z.enum(['private', 'public', 'quarantined']);
export type Visibility = z.infer<typeof Visibility>;

export const VersionStatus = z.enum([
  'private',
  'staged_public',
  'public',
  'retracted',
  'deprecated',
  'quarantined',
  'deleted',
]);
export type VersionStatus = z.infer<typeof VersionStatus>;
