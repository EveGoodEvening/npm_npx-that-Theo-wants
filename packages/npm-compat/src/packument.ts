import type { Packument, PackumentVersion } from './registry.js';
import type {
  PublishId,
  TarballIntegrity,
  VersionStatus,
} from '@safe-npm/core-types';

/**
 * Internal package/version model used by the safe-npm registry. The converter
 * turns this into an npm-compatible packument accepted by `pacote`/npm CLI.
 */
export interface InternalPackage {
  name: string;
  scope?: string;
  distTags: Array<{ tag: string; version: string; publishId: PublishId }>;
  versions: InternalVersion[];
  /** ISO timestamps keyed by version, plus `created`/`modified`. */
  time?: Record<string, string>;
  maintainers?: Array<{ name?: string; email?: string }>;
}

export interface InternalVersion {
  version: string;
  publishId: PublishId;
  status: VersionStatus;
  /** Optional deprecation message; included when status is `deprecated`. */
  deprecated?: string;
  tarballUrl: string;
  integrity?: TarballIntegrity;
  shasum?: string;
  unpackedSize?: number;
  fileCount?: number;
  signatures?: Array<{ keyid: string; sig: string }>;
  /** Raw npm version metadata (main, exports, bin, scripts, deps, license...). */
  metadata: Omit<PackumentVersion, 'name' | 'version' | 'dist' | 'deprecated'>;
}

export interface GeneratePackumentOptions {
  /**
   * Whether the caller is authorized to see retracted/quarantined versions.
   * Default: false (excludes retracted versions from normal packuments).
   */
  includeRetracted?: boolean;
  /** Tarball URL base; if omitted, the version's own `tarballUrl` is used. */
  tarballBaseUrl?: string;
}

/**
 * Convert an {@link InternalPackage} into an npm-compatible packument.
 *
 * - Excludes retracted and quarantined versions from normal packuments unless
 *   `includeRetracted` is set.
 * - Includes `deprecated` warnings for deprecated versions.
 * - Includes `dist.tarball`, `dist.integrity`, `dist.shasum`, and
 *   `dist.signatures` when present.
 */
export function generatePackument(
  pkg: InternalPackage,
  options: GeneratePackumentOptions = {},
): Packument {
  const distTags: Record<string, string> = {};
  const visibleVersions = new Set<string>();

  for (const v of pkg.versions) {
    if (!isVersionVisible(v.status, options.includeRetracted ?? false)) continue;
    visibleVersions.add(v.version);
  }

  for (const tag of pkg.distTags) {
    if (visibleVersions.has(tag.version)) {
      distTags[tag.tag] = tag.version;
    }
  }

  const versions: Record<string, PackumentVersion> = {};
  for (const v of pkg.versions) {
    if (!visibleVersions.has(v.version)) continue;
    const tarball = options.tarballBaseUrl
      ? `${options.tarballBaseUrl.replace(/\/$/, '')}/${tarballFileName(pkg.name, v)}`
      : v.tarballUrl;
    versions[v.version] = {
      ...v.metadata,
      name: pkg.name,
      version: v.version,
      ...(v.deprecated ? { deprecated: v.deprecated } : {}),
      dist: {
        tarball,
        ...(v.integrity ? { integrity: v.integrity } : {}),
        ...(v.shasum ? { shasum: v.shasum } : {}),
        ...(v.unpackedSize !== undefined ? { unpackedSize: v.unpackedSize } : {}),
        ...(v.fileCount !== undefined ? { fileCount: v.fileCount } : {}),
        ...(v.signatures && v.signatures.length > 0 ? { signatures: v.signatures } : {}),
      },
    };
  }

  const packument: Packument = {
    name: pkg.name,
    'dist-tags': distTags,
    versions,
    ...(pkg.time ? { time: pkg.time } : {}),
    ...(pkg.maintainers ? { maintainers: pkg.maintainers } : {}),
  };
  return packument;
}

function isVersionVisible(status: VersionStatus, includeRetracted: boolean): boolean {
  switch (status) {
    case 'public':
    case 'staged_public':
    case 'private':
    case 'deprecated':
      return true;
    case 'retracted':
      return includeRetracted;
    case 'quarantined':
    case 'deleted':
      return false;
    default:
      return false;
  }
}

/** Build the npm-style tarball filename: `<unscoped-name>-<version>.tgz`. */
export function tarballFileName(packageName: string, version: InternalVersion): string {
  const unscoped = packageName.startsWith('@') ? packageName.split('/').pop()! : packageName;
  return `${unscoped}-${version.version}.tgz`;
}
