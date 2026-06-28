import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import {
  type AnalysisReport,
  type RiskFinding,
  type TarballIntegrity,
  type ExactVersion,
  type PackageName,
  type Permissions,
  PermissionsSchema,
} from '@safe-npm/core-types';

/** Recursively list all files under a directory, returning relative paths. */
export async function listFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const s = await stat(full);
      if (s.isDirectory()) {
        await walk(full);
      } else {
        out.push(relative(rootDir, full));
      }
    }
  }
  await walk(rootDir);
  return out;
}

const BINARY_EXTS: Record<string, true> = {
  '.png': true,
  '.jpg': true,
  '.jpeg': true,
  '.gif': true,
  '.ico': true,
  '.webp': true,
  '.woff': true,
  '.woff2': true,
  '.ttf': true,
  '.eot': true,
  '.otf': true,
  '.pdf': true,
  '.zip': true,
  '.gz': true,
  '.tgz': true,
  '.tar': true,
  '.mp3': true,
  '.mp4': true,
  '.webm': true,
  '.wasm': true,
};

const CODE_EXTS: Record<string, true> = {
  '.js': true,
  '.mjs': true,
  '.cjs': true,
  '.ts': true,
  '.tsx': true,
  '.jsx': true,
};

export interface PackageJsonShape {
  name: string;
  version: string;
  description?: string;
  license?: string | { type?: string };
  author?: string | { name?: string; email?: string; url?: string };
  contributors?: Array<string | { name?: string }>;
  maintainers?: Array<{ name?: string; email?: string }>;
  repository?: string | { type?: string; url?: string };
  homepage?: string;
  bugs?: string | { url?: string; email?: string };
  main?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bundledDependencies?: string[] | boolean;
  safeNpm?: { permissions?: unknown };
}

/** Read and parse package.json from the unpacked tree. */
export async function readPackageJson(unpackDir: string): Promise<PackageJsonShape> {
  const pkgPath = join(unpackDir, 'package/package.json');
  // tarballs normally contain a `package/` dir; try both layouts.
  let raw: string;
  try {
    raw = await readFile(pkgPath, 'utf8');
  } catch {
    raw = await readFile(join(unpackDir, 'package.json'), 'utf8');
  }
  return JSON.parse(raw) as PackageJsonShape;
}

/** The directory containing the package files (usually `package/`). */
export async function packageRoot(unpackDir: string): Promise<string> {
  try {
    await stat(join(unpackDir, 'package', 'package.json'));
    return join(unpackDir, 'package');
  } catch {
    return unpackDir;
  }
}

export interface MetadataFacts {
  fileCount: number;
  packedSizeBytes: number;
  unpackedSizeBytes: number;
  binaryFiles: string[];
  nodeAddons: string[];
  bindingGyp: boolean;
  sourceMaps: string[];
  codeFiles: string[];
}

/** Compute file/size/native facts from the unpacked tree. */
export async function computeMetadataFacts(
  unpackDir: string,
  pkgRoot: string,
  tarballSizeBytes: number,
): Promise<MetadataFacts> {
  const files = await listFiles(pkgRoot);
  let unpackedSize = 0;
  const binaryFiles: string[] = [];
  const nodeAddons: string[] = [];
  const sourceMaps: string[] = [];
  const codeFiles: string[] = [];
  let bindingGyp = false;

  for (const rel of files) {
    const full = join(pkgRoot, rel);
    const s = await stat(full);
    unpackedSize += s.size;
    const ext = extname(rel).toLowerCase();
    if (ext === '.node') nodeAddons.push(rel);
    else if (BINARY_EXTS[ext] === true) binaryFiles.push(rel);
    if (ext === '.map') sourceMaps.push(rel);
    if (CODE_EXTS[ext] === true) codeFiles.push(rel);
    if (rel === 'binding.gyp') bindingGyp = true;
  }

  return {
    fileCount: files.length,
    packedSizeBytes: tarballSizeBytes,
    unpackedSizeBytes: unpackedSize,
    binaryFiles,
    nodeAddons,
    bindingGyp,
    sourceMaps,
    codeFiles,
  };
}

