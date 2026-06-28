import type {
  TarballIntegrity,
  VersionStatus,
  PublishId,
} from '@safe-npm/core-types';

/** Internal version model used by the registry to generate npm packuments. */
export interface InternalVersion {
  version: string;
  publishId: PublishId;
  status: VersionStatus;
  publishedAt: string; // ISO datetime
  publisher?: { name: string };
  maintainers?: Array<{ name: string; email?: string }>;
  tarballObjectKey: string;
  tarballIntegrity?: TarballIntegrity;
  tarballShasum?: string;
  signatures?: Array<{ keyid: string; sig: string }>;
  /** npm packument version fields merged in. */
  manifest: {
    description?: string;
    license?: string;
    author?: string | { name?: string; email?: string };
    main?: string;
    exports?: unknown;
    bin?: string | Record<string, string>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    homepage?: string;
    repository?: string | { type?: string; url?: string };
    bugs?: string | { url?: string };
  };
  deprecated?: string;
}

export interface InternalPackage {
  name: string;
  versions: InternalVersion[];
  distTags: Record<string, string>; // tag -> version
  createdAt: string;
}

export interface GeneratePackumentOptions {
  /** Base URL for tarball links, e.g. `https://registry.safe.example`. */
  registryBaseUrl: string;
  /** Whether to include retracted versions (default false). */
  includeRetracted?: boolean;
  /** Whether to include deprecated versions (default true). */
  includeDeprecated?: boolean;
}

/**
 * Generate an npm-compatible packument from the internal package model.
 *
 * - Excludes retracted versions from normal resolution unless `includeRetracted`.
 * - Includes deprecation warnings for deprecated versions.
 * - Tarball URLs are publish-ID/digest-specific to preserve lockfile safety.
 */
export function generatePackument(
  pkg: InternalPackage,
  options: GeneratePackumentOptions,
): Record<string, unknown> {
  const base = options.registryBaseUrl.replace(/\/$/, '');
  const includeRetracted = options.includeRetracted ?? false;
  const includeDeprecated = options.includeDeprecated ?? true;

  const versions: Record<string, Record<string, unknown>> = {};
  const time: Record<string, string> = { created: pkg.createdAt, modified: new Date().toISOString() };

  for (const v of pkg.versions) {
    if (v.status === 'retracted' && !includeRetracted) continue;
    if (v.status === 'deprecated' && !includeDeprecated) continue;
    if (v.status === 'deleted') continue;
    if (v.status === 'quarantined') continue; // quarantined removed from normal packuments

    const tarballName = `${pkg.name.replace('@', '').replace('/', '-')}-${v.version}.tgz`;
    // publish-ID-specific tarball path for lockfile safety
    const tarballUrl = `${base}/${encodeURIComponent(pkg.name).replace('%2F', '%2f')}/-/${tarballName}?publishId=${encodeURIComponent(v.publishId)}`;

    const versionEntry: Record<string, unknown> = {
      name: pkg.name,
      version: v.version,
      ...v.manifest,
      _hasPublishId: v.publishId,
      dist: {
        tarball: tarballUrl,
        ...(v.tarballIntegrity ? { integrity: v.tarballIntegrity } : {}),
        ...(v.tarballShasum ? { shasum: v.tarballShasum } : {}),
        ...(v.signatures ? { signatures: v.signatures } : {}),
      },
    };
    if (v.deprecated) {
      versionEntry.deprecated = v.deprecated;
    }
    versions[v.version] = versionEntry;
    time[v.version] = v.publishedAt;
  }

  const packument: Record<string, unknown> = {
    name: pkg.name,
    'dist-tags': { ...pkg.distTags },
    versions,
    time,
  };

  // maintainers from the latest non-retracted version
  const visibleVersions = pkg.versions.filter(
    (v) => v.status !== 'retracted' && v.status !== 'deleted' && v.status !== 'quarantined',
  );
  const latestVersion = pkg.distTags.latest
    ? visibleVersions.find((v) => v.version === pkg.distTags.latest)
    : visibleVersions[visibleVersions.length - 1];
  if (latestVersion?.maintainers) {
    packument.maintainers = latestVersion.maintainers;
  }

  return packument;
}
