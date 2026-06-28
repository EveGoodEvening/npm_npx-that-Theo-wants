import {
  PolicyAction,
  PolicyDecision,
  PolicySet,
  RiskTier,
  type PolicyDecision as PolicyDecisionType,
  type PolicySet as PolicySetType,
  type RiskReport as RiskReportType,
  type MatchedRule as MatchedRuleType,
} from '@safe-npm/core-types';

/**
 * Policy engine (design 15 / Section 5.3). Evaluates a {@link RiskReport}
 * against a {@link PolicySet} for a given action and produces a deterministic
 * {@link PolicyDecision}.
 */

/** Default human policy: balanced, allows install scripts, warns on caution. */
export const DEFAULT_HUMAN_POLICY: PolicySetType = PolicySet.parse({
  name: 'default-human',
  mode: 'default-human',
  install: {
    minimumScore: 55,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: true,
    allowNativeBinaries: true,
    allowNonRegistrySources: false,
    requireExactVersion: false,
    disallowLatestTag: false,
    requirePermissionEnforcement: false,
    blockKnownCriticalVulns: true,
  },
  exec: {
    minimumScore: 55,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: false,
    allowNativeBinaries: true,
    requireExactVersion: false,
    disallowLatestTag: false,
    requirePermissionEnforcement: false,
    allowNetwork: 'declared',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: false,
    publicPromotionMinimumScore: 75,
    requireTrustedPublisherForPublic: false,
  },
});

