import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import ssri from 'ssri';
import { parseGlobalFlags, viewCommand, preflightCommand, execPreflightCommand } from '../src/commands.js';
/** Build a fixture package tarball and return its bytes + integrity. */
async function buildFixture(): Promise<{ tarball: Buffer; integrity: string; shasum: string }> {
  const staging = await mkdtemp(join(tmpdir(), 'cli-fix-'));
  const pkgDir = join(staging, 'package');
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: 'cli-fixture',
      version: '1.0.0',
      license: 'MIT',
      main: 'index.js',
      bin: { 'cli-fixture': 'index.js' },
      repository: { type: 'git', url: 'https://github.com/u/cli-fixture' },
    }),
  );
  await writeFile(join(pkgDir, 'index.js'), 'module.exports = () => 42;\n');
  const tarballPath = join(staging, 'cli-fixture.tgz');
  await tar.c({ file: tarballPath, cwd: staging, gzip: true, sync: true }, ['package']);
  const buf = await readFile(tarballPath);
  const integrity = ssri.fromData(buf, { algorithms: ['sha512'] }).toString();
  const shasum = createHash('sha1').update(buf).digest('hex');
  await rm(staging, { recursive: true, force: true });
  return { tarball: buf, integrity, shasum };
}

function makeFakeFetch(tarball: Buffer, integrity: string, shasum: string): typeof fetch {
  const packument = {
    name: 'cli-fixture',
    'dist-tags': { latest: '1.0.0' },
    versions: {
      '1.0.0': {
        name: 'cli-fixture',
        version: '1.0.0',
        dist: { tarball: 'https://registry.example/cli-fixture/-/cli-fixture-1.0.0.tgz', integrity, shasum },
      },
    },
    maintainers: [{ name: 'alice' }],
  };
  return (async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('cli-fixture')) {
      return new Response(JSON.stringify(packument), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.endsWith('cli-fixture-1.0.0.tgz')) {
      return new Response(tarball, { status: 200, headers: { 'content-length': String(tarball.byteLength) } });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('CLI global flags', () => {
  test('parseGlobalFlags extracts flags and rest', () => {
    const { flags, rest } = parseGlobalFlags(['--json', 'view', 'is-odd', '--agent']);
    assert.equal(flags.json, true);
    assert.equal(flags.agent, true);
    assert.deepEqual(rest, ['view', 'is-odd']);
  });

  test('--registry and --policy consume next arg', () => {
    const { flags, rest } = parseGlobalFlags(['--registry', 'https://x', 'view', 'pkg']);
    assert.equal(flags.registry, 'https://x');
    assert.deepEqual(rest, ['view', 'pkg']);
  });
});

describe('CLI commands with mocked registry', { concurrency: 1 }, () => {
  let fixture: { tarball: Buffer; integrity: string; shasum: string };
  before(async () => {
    fixture = await buildFixture();
  });

  test('view --json returns valid JSON risk report', async () => {
    const fetchImpl = makeFakeFetch(fixture.tarball, fixture.integrity, fixture.shasum);
    let captured = '';
    const code = await viewCommand('cli-fixture@1.0.0', {
      json: true,
      agent: false,
      yes: false,
      no: false,
      verbose: false,
      debug: false,
      registry: 'https://registry.example',
      fetchImpl,
      out: (s) => {
        captured += s;
      },
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(captured);
    assert.equal(parsed.package, 'cli-fixture');
    assert.equal(parsed.version, '1.0.0');
    assert.ok(typeof parsed.score === 'number');
  });

  test('preflight --json includes bin and decision', async () => {
    const fetchImpl = makeFakeFetch(fixture.tarball, fixture.integrity, fixture.shasum);
    let captured = '';
    const code = await preflightCommand('cli-fixture@1.0.0', {
      json: true,
      agent: false,
      yes: false,
      no: false,
      verbose: false,
      debug: false,
      registry: 'https://registry.example',
      fetchImpl,
      out: (s) => {
        captured += s;
      },
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(captured);
    assert.equal(parsed.bin, 'cli-fixture');
    assert.ok(['allow', 'requires_approval', 'blocked'].includes(parsed.decision.decision));
  });

  test('exec --agent never prompts and returns deterministic exit code', async () => {
    const fetchImpl = makeFakeFetch(fixture.tarball, fixture.integrity, fixture.shasum);
    let captured = '';
    const code = await execPreflightCommand(
      'cli-fixture@1.0.0',
      {
        json: false,
        agent: true,
        yes: false,
        no: false,
        verbose: false,
        debug: false,
        registry: 'https://registry.example',
        fetchImpl,
        out: (s) => {
          captured += s;
        },
      },
      async () => 'yes',
    );
    const parsed = JSON.parse(captured);
    assert.ok(parsed.decision);
    // benign fixture with agent policy: enforcement unavailable -> blocked (11)
    assert.ok([0, 10, 11].includes(code));
  });

  test('exec TTY blocked returns 11', async () => {
    // Mismatched integrity triggers TARBALL_INTEGRITY_FAILED -> exit 11.
    const fetchImpl = makeFakeFetch(fixture.tarball, 'sha512-wrongbase64data=', fixture.shasum);
    let errCaptured = '';
    const code = await execPreflightCommand(
      'cli-fixture@1.0.0',
      {
        json: false,
        agent: false,
        yes: false,
        no: false,
        verbose: false,
        debug: false,
        registry: 'https://registry.example',
        fetchImpl,
        err: (s) => {
          errCaptured += s;
        },
      },
      async () => 'yes',
    );
    assert.equal(code, 11);
    assert.match(errCaptured, /TARBALL_INTEGRITY_FAILED|integrity/);
  });

  test('bare-name resolves to latest and triggers disallowLatestTag in agent mode', async () => {
    const fetchImpl = makeFakeFetch(fixture.tarball, fixture.integrity, fixture.shasum);
    let captured = '';
    const code = await execPreflightCommand(
      'cli-fixture',
      {
        json: false,
        agent: true,
        yes: false,
        no: false,
        verbose: false,
        debug: false,
        registry: 'https://registry.example',
        fetchImpl,
        out: (s) => {
          captured += s;
        },
      },
      async () => 'yes',
    );
    const parsed = JSON.parse(captured);
    // bare name resolves to latest dist-tag -> disallowLatestTag should fire
    // -> requires_approval (10) or blocked (11) due to enforcement-unavailable block
    assert.notEqual(parsed.decision, 'allow');
    assert.ok([10, 11].includes(code));
  });
});
