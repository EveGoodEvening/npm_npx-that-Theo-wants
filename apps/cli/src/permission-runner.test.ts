import { describe, expect, it } from 'vitest';
import { buildPermissionFlags, buildNodeFlags, nodeSupportsPermissions, type PermissionReport } from './permission-runner.js';

describe('buildPermissionFlags', () => {
  it('builds flags from permission report', () => {
    const report: PermissionReport = {
      declaredPermissions: {
        fsRead: ['/tmp/input'],
        fsWrite: ['/tmp/output'],
        network: true,
        childProcess: false,
        nativeAddon: false,
      },
    };
    const flags = buildPermissionFlags(report);
    expect(flags.fsReadAllowlist).toEqual(['/tmp/input']);
    expect(flags.fsWriteAllowlist).toEqual(['/tmp/output']);
    expect(flags.network).toBe(true);
    expect(flags.childProcess).toBe(false);
  });

  it('handles empty permission report', () => {
    const flags = buildPermissionFlags({});
    expect(flags.fsReadAllowlist).toBeUndefined();
    expect(flags.network).toBeUndefined();
  });
});

describe('nodeSupportsPermissions', () => {
  it('returns a boolean', () => {
    expect(typeof nodeSupportsPermissions()).toBe('boolean');
  });
});

describe('buildNodeFlags', () => {
  it('returns null when enforcement required but Node too old', () => {
    // This test depends on the Node version running the tests.
    // On Node < 20 with requireEnforcement, it should return null.
    const flags = buildPermissionFlags({
      declaredPermissions: { network: true },
    });
    const result = buildNodeFlags(flags, { requireEnforcement: true });
    if (!nodeSupportsPermissions()) {
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
    }
  });

  it('returns empty array when no enforcement needed and Node too old', () => {
    const flags = buildPermissionFlags({});
    const result = buildNodeFlags(flags, { requireEnforcement: false });
    if (!nodeSupportsPermissions()) {
      expect(result).toEqual([]);
    } else {
      expect(result).toContain('--permission');
    }
  });
});