/** Default agent/CI policy: stricter, requires explicit approval for caution. */
export const DEFAULT_AGENT_POLICY: PolicySetType = PolicySet.parse({
  name: 'default-agent',
  mode: 'agent',
  install: {
    minimumScore: 75,
    blockTiers: ['caution', 'danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: false,
    allowNativeBinaries: false,
    allowNonRegistrySources: false,
    requireExactVersion: true,
    disallowLatestTag: true,
    requirePermissionEnforcement: true,
    blockKnownCriticalVulns: true,
  },
  exec: {
    minimumScore: 75,
    blockTiers: ['caution', 'danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: false,
    allowNativeBinaries: false,
    requireExactVersion: true,
    disallowLatestTag: true,
    requirePermissionEnforcement: true,
    allowNetwork: 'declared-and-approved',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: true,
    publicPromotionMinimumScore: 85,
    requireTrustedPublisherForPublic: true,
  },
});

export interface EvaluatePolicyOptions {
  /** True if the package version specifier was `latest` (for disallowLatestTag). */
  isLatestTag?: boolean;
  /** True if the version is exact (for requireExactVersion). */
  isExactVersion?: boolean;
  /** True if install scripts are present (for allowInstallScripts). */
  hasInstallScripts?: boolean;
  /** True if native binaries/addons are present (for allowNativeBinaries). */
  hasNativeBinaries?: boolean;
  /** True if the source is non-registry (for allowNonRegistrySources). */
  isNonRegistrySource?: boolean;
  /** True if permissions are enforceable (for requirePermissionEnforcement). */
  permissionsEnforceable?: boolean;
}

/**
 * Evaluate a risk report against a policy for a given action.
 *
 * Returns a deterministic {@link PolicyDecision} with `decision` being one of:
 * - `allow`: all rules pass
 * - `warn`: some rules trigger warnings but none block
 * - `requires_approval`: action needs human/agent approval before proceeding
 * - `block`: a hard rule blocks the action
 */
export function evaluatePolicy(
  report: RiskReportType,
  action: PolicyAction,
  policy: PolicySetType,
  options: EvaluatePolicyOptions = {},
): PolicyDecisionType {
  const matchedRules: MatchedRuleType[] = [];
  let blocked = false;
  let needsApproval = false;
  let warned = false;

  const check = (
    path: string,
    condition: boolean,
    expected: unknown,
    actual: unknown,
    severity: 'block' | 'approval' | 'warn',
  ) => {
    if (condition) {
      matchedRules.push({ path, expected, actual });
      if (severity === 'block') blocked = true;
      else if (severity === 'approval') needsApproval = true;
      else warned = true;
    }
  };

  if (action === 'install') {
    const p = policy.install;
    check('install.minimumScore', report.score < p.minimumScore, `>= ${p.minimumScore}`, report.score, 'block');
    check('install.blockTiers', p.blockTiers.includes(report.tier as RiskTier), `not in [${p.blockTiers.join(', ')}]`, report.tier, 'block');
    check('install.requireNoBlockers', p.requireNoBlockers && report.blockers.length > 0, 'no blockers', `${report.blockers.length} blocker(s)`, 'block');
    if (p.allowInstallScripts === false && options.hasInstallScripts) {
      check('install.allowInstallScripts', true, false, 'install scripts present', 'block');
    }
    if (p.allowNativeBinaries === false && options.hasNativeBinaries) {
      check('install.allowNativeBinaries', true, false, 'native binaries present', 'block');
    }
    if (p.allowNonRegistrySources === false && options.isNonRegistrySource) {
      check('install.allowNonRegistrySources', true, false, 'non-registry source', 'block');
    }
    if (p.requireExactVersion && !options.isExactVersion) {
      check('install.requireExactVersion', true, 'exact version', 'non-exact version', 'block');
    }
    if (p.disallowLatestTag && options.isLatestTag) {
      check('install.disallowLatestTag', true, 'not latest', 'latest tag', 'block');
    }
    if (p.requirePermissionEnforcement && !options.permissionsEnforceable) {
      check('install.requirePermissionEnforcement', true, 'enforceable', 'not enforceable', 'block');
    }
  } else if (action === 'exec') {
    const p = policy.exec;
    check('exec.minimumScore', report.score < p.minimumScore, `>= ${p.minimumScore}`, report.score, 'block');
    check('exec.blockTiers', p.blockTiers.includes(report.tier as RiskTier), `not in [${p.blockTiers.join(', ')}]`, report.tier, 'block');
    check('exec.requireNoBlockers', p.requireNoBlockers && report.blockers.length > 0, 'no blockers', `${report.blockers.length} blocker(s)`, 'block');
    if (p.allowInstallScripts === false && options.hasInstallScripts) {
      check('exec.allowInstallScripts', true, false, 'install scripts present', 'block');
    }
    if (p.allowNativeBinaries === false && options.hasNativeBinaries) {
      check('exec.allowNativeBinaries', true, false, 'native binaries present', 'block');
    }
    if (p.requireExactVersion && !options.isExactVersion) {
      check('exec.requireExactVersion', true, 'exact version', 'non-exact version', 'block');
    }
    if (p.disallowLatestTag && options.isLatestTag) {
      check('exec.disallowLatestTag', true, 'not latest', 'latest tag', 'block');
    }
    if (p.requirePermissionEnforcement && !options.permissionsEnforceable) {
      check('exec.requirePermissionEnforcement', true, 'enforceable', 'not enforceable', 'block');
    }
    // Caution tier requires approval for exec
    if (report.tier === 'caution' && !blocked) {
      needsApproval = true;
      matchedRules.push({ path: 'exec.cautionTier', expected: 'not caution', actual: 'caution' });
    }
  } else if (action === 'publish') {
    const p = policy.publish;
    // Public promotion checks
    if (p.publicPromotionMinimumScore > 0 && report.score < p.publicPromotionMinimumScore) {
      check('publish.publicPromotionMinimumScore', true, `>= ${p.publicPromotionMinimumScore}`, report.score, 'block');
    }
    if (p.publicPromotionRequiresAudit) {
      check('publish.publicPromotionRequiresAudit', true, 'audit required', 'no audit', 'approval');
    }
    if (p.requireTrustedPublisherForPublic) {
      check('publish.requireTrustedPublisherForPublic', true, 'trusted publisher', 'unverified', 'approval');
    }
  }

  const decision = blocked ? 'block' : needsApproval ? 'requires_approval' : warned ? 'warn' : 'allow';
  const overridesAvailable = blocked ? ['--force'] : needsApproval ? ['--yes'] : [];

  return PolicyDecision.parse({
    allow: decision === 'allow' || decision === 'warn',
    decision,
    action,
    matchedRules,
    overridesAvailable,
    reason: matchedRules.length > 0 ? matchedRules[0]!.path : undefined,
  });
}

export { PolicySet, PolicyAction, RiskTier };