/** Normalize an author field to a string. */
export function authorToString(author: PackageJsonShape['author']): string | undefined {
  if (!author) return undefined;
  if (typeof author === 'string') return author;
  return [author.name, author.email ? `<${author.email}>` : undefined, author.url ? `(${author.url})` : undefined]
    .filter(Boolean)
    .join(' ');
}

/** Normalize a repository field to a URL string. */
export function repositoryToString(repo: PackageJsonShape['repository']): string | undefined {
  if (!repo) return undefined;
  if (typeof repo === 'string') return repo;
  return repo.url;
}

/** Normalize bin field to a record. */
export function normalizeBin(
  bin: PackageJsonShape['bin'],
  name: string,
): Record<string, string> {
  if (!bin) return {};
  if (typeof bin === 'string') return { [name]: bin };
  return bin;
}

/** Parse declared permissions from package.json `safeNpm.permissions`, if valid. */
export function parseDeclaredPermissions(raw: unknown): Permissions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const parsed = PermissionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export interface AnalysisInput {
  tarballDigest: TarballIntegrity;
  analyzerVersion: string;
  tarballSizeBytes: number;
  unpackDir: string;
  expectedName: PackageName;
  expectedVersion: ExactVersion;
  maintainersFromPackument?: Array<{ name?: string; email?: string }>;
}

/** Build the base AnalysisReport skeleton (without static/script/readability findings). */
export async function buildMetadataReport(
  input: AnalysisInput,
): Promise<{
  report: AnalysisReport;
  facts: MetadataFacts;
  pkg: PackageJsonShape;
  pkgRoot: string;
}> {
  const pkg = await readPackageJson(input.unpackDir);
  const pkgRoot = await packageRoot(input.unpackDir);
  const facts = await computeMetadataFacts(input.unpackDir, pkgRoot, input.tarballSizeBytes);

  const bin = normalizeBin(pkg.bin, pkg.name);
  const maintainers = [
    ...(pkg.maintainers ?? []).map((m) => m.name ?? ''),
    ...(input.maintainersFromPackument ?? []).map((m) => m.name ?? ''),
  ].filter((n) => n.length > 0);

  const report: AnalysisReport = {
    tarballDigest: input.tarballDigest,
    analyzerVersion: input.analyzerVersion,
    generatedAt: new Date().toISOString(),
    package: {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type,
      author: authorToString(pkg.author),
      contributors: (pkg.contributors ?? []).map((c) => (typeof c === 'string' ? c : c.name ?? '')),
      maintainers,
      repository: repositoryToString(pkg.repository),
      homepage: pkg.homepage,
      bugs: typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url,
      main: pkg.main,
      exports: (pkg.exports as Record<string, unknown>) ?? {},
      bin,
      scripts: pkg.scripts ?? {},
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
      optionalDependencies: pkg.optionalDependencies ?? {},
      peerDependencies: pkg.peerDependencies ?? {},
      bundledDependencies: Array.isArray(pkg.bundledDependencies) ? pkg.bundledDependencies : [],
    },
    tarball: {
      sizeBytes: facts.packedSizeBytes,
      unpackedSizeBytes: facts.unpackedSizeBytes,
      fileCount: facts.fileCount,
    },
    lifecycleScripts: [],
    scriptFindings: [],
    staticFindings: [],
    readability: {
      likelyMinified: false,
      likelyObfuscated: false,
      sourceMapsPresent: facts.sourceMaps.length > 0,
      humanReadableFileRatio: 1,
      minifiedLineRatio: 0,
    },
    nativeArtifacts: {
      nodeAddons: facts.nodeAddons,
      binaries: facts.binaryFiles,
      bindingGyp: facts.bindingGyp,
    },
    inferredPermissions: PermissionsSchema.parse({}),
  };

  return { report, facts, pkg, pkgRoot };
}

export type { RiskFinding };
