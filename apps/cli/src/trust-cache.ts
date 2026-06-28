/**
 * Trust cache for safe-npx (design 18.5).
 *
 * Stores local trust decisions by package name, version, tarball digest,
 * and risk report digest.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type TrustScope = 'once' | 'exact' | 'digest' | 'package';

export interface TrustEntry {
  packageName: string;
  version?: string;
  tarballDigest?: string;
  riskReportDigest?: string;
  scope: TrustScope;
  createdAt: string;
}

export class TrustCache {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), '.safe-npm', 'trust.json');
  }

  private async load(): Promise<TrustEntry[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      return JSON.parse(content) as TrustEntry[];
    } catch {
      return [];
    }
  }

  private async save(entries: TrustEntry[]): Promise<void> {
    await mkdir(join(this.filePath, '..'), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(entries, null, 2));
  }

  /** Add a trust entry. */
  async trust(entry: TrustEntry): Promise<void> {
    const entries = await this.load();
    // Remove any existing entry for the same package/version.
    const filtered = entries.filter(
      (e) => !(e.packageName === entry.packageName && e.version === entry.version),
    );
    filtered.push(entry);
    await this.save(filtered);
  }

  /** Check if a package/version/digest is trusted. */
  async isTrusted(
    packageName: string,
    version?: string,
    tarballDigest?: string,
    _riskReportDigest?: string,
  ): Promise<TrustEntry | null> {
    const entries = await this.load();
    for (const entry of entries) {
      if (entry.packageName !== packageName) continue;
      switch (entry.scope) {
        case 'package':
          return entry;
        case 'digest':
          if (tarballDigest && entry.tarballDigest === tarballDigest) return entry;
          break;
        case 'exact':
          if (version && entry.version === version) return entry;
          break;
        case 'once':
          // 'once' entries are consumed after a single use.
          break;
      }
    }
    return null;
  }

  /** List all trust entries. */
  async list(): Promise<TrustEntry[]> {
    return this.load();
  }

  /** Revoke trust for a package. */
  async revoke(packageName: string, version?: string): Promise<void> {
    const entries = await this.load();
    const filtered = entries.filter(
      (e) => !(e.packageName === packageName && (!version || e.version === version)),
    );
    await this.save(filtered);
  }

  /** Consume a 'once' trust entry. */
  async consumeOnce(packageName: string, version?: string): Promise<void> {
    const entries = await this.load();
    const filtered = entries.filter(
      (e) => !(e.packageName === packageName && e.scope === 'once' && (!version || e.version === version)),
    );
    await this.save(filtered);
  }
}
