import { mkdir, rm, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { PermissionReport, RiskReport, AnalysisReport } from '@safe-npm/core-types';

/** OS-specific execution cache root (separate from quarantine cache). */
export function defaultExecCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const envDir = env.SAFE_NPX_EXEC_CACHE_DIR;
  if (envDir) return envDir;
  const home = homedir();
  const p = platform();
  if (p === 'darwin') return join(home, 'Library', 'Caches', 'safe-npx-exec');
  if (p === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return join(localAppData, 'safe-npx-exec', 'Cache');
  }
  return join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'safe-npx-exec');
}

export interface ExecCache {
  rootDir: string;
}

export async function createExecCache(rootDir: string = defaultExecCacheRoot()): Promise<ExecCache> {
  await mkdir(rootDir, { recursive: true });
  return { rootDir };
}

/** Cache key by package name, version, tarball digest, and policy hash. */
export function execCacheKey(
  cache: ExecCache,
  packageName: string,
  version: string,
  tarballDigest: string,
  policyHash: string,
): string {
  const h = createHash('sha256')
    .update(`${packageName}@${version}|${tarballDigest}|${policyHash}`)
    .digest('hex')
    .slice(0, 24);
  return join(cache.rootDir, h);
}

/** Clean the execution cache. */
export async function cleanExecCache(cache: ExecCache): Promise<void> {
  await rm(cache.rootDir, { recursive: true, force: true });
  await mkdir(cache.rootDir, { recursive: true });
}

export interface InstallOptions {
  /** Disable install scripts (default true for safety). */
  ignoreScripts?: boolean;
  /** Registry URL. */
  registry?: string;
  /** Timeout in ms. */
  timeoutMs?: number;
}

/**
 * Install a package into an isolated prefix (execution cache entry).
 * Uses `npm install --prefix` with install scripts disabled by default.
 * Returns the install path.
 */
export async function installIntoCache(
  destDir: string,
  packageName: string,
  version: string,
  options: InstallOptions = {},
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const ignoreScripts = options.ignoreScripts ?? true;
  const args = [
    'install',
    '--prefix',
    destDir,
    '--no-save',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
  ];
  if (ignoreScripts) args.push('--ignore-scripts');
  if (options.registry) {
    args.push('--registry', options.registry);
  }
  args.push(`${packageName}@${version}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`install timed out after ${options.timeoutMs ?? 120_000}ms`));
    }, options.timeoutMs ?? 120_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install failed (exit ${code}): ${stderr.slice(-500)}`));
    });
  });
}

/** Resolve the bin path for an installed package. */
export async function resolveInstalledBin(
  installDir: string,
  packageName: string,
  binName: string,
): Promise<string | undefined> {
  // npm installs bins to <prefix>/node_modules/.bin/<binName>
  const binLink = join(installDir, 'node_modules', '.bin', binName);
  try {
    await access(binLink);
    return binLink;
  } catch {
    // fallback: look in the package dir
    const pkgDir = join(installDir, 'node_modules', packageName);
    try {
      const pkgJson = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')) as {
        bin?: string | Record<string, string>;
      };
      const bin = pkgJson.bin;
      const target = typeof bin === 'string' ? bin : bin?.[binName];
      if (target) return join(pkgDir, target);
    } catch {
      /* ignore */
    }
    return undefined;
  }
}

/** Detect whether a bin target is Node-based. */
export async function isNodeBin(binPath: string): Promise<boolean> {
  try {
    const content = await readFile(binPath, 'utf8');
    const firstLine = content.split('\n')[0] ?? '';
    if (/node/i.test(firstLine)) return true;
  } catch {
    /* not readable as text */
  }
  return /\.(js|mjs|cjs)$/i.test(binPath);
}

/**
 * Build Node permission flags from a permission report.
 * Returns an array of `--allow-*` / `--deny-*` flags for `node --permission`.
 */
export function buildPermissionFlags(permissions: PermissionReport): string[] {
  const flags: string[] = [];
  // fs read/write allowlists
  if (permissions.inferred.fs) {
    for (const path of permissions.inferred.fs.read) {
      flags.push(`--allow-fs-read=${path}`);
    }
    for (const path of permissions.inferred.fs.write) {
      flags.push(`--allow-fs-write=${path}`);
    }
  }
  // deny child process
  if (!permissions.inferred.childProcess) {
    flags.push('--deny-child-process');
  }
  // deny worker threads
  if (!permissions.inferred.workerThreads) {
    flags.push('--deny-worker');
  }
  // deny native addons
  if (!permissions.inferred.native) {
    flags.push('--deny-addons');
  }
  // network: Node permission model support varies; only add if no network declared
  if (permissions.inferred.net.length === 0) {
    flags.push('--deny-net');
  }
  return flags;
}

