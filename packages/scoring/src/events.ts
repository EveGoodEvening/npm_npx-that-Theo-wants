/**
 * Install event capture and privacy buckets (design 14.1-14.2).
 *
 * Captures install-related events with privacy-preserving bucketing.
 */
import { createHash } from 'node:crypto';

export type EventType = 'manifest_resolve' | 'tarball_fetch' | 'exec_preflight' | 'install_success';

export interface InstallEvent {
  type: EventType;
  packageName: string;
  packageVersion: string;
  /** Privacy-preserving bucket ID (never raw user/IP). */
  bucketId: string;
  timestamp: string;
  /** Whether the request was authenticated. */
  authenticated: boolean;
}

export interface EventCaptureOptions {
  /** Daily rotating salt for bucket hashing. */
  salt: string;
  /** Authenticated user/org ID (if available). */
  userId?: string;
  /** Org ID (if available). */
  orgId?: string;
  /** Client IP address (for anonymous bucketing only). */
  ip?: string;
  /** User-Agent header (for anonymous bucketing). */
  userAgent?: string;
  /** Whether telemetry is enabled. */
  telemetryEnabled: boolean;
}

/**
 * Compute a privacy-preserving bucket ID.
 *
 * For authenticated requests: bucket by user/org/day.
 * For anonymous requests: bucket by hashed IP prefix + user-agent family + day.
 */
export function computeBucketId(options: EventCaptureOptions): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (options.userId) {
    // Authenticated: bucket by user/org/day.
    const identifier = options.orgId ?? options.userId;
    return hashBucket(`auth:${identifier}:${day}`, options.salt);
  }

  // Anonymous: bucket by IP prefix + user-agent family + day.
  const ipPrefix = options.ip?.split('.').slice(0, 2).join('.') ?? 'unknown';
  const uaFamily = detectUserAgentFamily(options.userAgent);
  return hashBucket(`anon:${ipPrefix}:${uaFamily}:${day}`, options.salt);
}

function hashBucket(input: string, salt: string): string {
  return `bucket:${createHash('sha256').update(`${input}:${salt}`).digest('hex').slice(0, 16)}`;
}

function detectUserAgentFamily(ua?: string): string {
  if (!ua) return 'unknown';
  if (ua.includes('safe-npm/')) return 'safe-npm';
  if (ua.includes('pnpm/')) return 'pnpm';
  if (ua.includes('yarn/')) return 'yarn';
  if (ua.includes('npm/')) return 'npm';
  return 'other';
}

/**
 * Daily rotating salt manager.
 */
export class DailySaltManager {
  private currentSalt: string;
  private currentDate: string;
  private readonly saltSecret: string;

  constructor(saltSecret: string) {
    this.saltSecret = saltSecret;
    this.currentDate = this.today();
    this.currentSalt = this.deriveSalt(this.currentDate);
  }

  /** Get the current salt, rotating if the day has changed. */
  getSalt(): string {
    const today = this.today();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.currentSalt = this.deriveSalt(today);
    }
    return this.currentSalt;
  }

  private deriveSalt(date: string): string {
    return createHash('sha256').update(`${this.saltSecret}:${date}`).digest('hex');
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * In-memory event store (MVP).
 * In production, this would be a database table.
 */
export class EventStore {
  private events: InstallEvent[] = [];
  private retentionDays: number;

  constructor(retentionDays = 90) {
    this.retentionDays = retentionDays;
  }

  /** Record an event. */
  record(event: InstallEvent): void {
    this.events.push(event);
    this.evictExpired();
  }

  /** Get all events (for rollup processing). */
  list(): InstallEvent[] {
    return [...this.events];
  }

  /** Get events for a specific package version. */
  listByPackageVersion(packageName: string, packageVersion: string): InstallEvent[] {
    return this.events.filter(
      (e) => e.packageName === packageName && e.packageVersion === packageVersion,
    );
  }

  /** Count unique buckets for a package version (proxy for unique installs). */
  countUniqueInstalls(packageName: string, packageVersion: string): number {
    const events = this.listByPackageVersion(packageName, packageVersion)
      .filter((e) => e.type === 'install_success' || e.type === 'tarball_fetch');
    const buckets = new Set(events.map((e) => e.bucketId));
    return buckets.size;
  }

  /** Evict events older than retention period. */
  private evictExpired(): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    const cutoffIso = cutoff.toISOString();
    this.events = this.events.filter((e) => e.timestamp >= cutoffIso);
  }

  /** Clear all events (for tests). */
  clear(): void {
    this.events = [];
  }
}
