import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packAndAnalyze, cleanupPack, PackError } from './pack.js';

/**
 * Tests for the pack module (Section 8.1).
 * These tests create a real temp package directory and run `npm pack`.
 */
describe('pack', () => {
  let tmpPkgDir: string;

  beforeEach(async () => {
    tmpPkgDir = await mkdtemp(join(tmpdir(), 'safe-npm-pack-test-'));
    await writeFile(
      join(tmpPkgDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0', main: 'index.js' }),
    );
    await writeFile(join(tmpPkgDir, 'index.js'), 'module.exports = "hello";\n');
  });

  afterEach(async () => {
    await rm(tmpPkgDir, { recursive: true, force: true }).catch(() => {});
  });

  it('packs a package and computes integrity', async () => {
    const result = await packAndAnalyze({ cwd: tmpPkgDir });
    try {
      expect(result.packageJson.name).toBe('test-pkg');
      expect(result.packageJson.version).toBe('1.0.0');
      expect(result.sha512).toMatch(/^sha512-/);
      expect(result.shasum).toMatch(/^[0-9a-f]{40}$/);
      expect(result.size).toBeGreaterThan(0);
      expect(result.filename).toBe('test-pkg-1.0.0.tgz');
      expect(result.tarballBuffer.length).toBe(result.size);
      expect(result.analysisReport).toBeTruthy();
      expect(result.analysisReport.package).toBe('test-pkg');
    } finally {
      await cleanupPack(result);
    }
  }, 30000);

  it('throws PackError for missing package.json', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'safe-npm-empty-'));
    try {
      await expect(packAndAnalyze({ cwd: emptyDir })).rejects.toThrow();
    } finally {
      await rm(emptyDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('throws PackError for package.json without name', async () => {
    await writeFile(join(tmpPkgDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    await expect(packAndAnalyze({ cwd: tmpPkgDir })).rejects.toThrow();
  });
});

describe('PackError', () => {
  it('has a code property', () => {
    const err = new PackError('test', 'TEST_CODE');
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.name).toBe('PackError');
  });
});
