/**
 * Node permission runner for safe-npx (design 18.3).
 *
 * Detects whether a bin is Node-based and builds permission flags
 * from the permission report.
 */
import { readFile } from 'node:fs/promises';

export interface PermissionReport {
  declaredPermissions?: {
    fsRead?: string[];
    fsWrite?: string[];
    network?: boolean;
    childProcess?: boolean;
    nativeAddon?: boolean;
  };
}

export interface NodePermissionFlags {
  /** Filesystem read allowlist. */
  fsReadAllowlist?: string[];
  /** Filesystem write allowlist. */
  fsWriteAllowlist?: string[];
  /** Whether network access is allowed. */
  network?: boolean;
  /** Whether child processes are allowed. */
  childProcess?: boolean;
  /** Whether native addons are allowed. */
  nativeAddon?: boolean;
}

/**
 * Detect whether a bin is Node-based.
 */
export async function isNodeBin(binPath: string): Promise<boolean> {
  try {
    const content = await readFile(binPath, 'utf8');
    // Check shebang.
    if (content.startsWith('#!')) {
      const shebang = content.split('\n')[0] ?? '';
      if (shebang.includes('node')) return true;
    }
    // Check file extension.
    if (binPath.endsWith('.js') || binPath.endsWith('.mjs') || binPath.endsWith('.cjs')) {
      return true;
    }
    return false;
  } catch {
    // If we can't read the file, check by extension.
    return binPath.endsWith('.js') || binPath.endsWith('.mjs') || binPath.endsWith('.cjs');
  }
}

/**
 * Build Node permission flags from a permission report.
 */
export function buildPermissionFlags(report: PermissionReport): NodePermissionFlags {
  const declared = report.declaredPermissions ?? {};
  return {
    fsReadAllowlist: declared.fsRead,
    fsWriteAllowlist: declared.fsWrite,
    network: declared.network,
    childProcess: declared.childProcess,
    nativeAddon: declared.nativeAddon,
  };
}

/**
 * Check if the current Node.js version supports permission enforcement.
 * Node 20+ has --permission flag support.
 */
export function nodeSupportsPermissions(): boolean {
  const major = process.versions.node.split('.')[0];
  return parseInt(major, 10) >= 20;
}

/**
 * Build the Node.js CLI flags for permission enforcement.
 * Returns null if permissions can't be enforced for the required level.
 */
export function buildNodeFlags(
  flags: NodePermissionFlags,
  options: { requireEnforcement?: boolean } = {},
): string[] | null {
  const nodeArgs: string[] = [];

  if (!nodeSupportsPermissions()) {
    if (options.requireEnforcement) return null;
    return []; // No enforcement possible.
  }

  // Enable permission model.
  nodeArgs.push('--permission');

  // Filesystem read allowlist.
  if (flags.fsReadAllowlist) {
    for (const path of flags.fsReadAllowlist) {
      nodeArgs.push('--allow-fs-read', path);
    }
  } else {
    // No read allowlist = deny all reads by default.
    // Actually, --permission without allowlists denies everything.
    // We need to allow the package's own directory.
  }

  // Filesystem write allowlist.
  if (flags.fsWriteAllowlist) {
    for (const path of flags.fsWriteAllowlist) {
      nodeArgs.push('--allow-fs-write', path);
    }
  }

  // Network: Node 22+ supports --allow-network.
  const major = parseInt(process.versions.node.split('.')[0]!, 10);
  if (major >= 22) {
    if (flags.network) {
      nodeArgs.push('--allow-network');
    }
  } else if (flags.network && options.requireEnforcement) {
    // Can't enforce network permission on this Node version.
    return null;
  }

  // Child process: Node 22+ supports --allow-child-process.
  if (major >= 22) {
    if (flags.childProcess) {
      nodeArgs.push('--allow-child-process');
    }
  } else if (flags.childProcess && options.requireEnforcement) {
    return null;
  }

  return nodeArgs;
}
