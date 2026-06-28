import { describe, expect, it } from 'vitest';
import {
  evaluatePolicy,
  DEFAULT_HUMAN_POLICY,
  DEFAULT_AGENT_POLICY,
} from '../src/index.js';
import type { RiskReport, PolicySet } from '@safe-npm/core-types';

function makeReport(overrides: Partial<RiskReport> = {}): RiskReport {
  return {
    package: 'test-pkg',
    version: '1.0.0',
    publishId: 'pub-1',
    score: 90,
    tier: 'excellent',
    confidence: 95,
    generatedAt: '2026-06-28T00:00:00.000Z',
    analyzerVersion: '0.1.0',
    evidenceDigest: 'sha256:abc',
    blockers: [],
    warnings: [],
    facts: { tarball: { sizeBytes: 1000, unpackedSizeBytes: 2000, fileCount: 5 } },
    components: [],
    ...overrides,
  } as RiskReport;
}

describe('evaluatePolicy', () => {
  describe('install action', () => {
    it('allows a clean excellent package', () => {
      const d = evaluatePolicy(makeReport(), 'install', DEFAULT_HUMAN_POLICY);
      expect(d.decision).toBe('allow');
      expect(d.allow).toBe(true);
      expect(d.matchedRules).toEqual([]);
    });

    it('blocks when score below minimum', () => {
      const d = evaluatePolicy(
        makeReport({ score: 40, tier: 'danger' }),
        'install',
        DEFAULT_HUMAN_POLICY,
      );
      expect(d.decision).toBe('block');
      expect(d.matchedRules.some((r) => r.path === 'install.minimumScore')).toBe(true);
    });

    it('blocks when tier is in blockTiers', () => {
      const d = evaluatePolicy(
        makeReport({ score: 60, tier: 'danger' }),
        'install',
        DEFAULT_HUMAN_POLICY,
      );
      expect(d.decision).toBe('block');
      expect(d.matchedRules.some((r) => r.path === 'install.blockTiers')).toBe(true);
    });

    it('blocks when blockers present and requireNoBlockers', () => {
      const d = evaluatePolicy(
        makeReport({
          score: 90,
          tier: 'excellent',
          blockers: [{ code: 'X', severity: 'critical', message: 'm', evidence: [] }],
        }),
        'install',
        DEFAULT_HUMAN_POLICY,
      );
      expect(d.decision).toBe('block');
      expect(d.matchedRules.some((r) => r.path === 'install.requireNoBlockers')).toBe(true);
    });

    it('blocks install scripts when not allowed (agent policy)', () => {
      const d = evaluatePolicy(makeReport(), 'install', DEFAULT_AGENT_POLICY, {
        hasInstallScripts: true,
      });
      expect(d.decision).toBe('block');
      expect(d.matchedRules.some((r) => r.path === 'install.allowInstallScripts')).toBe(true);
    });

    it('blocks native binaries when not allowed (agent policy)', () => {
      const d = evaluatePolicy(makeReport(), 'install', DEFAULT_AGENT_POLICY, {
        hasNativeBinaries: true,
      });
      expect(d.decision).toBe('block');
    });

    it('blocks latest tag when disallowed (agent policy)', () => {
      const d = evaluatePolicy(makeReport(), 'install', DEFAULT_AGENT_POLICY, {
        isLatestTag: true,
      });
      expect(d.decision).toBe('block');
      expect(d.matchedRules.some((r) => r.path === 'install.disallowLatestTag')).toBe(true);
    });

    it('blocks non-exact version when required (agent policy)', () => {
      const d = evaluatePolicy(makeReport(), 'install', DEFAULT_AGENT_POLICY, {
        isExactVersion: false,
      });
      expect(d.decision).toBe('block');
      expect(d.matchedRules.some((r) => r.path === 'install.requireExactVersion')).toBe(true);
    });

    it('blocks non-registry source when not allowed', () => {
      const d = evaluatePolicy(makeReport(), 'install', DEFAULT_HUMAN_POLICY, {
        isNonRegistrySource: true,
      });
      expect(d.decision).toBe('block');
    });

    it('blocks when permission enforcement required but not enforceable', () => {
      const d = evaluatePolicy(makeReport(), 'install', DEFAULT_AGENT_POLICY, {
        permissionsEnforceable: false,
      });
      expect(d.decision).toBe('block');
    });
  });

  describe('exec action', () => {
    it('allows a clean excellent package', () => {
      const d = evaluatePolicy(makeReport(), 'exec', DEFAULT_HUMAN_POLICY);
      expect(d.decision).toBe('allow');
    });

    it('requires approval for caution tier', () => {
      const d = evaluatePolicy(
        makeReport({ score: 60, tier: 'caution' }),
        'exec',
        DEFAULT_HUMAN_POLICY,
      );
      expect(d.decision).toBe('requires_approval');
      expect(d.matchedRules.some((r) => r.path === 'exec.cautionTier')).toBe(true);
      expect(d.overridesAvailable).toContain('--yes');
    });

    it('blocks when score below minimum (agent)', () => {
      const d = evaluatePolicy(
        makeReport({ score: 60, tier: 'caution' }),
        'exec',
        DEFAULT_AGENT_POLICY,
      );
      expect(d.decision).toBe('block');
    });
  });

  describe('publish action', () => {
    it('allows publish with sufficient score', () => {
      const d = evaluatePolicy(makeReport({ score: 90 }), 'publish', DEFAULT_HUMAN_POLICY);
      expect(d.decision).toBe('allow');
    });

    it('blocks public promotion below minimum score', () => {
      const d = evaluatePolicy(makeReport({ score: 50 }), 'publish', DEFAULT_HUMAN_POLICY);
      expect(d.decision).toBe('block');
    });

    it('requires approval when audit required (agent)', () => {
      const d = evaluatePolicy(makeReport({ score: 90 }), 'publish', DEFAULT_AGENT_POLICY);
      expect(d.decision).toBe('requires_approval');
      expect(d.matchedRules.some((r) => r.path === 'publish.publicPromotionRequiresAudit')).toBe(true);
    });

    it('requires approval when trusted publisher required (agent)', () => {
      const d = evaluatePolicy(makeReport({ score: 90 }), 'publish', DEFAULT_AGENT_POLICY);
      expect(d.matchedRules.some((r) => r.path === 'publish.requireTrustedPublisherForPublic')).toBe(true);
    });
  });

  describe('determinism', () => {
    it('produces the same decision for the same inputs', () => {
      const r = makeReport({ score: 60, tier: 'caution' });
      const d1 = evaluatePolicy(r, 'exec', DEFAULT_HUMAN_POLICY);
      const d2 = evaluatePolicy(r, 'exec', DEFAULT_HUMAN_POLICY);
      expect(d1).toEqual(d2);
    });
  });

  describe('custom policy', () => {
    it('respects custom minimumScore', () => {
      const custom: PolicySet = {
        ...DEFAULT_HUMAN_POLICY,
        install: { ...DEFAULT_HUMAN_POLICY.install, minimumScore: 95 },
      };
      const d = evaluatePolicy(makeReport({ score: 90 }), 'install', custom);
      expect(d.decision).toBe('block');
    });
  });
});
