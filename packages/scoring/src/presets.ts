/**
 * Policy presets (Section 22.3).
 *
 * Pre-defined policy sets for common use cases.
 */
import type { PolicySet as PolicySetType } from '@safe-npm/core-types';
import { PolicySet } from '@safe-npm/core-types';

/** Relaxed policy: allows almost everything, minimal restrictions. */
export const RELAXED_PRESET: PolicySetType = PolicySet.parse({
  name: 'relaxed',
  mode: 'relaxed',
  install: {
    minimumScore: 20,
    blockTiers: ['blocked'],
    requireNoBlockers: false,
    allowInstallScripts: true,
    allowNativeBinaries: true,
    allowNonRegistrySources: true,
    requireExactVersion: false,
    disallowLatestTag: false,
    requirePermissionEnforcement: false,
    blockKnownCriticalVulns: false,
  },
  exec: {
    minimumScore: 20,
    blockTiers: ['blocked'],
    requireNoBlockers: false,
    allowInstallScripts: true,
    allowNativeBinaries: true,
    requireExactVersion: false,
    disallowLatestTag: false,
    requirePermissionEnforcement: false,
    allowNetwork: 'any',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: false,
    publicPromotionMinimumScore: 50,
    requireTrustedPublisherForPublic: false,
  },
});

/** Default human policy: balanced, allows install scripts, warns on caution. */
export const DEFAULT_HUMAN_PRESET: PolicySetType = PolicySet.parse({
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

/** Strict policy: high bar, blocks caution tier, requires exact versions. */
export const STRICT_PRESET: PolicySetType = PolicySet.parse({
  name: 'strict',
  mode: 'strict',
  install: {
    minimumScore: 85,
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
    minimumScore: 85,
    blockTiers: ['caution', 'danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: false,
    allowNativeBinaries: false,
    requireExactVersion: true,
    disallowLatestTag: true,
    requirePermissionEnforcement: true,
    allowNetwork: 'none',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: true,
    publicPromotionMinimumScore: 90,
    requireTrustedPublisherForPublic: true,
  },
});

/** Agent policy: for automated agents, blocks latest, requires exact versions. */
export const AGENT_PRESET: PolicySetType = PolicySet.parse({
  name: 'agent',
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

/** CI policy: for CI/CD pipelines, strict but allows some flexibility. */
export const CI_PRESET: PolicySetType = PolicySet.parse({
  name: 'ci',
  mode: 'ci',
  install: {
    minimumScore: 70,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: true,
    allowNativeBinaries: true,
    allowNonRegistrySources: false,
    requireExactVersion: true,
    disallowLatestTag: true,
    requirePermissionEnforcement: false,
    blockKnownCriticalVulns: true,
  },
  exec: {
    minimumScore: 70,
    blockTiers: ['danger', 'blocked'],
    requireNoBlockers: true,
    allowInstallScripts: false,
    allowNativeBinaries: true,
    requireExactVersion: true,
    disallowLatestTag: true,
    requirePermissionEnforcement: false,
    allowNetwork: 'declared',
  },
  publish: {
    defaultVisibility: 'private',
    publicPromotionRequiresAudit: true,
    publicPromotionMinimumScore: 80,
    requireTrustedPublisherForPublic: true,
  },
});

/** Map of preset name to preset. */
export const PRESETS: Record<string, PolicySetType> = {
  relaxed: RELAXED_PRESET,
  'default-human': DEFAULT_HUMAN_PRESET,
  strict: STRICT_PRESET,
  agent: AGENT_PRESET,
  ci: CI_PRESET,
};

/** Get a preset by name. */
export function getPreset(name: string): PolicySetType | undefined {
  return PRESETS[name];
}

/** List all preset names. */
export function listPresets(): string[] {
  return Object.keys(PRESETS);
}
