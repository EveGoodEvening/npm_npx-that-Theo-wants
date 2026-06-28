import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import { buildFixtureTarball } from './fixtures.js';
import { safeExtract } from '../src/extract.js';
import { analyzeTarball, resolveBin, ANALYZER_VERSION } from '../src/index.js';

describe('safeExtract', () => {
  let tmp: string;
  test('setup', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'safe-extract-'));
  });

  test('extracts benign tarball', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'benign', version: '1.0.0' }),
      'index.js': 'module.exports = 1;',
    });
    try {
      const dest = join(tmp, 'benign');
      await safeExtract(fix.tarballPath, dest);
      const pkg = JSON.parse(await readFile(join(dest, 'package', 'package.json'), 'utf8'));
      assert.equal(pkg.name, 'benign');
    } finally {
      await fix.cleanup();
    }
  });

  test('rejects symlink entry by default', async () => {
    // Build a tar containing a symlink entry; safeExtract must reject it.
    const staging = await mkdtemp(join(tmpdir(), 'symlink-staging-'));
    await mkdir(join(staging, 'package'));
    await writeFile(join(staging, 'package', 'package.json'), JSON.stringify({ name: 'sym', version: '1.0.0' }));
    await writeFile(join(staging, 'package', 'real.js'), '1');
    // create a symlink inside package pointing to real.js
    await symlink('real.js', join(staging, 'package', 'link.js'));
    const tarballPath = join(staging, 'sym.tgz');
    await tar.c(
      { file: tarballPath, cwd: staging, gzip: true, sync: true, portable: true, follow: false },
      ['package'],
    );
    const dest = join(tmp, 'sym-out');
    await assert.rejects(safeExtract(tarballPath, dest), /unsafe entries|symlink/);
    await rm(staging, { recursive: true, force: true });
  });

  test('cleanup', async () => {
    await rm(tmp, { recursive: true, force: true });
  });
});

