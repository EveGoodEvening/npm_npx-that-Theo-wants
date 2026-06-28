import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { policyCommand } from '../src/commands.js';
import { scoreAnalysis } from '@safe-npm/scoring';
import type { AnalysisReport, RiskReport } from '@safe-npm/core-types';

function baseFlags(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    agent: false,
    yes: false,
    no: false,
    verbose: false,
    debug: false,
    ...overrides,
  } as Parameters<typeof policyCommand>[2];
}

describe('policyCommand', () => {
  test('init writes a policy file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'policy-'));
    const outPath = join(dir, 'policy.json');
    try {
      let out = '';
      const code = await policyCommand('init', ['agent', outPath], {
        ...baseFlags(),
        out: (s) => {
          out += s;
        },
      });
      assert.equal(code, 0);
      const written = JSON.parse(await readFile(outPath, 'utf8'));
      assert.equal(written.name, 'default-agent-policy');
      assert.match(out, /wrote/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('init rejects invalid preset', async () => {
    let err = '';
    const code = await policyCommand('init', ['invalid-preset'], {
      ...baseFlags(),
      err: (s) => {
        err += s;
      },
    });
    assert.equal(code, 1);
    assert.match(err, /invalid preset/);
  });

  test('show prints effective policy', async () => {
    let out = '';
    const code = await policyCommand('show', [], {
      ...baseFlags(),
      out: (s) => {
        out += s;
      },
    });
    assert.equal(code, 0);
    assert.match(out, /Policy:/);
  });

  test('show --json prints valid JSON', async () => {
    let out = '';
    const code = await policyCommand('show', [], {
      ...baseFlags({ json: true }),
      out: (s) => {
        out += s;
      },
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.ok(parsed.name);
  });

  test('test evaluates a risk report and returns exit code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'policy-test-'));
    const reportPath = join(dir, 'report.json');
    const analysis = {
      tarballDigest: 'sha512-abc',
      analyzerVersion: '0.1.0',
      generatedAt: '2026-06-28T00:00:00.000Z',
      package: { name: 'pkg', version: '1.0.0', bin: {}, scripts: {}, dependencies: {}, devDependencies: {}, optionalDependencies: {}, peerDependencies: {}, bundledDependencies: [], contributors: [], maintainers: [], exports: {} },
      tarball: { sizeBytes: 1, unpackedSizeBytes: 1, fileCount: 1 },
      lifecycleScripts: [],
      scriptFindings: [],
      staticFindings: [],
      readability: { likelyMinified: false, likelyObfuscated: false, sourceMapsPresent: false, humanReadableFileRatio: 1, minifiedLineRatio: 0 },
      nativeArtifacts: { nodeAddons: [], binaries: [], bindingGyp: false },
      inferredPermissions: { net: [], env: [], childProcess: false, workerThreads: false, ffi: false, native: false, installScripts: false },
    } as AnalysisReport;
    const report: RiskReport = scoreAnalysis({ analysis });
    await writeFile(reportPath, JSON.stringify(report));
    try {
      let out = '';
      const code = await policyCommand('test', [reportPath, 'exec'], {
        ...baseFlags({ json: true }),
        out: (s) => {
          out += s;
        },
      });
      const parsed = JSON.parse(out);
      assert.ok(['allow', 'requires_approval', 'blocked'].includes(parsed.decision));
      assert.ok([0, 10, 11].includes(code));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('test with agent policy blocks latest-tag report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'policy-test-block-'));
    const reportPath = join(dir, 'report.json');
    const analysis = {
      tarballDigest: 'sha512-abc',
      analyzerVersion: '0.1.0',
      generatedAt: '2026-06-28T00:00:00.000Z',
      package: { name: 'pkg', version: '1.0.0', bin: {}, scripts: {}, dependencies: {}, devDependencies: {}, optionalDependencies: {}, peerDependencies: {}, bundledDependencies: [], contributors: [], maintainers: [], exports: {} },
      tarball: { sizeBytes: 1, unpackedSizeBytes: 1, fileCount: 1 },
      lifecycleScripts: [],
      scriptFindings: [],
      staticFindings: [],
      readability: { likelyMinified: false, likelyObfuscated: false, sourceMapsPresent: false, humanReadableFileRatio: 1, minifiedLineRatio: 0 },
      nativeArtifacts: { nodeAddons: [], binaries: [], bindingGyp: false },
      inferredPermissions: { net: [], env: [], childProcess: false, workerThreads: false, ffi: false, native: false, installScripts: false },
    } as AnalysisReport;
    const report: RiskReport = scoreAnalysis({ analysis });
    // mark version as non-exact to trigger requireExactVersion
    report.version = 'latest';
    await writeFile(reportPath, JSON.stringify(report));
    try {
      let out = '';
      const code = await policyCommand('test', [reportPath, 'exec'], {
        ...baseFlags({ json: true, agent: true }),
        out: (s) => {
          out += s;
        },
      });
      const parsed = JSON.parse(out);
      assert.notEqual(parsed.decision, 'allow');
      assert.ok([10, 11].includes(code));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
