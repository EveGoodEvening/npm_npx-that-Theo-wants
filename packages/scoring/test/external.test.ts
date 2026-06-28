import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  queryOsv,
  queryRepoHealth,
  normalizeRepoUrl,
  validateProvenance,
  repoHealthToSignal,
} from '../src/external.js';

function fakeFetch(response: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('queryOsv', () => {
  test('returns vulnerabilities and findings', async () => {
    const osvResp = {
      vulns: [
        { id: 'GHSA-abc', summary: 'rce', severity: [{ type: 'CVSS_V3', score: '9.0' }] },
      ],
    };
    const { vulnerabilities, findings, available } = await queryOsv('is-odd', '1.0.0', {
      fetchImpl: fakeFetch(osvResp),
    });
    assert.equal(available, true);
    assert.equal(vulnerabilities.length, 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.code, 'KNOWN_VULNERABILITY');
    assert.equal(findings[0]!.severity, 'critical');
  });

  test('graceful degradation on HTTP error', async () => {
    const { vulnerabilities, findings, available } = await queryOsv('pkg-http-err', '1.0.0', {
      fetchImpl: fakeFetch({}, 500),
    });
    assert.equal(available, false);
    assert.equal(vulnerabilities.length, 0);
    assert.equal(findings.length, 0);
  });

  test('graceful degradation on network failure', async () => {
    const failingFetch = (() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
  const { available } = await queryOsv('pkg-net-fail', '1.0.0', { fetchImpl: failingFetch });
    assert.equal(available, false);
  });
});

describe('normalizeRepoUrl', () => {
  test('github.com URL', () => {
    assert.deepEqual(normalizeRepoUrl('https://github.com/owner/repo'), { owner: 'owner', repo: 'repo' });
  });
  test('github.com URL with .git', () => {
    assert.deepEqual(normalizeRepoUrl('https://github.com/owner/repo.git'), {
      owner: 'owner',
      repo: 'repo',
    });
  });
  test('gitlab.com URL', () => {
    assert.deepEqual(normalizeRepoUrl('https://gitlab.com/group/proj'), {
      owner: 'group',
      repo: 'proj',
    });
  });
  test('non-repo URL returns undefined', () => {
    assert.equal(normalizeRepoUrl('https://example.com'), undefined);
    assert.equal(normalizeRepoUrl(undefined), undefined);
  });
});

describe('queryRepoHealth', () => {
  test('returns score and low-health finding', async () => {
    const resp = { score: 2, checks: [] };
    const { score, available, findings } = await queryRepoHealth('https://github.com/o/r', {
      fetchImpl: fakeFetch(resp),
    });
    assert.equal(available, true);
    assert.equal(score, 2);
    assert.ok(findings.some((f) => f.code === 'LOW_REPO_HEALTH'));
  });

  test('high score no finding', async () => {
    const resp = { score: 8, checks: [] };
    const { findings } = await queryRepoHealth('https://github.com/o/high', {
      fetchImpl: fakeFetch(resp),
    });
    assert.equal(findings.length, 0);
  });

  test('non-repo URL returns unavailable', async () => {
    const { available } = await queryRepoHealth('https://example.com', {
      fetchImpl: fakeFetch({ score: 5 }),
    });
    assert.equal(available, false);
  });
});

describe('validateProvenance', () => {
  test('missing when no subject digest', () => {
    const { status, findings } = validateProvenance({});
    assert.equal(status, 'missing');
    assert.equal(findings.length, 0);
  });

  test('verified when digests and repos match', () => {
    const { status } = validateProvenance({
      tarballDigest: 'sha512-abc',
      provenanceSubjectDigest: 'sha512-abc',
      provenanceRepo: 'https://github.com/o/r',
      packageRepo: 'https://github.com/o/r.git',
    });
    assert.equal(status, 'verified');
  });

  test('mismatch on digest difference', () => {
    const { status, findings } = validateProvenance({
      tarballDigest: 'sha512-abc',
      provenanceSubjectDigest: 'sha512-xyz',
    });
    assert.equal(status, 'mismatch');
    assert.ok(findings.some((f) => f.code === 'PROVENANCE_DIGEST_MISMATCH'));
  });

  test('unsupported when subject present but no tarball digest', () => {
    const { status } = validateProvenance({ provenanceSubjectDigest: 'sha512-abc' });
    assert.equal(status, 'unsupported');
  });

  test('mismatch on repo difference', () => {
    const { status, findings } = validateProvenance({
      tarballDigest: 'sha512-abc',
      provenanceSubjectDigest: 'sha512-abc',
      provenanceRepo: 'https://github.com/o/r',
      packageRepo: 'https://github.com/o/other',
    });
    assert.equal(status, 'mismatch');
    assert.ok(findings.some((f) => f.code === 'PROVENANCE_REPO_MISMATCH'));
  });
});

describe('repoHealthToSignal', () => {
  test('high score bonus', () => {
    assert.deepEqual(repoHealthToSignal({ score: 8, available: true, findings: [] }), {
      bonus: 3,
      confidenceDelta: 2,
    });
  });
  test('low score penalty', () => {
    assert.deepEqual(repoHealthToSignal({ score: 2, available: true, findings: [] }), {
      bonus: -3,
      confidenceDelta: -2,
    });
  });
  test('unavailable reduces confidence', () => {
    assert.deepEqual(repoHealthToSignal({ available: false, findings: [] }), {
      bonus: 0,
      confidenceDelta: -2,
    });
  });
});

import { enrichRiskReport } from '../src/external.js';
import { scoreAnalysis } from '../src/score.js';
import type { RiskReport, AnalysisReport } from '@safe-npm/core-types';

function baseReport(): RiskReport {
  const analysis = {
    tarballDigest: 'sha512-abc',
    analyzerVersion: '0.1.0',
    generatedAt: '2026-06-28T00:00:00.000Z',
    package: {
      name: 'pkg',
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
  } as AnalysisReport;
  return scoreAnalysis({ analysis });
}

describe('enrichRiskReport', () => {
  test('merges OSV, repo health, provenance findings', () => {
    const base = baseReport();
    const enriched = enrichRiskReport({
      riskReport: base,
      osv: {
        findings: [{ code: 'KNOWN_VULNERABILITY', severity: 'high', message: 'vuln', evidence: ['V1'] }],
        available: true,
      },
      repoHealth: { score: 2, available: true, findings: [{ code: 'LOW_REPO_HEALTH', severity: 'medium', message: 'low', evidence: [] }] },
      provenance: { status: 'verified', findings: [] },
    });
    assert.ok(enriched.warnings.some((w) => w.code === 'KNOWN_VULNERABILITY'));
    assert.ok(enriched.warnings.some((w) => w.code === 'LOW_REPO_HEALTH'));
    assert.equal(enriched.facts.source?.provenance, 'verified');
  });

  test('repo health bonus/penalty affects score', () => {
    const base = baseReport();
    const baseScore = base.score;
    const enrichedLow = enrichRiskReport({
      riskReport: base,
      osv: { findings: [], available: true },
      repoHealth: { score: 2, available: true, findings: [] },
      provenance: { status: 'missing', findings: [] },
    });
    assert.ok(enrichedLow.score < baseScore, `low health should reduce score: ${enrichedLow.score} vs ${baseScore}`);
  });
  test('provenance mismatch becomes blocker', () => {
    const base = baseReport();
    const enriched = enrichRiskReport({
      riskReport: base,
      osv: { findings: [], available: true },
      repoHealth: { available: false, findings: [] },
      provenance: {
        status: 'mismatch',
        findings: [{ code: 'PROVENANCE_DIGEST_MISMATCH', severity: 'critical', message: 'mismatch', evidence: [] }],
      },
    });
    assert.ok(enriched.blockers.some((b) => b.code === 'PROVENANCE_DIGEST_MISMATCH'));
    assert.equal(enriched.tier, 'blocked');
  });
});
