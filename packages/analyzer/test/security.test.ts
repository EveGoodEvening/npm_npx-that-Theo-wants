import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import { buildFixtureTarball } from './fixtures.js';
import { analyzeTarball, resolveBin } from '../src/index.js';
import { safeExtract } from '../src/extract.js';
import { downloadTarball } from '@safe-npm/npm-compat';
import type { ExactVersion } from '@safe-npm/core-types';

describe('security fixtures (section 26)', () => {
  test('https.request usage flagged', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({ name: 'https-pkg', version: '1.0.0', main: 'index.js' }),
      'index.js': "const https = require('https');\nhttps.request('https://x');\n",
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'sec-https-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'https-pkg',
        expectedVersion: '1.0.0' as ExactVersion,
      });
      assert.ok(report.inferredPermissions.net.length > 0, 'net permission should be inferred');
      assert.ok(report.staticFindings.some((f) => f.code === 'MODULE_HTTPS'));
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('ambiguous bins throw on resolution', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({
        name: 'ambig-pkg',
        version: '1.0.0',
        bin: { 'tool-a': 'a.js', 'tool-b': 'b.js' },
      }),
      'a.js': '1;',
      'b.js': '1;',
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'sec-ambig-'));
      const { report } = await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'ambig-pkg',
        expectedVersion: '1.0.0' as ExactVersion,
      });
      assert.throws(() => resolveBin(report.package.bin, 'ambig-pkg'), /ambiguous/);
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });

  test('safe extract allows non-traversal sibling files', async () => {
    // A tar with a sibling file (not ../) should extract without rejection;
    // actual traversal/symlink rejection is covered in analyzer.test.ts.
    const staging = await mkdtemp(join(tmpdir(), 'sec-sib-'));
    await mkdir(join(staging, 'package'));
    await writeFile(join(staging, 'package', 'package.json'), JSON.stringify({ name: 'sib', version: '1.0.0' }));
    await writeFile(join(staging, 'package', 'index.js'), '1;');
    await writeFile(join(staging, 'README.md'), 'readme');
    const tarballPath = join(staging, 'sib.tgz');
    await tar.c({ file: tarballPath, cwd: staging, gzip: true, sync: true, portable: true }, ['package', 'README.md']);
    const dest = await mkdtemp(join(tmpdir(), 'sec-sib-out-'));
    await safeExtract(tarballPath, dest); // should not reject
    await rm(staging, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });

  test('integrity mismatch fixture blocked by downloadTarball', async () => {
    const data = Buffer.from('payload');
    const dest = join(await mkdtemp(join(tmpdir(), 'sec-integrity-')), 'pkg.tgz');
    const wrong = 'sha512-wrongbase64data=';
    await assert.rejects(
      downloadTarball('https://x/pkg.tgz', dest, {
        expectedIntegrity: wrong,
        fetchImpl: (async () => new Response(data, { status: 200 })) as unknown as typeof fetch,
      }),
      /integrity mismatch/,
    );
  });

  test('analyzer does not execute fixture code (no side-effect)', async () => {
    const fix = await buildFixtureTarball({
      'package.json': JSON.stringify({
        name: 'noexec-sec',
        version: '1.0.0',
        scripts: { postinstall: 'node marker.js' },
        main: 'index.js',
      }),
      'index.js': "require('fs').writeFileSync('/tmp/safe-npm-sec-marker','1');",
      'marker.js': "require('fs').writeFileSync('/tmp/safe-npm-sec-marker','1');",
    });
    try {
      const unpack = await mkdtemp(join(tmpdir(), 'sec-noexec-'));
      try {
        await rm('/tmp/safe-npm-sec-marker', { force: true });
      } catch {
        /* ignore */
      }
      await analyzeTarball({
        tarballPath: fix.tarballPath,
        unpackDir: unpack,
        expectedName: 'noexec-sec',
        expectedVersion: '1.0.0' as ExactVersion,
      });
      let exists = false;
      try {
        await stat('/tmp/safe-npm-sec-marker');
        exists = true;
      } catch {
        exists = false;
      }
      assert.equal(exists, false, 'analyzer must not execute fixture code');
      await rm(unpack, { recursive: true, force: true });
    } finally {
      await fix.cleanup();
    }
  });
});
