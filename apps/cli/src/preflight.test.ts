import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { create as tarCreate } from 'tar';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreflight } from '../src/index.js';
import { QuarantineCache } from '@safe-npm/analyzer';

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'cli-preflight-'));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

async function buildFixtureTarball(): Promise<{ tarballBuffer: Buffer; integrity: string }> {
  const staging = join(work, 'staging');
  await mkdir(join(staging, 'package'), { recursive: true });
  await writeFile(
    join(staging, 'package', 'package.json'),
    JSON.stringify({
      name: 'fixture-cli-pkg',
      version: '1.0.0',
      license: 'MIT',
      main: 'index.js',
      bin: { 'fixture-cli-pkg': 'bin/cli.js' },
      scripts: { postinstall: 'echo hello' },
      repository: { type: 'git', url: 'https://github.com/x/fixture-cli-pkg' },
    }),
  );
  await writeFile(join(staging, 'package', 'index.js'), 'module.exports = 1;\n');
  await mkdir(join(staging, 'package', 'bin'), { recursive: true });
  await writeFile(join(staging, 'package', 'bin', 'cli.js'), '#!/usr/bin/env node\nconsole.log(1);\n');

  const tarPath = join(work, 'fixture.tgz');
  await tarCreate({ file: tarPath, cwd: staging, gzip: true, portable: true }, ['package']);
  const buf = await readFile(tarPath);
  const integrity = `sha512-${createHash('sha512').update(buf).digest('base64')}`;
  return { tarballBuffer: buf, integrity };
}

function mockFetch(tarballBuffer: Buffer, integrity: string): typeof fetch {
  const packument = {
    name: 'fixture-cli-pkg',
    'dist-tags': { latest: '1.0.0' },
    versions: {
      '1.0.0': {
        name: 'fixture-cli-pkg',
        version: '1.0.0',
        dist: { tarball: 'https://registry.example.com/fixture-cli-pkg/-/fixture-cli-pkg-1.0.0.tgz', integrity },
        bin: { 'fixture-cli-pkg': 'bin/cli.js' },
      },
    },
  };

  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.endsWith('.tgz')) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(tarballBuffer));
          controller.close();
        },
      });
      return {
        ok: true,
        status: 200,
        body: stream,
        headers: { get: () => null },
      } as unknown as Response;
    }
    // Packument request.
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === 'etag' ? 'W/"test"' : null) },
      json: async () => packument,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('runPreflight', () => {
  it('resolves, downloads, analyzes, and scores a fixture package', async () => {
    const { tarballBuffer, integrity } = await buildFixtureTarball();
    const cache = new QuarantineCache(join(work, 'cache'));
    const result = await runPreflight('fixture-cli-pkg@latest', {
      registryUrl: 'https://registry.example.com',
      cache,
      fetchImpl: mockFetch(tarballBuffer, integrity),
    });

    expect(result.spec.name).toBe('fixture-cli-pkg');
    expect(result.resolvedVersion).toBe('1.0.0');
    expect(result.binCommand).toBe('fixture-cli-pkg');
    expect(result.analysisReport.package).toBe('fixture-cli-pkg');
    expect(result.riskReport.package).toBe('fixture-cli-pkg');
    expect(result.riskReport.score).toBeLessThan(100); // has postinstall script
    expect(result.riskReport.warnings.some((w) => w.code === 'INSTALL_SCRIPT_PRESENT')).toBe(true);
  });

  it('evaluates policy when agent flag is set', async () => {
    const { tarballBuffer, integrity } = await buildFixtureTarball();
    const cache = new QuarantineCache(join(work, 'cache'));
    const result = await runPreflight('fixture-cli-pkg@latest', {
      registryUrl: 'https://registry.example.com',
      cache,
      fetchImpl: mockFetch(tarballBuffer, integrity),
      agent: true,
    });

    expect(result.policyDecision).not.toBeNull();
    // Agent policy disallows install scripts, so it should block.
    expect(result.policyDecision!.decision).toBe('block');
  });

  it('throws on package not found', async () => {
    const notFoundFetch = (async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => null,
    }) as unknown as typeof fetch);

    await expect(
      runPreflight('nonexistent-pkg', {
        registryUrl: 'https://registry.example.com',
        fetchImpl: notFoundFetch,
      }),
    ).rejects.toThrow();
  });
});
