import { createHash } from 'node:crypto';
import type {
  AnalysisReport,
  RiskReport,
  RiskFinding,
  RiskTier,
  RiskFindingSeverity,
  Permissions,
  PermissionReport,
  PublishId,
  PackageName,
  PackageVersion,
} from '@safe-npm/core-types';

export const SCORER_VERSION = '0.1.0';

/** Deduction per finding severity. */
const DEDUCTION_BY_SEVERITY: Record<RiskFindingSeverity, number> = {
  low: 2,
  medium: 6,
  high: 12,
  critical: 25,
};

/** Map a numeric score to a tier per design §9.2. */
export function scoreToTier(score: number): RiskTier {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 55) return 'caution';
  if (score >= 25) return 'danger';
  return 'blocked';
}

export interface ScoreComponent {
  name: string;
  weight: number;
  contribution: number;
  signals: string[];
}

export interface ScoreAnalysisInput {
  analysis: AnalysisReport;
  /** Optional declared permissions to compare against inferred. */
  declaredPermissions?: Permissions;
  /** Publisher facts when available. */
  publisher?: {
    name?: string;
    firstSeenAt?: string;
    trustedPublisher?: boolean;
    strongAuth?: boolean;
  };
  /** Source/provenance facts when available. */
  source?: {
    repository?: string;
    provenance?: 'verified' | 'missing' | 'mismatch' | 'unsupported';
    commit?: string;
  };
  /** Publish ID for the report. */
  publishId?: PublishId;
}

/** Blocker codes that force tier=blocked regardless of score. */
const BLOCKER_CODES: Record<string, true> = {
  TARBALL_INTEGRITY_MISMATCH: true,
  KNOWN_MALWARE: true,
  EXFILTRATION_FIXTURE: true,
  PROVENANCE_MISMATCH: true,
  COMPROMISED_PUBLISHER: true,
};

/**
 * Deterministic scoring: start at 100, deduct per finding, apply blockers.
 * Returns a complete RiskReport with explainable components.
 */
