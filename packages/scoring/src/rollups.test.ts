import { describe, expect, it } from 'vitest';
import { computeRollups } from './rollups.js';
import type { InstallEvent } from './events.js';

describe('computeRollups', () => {
  it('aggregates tarball fetches by package version', () => {
    const events: InstallEvent[] = [
      { type: 'tarball_fetch', packageName: 'pkg-a', packageVersion: '1.0.0', bucketId: 'b1', timestamp: '2024-01-01T10:00:00Z', authenticated: false },
      { type: 'tarball_fetch', packageName: 'pkg-a', packageVersion: '1.0.0', bucketId: 'b2', timestamp: '2024-01-01T11:00:00Z', authenticated: false },
      { type: 'tarball_fetch', packageName: 'pkg-b', packageVersion: '1.0.0', bucketId: 'b3', timestamp: '2024-01-01T10:00:00Z', authenticated: false },
    ];
    const rollups = computeRollups(events, 'daily');
    expect(rollups.length).toBe(2);
    const pkgA = rollups.find((r) => r.packageName === 'pkg-a');
    expect(pkgA?.tarballFetches).toBe(2);
    expect(pkgA?.uniqueInstalls).toBe(2);
  });

  it('groups by day for daily rollups', () => {
    const events: InstallEvent[] = [
      { type: 'tarball_fetch', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b1', timestamp: '2024-01-01T10:00:00Z', authenticated: false },
      { type: 'tarball_fetch', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b2', timestamp: '2024-01-02T10:00:00Z', authenticated: false },
    ];
    const rollups = computeRollups(events, 'daily');
    expect(rollups.length).toBe(2);
  });

  it('groups by hour for hourly rollups', () => {
    const events: InstallEvent[] = [
      { type: 'tarball_fetch', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b1', timestamp: '2024-01-01T10:00:00Z', authenticated: false },
      { type: 'tarball_fetch', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b2', timestamp: '2024-01-01T11:00:00Z', authenticated: false },
    ];
    const rollups = computeRollups(events, 'hourly');
    expect(rollups.length).toBe(2);
  });

  it('counts unique installs by bucket ID', () => {
    const events: InstallEvent[] = [
      { type: 'install_success', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b1', timestamp: '2024-01-01T10:00:00Z', authenticated: true },
      { type: 'install_success', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b1', timestamp: '2024-01-01T11:00:00Z', authenticated: true },
      { type: 'install_success', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b2', timestamp: '2024-01-01T12:00:00Z', authenticated: true },
    ];
    const rollups = computeRollups(events, 'daily');
    expect(rollups[0].uniqueInstalls).toBe(2);
  });

  it('sets period start and end correctly', () => {
    const events: InstallEvent[] = [
      { type: 'tarball_fetch', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b1', timestamp: '2024-01-01T10:00:00Z', authenticated: false },
    ];
    const daily = computeRollups(events, 'daily')[0];
    expect(daily.periodStart).toBe('2024-01-01');
    expect(daily.periodEnd).toBe('2024-01-02T00:00:00.000Z');

    const hourly = computeRollups(events, 'hourly')[0];
    expect(hourly.periodStart).toBe('2024-01-01T10');
    expect(hourly.periodEnd).toBe('2024-01-01T11:00:00.000Z');
  });
});
