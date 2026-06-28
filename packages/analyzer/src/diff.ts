import semver from 'semver';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AnalysisReport,
  RiskFinding,
  ExactVersion,
  PackageName,
  VersionStatus,
} from '@safe-npm/core-types';
import type { PackageJsonShape } from './metadata.js';
import { listFiles, readPackageJson, packageRoot } from './metadata.js';

/**
 * Select the previous visible version to diff against.
 * Prefers the highest semver version lower than current that is not
 * retracted/quarantined/deleted. Falls back to the current `latest` before
 * publish if none lower exists.
 */
export function selectPreviousVersion(
  currentVersion: ExactVersion,
  candidates: Array<{ version: string; status: VersionStatus }>,
  latestTag?: string,
): string | undefined {
  const visible = candidates.filter(
    (c) => c.status !== 'retracted' && c.status !== 'quarantined' && c.status !== 'deleted',
  );
  const lower = visible
    .filter((c) => semver.valid(c.version) && semver.lt(c.version, currentVersion))
    .sort((a, b) => semver.rcompare(a.version, b.version));
  if (lower.length > 0) return lower[0]!.version;
  // fallback to latest tag if it's not the current version
  if (latestTag && latestTag !== currentVersion) {
    const tagCandidate = visible.find((c) => c.version === latestTag);
    if (tagCandidate) return tagCandidate.version;
  }
  return undefined;
}

export interface FileDiff {
  added: string[];
  removed: string[];
  modified: string[];
  changedBytes: number;
}

/** Compute file added/removed/modified between two unpacked package roots. */
export async function computeFileDiff(prevRoot: string, currRoot: string): Promise<FileDiff> {
  const prevFiles = new Set(await listFiles(prevRoot));
  const currFiles = new Set(await listFiles(currRoot));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  let changedBytes = 0;

  for (const f of currFiles) {
    if (!prevFiles.has(f)) {
      added.push(f);
      const s = await stat(join(currRoot, f)).catch(() => null);
      changedBytes += s?.size ?? 0;
    }
  }
  for (const f of prevFiles) {
    if (!currFiles.has(f)) {
      removed.push(f);
      const s = await stat(join(prevRoot, f)).catch(() => null);
      changedBytes += s?.size ?? 0;
    }
  }
  for (const f of currFiles) {
    if (prevFiles.has(f)) {
      const ps = await stat(join(prevRoot, f)).catch(() => null);
      const cs = await stat(join(currRoot, f)).catch(() => null);
      if (ps && cs && ps.size !== cs.size) {
        modified.push(f);
        changedBytes += Math.abs(cs.size - ps.size);
      } else if (ps && cs) {
        // same size: compare bytes
        const pa = await readFile(join(prevRoot, f)).catch(() => Buffer.alloc(0));
        const ca = await readFile(join(currRoot, f)).catch(() => Buffer.alloc(0));
        if (!pa.equals(ca)) {
          modified.push(f);
          changedBytes += Math.abs(ca.length - pa.length);
        }
      }
    }
  }
  return { added, removed, modified, changedBytes };
}

export interface DiffInput {
  current: AnalysisReport;
  previousVersion: ExactVersion;
  previousUnpackDir: string;
  currentUnpackDir: string;
}

export interface DiffResult {
  previousVersion: string;
  filesAdded: number;
  filesRemoved: number;
  filesModified: number;
  changedBytes: number;
  newBinEntries: string[];
  removedBinEntries: string[];
  newLifecycleScripts: string[];
  removedLifecycleScripts: string[];
  dependencyChanges: string[];
  repositoryUrlChanged: boolean;
  maintainerChanged: boolean;
  summary: string;
  riskyDeltas: RiskFinding[];
}

/**
 * Compute a full diff between the current analysis report and a previous
 * unpacked version, including risky-delta findings.
 */
