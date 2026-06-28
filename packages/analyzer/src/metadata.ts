import { readFile, readdir, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  MetadataFacts,
  PackageName,
  type MetadataFacts as MetadataFactsType,
  type NativeArtifactFinding as NativeArtifactFindingType,
} from '@safe-npm/core-types';

/**
 * Metadata analyzer (design 4.3 / 10.1). Walks an unpacked tarball tree,
 * extracts `package.json`, counts files, computes sizes, and detects native
 * artifacts. Never executes package code.
 */

export interface MetadataAnalysisResult {
  metadata: MetadataFactsType;
  fileCount: number;
  packedSizeBytes: number;
  unpackedSizeBytes: number;
  nativeArtifacts: NativeArtifactFindingType[];
  /** Detected binary/asset file extensions encountered. */
  binaryFileTypes: string[];
}

const BINARY_EXTENSIONS = new Set([
  '.node',
  '.o',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.wasm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.zip',
  '.gz',
  '.tgz',
  '.pdf',
]);

export class MetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataError';
  }
}

export async function analyzeMetadata(
  unpackedRoot: string,
  expectedName?: string,
  expectedVersion?: string,
): Promise<MetadataAnalysisResult> {
  const pkgJsonPath = join(unpackedRoot, 'package.json');
  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new MetadataError('package.json missing or invalid');
  }

  const name = String(pkgJson.name ?? '');
  const version = String(pkgJson.version ?? '');

  if (expectedName && PackageName.safeParse(name).success && name !== expectedName) {
    throw new MetadataError(`package.json name "${name}" != resolved "${expectedName}"`);
  }
  if (expectedVersion && version && version !== expectedVersion) {
    throw new MetadataError(`package.json version "${version}" != resolved "${expectedVersion}"`);
  }

  const metadata = MetadataFacts.parse({
    name,
    version,
    description: optionalString(pkgJson.description),
    license: optionalStringOrObject(pkgJson.license),
    author: pkgJson.author,
    contributors: asArray(pkgJson.contributors),
    maintainers: asArray(pkgJson.maintainers),
    repository: pkgJson.repository,
    homepage: optionalString(pkgJson.homepage),
    bugs: pkgJson.bugs,
    main: optionalString(pkgJson.main),
    exports: pkgJson.exports,
    bin: pkgJson.bin,
    scripts: asStringRecord(pkgJson.scripts),
    dependencies: asStringRecord(pkgJson.dependencies),
    devDependencies: asStringRecord(pkgJson.devDependencies),
    optionalDependencies: asStringRecord(pkgJson.optionalDependencies),
    peerDependencies: asStringRecord(pkgJson.peerDependencies),
    bundledDependencies: asStringArray(pkgJson.bundledDependencies),
    files: asStringArray(pkgJson.files),
  });

  // Walk the tree for file count, sizes, and native artifacts.
  let fileCount = 0;
  let unpackedSizeBytes = 0;
  const nativeArtifacts: NativeArtifactFindingType[] = [];
  const binaryFileTypes = new Set<string>();

  await walk(unpackedRoot, async (_absPath, relPath, s) => {
    if (!s.isFile()) return;
    fileCount++;
    unpackedSizeBytes += s.size;
    const lower = relPath.toLowerCase();

    if (lower.endsWith('.node')) {
      nativeArtifacts.push({ type: 'node_addon', file: relPath });
      binaryFileTypes.add('.node');
    } else if (lower.endsWith('binding.gyp') || relPath.endsWith(`${sep}binding.gyp`)) {
      nativeArtifacts.push({ type: 'binding_gyp', file: relPath });
    } else {
      for (const ext of BINARY_EXTENSIONS) {
        if (lower.endsWith(ext)) {
          binaryFileTypes.add(ext);
          if (ext === '.exe' || ext === '.dll' || ext === '.so' || ext === '.dylib') {
            nativeArtifacts.push({ type: 'binary', file: relPath });
          }
          break;
        }
      }
    }
  });

  return {
    metadata,
    fileCount,
    packedSizeBytes: 0, // packed size is computed by the caller from the tarball file.
    unpackedSizeBytes,
    nativeArtifacts,
    binaryFileTypes: [...binaryFileTypes],
  };
}

async function walk(
  root: string,
  visit: (absPath: string, relPath: string, s: Stats) => Promise<void>,
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const absPath = join(root, entry.name);
    const relPath = relative(root, absPath);
    if (entry.isDirectory()) {
      await walk(absPath, (a, r, s) => visit(a, relPath + sep + r, s));
    } else if (entry.isFile()) {
      const s = await stat(absPath);
      await visit(absPath, relPath, s);
    }
  }
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function optionalStringOrObject(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'type' in v) return String((v as Record<string, unknown>).type);
  return undefined;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asStringRecord(v: unknown): Record<string, string> {
  if (v && typeof v === 'object') {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = String(val);
    }
    return out;
  }
  return {};
}
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}
