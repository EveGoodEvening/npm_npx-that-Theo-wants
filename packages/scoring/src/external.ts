import type { RiskFinding, RiskTier, RiskReport } from '@safe-npm/core-types';
import { scoreToTier } from './score.js';
/** OSV vulnerability record (subset). */
export interface OsvVulnerability {
  id: string;
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package?: { ecosystem: string; name: string };
    ranges?: Array<{ type: string; events: Array<Record<string, string>> }>;
  }>;
}

export interface OsvResponse {
  vulns?: OsvVulnerability[];
}

export interface OsvQueryOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Query OSV for vulnerabilities affecting a package/version.
 * Gracefully degrades on failure (returns empty list). Caches responses by
 * package+version keyed on the endpoint.
 */
const osvCache: Map<string, { vulnerabilities: OsvVulnerability[]; findings: RiskFinding[]; available: boolean; cachedAt: number }> = new Map();
const OSV_CACHE_TTL_MS = 60_000;

export async function queryOsv(
  packageName: string,
  version: string,
  options: OsvQueryOptions = {},
): Promise<{ vulnerabilities: OsvVulnerability[]; findings: RiskFinding[]; available: boolean }> {
  const endpoint = options.endpoint ?? 'https://api.osv.dev/v1/query';
  const fetchImpl = options.fetchImpl ?? fetch;
  const ecosystem = packageName.startsWith('@') ? 'npm' : 'npm';
  const cacheKey = `${endpoint}|${packageName}|${version}`;
  const cached = osvCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < OSV_CACHE_TTL_MS) {
    return {
      vulnerabilities: cached.vulnerabilities,
      findings: cached.findings,
      available: cached.available,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version,
        package: { ecosystem, name: packageName },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { vulnerabilities: [], findings: [], available: false };
    }
    const data = (await res.json()) as OsvResponse;
    const vulns = data.vulns ?? [];
    const findings: RiskFinding[] = vulns.map((v) => ({
      code: 'KNOWN_VULNERABILITY',
      severity: osvSeverityToFinding(v),
      message: `known vulnerability ${v.id}${v.summary ? ': ' + v.summary : ''}`,
      evidence: [v.id],
    }));
    const result = { vulnerabilities: vulns, findings, available: true };
    osvCache.set(cacheKey, { ...result, cachedAt: Date.now() });
    return result;
  } catch {
    return { vulnerabilities: [], findings: [], available: false };
  } finally {
    clearTimeout(timer);
  }
}

function osvSeverityToFinding(v: OsvVulnerability): RiskFinding['severity'] {
  const sev = v.severity?.[0]?.score ?? '';
  if (/critical|9\.[0-9]|10\.0/i.test(sev)) return 'critical';
  if (/high|7\.[0-9]|8\.[0-9]/i.test(sev)) return 'high';
  if (/medium|4\.[0-9]|5\.[0-9]|6\.[0-9]/i.test(sev)) return 'medium';
  return 'low';
}

/** Normalize a GitHub/GitLab repository URL to owner/repo form. */
export function normalizeRepoUrl(repo: string | undefined): { owner: string; repo: string } | undefined {
  if (!repo) return undefined;
  // github.com/owner/repo(.git)?
  const gh = repo.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (gh) return { owner: gh[1]!, repo: gh[2]! };
  const gl = repo.match(/gitlab\.com[/:]([^/]+)\/([^/.]+)/i);
  if (gl) return { owner: gl[1]!, repo: gl[2]! };
  return undefined;
}

export interface RepoHealthResult {
  score?: number;
  available: boolean;
  findings: RiskFinding[];
}

export interface RepoHealthOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const repoHealthCache: Map<string, RepoHealthResult & { cachedAt: number }> = new Map();
const REPO_HEALTH_CACHE_TTL_MS = 5 * 60_000;

/**
 * Look up OpenSSF Scorecard for a repository. Gracefully degrades.
 * Uses the scorecard API; on failure returns available:false.
 */
