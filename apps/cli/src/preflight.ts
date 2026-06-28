import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  downloadTarball,
  fetchPackument,
  parsePackageSpec,
  resolveBin,
  resolveVersion,
} from '@safe-npm/npm-compat';
import { analyzeTarball, QuarantineCache } from '@safe-npm/analyzer';
import {
  scoreAnalysis,
  renderJson,
  renderTty,
  inferPermissions,
  evaluatePolicy,
  DEFAULT_HUMAN_POLICY,
  DEFAULT_AGENT_POLICY,
} from '@safe-npm/scoring';
import type { AnalysisReport, RiskReport, PolicyDecision, PolicySet } from '@safe-npm/core-types';

/**
 * Preflight pipeline: resolve → download → analyze → score → (optional) policy.
 *
 * This is the shared core used by `safe-npm view --risk`, `safe-npx preflight`,
 * and `safe-npx <pkg>`. It never executes package code.
 */

export interface PreflightOptions {
  registryUrl: string;
  /** Quarantine cache; a temporary one is used when omitted. */
  cache?: QuarantineCache;
  /** Policy to evaluate; defaults to human or agent based on `agent` flag. */
  policy?: PolicySet;
  /** Whether to use agent policy defaults. */
  agent?: boolean;
  /** Custom fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
  /** Timeout for network requests in ms. */
  timeoutMs?: number;
  /** Max tarball size in bytes. */
  maxBytes?: number;
}

export interface PreflightResult {
  spec: ReturnType<typeof parsePackageSpec>;
  resolvedVersion: string;
  binCommand: string | null;
  analysisReport: AnalysisReport;
  riskReport: RiskReport;
  policyDecision: PolicyDecision | null;
  /** Path to the downloaded tarball (in cache). */
  tarballPath: string;
}

export async function runPreflight(
  specInput: string,
  options: PreflightOptions,
): Promise<PreflightResult> {
  // 1. Parse spec (strict mode: registry only).
  const spec = parsePackageSpec(specInput, true);

  // 2. Fetch packument.
  const fetched = await fetchPackument(options.registryUrl, spec.name, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  if (!fetched.packument) {
    throw new PreflightError(
      `Package "${spec.name}" not found on registry ${options.registryUrl}`,
      'PACKAGE_NOT_FOUND',
    );
  }

  // 3. Resolve version.
  const resolvedVersion = resolveVersion(fetched.packument, spec.specifier || 'latest');
  if (!resolvedVersion) {
    throw new PreflightError(
      `No version of "${spec.name}" satisfies "${spec.specifier || 'latest'}"`,
      'VERSION_NOT_FOUND',
    );
  }

  const versionData = fetched.packument.versions![resolvedVersion]!;
  const tarballUrl = versionData.dist?.tarball;
  const integrity = versionData.dist?.integrity;
  if (!tarballUrl) {
    throw new PreflightError(
      `No tarball URL for "${spec.name}@${resolvedVersion}"`,
      'NO_TARBALL_URL',
    );
  }

  // 4. Download tarball to quarantine cache.
  const cache = options.cache ?? new QuarantineCache();
  const tmpDir = await mkdtemp(join(tmpdir(), 'safe-npm-preflight-'));
  const tarballPath = join(tmpDir, `${spec.name.replace('/', '_')}-${resolvedVersion}.tgz`);

  try {
    await downloadTarball(tarballUrl, tarballPath, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes,
      expectedIntegrity: integrity,
    });

    // 5. Analyze tarball.
    const analysisReport = await analyzeTarball({
      tarballPath,
      integrity: integrity ?? `sha512-unknown`,
      packageName: spec.name,
      packageVersion: resolvedVersion,
      cache,
    });

    // 6. Score.
    const riskReport = scoreAnalysis(analysisReport);

    // 7. Resolve bin command.
    let binCommand: string | null = null;
    if (versionData.bin) {
      const bin = resolveBin(versionData, spec.name);
      binCommand = bin ? bin.binName : null;
    }

    // 8. Policy evaluation (optional).
    let policyDecision: PolicyDecision | null = null;
    if (options.policy || options.agent !== undefined) {
      const policy = options.policy ?? (options.agent ? DEFAULT_AGENT_POLICY : DEFAULT_HUMAN_POLICY);
      policyDecision = evaluatePolicy(riskReport, 'exec', policy, {
        hasInstallScripts: analysisReport.lifecycleScripts.length > 0,
        hasNativeBinaries: analysisReport.nativeArtifacts.length > 0,
        isExactVersion: !spec.specifier.endsWith('latest') && spec.specifier !== '',
        isLatestTag: spec.specifier === '' || spec.specifier === 'latest',
        permissionsEnforceable: analysisReport.nativeArtifacts.length === 0,
      });
    }

    return {
      spec,
      resolvedVersion,
      binCommand,
      analysisReport,
      riskReport,
      policyDecision,
      tarballPath,
    };
  } finally {
    // Clean up the temp tarball; the cache retains its own copy.
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export class PreflightError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PreflightError';
    this.code = code;
  }
}

export { renderJson, renderTty, inferPermissions };
