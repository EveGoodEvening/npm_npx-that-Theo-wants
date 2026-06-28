import { describe, expect, it } from 'vitest';
import { computeDiffRisk } from './diff-risk.js';
import type { DiffResult } from './diff.js';

function makeDiff(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    addedFiles: [],
    removedFiles: [],
    modifiedFiles: [],
    totalChangedBytes: 0,
    newBinEntries: [],
    removedBinEntries: [],
    newLifecycleScripts: [],
    removedLifecycleScripts: [],
    addedDependencies: [],
    removedDependencies: [],
    changedDependencies: [],
    repositoryUrlChanged: false,
    maintainerChanged: false,
    ...overrides,
  };
}

describe('computeDiffRisk', () => {
  it('returns no deductions for a clean diff', () => {
    const result = computeDiffRisk(makeDiff());
    expect(result.deductions).toEqual([]);
    expect(result.totalDeduction).toBe(0);
  });

  it('deducts for new install script', () => {
    const result = computeDiffRisk(makeDiff({ newLifecycleScripts: ['postinstall'] }));
    expect(result.deductions.length).toBe(1);
    expect(result.deductions[0].category).toBe('new_install_script');
    expect(result.deductions[0].points).toBe(15);
    expect(result.diffRisk.newInstallScript).toBe(true);
  });

  it('deducts for new bin entry', () => {
    const result = computeDiffRisk(makeDiff({ newBinEntries: ['my-cli'] }));
    expect(result.deductions.length).toBe(1);
    expect(result.deductions[0].category).toBe('new_bin_entry');
    expect(result.deductions[0].points).toBe(10);
    expect(result.diffRisk.newChildProcessUsage).toBe(true);
  });

  it('deducts for new native binary', () => {
    const result = computeDiffRisk(makeDiff({ addedFiles: ['native.node'] }));
    expect(result.deductions.length).toBe(1);
    expect(result.deductions[0].category).toBe('new_native_binary');
    expect(result.deductions[0].points).toBe(15);
    expect(result.diffRisk.newNativeBinary).toBe(true);
  });

  it('deducts for source repo change', () => {
    const result = computeDiffRisk(makeDiff({
      repositoryUrlChanged: true,
      oldRepositoryUrl: 'https://github.com/old/repo',
      newRepositoryUrl: 'https://github.com/new/repo',
    }));
    expect(result.deductions.length).toBe(1);
    expect(result.deductions[0].category).toBe('source_repo_changed');
    expect(result.deductions[0].points).toBe(20);
    expect(result.diffRisk.sourceRepoChanged).toBe(true);
  });

  it('deducts for maintainer change', () => {
    const result = computeDiffRisk(makeDiff({ maintainerChanged: true }));
    expect(result.deductions.length).toBe(1);
    expect(result.deductions[0].category).toBe('maintainer_changed');
    expect(result.deductions[0].points).toBe(10);
    expect(result.diffRisk.maintainerChanged).toBe(true);
  });

  it('accumulates multiple deductions', () => {
    const result = computeDiffRisk(makeDiff({
      newLifecycleScripts: ['postinstall'],
      newBinEntries: ['cli'],
      maintainerChanged: true,
    }));
    expect(result.deductions.length).toBe(3);
    expect(result.totalDeduction).toBe(35);
  });
});
