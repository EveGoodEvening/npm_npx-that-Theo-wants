import { describe, expect, it, beforeEach } from 'vitest';
import { computeBucketId, DailySaltManager, EventStore, type EventType } from './events.js';

describe('computeBucketId', () => {
  it('buckets authenticated requests by user/day', () => {
    const bucket1 = computeBucketId({
      salt: 'test-salt',
      userId: 'user-1',
      telemetryEnabled: true,
    });
    const bucket2 = computeBucketId({
      salt: 'test-salt',
      userId: 'user-1',
      telemetryEnabled: true,
    });
    expect(bucket1).toBe(bucket2);
    expect(bucket1).toMatch(/^bucket:/);
  });

  it('buckets different users differently', () => {
    const bucket1 = computeBucketId({
      salt: 'test-salt',
      userId: 'user-1',
      telemetryEnabled: true,
    });
    const bucket2 = computeBucketId({
      salt: 'test-salt',
      userId: 'user-2',
      telemetryEnabled: true,
    });
    expect(bucket1).not.toBe(bucket2);
  });

  it('buckets anonymous requests by IP prefix + UA family', () => {
    const bucket1 = computeBucketId({
      salt: 'test-salt',
      ip: '192.168.1.100',
      userAgent: 'npm/8.0.0',
      telemetryEnabled: true,
    });
    const bucket2 = computeBucketId({
      salt: 'test-salt',
      ip: '192.168.1.200',
      userAgent: 'npm/8.0.0',
      telemetryEnabled: true,
    });
    // Same /24 prefix → same bucket.
    expect(bucket1).toBe(bucket2);
  });

  it('buckets different IP prefixes differently', () => {
    const bucket1 = computeBucketId({
      salt: 'test-salt',
      ip: '192.168.1.100',
      userAgent: 'npm/8.0.0',
      telemetryEnabled: true,
    });
    const bucket2 = computeBucketId({
      salt: 'test-salt',
      ip: '10.0.0.100',
      userAgent: 'npm/8.0.0',
      telemetryEnabled: true,
    });
    expect(bucket1).not.toBe(bucket2);
  });

  it('detects user-agent families', () => {
    const npmBucket = computeBucketId({
      salt: 'test-salt',
      ip: '1.2.3.4',
      userAgent: 'npm/8.0.0',
      telemetryEnabled: true,
    });
    const pnpmBucket = computeBucketId({
      salt: 'test-salt',
      ip: '1.2.3.4',
      userAgent: 'pnpm/8.0.0',
      telemetryEnabled: true,
    });
    expect(npmBucket).not.toBe(pnpmBucket);
  });

  it('different salts produce different buckets', () => {
    const bucket1 = computeBucketId({
      salt: 'salt-1',
      userId: 'user-1',
      telemetryEnabled: true,
    });
    const bucket2 = computeBucketId({
      salt: 'salt-2',
      userId: 'user-1',
      telemetryEnabled: true,
    });
    expect(bucket1).not.toBe(bucket2);
  });
});

describe('DailySaltManager', () => {
  it('produces a stable salt for the same day', () => {
    const manager = new DailySaltManager('secret');
    const salt1 = manager.getSalt();
    const salt2 = manager.getSalt();
    expect(salt1).toBe(salt2);
    expect(salt1).toBeTruthy();
  });

  it('produces different salts for different secrets', () => {
    const manager1 = new DailySaltManager('secret-1');
    const manager2 = new DailySaltManager('secret-2');
    expect(manager1.getSalt()).not.toBe(manager2.getSalt());
  });
});

describe('EventStore', () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore(90);
  });

  it('records and lists events', () => {
    const event = {
      type: 'install_success' as EventType,
      packageName: 'test-pkg',
      packageVersion: '1.0.0',
      bucketId: 'bucket-1',
      timestamp: new Date().toISOString(),
      authenticated: true,
    };
    store.record(event);
    expect(store.list().length).toBe(1);
  });

  it('lists events by package version', () => {
    store.record({
      type: 'install_success',
      packageName: 'pkg-a',
      packageVersion: '1.0.0',
      bucketId: 'b1',
      timestamp: new Date().toISOString(),
      authenticated: true,
    });
    store.record({
      type: 'tarball_fetch',
      packageName: 'pkg-b',
      packageVersion: '1.0.0',
      bucketId: 'b2',
      timestamp: new Date().toISOString(),
      authenticated: false,
    });
    expect(store.listByPackageVersion('pkg-a', '1.0.0').length).toBe(1);
    expect(store.listByPackageVersion('pkg-b', '1.0.0').length).toBe(1);
  });

  it('counts unique installs by bucket ID', () => {
    const ts = new Date().toISOString();
    store.record({ type: 'tarball_fetch', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b1', timestamp: ts, authenticated: false });
    store.record({ type: 'tarball_fetch', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b1', timestamp: ts, authenticated: false });
    store.record({ type: 'tarball_fetch', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b2', timestamp: ts, authenticated: false });
    store.record({ type: 'manifest_resolve', packageName: 'pkg', packageVersion: '1.0.0', bucketId: 'b3', timestamp: ts, authenticated: false });
    expect(store.countUniqueInstalls('pkg', '1.0.0')).toBe(2); // b1 and b2 only.
  });

  it('clears events', () => {
    store.record({ type: 'install_success', packageName: 'p', packageVersion: '1', bucketId: 'b', timestamp: new Date().toISOString(), authenticated: true });
    store.clear();
    expect(store.list().length).toBe(0);
  });
});
