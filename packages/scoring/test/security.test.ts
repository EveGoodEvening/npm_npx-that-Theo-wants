import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNameRisk,
  scoreAnalysis,
  evaluatePolicy,
  STRICT_POLICY,
  DEFAULT_AGENT_POLICY,
} from '../src/index.js';
import type { AnalysisReport } from '@safe-npm/core-types';

function baseAnalysis(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    tarballDigest: 'sha512-x',
    analyzerVersion: '0.1.0',
    generatedAt: '2026-06-28T00:00:00.000Z',
    package: {
      name: 'p',
      version: '1.0.0',
      bin: {},
      scripts: {},
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
      bundledDependencies: [],
      contributors: [],
      maintainers: [],
      exports: {},
    },
    tarball: { sizeBytes: 1, unpackedSizeBytes: 1, fileCount: 1 },
    lifecycleScripts: [],
    scriptFindings: [],
    staticFindings: [],
    readability: { likelyMinified: false, likelyObfuscated: false, sourceMapsPresent: false, humanReadableFileRatio: 1, minifiedLineRatio: 0 },
    nativeArtifacts: { nodeAddons: [], binaries: [], bindingGyp: false },
    inferredPermissions: { net: [], env: [], childProcess: false, workerThreads: false, ffi: false, native: false, installScripts: false },
    ...overrides,
  } as AnalysisReport;
}

describe('policy security tests (section 26.3)', () => {
  test('strict policy blocks install scripts', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        lifecycleScripts: ['postinstall'],
        scriptFindings: [{ code: 'LIFECYCLE_SCRIPT_PRESENT', severity: 'medium', message: 'p', evidence: [] }],
      }),
    });
    const decision = evaluatePolicy(STRICT_POLICY, { riskReport: report, action: 'install' });
    assert.ok(['requires_approval', 'blocked'].includes(decision.decision));
  });

  test('strict policy blocks native binaries', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        nativeArtifacts: { nodeAddons: ['addon.node'], binaries: [], bindingGyp: false },
        inferredPermissions: { net: [], env: [], childProcess: false, workerThreads: false, ffi: false, native: true, installScripts: false },
      }),
    });
    const decision = evaluatePolicy(STRICT_POLICY, { riskReport: report, action: 'exec', isExactVersion: true, permissionEnforcementAvailable: true });
    assert.ok(['requires_approval', 'blocked'].includes(decision.decision));
  });

  test('agent policy requires exact version', () => {
    const report = scoreAnalysis({ analysis: baseAnalysis() });
    const decision = evaluatePolicy(DEFAULT_AGENT_POLICY, { riskReport: report, action: 'exec', isExactVersion: false, permissionEnforcementAvailable: true });
    assert.notEqual(decision.decision, 'allow');
  });

  test('agent policy blocks latest tag', () => {
    const report = scoreAnalysis({ analysis: baseAnalysis() });
    const decision = evaluatePolicy(DEFAULT_AGENT_POLICY, { riskReport: report, action: 'exec', usedLatestTag: true, isExactVersion: true, permissionEnforcementAvailable: true });
    assert.notEqual(decision.decision, 'allow');
  });

  test('blocker always blocks', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        staticFindings: [{ code: 'KNOWN_MALWARE', severity: 'critical', message: 'm', evidence: [] }],
      }),
    });
    const decision = evaluatePolicy(STRICT_POLICY, { riskReport: report, action: 'install' });
    assert.equal(decision.decision, 'blocked');
  });
});

describe('typosquat security test (section 26)', () => {
  test('typosquat-like name flagged', () => {
    const result = computeNameRisk({ packageName: 'is-0dd', isNewPackage: true });
    assert.ok(result.similarTo.includes('is-odd'));
    assert.ok(['warn', 'block'].includes(result.action));
  });
});