export async function queryRepoHealth(
  repoUrl: string | undefined,
  options: RepoHealthOptions = {},
): Promise<RepoHealthResult> {
  const normalized = normalizeRepoUrl(repoUrl);
  if (!normalized) return { available: false, findings: [] };
  const endpoint =
    options.endpoint ??
    `https://api.securityscorecards.dev/v1/score?platform=github&org=${normalized.owner}&repo=${normalized.repo}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheKey = `${normalized.owner}/${normalized.repo}`;
  const cached = repoHealthCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < REPO_HEALTH_CACHE_TTL_MS) {
    return { score: cached.score, available: cached.available, findings: cached.findings };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetchImpl(endpoint, { signal: controller.signal });
    if (!res.ok) return { available: false, findings: [] };
    const data = (await res.json()) as { score?: number; checks?: Array<{ name: string; score: number }> };
    const score = data.score;
    const findings: RiskFinding[] = [];
    if (score !== undefined && score < 3) {
      findings.push({
        code: 'LOW_REPO_HEALTH',
        severity: 'medium',
        message: `OpenSSF Scorecard score ${score}/10 is low`,
        evidence: [repoUrl ?? ''],
      });
    }
    const result: RepoHealthResult = { score, available: true, findings };
    repoHealthCache.set(cacheKey, { ...result, cachedAt: Date.now() });
    return result;
  } catch {
    return { available: false, findings: [] };
  } finally {
    clearTimeout(timer);
  }
}

export type ProvenanceStatus = 'verified' | 'missing' | 'mismatch' | 'unsupported';

export interface ProvenanceInput {
  /** Tarball digest (sha512 SRI). */
  tarballDigest?: string;
  /** Provenance subject digest from npm packument `_attestations` or `dist.attestations`. */
  provenanceSubjectDigest?: string;
  /** Source repository URL claimed by provenance. */
  provenanceRepo?: string;
  /** Source repository URL from package.json. */
  packageRepo?: string;
}

/**
 * Validate provenance: subject digest must match tarball digest, and source
 * repo must match package metadata. Returns a status + findings.
 */
export function validateProvenance(input: ProvenanceInput): {
  status: ProvenanceStatus;
  findings: RiskFinding[];
} {
  if (!input.provenanceSubjectDigest) {
    return { status: 'missing', findings: [] };
  }
  // provenance present but no tarball digest to compare against -> unsupported verification
  if (!input.tarballDigest) {
    return { status: 'unsupported', findings: [] };
  }
  const findings: RiskFinding[] = [];
  let mismatch = false;
  if (input.tarballDigest && input.provenanceSubjectDigest !== input.tarballDigest) {
    mismatch = true;
    findings.push({
      code: 'PROVENANCE_DIGEST_MISMATCH',
      severity: 'critical',
      message: 'provenance subject digest does not match tarball digest',
      evidence: [input.provenanceSubjectDigest, input.tarballDigest ?? ''],
    });
  }
  if (
    input.provenanceRepo &&
    input.packageRepo &&
    normalizeRepoUrl(input.provenanceRepo)?.repo !== normalizeRepoUrl(input.packageRepo)?.repo
  ) {
    mismatch = true;
    findings.push({
      code: 'PROVENANCE_REPO_MISMATCH',
      severity: 'critical',
      message: 'provenance source repo does not match package repository',
      evidence: [input.provenanceRepo, input.packageRepo],
    });
  }
  return { status: mismatch ? 'mismatch' : 'verified', findings };
}

/** Map a repo health score to a tier contribution signal. */
export function repoHealthToSignal(result: RepoHealthResult): { bonus: number; confidenceDelta: number } {
  if (!result.available || result.score === undefined) return { bonus: 0, confidenceDelta: -2 };
  if (result.score >= 7) return { bonus: 3, confidenceDelta: 2 };
  if (result.score >= 5) return { bonus: 0, confidenceDelta: 0 };
  return { bonus: -3, confidenceDelta: -2 };
}

export type { RiskTier };


export interface EnrichmentInput {
  riskReport: RiskReport;
  osv: { findings: RiskFinding[]; available: boolean };
  repoHealth: RepoHealthResult;
  provenance: { status: ProvenanceStatus; findings: RiskFinding[] };
}

/**
 * Merge external-signal findings into a risk report: adds vulnerability,
 * repo-health, and provenance findings as warnings/blockers and adjusts
 * confidence. Returns a new report (does not mutate input).
 */
export function enrichRiskReport(input: EnrichmentInput): RiskReport {
  const { riskReport } = input;
  const warnings = [...riskReport.warnings];
  const blockers = [...riskReport.blockers];
  let confidence = riskReport.confidence;
  let score = riskReport.score;

  for (const f of input.osv.findings) warnings.push(f);
  if (!input.osv.available) confidence = Math.max(10, confidence - 3);

  for (const f of input.repoHealth.findings) warnings.push(f);
  const repoSignal = repoHealthToSignal(input.repoHealth);
  confidence = Math.max(10, Math.min(100, confidence + repoSignal.confidenceDelta));
  // apply repo-health score bonus/penalty (clamped)
  score = Math.max(0, Math.min(100, score + repoSignal.bonus));

  for (const f of input.provenance.findings) {
    if (f.severity === 'critical') blockers.push(f);
    else warnings.push(f);
  }

  // recompute tier: blockers force blocked, otherwise derive from score
  const tier = blockers.length > 0 ? 'blocked' : scoreToTier(score);

  return {
    ...riskReport,
    score,
    tier,
    warnings,
    blockers,
    confidence,
    facts: {
      ...riskReport.facts,
      source: {
        ...(riskReport.facts.source ?? { provenance: 'missing' }),
        provenance: input.provenance.status,
      },
    },
  };
}