export function scoreAnalysis(input: ScoreAnalysisInput): RiskReport {
  const { analysis } = input;
  const allFindings: RiskFinding[] = [
    ...analysis.scriptFindings,
    ...analysis.staticFindings,
    ...(analysis.diffRisk?.riskyDeltas ?? []),
  ];

  // Collect blockers.
  const blockers: RiskFinding[] = [];
  const warnings: RiskFinding[] = [];
  for (const f of allFindings) {
    if (BLOCKER_CODES[f.code] === true) {
      blockers.push(f);
    } else {
      warnings.push(f);
    }
  }

  // Additional structural blockers / deductions.
  const components: ScoreComponent[] = [];
  let score = 100;

  // Install scripts.
  const scriptSignals = analysis.lifecycleScripts.map((s) => `lifecycle:${s}`);
  if (analysis.lifecycleScripts.length > 0) {
    const ded = Math.min(10, analysis.lifecycleScripts.length * 4);
    score -= ded;
    components.push({
      name: 'install-scripts',
      weight: 20,
      contribution: -ded,
      signals: scriptSignals,
    });
  }

  // Native addons/binaries.
  const nativeCount = analysis.nativeArtifacts.nodeAddons.length + analysis.nativeArtifacts.binaries.length;
  if (nativeCount > 0 || analysis.nativeArtifacts.bindingGyp) {
    const ded = 10 + nativeCount * 3;
    score -= ded;
    components.push({
      name: 'native-artifacts',
      weight: 15,
      contribution: -ded,
      signals: [
        ...analysis.nativeArtifacts.nodeAddons.map((n) => `node-addon:${n}`),
        ...(analysis.nativeArtifacts.bindingGyp ? ['binding.gyp'] : []),
      ],
    });
    warnings.push({
      code: 'NATIVE_ARTIFACT',
      severity: 'medium',
      message: `package contains native artifacts (${nativeCount} native/binary files${analysis.nativeArtifacts.bindingGyp ? ', binding.gyp' : ''})`,
      evidence: [
        ...analysis.nativeArtifacts.nodeAddons,
        ...analysis.nativeArtifacts.binaries,
      ],
    });
  }

  // Deduct per static/script finding by severity.
  const findingDeduction = allFindings.reduce((sum, f) => {
    const base = DEDUCTION_BY_SEVERITY[f.severity] ?? 2;
    // cap per-finding so a single finding can't dominate
    return sum + Math.min(base, 25);
  }, 0);
  if (findingDeduction > 0) {
    score -= findingDeduction;
    components.push({
      name: 'static-and-script-findings',
      weight: 40,
      contribution: -findingDeduction,
      signals: allFindings.map((f) => f.code),
    });
  }

  // Obfuscation/readability.
  if (analysis.readability.likelyObfuscated) {
    score -= 12;
    components.push({ name: 'obfuscation', weight: 15, contribution: -12, signals: ['likelyObfuscated'] });
  } else if (analysis.readability.likelyMinified) {
    score -= 6;
    components.push({ name: 'minification', weight: 15, contribution: -6, signals: ['likelyMinified'] });
  }

  // Missing repository.
  if (!analysis.package.repository) {
    score -= 4;
    components.push({ name: 'missing-repository', weight: 5, contribution: -4, signals: [] });
  }
  // Missing license.
  if (!analysis.package.license) {
    score -= 4;
    components.push({ name: 'missing-license', weight: 5, contribution: -4, signals: [] });
  }

  // Package size anomaly placeholder: flag unusually large unpacked size (>50MB).
  if (analysis.tarball.unpackedSizeBytes > 50 * 1024 * 1024) {
    score -= 5;
    components.push({ name: 'size-anomaly', weight: 5, contribution: -5, signals: ['unpackedSizeBytes>50MB'] });
  }

  // Permission mismatch: declared vs inferred.
  const permMismatches = permissionMismatches(input.declaredPermissions, analysis.inferredPermissions);
  if (permMismatches.length > 0) {
    const ded = Math.min(15, permMismatches.length * 5);
    score -= ded;
    components.push({
      name: 'permission-mismatch',
      weight: 10,
      contribution: -ded,
      signals: permMismatches,
    });
    for (const m of permMismatches) {
      warnings.push({
        code: 'PERMISSION_MISMATCH',
        severity: 'medium',
        message: m,
        evidence: [],
      });
    }
  }

  // Provenance bonus / mismatch.
  if (input.source?.provenance === 'verified') {
    score += 5;
    score = Math.min(score, 100);
    components.push({ name: 'provenance', weight: 5, contribution: 5, signals: ['verified'] });
  } else if (input.source?.provenance === 'mismatch') {
    blockers.push({
      code: 'PROVENANCE_MISMATCH',
      severity: 'critical',
      message: 'provenance subject does not match package',
      evidence: [],
    });
  }

  // Clamp.
  score = Math.max(0, Math.min(100, Math.round(score)));

  const tier = blockers.length > 0 ? 'blocked' : scoreToTier(score);

  // Confidence: lower when many warnings or missing signals.
  const confidence = computeConfidence(analysis, warnings.length, blockers.length);

  // Evidence digest over the analysis report (deterministic).
  const evidenceDigest = `sha256-${createHash('sha256').update(JSON.stringify(analysis)).digest('hex')}`;

  const permissionReport: PermissionReport | undefined = input.declaredPermissions
    ? {
        declared: input.declaredPermissions,
        inferred: analysis.inferredPermissions,
        enforceable: false,
      }
    : undefined;

  const report: RiskReport = {
    package: analysis.package.name as PackageName,
    version: analysis.package.version as PackageVersion,
    ...(input.publishId ? { publishId: input.publishId } : {}),
    score,
    tier,
    confidence,
    generatedAt: new Date().toISOString(),
    analyzerVersion: analysis.analyzerVersion,
    evidenceDigest,
    blockers,
    warnings,
    facts: {
      tarball: {
        sizeBytes: analysis.tarball.sizeBytes,
        unpackedSizeBytes: analysis.tarball.unpackedSizeBytes,
        fileCount: analysis.tarball.fileCount,
      },
      ...(input.publisher
        ? {
            publisher: {
              name: input.publisher.name,
              firstSeenAt: input.publisher.firstSeenAt,
              trustedPublisher: input.publisher.trustedPublisher ?? false,
              strongAuth: input.publisher.strongAuth ?? false,
            },
          }
        : {}),
      ...(input.source
        ? {
            source: {
              repository: input.source.repository,
              provenance: input.source.provenance ?? 'missing',
              commit: input.source.commit,
            },
          }
        : {}),
      ...(permissionReport ? { permissions: permissionReport } : {}),
    },
    components,
  };

  return report;
}

function computeConfidence(analysis: AnalysisReport, warningCount: number, blockerCount: number): number {
  let confidence = 90;
  // reduce confidence when parse failures occurred
  const parseFailures = analysis.staticFindings.filter((f) => f.code === 'PARSE_FAILED').length;
  confidence -= parseFailures * 5;
  // reduce for missing repo/license
  if (!analysis.package.repository) confidence -= 4;
  if (!analysis.package.license) confidence -= 2;
  // reduce slightly for many warnings
  if (warningCount > 5) confidence -= 5;
  if (warningCount > 15) confidence -= 5;
  if (blockerCount > 0) confidence = Math.min(confidence, 60);
  return Math.max(10, Math.min(100, confidence));
}

/** Compare declared vs inferred permissions and return mismatch descriptions. */
export function permissionMismatches(
  declared: Permissions | undefined,
  inferred: Permissions,
): string[] {
  if (!declared) return [];
  const out: string[] = [];
  if (!declared.childProcess && inferred.childProcess) {
    out.push('declares no child_process but code imports child_process');
  }
  if (declared.net.length === 0 && inferred.net.length > 0) {
    out.push('declares no network but code uses network modules');
  }
  if (!declared.installScripts) {
    // installScripts declared false but package has lifecycle scripts
    // (checked elsewhere via script findings; included here for completeness)
  }
  if (declared.native === false && inferred.native) {
    out.push('declares no native but code uses native addons');
  }
  return out;
}