describe('analyzeTarball', () => {
  test('benign package: no high findings', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({
        name: 'benign-pkg',
        version: '1.0.0',
        license: 'MIT',
        main: 'index.js',
        bin: { 'benign-pkg': 'index.js' },
        repository: { type: 'git', url: 'https://github.com/u/benign-pkg' },
      }),
      'index.js': 'module.exports = function add(a, b) { return a + b; };\n',
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'benign-pkg',
        expectedVersion: '1.0.0',
      });
      assert.equal(report.package.name, 'benign-pkg');
      assert.equal(report.package.license, 'MIT');
      assert.equal(report.analyzerVersion, ANALYZER_VERSION);
      assert.equal(report.lifecycleScripts.length, 0);
      assert.equal(report.readability.likelyMinified, false);
      assert.equal(report.inferredPermissions.fs, undefined);
      assert.equal(report.inferredPermissions.childProcess, false);
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('name mismatch throws', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'real-name', version: '1.0.0', main: 'index.js' }),
      'index.js': '1',
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      await assert.rejects(
        analyzeTarball({
          tarballPath: fix.tarballPath,
          unpackDir: unpack,
          expectedName: 'wrong-name',
          expectedVersion: '1.0.0',
        }),
        /name mismatch/,
      );
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('version mismatch throws', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'ver-pkg', version: '1.0.0', main: 'index.js' }),
      'index.js': '1',
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      await assert.rejects(
        analyzeTarball({
          tarballPath: fix.tarballPath,
          unpackDir: unpack,
          expectedName: 'ver-pkg',
          expectedVersion: '2.0.0',
        }),
        /version mismatch/,
      );
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('postinstall script flagged', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({
        name: 'with-script',
        version: '1.0.0',
        scripts: { postinstall: 'node install.js' },
      }),
      'index.js': '1',
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'with-script',
        expectedVersion: '1.0.0',
      });
      assert.ok(report.lifecycleScripts.includes('postinstall'));
      const hasScriptFinding = report.scriptFindings.some((f) => f.code === 'LIFECYCLE_SCRIPT_PRESENT');
      assert.ok(hasScriptFinding);
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('child_process import flagged and inferred', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'cp-pkg', version: '1.0.0', main: 'index.js' }),
      'index.js': "const { exec } = require('child_process');\nmodule.exports = exec;\n",
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'cp-pkg',
        expectedVersion: '1.0.0',
      });
      assert.equal(report.inferredPermissions.childProcess, true);
      const hasCp = report.staticFindings.some((f) => f.code === 'MODULE_CHILD_PROCESS');
      assert.ok(hasCp);
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('process.env.GITHUB_TOKEN flagged', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'env-pkg', version: '1.0.0', main: 'index.js' }),
      'index.js': "module.exports = () => process.env.GITHUB_TOKEN;\n",
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'env-pkg',
        expectedVersion: '1.0.0',
      });
      const secret = report.staticFindings.find((f) => f.code === 'SECRET_ENV_ACCESS');
      assert.ok(secret, 'expected SECRET_ENV_ACCESS finding');
      assert.match(secret!.message, /GITHUB_TOKEN/);
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('eval flagged', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'eval-pkg', version: '1.0.0', main: 'index.js' }),
      'index.js': "module.exports = (s) => eval(s);\n",
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'eval-pkg',
        expectedVersion: '1.0.0',
      });
      const evalFinding = report.staticFindings.find((f) => f.code === 'EVAL_USED');
      assert.ok(evalFinding);
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('native addon detected', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'native-pkg', version: '1.0.0' }),
      'index.js': '1',
      'addon.node': Buffer.from([0, 1, 2, 3]),
      'binding.gyp': '{ "targets": [] }',
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'native-pkg',
        expectedVersion: '1.0.0',
      });
      assert.equal(report.nativeArtifacts.bindingGyp, true);
      assert.ok(report.nativeArtifacts.nodeAddons.includes('addon.node'));
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('minified file detected', async () => {
    const longLine = 'var a=1;var b=2;var c=3;var d=4;var e=5;var f=6;var g=7;var h=8;var i=9;var j=10;var k=11;var l=12;var m=13;var n=14;var o=15;var p=16;var q=17;var r=18;var s=19;var t=20;';
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'min-pkg', version: '1.0.0', main: 'min.js' }),
      'min.js': longLine.repeat(20),
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'min-pkg',
        expectedVersion: '1.0.0',
      });
      assert.equal(report.readability.likelyMinified, true);
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('analyzer never executes fixture code (no side-effect file)', async () => {
    // The fixture writes a marker file if executed; analyzer must not run it.
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({
        name: 'noexec-pkg',
        version: '1.0.0',
        scripts: { postinstall: 'node marker.js' },
        main: 'index.js',
      }),
      'index.js': "require('fs').writeFileSync('/tmp/safe-npm-analyzer-ran-marker','1');\n",
      'marker.js': "require('fs').writeFileSync('/tmp/safe-npm-analyzer-ran-marker','1');\n",
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'unpack-'));
      // remove marker if exists
      try {
        await rm('/tmp/safe-npm-analyzer-ran-marker', { force: true });
      } catch {
        /* ignore */
      }
      await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'noexec-pkg',
        expectedVersion: '1.0.0',
      });
      let markerExists = false;
      try {
        await stat('/tmp/safe-npm-analyzer-ran-marker');
        markerExists = true;
      } catch {
        markerExists = false;
      }
      assert.equal(markerExists, false, 'analyzer must not execute fixture code');
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });
});

describe('resolveBin', () => {
  test('single bin entry', () => {
    assert.equal(resolveBin({ 'my-cli': 'cli.js' }, 'my-cli'), 'my-cli');
  });

  test('bin matching unscoped name', () => {
    assert.equal(
      resolveBin({ other: 'o.js', 'my-cli': 'cli.js' }, 'my-cli'),
      'my-cli',
    );
  });

  test('multiple aliases to same target pick first', () => {
    assert.equal(resolveBin({ a: 'cli.js', b: 'cli.js' }, 'pkg'), 'a');
  });

  test('ambiguous bins throw', () => {
    assert.throws(() => resolveBin({ a: 'x.js', b: 'y.js' }, 'pkg'), /ambiguous/);
  });

  test('no bin throws', () => {
    assert.throws(() => resolveBin({}, 'pkg'), /no bin/);
  });

  test('scoped name resolves unscoped bin', () => {
    assert.equal(resolveBin({ 'scoped-cli': 'cli.js' }, '@scope/scoped-cli'), 'scoped-cli');
  });
});
