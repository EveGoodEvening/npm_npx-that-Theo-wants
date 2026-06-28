import { describe, expect, it } from 'vitest';
import { renderJson, renderTty, inferPermissions } from '../src/index.js';
import type { RiskReport, AnalysisReport } from '@safe-npm/core-types';

function makeRiskReport(overrides: Partial<RiskReport> = {}): RiskReport {
  return {
    package: 'test-pkg',
    version: '1.0.0',
    publishId: 'pub-1',
    score: 84,
    tier: 'good',
    confidence: 91,
    generatedAt: '2026-06-28T00:00:00.000Z',
    analyzerVersion: '0.1.0',
    evidenceDigest: 'sha256:abc',
    blockers: [],
    warnings: [
      { code: 'INSTALL_SCRIPT_PRESENT', severity: 'medium', message: 'Package has a postinstall script.', evidence: ['package.json:scripts.postinstall'] },
    ],
    facts: {
      tarball: { sizeBytes: 512345, unpackedSizeBytes: 1838120, fileCount: 76, integrity: 'sha512-test' },
    },
    components: [
      { component: 'runtime_install_behavior', weight: 20, contribution: -4, signals: { lifecycleScripts: 1 } },
    ],
    ...overrides,
  } as RiskReport;
}

describe('renderJson', () => {
  it('produces valid JSON with all fields', () => {
    const json = renderJson(makeRiskReport());
    const parsed = JSON.parse(json);
    expect(parsed.package).toBe('test-pkg');
    expect(parsed.score).toBe(84);
    expect(parsed.tier).toBe('good');
    expect(parsed.warnings).toHaveLength(1);
  });
});

