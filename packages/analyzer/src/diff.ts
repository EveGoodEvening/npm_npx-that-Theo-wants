/**
 * File diff between two package versions (design 11.2).
 *
 * Unpacks both tarballs, computes added/removed/modified files,
 * and detects changes in bin entries, lifecycle scripts, dependencies,
 * and repository URL.
 */
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import * as tar from 'tar';

export interface FileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface PackageMetadata {
  scripts?: Record<string, string>;
  bin?: Record<string, string> | string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  repository?: string | { type: string; url: string };
  maintainers?: Array<{ name?: string; email?: string }>;
  contributors?: Array<{ name?: string; email?: string }>;
}

export interface DiffResult {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  totalChangedBytes: number;
  newBinEntries: string[];
  removedBinEntries: string[];
  newLifecycleScripts: string[];
  removedLifecycleScripts: string[];
  addedDependencies: string[];
  removedDependencies: string[];
  changedDependencies: string[];
  repositoryUrlChanged: boolean;
  oldRepositoryUrl?: string;
  newRepositoryUrl?: string;
  maintainerChanged: boolean;
}

/**
 * Compute the diff between two tarball buffers.
 */
export async function computeDiff(
  oldTarball: Buffer,
  newTarball: Buffer,
): Promise<DiffResult> {
  const oldDir = await mkdtemp(join(tmpdir(), 'safe-npm-diff-old-'));
  const newDir = await mkdtemp(join(tmpdir(), 'safe-npm-diff-new-'));
  try {
    const oldTarballPath = join(oldDir, 'old.tgz');
    const newTarballPath = join(newDir, 'new.tgz');
    await writeFile(oldTarballPath, oldTarball);
    await writeFile(newTarballPath, newTarball);

    const oldFiles = await listTarballFiles(oldTarballPath);
    const newFiles = await listTarballFiles(newTarballPath);

    const oldMeta = await extractPackageJson(oldTarballPath);
    const newMeta = await extractPackageJson(newTarballPath);

    return compareFilesAndMetadata(oldFiles, newFiles, oldMeta, newMeta);
  } finally {
    await rm(oldDir, { recursive: true, force: true }).catch(() => {});
    await rm(newDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function listTarballFiles(tarballPath: string): Promise<Map<string, FileEntry>> {
  const files = new Map<string, FileEntry>();
  await tar.list({
    file: tarballPath,
    onentry: (entry) => {
      if (entry.type === 'File') {
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => chunks.push(chunk));
        entry.on('end', () => {
          const content = Buffer.concat(chunks);
          files.set(entry.path, {
            path: entry.path,
            size: content.length,
            sha256: createHash('sha256').update(content).digest('hex'),
          });
        });
      }
    },
  });
  // Wait for all 'end' events to fire. tar.list doesn't wait for stream data.
  // Use a small delay to ensure all data is collected.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return files;
}

async function extractPackageJson(tarballPath: string): Promise<PackageMetadata> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'safe-npm-pkgjson-'));
  try {
    await tar.extract({
      file: tarballPath,
      cwd: tmpDir,
      filter: (path) => path === 'package.json' || path === './package.json',
    });
    try {
      const content = await readFile(join(tmpDir, 'package.json'), 'utf8');
      return JSON.parse(content) as PackageMetadata;
    } catch {
      return {};
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function compareFilesAndMetadata(
  oldFiles: Map<string, FileEntry>,
  newFiles: Map<string, FileEntry>,
  oldMeta: PackageMetadata,
  newMeta: PackageMetadata,
): DiffResult {
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  let totalChangedBytes = 0;

  // Added files.
  for (const [path, newEntry] of newFiles) {
    if (!oldFiles.has(path)) {
      addedFiles.push(path);
      totalChangedBytes += newEntry.size;
    }
  }

  // Removed files.
  for (const [path, oldEntry] of oldFiles) {
    if (!newFiles.has(path)) {
      removedFiles.push(path);
      totalChangedBytes += oldEntry.size;
    }
  }

  // Modified files.
  for (const [path, newEntry] of newFiles) {
    const oldEntry = oldFiles.get(path);
    if (oldEntry && oldEntry.sha256 !== newEntry.sha256) {
      modifiedFiles.push(path);
      totalChangedBytes += Math.abs(newEntry.size - oldEntry.size);
    }
  }

  // Bin entries.
  const oldBin = normalizeBin(oldMeta.bin);
  const newBin = normalizeBin(newMeta.bin);
  const newBinEntries = Object.keys(newBin).filter((k) => !(k in oldBin));
  const removedBinEntries = Object.keys(oldBin).filter((k) => !(k in newBin));

  // Lifecycle scripts.
  const lifecycleScriptTypes = ['preinstall', 'install', 'postinstall', 'prepublish', 'prepare', 'prepack', 'postpack'];
  const oldScripts = oldMeta.scripts ?? {};
  const newScripts = newMeta.scripts ?? {};
  const newLifecycleScripts = lifecycleScriptTypes.filter((s) => newScripts[s] && !oldScripts[s]);
  const removedLifecycleScripts = lifecycleScriptTypes.filter((s) => oldScripts[s] && !newScripts[s]);

  // Dependencies.
  const oldDeps = oldMeta.dependencies ?? {};
  const newDeps = newMeta.dependencies ?? {};
  const addedDependencies = Object.keys(newDeps).filter((d) => !(d in oldDeps));
  const removedDependencies = Object.keys(oldDeps).filter((d) => !(d in newDeps));
  const changedDependencies = Object.keys(newDeps).filter((d) => d in oldDeps && oldDeps[d] !== newDeps[d]);

  // Repository URL.
  const oldRepoUrl = typeof oldMeta.repository === 'string' ? oldMeta.repository : oldMeta.repository?.url;
  const newRepoUrl = typeof newMeta.repository === 'string' ? newMeta.repository : newMeta.repository?.url;
  const repositoryUrlChanged = oldRepoUrl !== newRepoUrl;

  // Maintainer changed.
  const oldMaintainersKey = (oldMeta.maintainers ?? []).map((m) => m.email ?? m.name ?? '').sort().join(',');
  const newMaintainersKey = (newMeta.maintainers ?? []).map((m) => m.email ?? m.name ?? '').sort().join(',');
  const maintainerChanged = oldMaintainersKey !== newMaintainersKey;

  return {
    addedFiles: addedFiles.sort(),
    removedFiles: removedFiles.sort(),
    modifiedFiles: modifiedFiles.sort(),
    totalChangedBytes,
    newBinEntries,
    removedBinEntries,
    newLifecycleScripts,
    removedLifecycleScripts,
    addedDependencies: addedDependencies.sort(),
    removedDependencies: removedDependencies.sort(),
    changedDependencies: changedDependencies.sort(),
    repositoryUrlChanged,
    oldRepositoryUrl: oldRepoUrl,
    newRepositoryUrl: newRepoUrl,
    maintainerChanged,
  };
}

function normalizeBin(bin: PackageMetadata['bin']): Record<string, string> {
  if (!bin) return {};
  if (typeof bin === 'string') return { index: bin };
  return bin;
}
