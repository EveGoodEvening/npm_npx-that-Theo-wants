import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisReport, RiskReport } from '@safe-npm/core-types';
import { scoreAnalysis, scoreToTier } from '../src/score.js';
import { renderJson, renderTty } from '../src/render.js';
import {
  evaluatePolicy,
  DEFAULT_HUMAN_POLICY,
  DEFAULT_AGENT_POLICY,
  STRICT_POLICY,
  RELAXED_POLICY,
  getPreset,
} from '../src/policy.js';

function baseAnalysis(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    tarballDigest: 'sha512-abc',
    analyzerVersion: '0.1.0',
    generatedAt: '2026-06-28T00:00:00.000Z',
    package: {
      name: 'test-pkg',
      version: '1.0.0',
      license: 'MIT',
      repository: 'https://github.com/u/test-pkg',
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
    tarball: { sizeBytes: 1000, unpackedSizeBytes: 2000, fileCount: 3 },
    lifecycleScripts: [],
    scriptFindings: [],
    staticFindings: [],
    readability: {
      likelyMinified: false,
      likelyObfuscated: false,
      sourceMapsPresent: false,
      humanReadableFileRatio: 1,
      minifiedLineRatio: 0,
    },
    nativeArtifacts: { nodeAddons: [], binaries: [], bindingGyp: false },
    inferredPermissions: {
      net: [],
      env: [],
      childProcess: false,
      workerThreads: false,
      ffi: false,
      native: false,
      installScripts: false,
    },
    ...overrides,
  } as AnalysisReport;
}

describe('scoreAnalysis', () => {
  test('benign package scores high', () => {
    const report = scoreAnalysis({ analysis: baseAnalysis() });
    assert.ok(report.score >= 90, `score ${report.score}`);
    assert.equal(report.tier, 'excellent');
    assert.equal(report.blockers.length, 0);
  });

  test('install scripts reduce score', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        lifecycleScripts: ['postinstall'],
        scriptFindings: [
          { code: 'LIFECYCLE_SCRIPT_PRESENT', severity: 'medium', message: 'postinstall', evidence: [] },
        ],
      }),
    });
    assert.ok(report.score < 95, `score ${report.score}`);
    assert.ok(report.warnings.some((w) => w.code === 'LIFECYCLE_SCRIPT_PRESENT'));
  });

  test('child_process finding reduces score', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        staticFindings: [
          { code: 'MODULE_CHILD_PROCESS', severity: 'high', message: 'imports child_process', evidence: [] },
        ],
        inferredPermissions: { net: [], env: [], childProcess: true, workerThreads: false, ffi: false, native: false, installScripts: false },
      }),
    });
    assert.ok(report.score < 90, `score ${report.score}`);
  });

  test('blocker forces blocked tier regardless of score', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        staticFindings: [
          { code: 'KNOWN_MALWARE', severity: 'critical', message: 'malware', evidence: [] },
        ],
      }),
    });
    assert.equal(report.tier, 'blocked');
    assert.ok(report.blockers.some((b) => b.code === 'KNOWN_MALWARE'));
  });

  test('native artifacts emit NATIVE_ARTIFACT warning', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        nativeArtifacts: { nodeAddons: ['addon.node'], binaries: [], bindingGyp: true },
      }),
    });
    assert.ok(report.warnings.some((w) => w.code === 'NATIVE_ARTIFACT'));
  });

  test('provenance verified gives bonus', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis(),
      source: { provenance: 'verified', repository: 'https://github.com/u/r' },
    });
    assert.ok(report.score >= 95);
    assert.ok(report.components.some((c) => c.name === 'provenance'));
  });

  test('provenance mismatch is a blocker', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis(),
      source: { provenance: 'mismatch' },
    });
    assert.equal(report.tier, 'blocked');
    assert.ok(report.blockers.some((b) => b.code === 'PROVENANCE_MISMATCH'));
  });

  test('permission mismatch flagged', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        inferredPermissions: { net: [], env: [], childProcess: true, workerThreads: false, ffi: false, native: false, installScripts: false },
      }),
      declaredPermissions: { net: [], env: [], childProcess: false, workerThreads: false, ffi: false, native: false, installScripts: false },
    });
    assert.ok(report.warnings.some((w) => w.code === 'PERMISSION_MISMATCH'));
  });

  test('deterministic evidence digest', () => {
    const a = baseAnalysis();
    const r1 = scoreAnalysis({ analysis: a });
    const r2 = scoreAnalysis({ analysis: a });
    assert.equal(r1.evidenceDigest, r2.evidenceDigest);
  });

  test('scoreToTier boundaries', () => {
    assert.equal(scoreToTier(90), 'excellent');
    assert.equal(scoreToTier(75), 'good');
    assert.equal(scoreToTier(55), 'caution');
    assert.equal(scoreToTier(25), 'danger');
    assert.equal(scoreToTier(24), 'blocked');
  });
});

