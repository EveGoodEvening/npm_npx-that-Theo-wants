import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  RiskReport,
  AnalysisReport,
  PolicyDecision,
  PolicySet,
  PackageName,
  ExactVersion,
} from '@safe-npm/core-types';
import { parsePackageSpec, fetchPackument, resolveVersion, downloadTarball } from '@safe-npm/npm-compat';
import { analyzeTarball, resolveBin, ANALYZER_VERSION } from '@safe-npm/analyzer';
import { scoreAnalysis, evaluatePolicy, DEFAULT_HUMAN_POLICY, DEFAULT_AGENT_POLICY } from '@safe-npm/scoring';

export interface PreflightInput {
  spec: string;
  registryUrl?: string;
  policy?: PolicySet;
  /** Whether the spec used the `latest` tag. */
  usedLatestTag?: boolean;
  /** Whether to require exact version (agent mode). */
  agentMode?: boolean;
  /** Fetch implementation override (for tests). */
  fetchImpl?: typeof fetch;
}

export interface PreflightResult {
  packageName: PackageName;
  version: ExactVersion;
  analysis: AnalysisReport;
  riskReport: RiskReport;
  selectedBin?: string;
  decision: PolicyDecision;
  /** Whether the version is exact (not a range/tag). */
  isExactVersion: boolean;
}

/**
 * Full preflight pipeline: resolve -> download -> analyze -> score -> policy.
 * Never executes package code.
 */
export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const registryUrl = input.registryUrl ?? 'https://registry.npmjs.org';
  const policy = input.policy ?? (input.agentMode ? DEFAULT_AGENT_POLICY : DEFAULT_HUMAN_POLICY);

  // 1. Parse spec (strict in agent mode to reject non-registry sources).
  const spec = parsePackageSpec(input.spec, { strict: input.agentMode ?? false });
  if (spec.source !== 'registry') {
    throw new Error(`non-registry source (${spec.source}) not supported in preflight`);
  }

  // 2. Fetch packument.
  const { packument } = await fetchPackument(registryUrl, spec.name, {
    fetchImpl: input.fetchImpl,
  });
  if (!packument) {
    throw new Error(`package not found: ${spec.name}`);
  }

  // 3. Resolve version.
  const { version, versionData } = resolveVersion(packument, spec);
  const isExactVersion = /^\d+\.\d+\.\d+/.test(version);
  // A bare name (no specifier) resolves to the `latest` dist-tag, so treat it
  // as using `latest` for policy purposes (disallowLatestTag).
  const latestTag = packument['dist-tags']?.latest;
  const usedLatestTag = input.usedLatestTag ?? (spec.specifier === 'latest' || (spec.specifier === undefined && latestTag !== undefined && version === latestTag));

  // 4. Download tarball to a temp quarantine.
  const tmp = await mkdtemp(join(tmpdir(), 'safe-preflight-'));
  try {
    const dest = join(tmp, 'pkg.tgz');
    const dist = versionData.dist;
    if (!dist?.tarball) {
      throw new Error(`no tarball URL for ${spec.name}@${version}`);
    }
    const dl = await downloadTarball(dist.tarball, dest, {
      expectedIntegrity: dist.integrity,
      expectedShasum: dist.shasum,
      fetchImpl: input.fetchImpl,
    });

    // 5. Analyze.
    const unpackDir = join(tmp, 'unpacked');
    const { report: analysis, declaredPermissions } = await analyzeTarball({
      tarballPath: dl.path,
      unpackDir,
      expectedName: spec.name as PackageName,
      expectedVersion: version as ExactVersion,
      maintainersFromPackument: packument.maintainers,
    });

    // 6. Score.
    const riskReport = scoreAnalysis({
      analysis,
      declaredPermissions,
      publishId: undefined,
    });

    // 7. Resolve bin (for exec action).
    let selectedBin: string | undefined;
    try {
      selectedBin = resolveBin(analysis.package.bin, spec.name as PackageName);
    } catch {
      selectedBin = undefined;
    }

    // 8. Policy decision.
    const decision = evaluatePolicy(policy, {
      riskReport,
      action: 'exec',
      usedLatestTag,
      isExactVersion,
      permissionEnforcementAvailable: false,
    });

    return {
      packageName: spec.name as PackageName,
      version: version as ExactVersion,
      analysis,
      riskReport,
      selectedBin,
      decision,
      isExactVersion,
    };
  } finally {
    // cleanup temp; note: in real use the quarantine cache persists.
    await rm(tmp, { recursive: true, force: true });
  }
}

export { ANALYZER_VERSION };
