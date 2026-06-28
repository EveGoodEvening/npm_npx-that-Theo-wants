/**
 * OSV (Open Source Vulnerabilities) integration (design 12.1).
 *
 * Queries the OSV API for known vulnerabilities and normalizes results
 * into risk findings.
 */

export interface OsvVulnerability {
  id: string;
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
  references?: Array<{ type: string; url: string }>;
  affected?: Array<{
    package?: { ecosystem: string; name: string };
    ranges?: Array<{ type: string; events: Array<{ introduced?: string; fixed?: string }> }>;
  }>;
}

export interface OsvResponse {
  vulns?: OsvVulnerability[];
}

export interface VulnerabilityFinding {
  id: string;
  summary: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  url?: string;
}

export interface OsvQueryOptions {
  /** Custom fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
  /** Timeout in milliseconds. */
  timeoutMs?: number;
  /** OSV API URL. */
  apiUrl?: string;
}

const DEFAULT_OSV_API_URL = 'https://api.osv.dev/v1/query';
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Query OSV for vulnerabilities affecting a package version.
 */
export async function queryOsv(
  packageName: string,
  version: string,
  options: OsvQueryOptions = {},
): Promise<VulnerabilityFinding[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = options.apiUrl ?? DEFAULT_OSV_API_URL;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package: { name: packageName, ecosystem: 'npm' },
        version,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      return []; // Graceful degradation.
    }

    const data = (await resp.json()) as OsvResponse;
    if (!data.vulns) return [];

    return data.vulns.map(normalizeVulnerability);
  } catch {
    // Graceful degradation: network errors, timeouts, etc.
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeVulnerability(vuln: OsvVulnerability): VulnerabilityFinding {
  return {
    id: vuln.id,
    summary: vuln.summary ?? vuln.id,
    severity: normalizeSeverity(vuln.severity),
    url: vuln.references?.[0]?.url,
  };
}

function normalizeSeverity(
  severity: OsvVulnerability['severity'],
): VulnerabilityFinding['severity'] {
  if (!severity || severity.length === 0) return 'unknown';
  const score = severity[0]?.score ?? '';
  // CVSS v3 vector string — extract base score.
  if (score.startsWith('CVSS:')) {
    const match = score.match(/CVSS:3\.[01]\/[A-Z]:([A-Z])\//);
    if (match) {
      const severityChar = match[1];
      if (severityChar === 'C') return 'critical';
      if (severityChar === 'H') return 'high';
      if (severityChar === 'M') return 'medium';
      if (severityChar === 'L') return 'low';
    }
  }
  return 'unknown';
}

/**
 * Simple in-memory cache for OSV responses.
 */
export class OsvCache {
  private cache = new Map<string, VulnerabilityFinding[]>();

  get(packageName: string, version: string): VulnerabilityFinding[] | undefined {
    return this.cache.get(`${packageName}@${version}`);
  }

  set(packageName: string, version: string, findings: VulnerabilityFinding[]): void {
    this.cache.set(`${packageName}@${version}`, findings);
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Query OSV with caching.
 */
export async function queryOsvCached(
  packageName: string,
  version: string,
  cache: OsvCache,
  options: OsvQueryOptions = {},
): Promise<VulnerabilityFinding[]> {
  const cached = cache.get(packageName, version);
  if (cached) return cached;
  const findings = await queryOsv(packageName, version, options);
  cache.set(packageName, version, findings);
  return findings;
}