describe('renderers', () => {
  test('renderJson produces valid JSON', () => {
    const report = scoreAnalysis({ analysis: baseAnalysis() });
    const json = renderJson(report);
    const parsed = JSON.parse(json) as RiskReport;
    assert.equal(parsed.score, report.score);
  });

  test('renderTty includes key fields with analysis', () => {
    const analysis = baseAnalysis({
      package: {
        ...baseAnalysis().package,
        bin: { 'test-pkg': 'cli.js' },
        author: 'alice',
        maintainers: ['alice'],
      },
      lifecycleScripts: ['postinstall'],
    });
    const report = scoreAnalysis({ analysis });
    const tty = renderTty(report, analysis);
    assert.match(tty, /Package: test-pkg@1.0.0/);
    assert.match(tty, /Score:/);
    assert.match(tty, /Confidence:/);
    assert.match(tty, /Bin:/);
    assert.match(tty, /Scripts:/);
    assert.match(tty, /Maintainers:/);
  });
});

describe('evaluatePolicy', () => {
  test('agent policy blocks latest tag', () => {
    const report = scoreAnalysis({ analysis: baseAnalysis() });
    const decision = evaluatePolicy(DEFAULT_AGENT_POLICY, {
      riskReport: report,
      action: 'exec',
      usedLatestTag: true,
      isExactVersion: true,
      permissionEnforcementAvailable: true,
    });
    assert.equal(decision.decision, 'requires_approval');
    assert.match(decision.matchedRules.map((r) => r.path).join(','), /disallowLatestTag/);
  });

  test('agent policy requires exact version', () => {
    const report = scoreAnalysis({ analysis: baseAnalysis() });
    const decision = evaluatePolicy(DEFAULT_AGENT_POLICY, {
      riskReport: report,
      action: 'exec',
      isExactVersion: false,
      permissionEnforcementAvailable: true,
    });
    assert.equal(decision.decision, 'requires_approval');
  });

  test('agent policy blocks on score below minimum', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        staticFindings: [
          { code: 'MODULE_CHILD_PROCESS', severity: 'high', message: 'cp', evidence: [] },
        ],
      }),
    });
    const decision = evaluatePolicy(DEFAULT_AGENT_POLICY, {
      riskReport: report,
      action: 'exec',
      isExactVersion: true,
      permissionEnforcementAvailable: true,
    });
    // score likely below 90 -> requires_approval (not blocked unless tier blocked)
    assert.ok(['requires_approval', 'blocked'].includes(decision.decision));
  });

  test('blocker always blocks under requireNoBlockers', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        staticFindings: [{ code: 'KNOWN_MALWARE', severity: 'critical', message: 'm', evidence: [] }],
      }),
    });
    const decision = evaluatePolicy(DEFAULT_HUMAN_POLICY, {
      riskReport: report,
      action: 'install',
    });
    assert.equal(decision.decision, 'blocked');
    assert.equal(decision.allow, false);
  });

  test('strict policy blocks install scripts', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        lifecycleScripts: ['postinstall'],
        scriptFindings: [{ code: 'LIFECYCLE_SCRIPT_PRESENT', severity: 'medium', message: 'p', evidence: [] }],
      }),
    });
    const decision = evaluatePolicy(STRICT_POLICY, {
      riskReport: report,
      action: 'install',
    });
    assert.ok(['requires_approval', 'blocked'].includes(decision.decision));
  });

  test('relaxed policy allows low score', () => {
    const report = scoreAnalysis({
      analysis: baseAnalysis({
        staticFindings: [{ code: 'MODULE_CHILD_PROCESS', severity: 'high', message: 'cp', evidence: [] }],
      }),
    });
    const decision = evaluatePolicy(RELAXED_POLICY, {
      riskReport: report,
      action: 'install',
    });
    // relaxed minimumScore 20, no blockers -> allow unless tier blocked
    assert.ok(['allow', 'requires_approval'].includes(decision.decision));
  });

  test('enforcement unavailable blocks exec when required', () => {
    const report = scoreAnalysis({ analysis: baseAnalysis() });
    const decision = evaluatePolicy(DEFAULT_AGENT_POLICY, {
      riskReport: report,
      action: 'exec',
      isExactVersion: true,
      permissionEnforcementAvailable: false,
    });
    assert.equal(decision.decision, 'blocked');
  });

  test('getPreset returns matching policy', () => {
    assert.equal(getPreset('agent').name, 'default-agent-policy');
    assert.equal(getPreset('strict').name, 'strict');
    assert.equal(getPreset('relaxed').name, 'relaxed');
    assert.equal(getPreset('ci').name, 'ci');
    assert.equal(getPreset('default').name, 'default-human');
  });
});
