/**
 * Rollup worker for install counts (design 14.3).
 *
 * Aggregates install events into hourly/daily rollups.
 */
import type { EventStore, InstallEvent } from './events.js';

export interface InstallRollup {
  packageName: string;
  packageVersion: string;
  uniqueInstalls: number;
  tarballFetches: number;
  period: 'hourly' | 'daily';
  periodStart: string;
  periodEnd: string;
}

/**
 * Aggregate install events into rollups.
 */
export function computeRollups(
  events: InstallEvent[],
  period: 'hourly' | 'daily' = 'daily',
): InstallRollup[] {
  const rollups = new Map<string, InstallRollup>();

  for (const event of events) {
    const periodStart = getPeriodStart(event.timestamp, period);
    const key = `${event.packageName}@${event.packageVersion}:${periodStart}`;

    if (!rollups.has(key)) {
      rollups.set(key, {
        packageName: event.packageName,
        packageVersion: event.packageVersion,
        uniqueInstalls: 0,
        tarballFetches: 0,
        period,
        periodStart,
        periodEnd: getPeriodEnd(periodStart, period),
      });
    }

    const rollup = rollups.get(key)!;
    if (event.type === 'tarball_fetch') {
      rollup.tarballFetches++;
    }
  }

  // Count unique installs (unique bucket IDs with install_success or tarball_fetch).
  const bucketSets = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.type !== 'install_success' && event.type !== 'tarball_fetch') continue;
    const periodStart = getPeriodStart(event.timestamp, period);
    const key = `${event.packageName}@${event.packageVersion}:${periodStart}`;
    if (!bucketSets.has(key)) bucketSets.set(key, new Set());
    bucketSets.get(key)!.add(event.bucketId);
  }

  for (const [key, buckets] of bucketSets) {
    const rollup = rollups.get(key);
    if (rollup) rollup.uniqueInstalls = buckets.size;
  }

  return [...rollups.values()];
}

function getPeriodStart(timestamp: string, period: 'hourly' | 'daily'): string {
  if (period === 'hourly') {
    return timestamp.slice(0, 13); // YYYY-MM-DDTHH
  }
  return timestamp.slice(0, 10); // YYYY-MM-DD
}

function getPeriodEnd(periodStart: string, period: 'hourly' | 'daily'): string {
  const date = new Date(periodStart.length === 10 ? periodStart + 'T00:00:00Z' : periodStart + ':00:00Z');
  if (period === 'hourly') {
    date.setUTCHours(date.getUTCHours() + 1);
  } else {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString();
}

/**
 * Process events from an EventStore into rollups.
 */
export function processRollups(store: EventStore, period: 'hourly' | 'daily' = 'daily'): InstallRollup[] {
  return computeRollups(store.list(), period);
}
