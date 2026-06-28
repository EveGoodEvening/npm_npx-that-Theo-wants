import { createHash } from 'node:crypto';
import {
  AnalysisReport,
  RiskFinding,
  RiskReport,
  RiskSeverity,
  RiskTier,
  type RiskFinding as RiskFindingType,
  type RiskReport as RiskReportType,
  type RiskTier as RiskTierType,
} from '@safe-npm/core-types';

/**
 * Deterministic risk scoring (design 9). Turns an {@link AnalysisReport} into
 * an immutable {@link RiskReport} with score, tier, confidence, blockers,
 * warnings, and per-component contributions.
 *
 * The formula is intentionally transparent: every deduction is recorded as a
 * component contribution and a warning/blocker finding with evidence.
 */

export const SCORING_VERSION = '0.1.0';

export interface ScoreAnalysisOptions {
  /** Override generatedAt (ISO); defaults to now. */
  generatedAt?: string;
  /** External blockers (e.g. known malware, typosquat) injected by callers. */
  externalBlockers?: RiskFindingType[];
  /** External warnings (e.g. vulnerability advisories) injected by callers. */
  externalWarnings?: RiskFindingType[];
}

interface Component {
  component: string;
  weight: number;
  contribution: number;
  signals: Record<string, unknown>;
}

interface ScoreResult {
  score: number;
  tier: RiskTierType;
  confidence: number;
  blockers: RiskFindingType[];
  warnings: RiskFindingType[];
  components: Component[];
}

/**
 * Score an {@link AnalysisReport} and return a {@link RiskReport}.
 *
 * Starts from 100 and deducts per design 9.4. Any blocker sets tier to
 * `blocked` regardless of numeric score.
 */
export function scoreAnalysis(
  report: AnalysisReport,
  options: ScoreAnalysisOptions = {},
): RiskReportType {
  const result = computeScore(report, options);

  const evidenceDigest = computeEvidenceDigest(report);

  return RiskReport.parse({
    package: report.package,
    version: report.version,
    publishId: report.publishId,
    score: result.score,
    tier: result.tier,
    confidence: result.confidence,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    analyzerVersion: report.analyzerVersion,
    evidenceDigest,
    blockers: result.blockers,
    warnings: result.warnings,
    facts: {
      tarball: {
        sizeBytes: report.tarball.sizeBytes,
        unpackedSizeBytes: report.tarball.unpackedSizeBytes,
        fileCount: report.tarball.fileCount,
        integrity: report.tarballDigest,
      },
    },
    components: result.components,
  });
}

