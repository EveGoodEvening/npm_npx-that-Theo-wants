import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishCommand } from '../src/commands.js';

function baseFlags(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    agent: false,
    yes: false,
    no: false,
    verbose: false,
    debug: false,
    ...overrides,
  } as Parameters<typeof publishCommand>[1];
}

describe('publishCommand', { concurrency: 1 }, () => {
  test('private default packs + analyzes + shows summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'publish-fixture',
        version: '1.0.0',
        license: 'MIT',
        main: 'index.js',
        bin: { 'publish-fixture': 'index.js' },
        repository: { type: 'git', url: 'https://github.com/u/publish-fixture' },
      }),
    );
    await writeFile(join(dir, 'index.js'), 'module.exports = () => 1;\n');
    const origCwd = process.cwd();
    process.chdir(dir);
    try {
      let out = '';
      let err = '';
      const code = await publishCommand([], {
        ...baseFlags(),
        out: (s) => {
          out += s;
        },
        err: (s) => {
          err += s;
        },
      });
      assert.equal(code, 0, `err: ${err}`);
      assert.match(out, /Publish summary: publish-fixture@1.0.0 \(private\)/);
      assert.match(out, /Score:/);
    } finally {
      process.chdir(origCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('public requires --yes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-pub-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'pub-fixture', version: '1.0.0', main: 'index.js' }),
    );
    await writeFile(join(dir, 'index.js'), '1;\n');
    const origCwd = process.cwd();
    process.chdir(dir);
    try {
      let err = '';
      const code = await publishCommand(['--public'], {
        ...baseFlags(),
        err: (s) => {
          err += s;
        },
      });
      assert.equal(code, 1);
      assert.match(err, /explicit intent/);
    } finally {
      process.chdir(origCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('public with --yes proceeds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-pub-yes-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'pub-yes-fixture', version: '1.0.0', main: 'index.js', license: 'MIT' }),
    );
    await writeFile(join(dir, 'index.js'), '1;\n');
    const origCwd = process.cwd();
    process.chdir(dir);
    try {
      let out = '';
      const code = await publishCommand(['--public', '--yes'], {
        ...baseFlags(),
        out: (s) => {
          out += s;
        },
      });
      assert.equal(code, 0);
      assert.match(out, /\(public\)/);
    } finally {
      process.chdir(origCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('public with --json proceeds (non-interactive intent)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-pub-json-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'pub-json-fixture', version: '1.0.0', main: 'index.js', license: 'MIT' }),
    );
    await writeFile(join(dir, 'index.js'), '1;\n');
    const origCwd = process.cwd();
    process.chdir(dir);
    try {
      let out = '';
      const code = await publishCommand(['--public'], {
        ...baseFlags({ json: true }),
        out: (s) => {
          out += s;
        },
      });
      assert.equal(code, 0);
      const parsed = JSON.parse(out);
      assert.equal(parsed.summary.visibility, 'public');
    } finally {
      process.chdir(origCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('preview file count is numeric not string length', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-preview-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'preview-fixture', version: '1.0.0', main: 'index.js', license: 'MIT' }),
    );
    await writeFile(join(dir, 'index.js'), '1;\n');
    await writeFile(join(dir, 'extra.js'), '2;\n');
    const origCwd = process.cwd();
    process.chdir(dir);
    try {
      let out = '';
      const code = await publishCommand([], {
        ...baseFlags({ verbose: true }),
        out: (s) => {
          out += s;
        },
      });
      assert.equal(code, 0);
      // preview should report a file count >= 2, not the string length "2"->1
      const previewMatch = out.match(/Pack preview: (\d+) file/);
      assert.ok(previewMatch, `expected preview in: ${out}`);
      assert.ok(Number(previewMatch![1]) >= 2, `preview count ${previewMatch![1]} should be >= 2`);
    } finally {
      process.chdir(origCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
  test('json output includes summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-json-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'json-fixture', version: '2.0.0', main: 'index.js', license: 'MIT' }),
    );
    await writeFile(join(dir, 'index.js'), '1;\n');
    const origCwd = process.cwd();
    process.chdir(dir);
    try {
      let out = '';
      const code = await publishCommand([], {
        ...baseFlags({ json: true }),
        out: (s) => {
          out += s;
        },
      });
      assert.equal(code, 0);
      const parsed = JSON.parse(out);
      assert.equal(parsed.summary.name, 'json-fixture');
      assert.equal(parsed.summary.visibility, 'private');
      assert.ok(parsed.summary.integrity.startsWith('sha512-'));
    } finally {
      process.chdir(origCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
