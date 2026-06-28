/**
 * Repository health integration (design 12.2).
 *
 * Extracts repository URL from package metadata, normalizes it,
 * and looks up OpenSSF Scorecard data.
 */

export interface RepoHealthResult {
  url: string;
  platform: 'github' | 'gitlab' | 'bitbucket' | 'other';
  normalizedUrl: string;
  scorecardScore?: number;
  scorecardGrade?: string;
  archived?: boolean;
  stars?: number;
  error?: string;
}

export interface RepoHealthOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Scorecard API URL. */
  scorecardApiUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Extract repository URL from package metadata.
 */
export function extractRepoUrl(
  repository: string | { type: string; url: string } | undefined,
): string | undefined {
  if (!repository) return undefined;
  if (typeof repository === 'string') return repository;
  return repository.url;
}

/**
 * Normalize a GitHub/GitLab URL to a canonical form.
 */
export function normalizeRepoUrl(url: string): { platform: RepoHealthResult['platform']; normalizedUrl: string } {
  // Handle git+https:// and git+ssh:// prefixes.
  let cleaned = url.replace(/^git\+/, '');
  // Handle ssh://git@.
  cleaned = cleaned.replace(/^ssh:\/\/git@/, 'https://');
  // Handle git@github.com:owner/repo.git.
  cleaned = cleaned.replace(/^git@([^:]+):/, 'https://$1/');

  // Detect platform.
  let platform: RepoHealthResult['platform'] = 'other';
  if (cleaned.includes('github.com')) platform = 'github';
  else if (cleaned.includes('gitlab.com')) platform = 'gitlab';
  else if (cleaned.includes('bitbucket.org')) platform = 'bitbucket';

  // Remove .git suffix.
  cleaned = cleaned.replace(/\.git$/, '');
  // Remove trailing slash.
  cleaned = cleaned.replace(/\/$/, '');

  return { platform, normalizedUrl: cleaned };
}

/**
 * Look up OpenSSF Scorecard data for a repository.
 */
export async function lookupScorecard(
  repoUrl: string,
  options: RepoHealthOptions = {},
): Promise<RepoHealthResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { platform, normalizedUrl } = normalizeRepoUrl(repoUrl);

  const result: RepoHealthResult = {
    url: repoUrl,
    platform,
    normalizedUrl,
  };

  if (platform !== 'github') {
    // Scorecard primarily supports GitHub.
    return result;
  }

  // Extract owner/repo from URL.
  const match = normalizedUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return result;
  const ownerRepo = match[1];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const apiUrl = options.scorecardApiUrl ?? `https://api.securityscorecards.dev/v1/projects/github.com/${ownerRepo}`;
    const resp = await fetchImpl(apiUrl, { signal: controller.signal });

    if (!resp.ok) {
      result.error = `scorecard API returned ${resp.status}`;
      return result;
    }

    const data = (await resp.json()) as { score?: number; grade?: string };
    result.scorecardScore = data.score;
    result.scorecardGrade = data.grade;
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'lookup failed';
  } finally {
    clearTimeout(timeoutId);
  }

  return result;
}

/**
 * Compute a repo health score component (0-100).
 */
export function repoHealthScore(result: RepoHealthResult): number {
  if (result.error || result.scorecardScore === undefined) {
    return 50; // Neutral when no data.
  }
  // Scorecard scores are typically 0-10. Scale to 0-100.
  return Math.min(100, Math.max(0, result.scorecardScore * 10));
}
