import { describe, expect, it } from 'vitest';
import { analyzeMetadata } from '../src/index.js';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'metadata-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const pkgJson = {
  name: 'fixture-pkg',
  version: '1.0.0',
  description: 'a fixture',
  license: 'MIT',
  author: 'alice',
  main: 'index.js',
  bin: { 'fixture-pkg': 'bin/cli.js' },
  scripts: { postinstall: 'node install.js', test: 'echo test' },
  dependencies: { lodash: '^4.0.0' },
  repository: { type: 'git', url: 'https://github.com/x/fixture-pkg' },
};

describe('analyzeMetadata', () => {
  it('extracts package.json fields', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'package.json'), JSON.stringify(pkgJson));
      await writeFile(join(root, 'index.js'), 'module.exports=1');
      await mkdir(join(root, 'bin'), { recursive: true });
      await writeFile(join(root, 'bin/cli.js'), '#!/usr/bin/env node\n');
      const res = await analyzeMetadata(root, 'fixture-pkg', '1.0.0');
      expect(res.metadata.name).toBe('fixture-pkg');
      expect(res.metadata.version).toBe('1.0.0');
      expect(res.metadata.license).toBe('MIT');
      expect(res.metadata.scripts.postinstall).toBe('node install.js');
      expect(res.metadata.dependencies.lodash).toBe('^4.0.0');
      expect(res.fileCount).toBe(3);
      expect(res.unpackedSizeBytes).toBeGreaterThan(0);
    });
  });

  it('detects .node native addons and binding.gyp', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'native-pkg', version: '1.0.0' }));
      await mkdir(join(root, 'build'), { recursive: true });
      await writeFile(join(root, 'build/addon.node'), '');
      await writeFile(join(root, 'binding.gyp'), '{}');
      const res = await analyzeMetadata(root, 'native-pkg', '1.0.0');
      const types = res.nativeArtifacts.map((a) => a.type);
      expect(types).toContain('node_addon');
      expect(types).toContain('binding_gyp');
    });
  });

  it('throws on missing package.json', async () => {
    await withRoot(async (root) => {
      await expect(analyzeMetadata(root)).rejects.toThrow();
    });
  });

  it('throws on name mismatch', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'other', version: '1.0.0' }));
      await expect(analyzeMetadata(root, 'fixture-pkg', '1.0.0')).rejects.toThrow();
    });
  });
});
