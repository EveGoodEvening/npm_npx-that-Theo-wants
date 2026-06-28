import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFixtureTarball } from './fixtures.js';
import { analyzeTarball } from '../src/index.js';
import { selectPreviousVersion, analyzeDiff, applyDiff } from '../src/diff.js';
import { safeExtract } from '../src/extract.js';
import type { AnalysisReport, ExactVersion } from '@safe-npm/core-types';

describe('selectPreviousVersion', () => {
  test('prefers highest version lower than current', () => {
    const candidates = [
      { version: '1.0.0', status: 'public' as const },
      { version: '1.1.0', status: 'public' as const },
      { version: '1.2.0', status: 'public' as const },
    ];
    assert.equal(selectPreviousVersion('1.2.0' as ExactVersion, candidates), '1.1.0');
  });

  test('ignores retracted/quarantined/deleted', () => {
    const candidates = [
      { version: '1.0.0', status: 'retracted' as const },
      { version: '1.1.0', status: 'quarantined' as const },
      { version: '1.2.0', status: 'public' as const },
    ];
    assert.equal(selectPreviousVersion('1.3.0' as ExactVersion, candidates), '1.2.0');
  });

  test('falls back to latest tag when no lower visible version', () => {
    const candidates = [{ version: '2.0.0', status: 'public' as const }];
    assert.equal(selectPreviousVersion('1.0.0' as ExactVersion, candidates, '2.0.0'), '2.0.0');
  });

  test('returns undefined when no candidate', () => {
    assert.equal(selectPreviousVersion('1.0.0' as ExactVersion, []), undefined);
  });
});

describe('analyzeDiff', () => {
  test('detects new install script, repo change, maintainer change', async () => {
    const prevFix = await buildFixtureTarball(
      {
        'package.json': JSON.stringify({
          name: 'diff-pkg',
          version: '1.0.0',
          license: 'MIT',
          main: 'index.js',
          bin: { 'diff-pkg': 'index.js' },
          repository: { type: 'git', url: 'https://github.com/u/old' },
          maintainers: [{ name: 'alice' }],
          dependencies: { foo: '^1.0.0' },
        }),
        'index.js': 'module.exports = 1;\n',
      },
      'prev',
    );
    const currFix = await buildFixtureTarball(
      {
        'package.json': JSON.stringify({
          name: 'diff-pkg',
          version: '1.1.0',
          main: 'index.js',
          bin: { 'diff-pkg': 'index.js', 'extra-bin': 'extra.js' },
          scripts: { postinstall: 'node install.js' },
          repository: { type: 'git', url: 'https://github.com/u/new' },
          maintainers: [{ name: 'bob' }],
          dependencies: { foo: '^2.0.0', bar: '^1.0.0' },
        }),
        'index.js': 'module.exports = 2;\n',
        'extra.js': 'module.exports = 3;\n',
        'install.js': '1;\n',
      },
      'curr',
    );
    try {
      const prevUnpack = await mkdtemp(join(tmpdir(), 'diff-prev-'));
      const currUnpack = await mkdtemp(join(tmpdir(), 'diff-curr-'));
      const { report: currReport } = await analyzeTarball({
        tarballPath: currFix.tarballPath,
        unpackDir: currUnpack,
        expectedName: 'diff-pkg',
        expectedVersion: '1.1.0',
      });
      // extract previous too
      await safeExtract(prevFix.tarballPath, prevUnpack);

      const diff = await analyzeDiff({
        current: currReport,
        previousVersion: '1.0.0' as ExactVersion,
        previousUnpackDir: prevUnpack,
        currentUnpackDir: currUnpack,
      });

      assert.equal(diff.previousVersion, '1.0.0');
      assert.ok(diff.filesAdded >= 1, `filesAdded=${diff.filesAdded}`);
      assert.ok(diff.newBinEntries.includes('extra-bin'));
      assert.ok(diff.newLifecycleScripts.includes('postinstall'));
      assert.ok(diff.repositoryUrlChanged);
      assert.ok(diff.maintainerChanged);
      assert.ok(diff.dependencyChanges.length > 0);
      assert.ok(diff.riskyDeltas.some((d) => d.code === 'DIFF_NEW_INSTALL_SCRIPT'));
      assert.ok(diff.riskyDeltas.some((d) => d.code === 'DIFF_REPO_CHANGED'));
      assert.ok(diff.riskyDeltas.some((d) => d.code === 'DIFF_MAINTAINER_CHANGED'));

      // applyDiff mutates report
      const reportCopy: AnalysisReport = { ...currReport };
      applyDiff(reportCopy, diff);
      assert.ok(reportCopy.diffRisk);
      assert.equal(reportCopy.diffRisk?.previousVersion, '1.0.0');

      await rm(prevUnpack, { recursive: true, force: true });
      await rm(currUnpack, { recursive: true, force: true });
    } finally {
      await prevFix.cleanup();
      await currFix.cleanup();
    }
  });

  test('detects network usage delta', async () => {
    const prevFix = await buildFixtureTarball(
      {
        'package.json': JSON.stringify({ name: 'net-pkg', version: '1.0.0', main: 'index.js' }),
        'index.js': 'module.exports = 1;\n',
      },
      'prevnet',
    );
    const currFix = await buildFixtureTarball(
      {
        'package.json': JSON.stringify({ name: 'net-pkg', version: '1.1.0', main: 'index.js' }),
        'index.js': "const https = require('https');\nmodule.exports = https;\n",
      },
      'currnet',
    );
    try {
      const prevUnpack = await mkdtemp(join(tmpdir(), 'diff-net-prev-'));
      const currUnpack = await mkdtemp(join(tmpdir(), 'diff-net-curr-'));
      const { report: currReport } = await analyzeTarball({
        tarballPath: currFix.tarballPath,
        unpackDir: currUnpack,
        expectedName: 'net-pkg',
        expectedVersion: '1.1.0',
      });
      await safeExtract(prevFix.tarballPath, prevUnpack);
      const diff = await analyzeDiff({
        current: currReport,
        previousVersion: '1.0.0' as ExactVersion,
        previousUnpackDir: prevUnpack,
        currentUnpackDir: currUnpack,
      });
      assert.ok(diff.riskyDeltas.some((d) => d.code === 'DIFF_NEW_NETWORK'));
      await rm(prevUnpack, { recursive: true, force: true });
      await rm(currUnpack, { recursive: true, force: true });
    } finally {
      await prevFix.cleanup();
      await currFix.cleanup();
    }
  });
});