function computeScore(report: AnalysisReport, options: ScoreAnalysisOptions): ScoreResult {
  const blockers: RiskFindingType[] = [...(options.externalBlockers ?? [])];
  const warnings: RiskFindingType[] = [...(options.externalWarnings ?? [])];
  const components: Component[] = [];
  let score = 100;
  let confidenceDeduction = 0;

  // --- Runtime/install behavior (weight 20) ---
  let runtimeDeduction = 0;
  const runtimeSignals: Record<string, unknown> = {};

  // Install scripts
  if (report.lifecycleScripts.length > 0) {
    const scripts = report.lifecycleScripts;
    runtimeSignals.lifecycleScripts = scripts.length;
    const hasNetwork = scripts.some((s) => s.flags.includes('network_tool'));
    const hasShell = scripts.some((s) => s.flags.includes('shell_metacharacters'));
    const hasPm = scripts.some((s) => s.flags.includes('package_manager'));

    if (hasNetwork && hasShell) {
      // Curl|sh pattern — potential exfiltration blocker.
      blockers.push(
        finding('INSTALL_SCRIPT_NETWORK_EXEC', 'critical',
          'Install script pipes network content to a shell.',
          scripts.filter((s) => s.flags.includes('network_tool') && s.flags.includes('shell_metacharacters'))
            .map((s) => `package.json:scripts.${s.kind}`)),
      );
      runtimeDeduction += 20;
    } else if (hasNetwork) {
      runtimeDeduction += 12;
      warnings.push(warning('INSTALL_SCRIPT_NETWORK', 'high',
        'Install script uses network tools.',
        scripts.filter((s) => s.flags.includes('network_tool')).map((s) => `package.json:scripts.${s.kind}`)));
    } else if (hasShell || hasPm) {
      runtimeDeduction += 8;
      warnings.push(warning('INSTALL_SCRIPT_RISKY', 'medium',
        'Install script uses shell metacharacters or package managers.',
        scripts.map((s) => `package.json:scripts.${s.kind}`)));
    } else {
      runtimeDeduction += 4;
      warnings.push(warning('INSTALL_SCRIPT_PRESENT', 'medium',
        `Package has ${scripts.length} lifecycle script(s).`,
        scripts.map((s) => `package.json:scripts.${s.kind}`)));
    }
  }

  // Native addons / binaries
  if (report.nativeArtifacts.length > 0) {
    runtimeSignals.nativeArtifacts = report.nativeArtifacts.length;
    runtimeDeduction += 8;
    warnings.push(warning('NATIVE_ARTIFACT', 'high',
      `Package contains ${report.nativeArtifacts.length} native artifact(s).`,
      report.nativeArtifacts.map((a) => a.file)));
  }

  // child_process usage
  if (report.builtinsUsed.includes('child_process')) {
    runtimeSignals.childProcess = true;
    runtimeDeduction += 8;
    warnings.push(warning('CHILD_PROCESS_USAGE', 'high',
      'Package uses child_process.',
      evidenceFor(report, 'BUILTIN_CHILD_PROCESS')));
  }

  // Network usage (http/https/net/dns/dgram)
  const networkBuiltins = ['http', 'https', 'net', 'dns', 'dgram'] as const;
  const usedNetwork = networkBuiltins.filter((b) => report.builtinsUsed.includes(b));
  if (usedNetwork.length > 0) {
    runtimeSignals.networkBuiltins = usedNetwork;
    runtimeDeduction += 5;
    warnings.push(warning('NETWORK_USAGE', 'medium',
      `Package uses network builtins: ${usedNetwork.join(', ')}.`,
      evidenceFor(report, 'BUILTIN_HTTP', 'BUILTIN_HTTPS', 'BUILTIN_NET', 'BUILTIN_DNS', 'BUILTIN_DGRAM')));
  }

  // env/secret access
  const secretFindings = report.staticFindings.filter((f) => f.code === 'SECRET_NAME_ACCESS');
  const envFindings = report.staticFindings.filter((f) => f.code === 'PROCESS_ENV_ACCESS');
  if (secretFindings.length > 0) {
    runtimeSignals.secretAccess = secretFindings.length;
    runtimeDeduction += 10;
    warnings.push(warning('SECRET_ACCESS', 'high',
      `Package accesses ${secretFindings.length} potential secret(s) via process.env.`,
      secretFindings.map((f) => `${f.file}:${f.line ?? '?'}`)));
  } else if (envFindings.length > 0) {
    runtimeSignals.envAccess = envFindings.length;
    runtimeDeduction += 3;
    warnings.push(warning('ENV_ACCESS', 'low',
      `Package accesses process.env (${envFindings.length} site(s)).`,
      envFindings.map((f) => `${f.file}:${f.line ?? '?'}`)));
  }

  // Dynamic code execution (eval, new Function, dynamic import)
  const evalFindings = report.staticFindings.filter((f) => f.code === 'EVAL' || f.code === 'NEW_FUNCTION');
  const dynImportFindings = report.staticFindings.filter((f) => f.code === 'DYNAMIC_IMPORT_NONLITERAL');
  if (evalFindings.length > 0) {
    runtimeSignals.dynamicExec = evalFindings.length;
    runtimeDeduction += 10;
    warnings.push(warning('DYNAMIC_CODE_EXEC', 'high',
      `Package uses eval() or new Function() (${evalFindings.length} site(s)).`,
      evalFindings.map((f) => `${f.file}:${f.line ?? '?'}`)));
  }
  if (dynImportFindings.length > 0) {
    runtimeSignals.dynamicImport = dynImportFindings.length;
    runtimeDeduction += 4;
    warnings.push(warning('DYNAMIC_IMPORT', 'medium',
      `Package uses dynamic import() with non-literal arguments (${dynImportFindings.length} site(s)).`,
      dynImportFindings.map((f) => `${f.file}:${f.line ?? '?'}`)));
  }

  runtimeDeduction = Math.min(runtimeDeduction, 20);
  score -= runtimeDeduction;
  components.push({ component: 'runtime_install_behavior', weight: 20, contribution: -runtimeDeduction, signals: runtimeSignals });

  // --- Code transparency (weight 15) ---
  let transparencyDeduction = 0;
  const transparencySignals: Record<string, unknown> = {};

  if (report.readability.likelyMinified) {
    transparencySignals.likelyMinified = true;
    transparencyDeduction += 6;
    warnings.push(warning('LIKELY_MINIFIED', 'medium',
      'Package contains likely minified code without source maps.',
      []));
  }
  if (report.readability.likelyObfuscated) {
    transparencySignals.likelyObfuscated = true;
    transparencyDeduction += 8;
    warnings.push(warning('LIKELY_OBFUSCATED', 'high',
      'Package shows obfuscation indicators (giant string arrays, high entropy, or very short identifiers).',
      []));
  }
  if (report.readability.giantStringArrays) {
    transparencySignals.giantStringArrays = true;
    transparencyDeduction += 3;
  }
  if (!report.readability.sourceMapsPresent && report.readability.likelyMinified) {
    transparencyDeduction += 2;
  }

  transparencyDeduction = Math.min(transparencyDeduction, 15);
  score -= transparencyDeduction;
  components.push({ component: 'code_transparency', weight: 15, contribution: -transparencyDeduction, signals: transparencySignals });

  // --- Identity/provenance (weight 20) ---
  let identityDeduction = 0;
  const identitySignals: Record<string, unknown> = {};

  if (!report.metadata.repository) {
    identitySignals.missingRepository = true;
    identityDeduction += 8;
    warnings.push(warning('MISSING_REPOSITORY', 'medium',
      'Package has no repository field in package.json.',
      ['package.json:repository']));
  }
  if (!report.metadata.license) {
    identitySignals.missingLicense = true;
    identityDeduction += 5;
    warnings.push(warning('MISSING_LICENSE', 'low',
      'Package has no license field in package.json.',
      ['package.json:license']));
    confidenceDeduction += 5;
  }

  identityDeduction = Math.min(identityDeduction, 20);
  score -= identityDeduction;
  components.push({ component: 'identity_provenance', weight: 20, contribution: -identityDeduction, signals: identitySignals });

  // --- Package size anomaly placeholder (weight 5) ---
  let sizeDeduction = 0;
  const sizeSignals: Record<string, unknown> = {};
  if (report.tarball.unpackedSizeBytes > 50 * 1024 * 1024) {
    sizeSignals.largePackage = report.tarball.unpackedSizeBytes;
    sizeDeduction += 5;
    warnings.push(warning('LARGE_PACKAGE', 'low',
      `Unpacked size is ${Math.round(report.tarball.unpackedSizeBytes / 1024 / 1024)}MB.`,
      []));
  }
  score -= sizeDeduction;
  components.push({ component: 'package_size', weight: 5, contribution: -sizeDeduction, signals: sizeSignals });

  // --- Blockers from external sources ---
  // High-confidence exfiltration fixture: if both secret access and network
  // usage exist in install scripts, escalate to blocker.
  if (secretFindings.length > 0 && report.lifecycleScripts.some((s) => s.flags.includes('network_tool'))) {
    blockers.push(finding('POTENTIAL_EXFILTRATION', 'critical',
      'Package accesses secrets and uses network tools in install scripts.',
      [
        ...secretFindings.map((f) => `${f.file}:${f.line ?? '?'}`),
        ...report.lifecycleScripts.filter((s) => s.flags.includes('network_tool')).map((s) => `package.json:scripts.${s.kind}`),
      ],
    ));
  }

  // Clamp score
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Tier
  const tier = blockers.length > 0 ? 'blocked' : tierFromScore(score);

  // Confidence
  const confidence = Math.max(0, Math.min(100, 100 - confidenceDeduction));

  return { score, tier, confidence, blockers, warnings, components };
}

function tierFromScore(score: number): RiskTierType {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 55) return 'caution';
  if (score >= 25) return 'danger';
  return 'blocked';
}

function finding(code: string, severity: RiskSeverity, message: string, evidence: string[]): RiskFindingType {
  return RiskFinding.parse({ code, severity, message, evidence });
}

function warning(code: string, severity: RiskSeverity, message: string, evidence: string[]): RiskFindingType {
  return RiskFinding.parse({ code, severity, message, evidence });
}

function evidenceFor(report: AnalysisReport, ...codes: string[]): string[] {
  return report.staticFindings
    .filter((f) => codes.includes(f.code))
    .map((f) => `${f.file}:${f.line ?? '?'}`);
}

function computeEvidenceDigest(report: AnalysisReport): string {
  // Deterministic digest of the inputs that produced this report.
  const payload = JSON.stringify({
    p: report.package,
    v: report.version,
    d: report.tarballDigest,
    a: report.analyzerVersion,
  });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export { RiskTier };
