import type {
  RiskReport,
  PolicySet,
  PolicyDecision,
  PolicyAction,
  PolicyDecisionKind,
  MatchedRule,
} from '@safe-npm/core-types';
import { PolicySetSchema } from '@safe-npm/core-types';

export interface PolicyEvaluationContext {
  riskReport: RiskReport;
  action: PolicyAction;
  usedLatestTag?: boolean;
  isExactVersion?: boolean;
  permissionEnforcementAvailable?: boolean;
}

/**
 * Evaluate a policy set against a risk report and action.
 * Returns a deterministic decision per design §15.
 */
export function evaluatePolicy(policy: PolicySet, ctx: PolicyEvaluationContext): PolicyDecision {
  const matched: MatchedRule[] = [];
  const overrides: string[] = [];
  const { riskReport, action } = ctx;

  const rules = (action === 'install' ? policy.install : action === 'exec' ? policy.exec : policy.publish) as {
    minimumScore?: number;
    blockTiers: Array<'danger' | 'blocked'>;
    requireNoBlockers: boolean;
    allowInstallScripts?: boolean;
    requireExactVersion?: boolean;
    disallowLatestTag?: boolean;
    requirePermissionEnforcement?: boolean;
    allowNativeBinaries?: boolean;
    publicPromotionMinimumScore?: number;
    blockKnownCriticalVulns?: boolean;
  };

  // requireNoBlockers
  if (rules.requireNoBlockers) {
    if (riskReport.blockers.length > 0) {
      matched.push({
        path: `${action}.requireNoBlockers`,
        expected: 'no blockers',
        actual: `${riskReport.blockers.length} blockers`,
      });
    }
  }

  // blockedTiers
  if (rules.blockTiers.length > 0) {
    if (rules.blockTiers.includes(riskReport.tier as 'danger' | 'blocked')) {
      matched.push({
        path: `${action}.blockTiers`,
        expected: rules.blockTiers,
        actual: riskReport.tier,
      });
    }
  }

  // minimumScore
  if (rules.minimumScore !== undefined) {
    if (riskReport.score < rules.minimumScore) {
      matched.push({
        path: `${action}.minimumScore`,
        expected: rules.minimumScore,
        actual: riskReport.score,
      });
    }
  }
  // allowInstallScripts (install action)
  if (action === 'install' && rules.allowInstallScripts === false) {
    const hasInstallScript = riskReport.warnings.some((w) => w.code === 'LIFECYCLE_SCRIPT_PRESENT');
    if (hasInstallScript) {
      matched.push({
        path: 'install.allowInstallScripts',
        expected: false,
        actual: 'lifecycle scripts present',
      });
      overrides.push('human-approve-exact-version');
    }
  }

  // blockKnownCriticalVulns (install action)
  if (action === 'install' && rules.blockKnownCriticalVulns) {
    const hasCriticalVuln = riskReport.warnings.some(
      (w) => w.code === 'KNOWN_VULNERABILITY' && w.severity === 'critical',
    );
    if (hasCriticalVuln) {
      matched.push({
        path: 'install.blockKnownCriticalVulns',
        expected: 'no critical vulnerabilities',
        actual: 'critical vulnerability present',
      });
    }
  }

  // allowNonRegistrySources handled at spec layer; skipped here.

  // exec-specific rules
  if (action === 'exec') {
    if (rules.requireExactVersion && ctx.isExactVersion === false) {
      matched.push({
        path: 'exec.requireExactVersion',
        expected: true,
        actual: ctx.isExactVersion,
      });
    }
    if (rules.disallowLatestTag && ctx.usedLatestTag) {
      matched.push({
        path: 'exec.disallowLatestTag',
        expected: false,
        actual: true,
      });
    }
    if (rules.requirePermissionEnforcement && !ctx.permissionEnforcementAvailable) {
      matched.push({
        path: 'exec.requirePermissionEnforcement',
        expected: true,
        actual: ctx.permissionEnforcementAvailable ?? false,
      });
    }
    if (rules.allowNativeBinaries === false) {
      // check facts for native artifacts via warnings/components is not stored on risk report;
      // the analyzer report carries nativeArtifacts. We approximate via blocker/warning codes.
      const nativeWarning = riskReport.warnings.some((w) => w.code === 'NATIVE_ARTIFACT');
      if (nativeWarning) {
        matched.push({
          path: 'exec.allowNativeBinaries',
          expected: false,
          actual: 'native binary present',
        });
      }
    }
  }

  // publish-specific rules
  if (action === 'publish') {
    if (rules.publicPromotionMinimumScore !== undefined && riskReport.score < rules.publicPromotionMinimumScore) {
      matched.push({
        path: 'publish.publicPromotionMinimumScore',
        expected: rules.publicPromotionMinimumScore,
        actual: riskReport.score,
      });
    }
  }

  // Determine decision.
  const hasBlocker = riskReport.blockers.length > 0 && rules.requireNoBlockers;
  const tierBlocked = rules.blockTiers.includes(riskReport.tier as 'danger' | 'blocked');
  const scoreBlocked = rules.minimumScore !== undefined && riskReport.score < rules.minimumScore;
  const criticalVulnBlock =
    action === 'install' &&
    rules.blockKnownCriticalVulns === true &&
    riskReport.warnings.some((w) => w.code === 'KNOWN_VULNERABILITY' && w.severity === 'critical');

  let decision: PolicyDecisionKind;
  let allow: boolean;
  // Hard blocks: blockers present, tier blocked, critical vuln block, or (exec) enforcement unavailable.
  const enforcementMissing =
    action === 'exec' && rules.requirePermissionEnforcement && !ctx.permissionEnforcementAvailable;

  if (hasBlocker || tierBlocked || criticalVulnBlock || enforcementMissing) {
    decision = 'blocked';
    allow = false;
  } else if (scoreBlocked || matched.length > 0) {
    // score below threshold or other soft rule -> requires approval
    decision = 'requires_approval';
    allow = false;
    if (!overrides.includes('human-approve-exact-version')) {
      overrides.push('human-approve-exact-version');
    }
  } else {
    decision = 'allow';
    allow = true;
  }

  const reason =
    decision === 'allow'
      ? undefined
      : decision === 'blocked'
        ? `blocked by policy: ${matched.map((m) => m.path).join(', ') || 'blockers present'}`
        : `requires approval: ${matched.map((m) => m.path).join(', ') || 'score below threshold'}`;

  return {
    allow,
    decision,
    action,
    matchedRules: matched,
    overridesAvailable: overrides,
    reason,
  };
}


