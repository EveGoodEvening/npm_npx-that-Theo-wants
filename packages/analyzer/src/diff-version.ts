/**
 * Previous version selection (design 11.1).
 *
 * Finds the previous visible version of a package for diff comparison.
 */
import * as semver from 'semver';

export interface VersionInfo {
  version: string;
  status: string;
  publishedAt?: string;
}

/**
 * Find the previous visible version of a package.
 *
 * Rules (design 11.1):
 * 1. Prefer the highest semver version that is lower than the current version.
 * 2. Fallback to the current `latest` dist-tag before publish.
 * 3. Ignore retracted/quarantined versions unless in forensic admin mode.
 */
export function findPreviousVersion(
  currentVersion: string,
  allVersions: VersionInfo[],
  options: { latestVersion?: string; forensicMode?: boolean } = {},
): VersionInfo | null {
  const { latestVersion, forensicMode = false } = options;

  // Filter visible versions (exclude retracted/quarantined unless forensic mode).
  const visibleStatuses = forensicMode
    ? ['private', 'staged_public', 'public', 'deprecated', 'quarantined', 'retracted']
    : ['private', 'staged_public', 'public', 'deprecated'];

  let candidates = allVersions.filter((v) => visibleStatuses.includes(v.status));

  // Exclude the current version.
  candidates = candidates.filter((v) => v.version !== currentVersion);

  if (candidates.length === 0) return null;

  // Sort by semver descending.
  const sorted = candidates
    .filter((v) => semver.valid(v.version))
    .sort((a, b) => semver.rcompare(a.version, b.version));

  // Find the highest version lower than current.
  const current = semver.parse(currentVersion);
  if (current) {
    const lower = sorted.find((v) => semver.lt(v.version, currentVersion));
    if (lower) return lower;
  }

  // Fallback to the current `latest` dist-tag.
  if (latestVersion && latestVersion !== currentVersion) {
    const latest = candidates.find((v) => v.version === latestVersion);
    if (latest) return latest;
  }

  // No suitable previous version found.
  return null;
}
