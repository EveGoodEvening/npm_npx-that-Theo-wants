/**
 * Diff risk integration (design 11.3).
 *
 * Computes risk deductions based on the diff between a package version
 * and its previous version.
 */
import type { DiffResult } from './diff.js';

export interface DiffRiskDeduction {
  reason: string;
  points: number;
  category: string;
}

export interface DiffRiskResult {
  deductions: DiffRiskDeduction[];
  totalDeduction: number;
  diffRisk: {
    newInstallScript: boolean;
    newChildProcessUsage: boolean;
    newNetworkUsage: boolean;
    newNativeBinary: boolean;
    sourceRepoChanged: boolean;
    maintainerChanged: boolean;
  };
}

/**
 * Compute risk deductions from a diff result.
 *
 * Deductions (design 11.3):
 * - new install script: -15
 * - new child process usage: -10
 * - new network usage: -10
 * - new native binary: -15
 * - source repo changed: -20
 * - maintainer/publisher changed: -10
 */
export function computeDiffRisk(diff: DiffResult): DiffRiskResult {
  const deductions: DiffRiskDeduction[] = [];

  // New install script.
  const newInstallScript = diff.newLifecycleScripts.length > 0;
  if (newInstallScript) {
    deductions.push({
      reason: `new lifecycle script(s): ${diff.newLifecycleScripts.join(', ')}`,
      points: 15,
      category: 'new_install_script',
    });
  }

  // New bin entries (proxy for child process usage).
  const newChildProcessUsage = diff.newBinEntries.length > 0;
  if (newChildProcessUsage) {
    deductions.push({
      reason: `new bin entry/entries: ${diff.newBinEntries.join(', ')}`,
      points: 10,
      category: 'new_bin_entry',
    });
  }

  // New native binary (heuristic: .node files added).
  const newNativeBinary = diff.addedFiles.some((f) => f.endsWith('.node') || f.endsWith('.so') || f.endsWith('.dylib'));
  if (newNativeBinary) {
    deductions.push({
      reason: 'new native binary file(s) detected',
      points: 15,
      category: 'new_native_binary',
    });
  }

  // Source repo changed.
  const sourceRepoChanged = diff.repositoryUrlChanged;
  if (sourceRepoChanged) {
    deductions.push({
      reason: `repository URL changed from ${diff.oldRepositoryUrl} to ${diff.newRepositoryUrl}`,
      points: 20,
      category: 'source_repo_changed',
    });
  }

  // Maintainer/publisher changed.
  const maintainerChanged = diff.maintainerChanged;
  if (maintainerChanged) {
    deductions.push({
      reason: 'maintainer/contributor list changed',
      points: 10,
      category: 'maintainer_changed',
    });
  }

  const totalDeduction = deductions.reduce((sum, d) => sum + d.points, 0);

  return {
    deductions,
    totalDeduction,
    diffRisk: {
      newInstallScript,
      newChildProcessUsage,
      newNetworkUsage: false, // TODO: detect network usage from static analysis
      newNativeBinary,
      sourceRepoChanged,
      maintainerChanged,
    },
  };
}