/** Check whether the current Node version supports the permission model. */
export function nodeSupportsPermissionModel(): boolean {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 20;
}

export interface ExecOptions {
  /** User args to pass after the bin command. */
  args?: string[];
  /** Whether to preserve stdio for TTY mode. */
  tty?: boolean;
  /** Permission flags to apply (Node permission model). */
  permissionFlags?: string[];
  /** Whether to enforce permissions (require the model). */
  enforcePermissions?: boolean;
  /** Env overrides. */
  env?: Record<string, string>;
  /** Timeout in ms. */
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Whether permission enforcement was applied. */
  enforced: boolean;
}

/**
 * Execute a bin with controlled environment. Returns the child exit code.
 * If enforcePermissions is true and the Node permission model is unavailable,
 * returns exitCode 15 (sandbox unavailable).
 */
export async function executeBin(
  binPath: string,
  options: ExecOptions = {},
): Promise<ExecResult> {
  const nodeBased = await isNodeBin(binPath);
  const permissionAvailable = nodeSupportsPermissionModel();
  const usePermission =
    options.enforcePermissions === true &&
    nodeBased &&
    permissionAvailable;

  if (options.enforcePermissions === true && !usePermission) {
    // enforcement required but unavailable (non-node bin or unsupported Node)
    return { exitCode: 15, stdout: '', stderr: 'permission enforcement unavailable', enforced: false };
  }

  let cmd: string;
  let cmdArgs: string[];
  if (usePermission) {
    cmd = process.execPath;
    cmdArgs = ['--permission', ...(options.permissionFlags ?? []), binPath, ...(options.args ?? [])];
  } else if (nodeBased) {
    cmd = process.execPath;
    cmdArgs = [binPath, ...(options.args ?? [])];
  } else {
    cmd = binPath;
    cmdArgs = options.args ?? [];
  }

  return new Promise<ExecResult>((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: options.tty ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    });
    let stdout = '';
    let stderr = '';
    if (!options.tty) {
      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 60_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr, enforced: usePermission });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr, enforced: usePermission });
    });
  });
}

// ---- Trust cache ----

export type TrustScope = 'once' | 'exact-version' | 'digest' | 'package-name';

export interface TrustEntry {
  packageName: string;
  version: string;
  tarballDigest: string;
  riskReportDigest: string;
  scope: TrustScope;
  createdAt: string;
}

export interface TrustCache {
  entries: TrustEntry[];
}

function trustCachePath(): string {
  return join(defaultExecCacheRoot(), 'trust.json');
}

export async function loadTrustCache(): Promise<TrustCache> {
  try {
    const raw = await readFile(trustCachePath(), 'utf8');
    return JSON.parse(raw) as TrustCache;
  } catch {
    return { entries: [] };
  }
}

export async function saveTrustCache(cache: TrustCache): Promise<void> {
  await mkdir(defaultExecCacheRoot(), { recursive: true });
  await writeFile(trustCachePath(), JSON.stringify(cache, null, 2), 'utf8');
}

export async function addTrustEntry(entry: TrustEntry): Promise<void> {
  const cache = await loadTrustCache();
  cache.entries.push(entry);
  await saveTrustCache(cache);
}

export async function revokeTrustEntry(packageName: string, version?: string): Promise<void> {
  const cache = await loadTrustCache();
  cache.entries = cache.entries.filter(
    (e) => !(e.packageName === packageName && (!version || e.version === version)),
  );
  await saveTrustCache(cache);
}

/** Check whether a package/version/digest is trusted per the trust cache. */
export function isTrusted(cache: TrustCache, packageName: string, version: string, tarballDigest: string): TrustEntry | undefined {
  return cache.entries.find(
    (e) =>
      (e.scope === 'package-name' && e.packageName === packageName) ||
      (e.scope === 'exact-version' && e.packageName === packageName && e.version === version) ||
      (e.scope === 'digest' && e.packageName === packageName && e.tarballDigest === tarballDigest) ||
      (e.scope === 'once' && e.packageName === packageName && e.version === version && e.tarballDigest === tarballDigest),
  );
}

export async function listTrustEntries(): Promise<TrustEntry[]> {
  const cache = await loadTrustCache();
  return cache.entries;
}

export type { RiskReport, AnalysisReport };
