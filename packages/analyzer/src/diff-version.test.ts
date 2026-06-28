import { describe, expect, it } from 'vitest';
import { findPreviousVersion, type VersionInfo } from './diff-version.js';

describe('findPreviousVersion', () => {
  const versions: VersionInfo[] = [
    { version: '1.0.0', status: 'public' },
    { version: '1.1.0', status: 'public' },
    { version: '2.0.0', status: 'public' },
    { version: '2.1.0', status: 'public' },
    { version: '3.0.0-beta.1', status: 'public' },
  ];

  it('finds the highest version lower than current', () => {
    const result = findPreviousVersion('2.1.0', versions);
    expect(result?.version).toBe('2.0.0');
  });

  it('finds previous for 1.1.0', () => {
    const result = findPreviousVersion('1.1.0', versions);
    expect(result?.version).toBe('1.0.0');
  });

  it('returns null when no lower version exists', () => {
    const result = findPreviousVersion('1.0.0', versions);
    expect(result).toBeNull();
  });

  it('falls back to latest dist-tag when no lower semver exists', () => {
    const result = findPreviousVersion('0.9.0', versions, { latestVersion: '2.1.0' });
    expect(result?.version).toBe('2.1.0');
  });

  it('ignores retracted/quarantined versions by default', () => {
    const vers: VersionInfo[] = [
      { version: '1.0.0', status: 'public' },
      { version: '1.1.0', status: 'retracted' },
      { version: '2.0.0', status: 'public' },
    ];
    const result = findPreviousVersion('2.0.0', vers);
    expect(result?.version).toBe('1.0.0');
  });

  it('includes retracted/quarantined in forensic mode', () => {
    const vers: VersionInfo[] = [
      { version: '1.0.0', status: 'public' },
      { version: '1.1.0', status: 'retracted' },
      { version: '2.0.0', status: 'public' },
    ];
    const result = findPreviousVersion('2.0.0', vers, { forensicMode: true });
    expect(result?.version).toBe('1.1.0');
  });

  it('excludes the current version from candidates', () => {
    const result = findPreviousVersion('2.0.0', versions);
    expect(result?.version).not.toBe('2.0.0');
  });
});
