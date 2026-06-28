import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import { computeDiff } from './diff.js';

describe('computeDiff', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'safe-npm-diff-test-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function makeTarball(pkgDir: string, files: Record<string, string>): Promise<Buffer> {
    const tarballPath = join(pkgDir, 'pkg.tgz');
    for (const [path, content] of Object.entries(files)) {
      await writeFile(join(pkgDir, path), content);
    }
    await tar.create({ cwd: pkgDir, file: tarballPath, gzip: true }, Object.keys(files));
    const { readFile } = await import('node:fs/promises');
    return readFile(tarballPath);
  }

  it('detects added files', async () => {
    const oldDir = await mkdtemp(join(tmpDir, 'old-'));
    const newDir = await mkdtemp(join(tmpDir, 'new-'));
    try {
      const oldTarball = await makeTarball(oldDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.0.0' }),
        'index.js': 'console.log("hello");',
      });
      const newTarball = await makeTarball(newDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.1.0' }),
        'index.js': 'console.log("hello");',
        'new.js': 'console.log("new");',
      });

      const diff = await computeDiff(oldTarball, newTarball);
      expect(diff.addedFiles).toContain('new.js');
      expect(diff.removedFiles).toEqual([]);
      // package.json is modified because the version changed.
      expect(diff.modifiedFiles).toContain('package.json');
    } finally {
      await rm(oldDir, { recursive: true, force: true }).catch(() => {});
      await rm(newDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15000);

  it('detects removed files', async () => {
    const oldDir = await mkdtemp(join(tmpDir, 'old-'));
    const newDir = await mkdtemp(join(tmpDir, 'new-'));
    try {
      const oldTarball = await makeTarball(oldDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.0.0' }),
        'index.js': 'console.log("hello");',
        'old.js': 'console.log("old");',
      });
      const newTarball = await makeTarball(newDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.1.0' }),
        'index.js': 'console.log("hello");',
      });

      const diff = await computeDiff(oldTarball, newTarball);
      expect(diff.removedFiles).toContain('old.js');
      expect(diff.addedFiles).toEqual([]);
    } finally {
      await rm(oldDir, { recursive: true, force: true }).catch(() => {});
      await rm(newDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15000);

  it('detects modified files', async () => {
    const oldDir = await mkdtemp(join(tmpDir, 'old-'));
    const newDir = await mkdtemp(join(tmpDir, 'new-'));
    try {
      const oldTarball = await makeTarball(oldDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.0.0' }),
        'index.js': 'console.log("hello");',
      });
      const newTarball = await makeTarball(newDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.1.0' }),
        'index.js': 'console.log("hello world");',
      });

      const diff = await computeDiff(oldTarball, newTarball);
      expect(diff.modifiedFiles).toContain('index.js');
    } finally {
      await rm(oldDir, { recursive: true, force: true }).catch(() => {});
      await rm(newDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15000);

  it('detects new lifecycle scripts', async () => {
    const oldDir = await mkdtemp(join(tmpDir, 'old-'));
    const newDir = await mkdtemp(join(tmpDir, 'new-'));
    try {
      const oldTarball = await makeTarball(oldDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.0.0', scripts: {} }),
      });
      const newTarball = await makeTarball(newDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.1.0', scripts: { postinstall: 'echo hi' } }),
      });

      const diff = await computeDiff(oldTarball, newTarball);
      expect(diff.newLifecycleScripts).toContain('postinstall');
    } finally {
      await rm(oldDir, { recursive: true, force: true }).catch(() => {});
      await rm(newDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15000);

  it('detects repository URL change', async () => {
    const oldDir = await mkdtemp(join(tmpDir, 'old-'));
    const newDir = await mkdtemp(join(tmpDir, 'new-'));
    try {
      const oldTarball = await makeTarball(oldDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.0.0', repository: 'https://github.com/old/repo' }),
      });
      const newTarball = await makeTarball(newDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.1.0', repository: 'https://github.com/new/repo' }),
      });

      const diff = await computeDiff(oldTarball, newTarball);
      expect(diff.repositoryUrlChanged).toBe(true);
      expect(diff.oldRepositoryUrl).toBe('https://github.com/old/repo');
      expect(diff.newRepositoryUrl).toBe('https://github.com/new/repo');
    } finally {
      await rm(oldDir, { recursive: true, force: true }).catch(() => {});
      await rm(newDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15000);

  it('detects dependency changes', async () => {
    const oldDir = await mkdtemp(join(tmpDir, 'old-'));
    const newDir = await mkdtemp(join(tmpDir, 'new-'));
    try {
      const oldTarball = await makeTarball(oldDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { 'left-pad': '1.0.0' } }),
      });
      const newTarball = await makeTarball(newDir, {
        'package.json': JSON.stringify({ name: 'test', version: '1.1.0', dependencies: { 'left-pad': '2.0.0', 'right-pad': '1.0.0' } }),
      });

      const diff = await computeDiff(oldTarball, newTarball);
      expect(diff.addedDependencies).toContain('right-pad');
      expect(diff.changedDependencies).toContain('left-pad');
    } finally {
      await rm(oldDir, { recursive: true, force: true }).catch(() => {});
      await rm(newDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 15000);
});