describe('renderTty', () => {
  it('includes package name, version, score, and tier', () => {
    const out = renderTty(makeRiskReport());
    expect(out).toContain('test-pkg');
    expect(out).toContain('1.0.0');
    expect(out).toContain('84/100');
    expect(out).toContain('good');
  });

  it('includes tarball size info', () => {
    const out = renderTty(makeRiskReport());
    expect(out).toContain('500.3KB');
    expect(out).toContain('1.8MB');
    expect(out).toContain('76 files');
  });

  it('includes warnings', () => {
    const out = renderTty(makeRiskReport());
    expect(out).toContain('Warnings:');
    expect(out).toContain('INSTALL_SCRIPT_PRESENT');
    expect(out).toContain('package.json:scripts.postinstall');
  });

  it('includes blockers when present', () => {
    const out = renderTty(
      makeRiskReport({
        tier: 'blocked',
        blockers: [
          { code: 'KNOWN_MALWARE', severity: 'critical', message: 'malware detected', evidence: ['ref'] },
        ],
      }),
    );
    expect(out).toContain('Blockers:');
    expect(out).toContain('KNOWN_MALWARE');
  });

  it('includes permissions when provided', () => {
    const out = renderTty(makeRiskReport(), {
      permissions: { fs: true, net: true, childProcess: false, env: false, nativeAddon: false },
    });
    expect(out).toContain('filesystem');
    expect(out).toContain('network');
  });

  it('shows none inferred when no permissions', () => {
    const out = renderTty(makeRiskReport(), {
      permissions: { fs: false, net: false, childProcess: false, env: false, nativeAddon: false },
    });
    expect(out).toContain('none inferred');
  });

  it('includes author and maintainers when provided', () => {
    const out = renderTty(makeRiskReport(), {
      author: 'alice',
      maintainers: ['alice', 'bob'],
    });
    expect(out).toContain('alice');
    expect(out).toContain('bob');
  });

  it('includes bin command when provided', () => {
    const out = renderTty(makeRiskReport(), { binCommand: 'test-pkg' });
    expect(out).toContain('Bin:');
    expect(out).toContain('test-pkg');
  });

  it('shows install scripts as a dedicated field when present', () => {
    const out = renderTty(makeRiskReport(), { installScripts: ['postinstall'] });
    expect(out).toContain('Scripts:');
    expect(out).toContain('postinstall');
  });

  it('shows no install scripts when absent', () => {
    const out = renderTty(makeRiskReport(), { installScripts: [] });
    expect(out).toContain('no install scripts');
  });

  it('TTY snapshot matches', () => {
    const out = renderTty(makeRiskReport(), {
      author: 'alice',
      maintainers: ['alice', 'bob'],
      binCommand: 'test-pkg',
      installScripts: ['postinstall'],
      permissions: { fs: true, net: false, childProcess: false, env: false, nativeAddon: false },
    });
    expect(out).toMatchInlineSnapshot(`
      "[1mtest-pkg[0m@[1m1.0.0[0m

        Score:      [32m84/100 (good)[0m
        Confidence: 91/100
        Tarball:    500.3KB packed, 1.8MB unpacked, 76 files
        Author:     alice
        Maintainers: alice, bob
        Bin:        test-pkg
        Scripts:    [33mpostinstall[0m
        Permissions: [33mfilesystem[0m

      [33mWarnings:[0m
        [33m[medium][0m INSTALL_SCRIPT_PRESENT: Package has a postinstall script.
          [2mevidence: package.json:scripts.postinstall[0m

      [2mScore components:[0m
        runtime_install_behavior: [31m-4[0m [2m(weight 20)[0m"
    `);
  });

  it('JSON snapshot matches', () => {
    const json = renderJson(makeRiskReport());
    expect(JSON.parse(json)).toMatchInlineSnapshot(`
      {
        "analyzerVersion": "0.1.0",
        "blockers": [],
        "components": [
          {
            "component": "runtime_install_behavior",
            "contribution": -4,
            "signals": {
              "lifecycleScripts": 1,
            },
            "weight": 20,
          },
        ],
        "confidence": 91,
        "evidenceDigest": "sha256:abc",
        "facts": {
          "tarball": {
            "fileCount": 76,
            "integrity": "sha512-test",
            "sizeBytes": 512345,
            "unpackedSizeBytes": 1838120,
          },
        },
        "generatedAt": "2026-06-28T00:00:00.000Z",
        "package": "test-pkg",
        "publishId": "pub-1",
        "score": 84,
        "tier": "good",
        "version": "1.0.0",
        "warnings": [
          {
            "code": "INSTALL_SCRIPT_PRESENT",
            "evidence": [
              "package.json:scripts.postinstall",
            ],
            "message": "Package has a postinstall script.",
            "severity": "medium",
          },
        ],
      }
    `);
  });

  it('includes score components', () => {
    const out = renderTty(makeRiskReport());
    expect(out).toContain('Score components:');
    expect(out).toContain('runtime_install_behavior');
  });
});

describe('inferPermissions', () => {
  it('infers permissions from analysis report', () => {
    const report = {
      builtinsUsed: ['fs', 'http', 'child_process'],
      staticFindings: [{ code: 'PROCESS_ENV_ACCESS', file: 'i.js', confidence: 1 }],
      nativeArtifacts: [{ type: 'node_addon', file: 'a.node' }],
    } as unknown as AnalysisReport;
    const perms = inferPermissions(report);
    expect(perms.fs).toBe(true);
    expect(perms.net).toBe(true);
    expect(perms.childProcess).toBe(true);
    expect(perms.env).toBe(true);
    expect(perms.nativeAddon).toBe(true);
  });

  it('returns all false for clean report', () => {
    const report = {
      builtinsUsed: [],
      staticFindings: [],
      nativeArtifacts: [],
    } as unknown as AnalysisReport;
    const perms = inferPermissions(report);
    expect(perms.fs).toBe(false);
    expect(perms.net).toBe(false);
    expect(perms.childProcess).toBe(false);
    expect(perms.env).toBe(false);
    expect(perms.nativeAddon).toBe(false);
  });
});