export async function analyzeDiff(input: DiffInput): Promise<DiffResult> {
  const prevPkg = await readPackageJson(input.previousUnpackDir);
  const prevRoot = await packageRoot(input.previousUnpackDir);
  const currRoot = await packageRoot(input.currentUnpackDir);

  const fileDiff = await computeFileDiff(prevRoot, currRoot);

  const prevBin = normalizeBinSet(prevPkg.bin, prevPkg.name);
  const currBin = normalizeBinSet(input.current.package.bin, input.current.package.name);
  const newBinEntries = [...currBin].filter((b) => !prevBin.has(b));
  const removedBinEntries = [...prevBin].filter((b) => !currBin.has(b));

  const prevScripts = new Set(Object.keys(prevPkg.scripts ?? {}));
  const currScripts = new Set(input.current.package.scripts ? Object.keys(input.current.package.scripts) : []);
  const newLifecycleScripts = [...currScripts].filter((s) => !prevScripts.has(s));
  const removedLifecycleScripts = [...prevScripts].filter((s) => !currScripts.has(s));

  const dependencyChanges: string[] = [];
  const prevDeps = prevPkg.dependencies ?? {};
  const currDeps = input.current.package.dependencies;
  for (const dep of new Set([...Object.keys(prevDeps), ...Object.keys(currDeps)])) {
    if (prevDeps[dep] !== currDeps[dep]) {
      dependencyChanges.push(`${dep}: ${prevDeps[dep] ?? '(absent)'} -> ${currDeps[dep] ?? '(removed)'}`);
    }
  }

  const prevRepo = repositoryToString(prevPkg.repository);
  const currRepo = input.current.package.repository;
  const repositoryUrlChanged = !!prevRepo && !!currRepo && prevRepo !== currRepo;

  const prevMaintainers = new Set((prevPkg.maintainers ?? []).map((m) => m.name ?? ''));
  const currMaintainers = new Set(input.current.package.maintainers);
  const maintainerChanged =
    currMaintainers.size > 0 &&
    prevMaintainers.size > 0 &&
    ([...currMaintainers].some((m) => !prevMaintainers.has(m)) ||
      [...prevMaintainers].some((m) => !currMaintainers.has(m)));

  // Risky deltas -> findings.
  const riskyDeltas: RiskFinding[] = [];
  const newLifecycleInstallScripts = newLifecycleScripts.filter((s) =>
    ['preinstall', 'install', 'postinstall', 'prepare'].includes(s),
  );
  if (newLifecycleInstallScripts.length > 0) {
    riskyDeltas.push({
      code: 'DIFF_NEW_INSTALL_SCRIPT',
      severity: 'high',
      message: `new lifecycle install script(s): ${newLifecycleInstallScripts.join(', ')}`,
      evidence: newLifecycleInstallScripts.map((s) => `scripts.${s}`),
    });
  }
  const newChildProcess = input.current.inferredPermissions.childProcess;
  // We can't know previous inferred permissions without re-analyzing; approximate
  // by checking if child_process is newly imported in added/modified files.
  if (newChildProcess) {
    riskyDeltas.push({
      code: 'DIFF_NEW_CHILD_PROCESS',
      severity: 'medium',
      message: 'current version uses child_process (verify it is new vs previous)',
      evidence: [],
    });
  }
  if (input.current.inferredPermissions.net.length > 0) {
    riskyDeltas.push({
      code: 'DIFF_NEW_NETWORK',
      severity: 'medium',
      message: 'current version uses network modules (verify it is new vs previous)',
      evidence: input.current.inferredPermissions.net,
    });
  }
  if (input.current.nativeArtifacts.nodeAddons.length > 0 || input.current.nativeArtifacts.bindingGyp) {
    riskyDeltas.push({
      code: 'DIFF_NEW_NATIVE',
      severity: 'medium',
      message: 'current version contains native artifacts (verify new vs previous)',
      evidence: input.current.nativeArtifacts.nodeAddons,
    });
  }
  if (repositoryUrlChanged) {
    riskyDeltas.push({
      code: 'DIFF_REPO_CHANGED',
      severity: 'high',
      message: `source repository changed: ${prevRepo} -> ${currRepo}`,
      evidence: [prevRepo ?? '', currRepo ?? ''],
    });
  }
  if (maintainerChanged) {
    riskyDeltas.push({
      code: 'DIFF_MAINTAINER_CHANGED',
      severity: 'high',
      message: 'maintainer set changed since previous version',
      evidence: [
        `prev: ${[...prevMaintainers].join(', ')}`,
        `curr: ${[...currMaintainers].join(', ')}`,
      ],
    });
  }

  const summaryParts: string[] = [];
  summaryParts.push(`${fileDiff.added.length} added, ${fileDiff.removed.length} removed, ${fileDiff.modified.length} modified`);
  if (newBinEntries.length) summaryParts.push(`new bins: ${newBinEntries.join(', ')}`);
  if (newLifecycleScripts.length) summaryParts.push(`new scripts: ${newLifecycleScripts.join(', ')}`);
  if (dependencyChanges.length) summaryParts.push(`${dependencyChanges.length} dependency changes`);
  if (repositoryUrlChanged) summaryParts.push('repository URL changed');
  if (maintainerChanged) summaryParts.push('maintainer set changed');

  return {
    previousVersion: input.previousVersion,
    filesAdded: fileDiff.added.length,
    filesRemoved: fileDiff.removed.length,
    filesModified: fileDiff.modified.length,
    changedBytes: fileDiff.changedBytes,
    newBinEntries,
    removedBinEntries,
    newLifecycleScripts,
    removedLifecycleScripts,
    dependencyChanges,
    repositoryUrlChanged,
    maintainerChanged,
    summary: summaryParts.join('; '),
    riskyDeltas,
  };
}

function normalizeBinSet(bin: PackageJsonShape['bin'], name: string): Set<string> {
  if (!bin) return new Set();
  if (typeof bin === 'string') return new Set([name]);
  return new Set(Object.keys(bin));
}

function repositoryToString(repo: PackageJsonShape['repository']): string | undefined {
  if (!repo) return undefined;
  if (typeof repo === 'string') return repo;
  return repo.url;
}

/** Apply a diff result to an AnalysisReport.diffRisk. */
export function applyDiff(report: AnalysisReport, diff: DiffResult): void {
  report.diffRisk = {
    previousVersion: diff.previousVersion,
    filesAdded: diff.filesAdded,
    filesRemoved: diff.filesRemoved,
    filesModified: diff.filesModified,
    changedBytes: diff.changedBytes,
    newBinEntries: diff.newBinEntries,
    removedBinEntries: diff.removedBinEntries,
    newLifecycleScripts: diff.newLifecycleScripts,
    removedLifecycleScripts: diff.removedLifecycleScripts,
    dependencyChanges: diff.dependencyChanges,
    repositoryUrlChanged: diff.repositoryUrlChanged,
    maintainerChanged: diff.maintainerChanged,
    summary: diff.summary,
    riskyDeltas: diff.riskyDeltas,
  };
}

export type { ExactVersion, PackageName };