/** Default human policy (permissive, prompts for caution). */
export const DEFAULT_HUMAN_POLICY: PolicySet = PolicySetSchema.parse({
  name: 'default-human',
  mode: 'default',
  install: {
    minimumScore: 50,
    blockTiers: ['blocked'],
    requireNoBlockers: true,
    allowInstallScripts: true,
    allowNonRegistrySources: true,
  },
  exec: {
    minimumScore: 60,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    requireExactVersion: false,
    disallowLatestTag: false,
    requirePermissionEnforcement: false,
    allowNativeBinaries: true,
    allowNetwork: 'any',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: false,
    requireTrustedPublisherForPublic: false,
  },
});

/** Default agent/CI policy (strict, deterministic). */
export const DEFAULT_AGENT_POLICY: PolicySet = PolicySetSchema.parse({
  name: 'default-agent-policy',
  mode: 'agent',
  install: {
    minimumScore: 80,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: false,
    allowNonRegistrySources: false,
  },
  exec: {
    minimumScore: 90,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    requireExactVersion: true,
    disallowLatestTag: true,
    requirePermissionEnforcement: true,
    allowNativeBinaries: false,
    allowNetwork: 'declared-and-approved',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: true,
    publicPromotionMinimumScore: 85,
    requireTrustedPublisherForPublic: true,
  },
});

/** Strict policy preset. */
export const STRICT_POLICY: PolicySet = PolicySetSchema.parse({
  name: 'strict',
  mode: 'strict',
  install: {
    minimumScore: 75,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: false,
    allowNonRegistrySources: false,
  },
  exec: {
    minimumScore: 85,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    requireExactVersion: true,
    disallowLatestTag: true,
    requirePermissionEnforcement: true,
    allowNativeBinaries: false,
    allowNetwork: 'declared',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: true,
    publicPromotionMinimumScore: 85,
    requireTrustedPublisherForPublic: true,
  },
});

/** Relaxed policy preset. */
export const RELAXED_POLICY: PolicySet = PolicySetSchema.parse({
  name: 'relaxed',
  mode: 'relaxed',
  install: {
    minimumScore: 20,
    blockTiers: ['blocked'],
    requireNoBlockers: false,
    allowInstallScripts: true,
    allowNonRegistrySources: true,
  },
  exec: {
    minimumScore: 30,
    blockTiers: ['blocked'],
    requireNoBlockers: false,
    requireExactVersion: false,
    disallowLatestTag: false,
    requirePermissionEnforcement: false,
    allowNativeBinaries: true,
    allowNetwork: 'any',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: false,
    requireTrustedPublisherForPublic: false,
  },
});

/** CI policy preset. */
export const CI_POLICY: PolicySet = PolicySetSchema.parse({
  name: 'ci',
  mode: 'ci',
  install: {
    minimumScore: 80,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: false,
    allowNonRegistrySources: false,
  },
  exec: {
    minimumScore: 90,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    requireExactVersion: true,
    disallowLatestTag: true,
    requirePermissionEnforcement: false,
    allowNativeBinaries: false,
    allowNetwork: 'declared',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: true,
    publicPromotionMinimumScore: 85,
    requireTrustedPublisherForPublic: true,
  },
});

/** Get a preset policy by mode. */
export function getPreset(mode: PolicySet['mode']): PolicySet {
  switch (mode) {
    case 'relaxed':
      return RELAXED_POLICY;
    case 'strict':
      return STRICT_POLICY;
    case 'agent':
      return DEFAULT_AGENT_POLICY;
    case 'ci':
      return CI_POLICY;
    case 'default':
    default:
      return DEFAULT_HUMAN_POLICY;
  }
}
