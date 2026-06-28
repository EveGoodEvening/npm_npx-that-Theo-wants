import { describe, expect, it } from 'vitest';
import { generatePackument, tarballFileName, type InternalPackage } from '../src/index.js';

function makePackage(): InternalPackage {
  return {
    name: '@scope/pkg',
    scope: '@scope',
    distTags: [
      { tag: 'latest', version: '1.2.3', publishId: 'pub-123' },
      { tag: 'next', version: '1.2.4', publishId: 'pub-124' },
    ],
    versions: [
      {
        version: '1.2.2',
        publishId: 'pub-122',
        status: 'public',
        tarballUrl: 'https://registry.example.com/@scope/pkg/-/pkg-1.2.2.tgz',
        integrity: 'sha512-old',
        shasum: 'aaa',
        unpackedSize: 1000,
        fileCount: 5,
        metadata: { main: 'index.js', license: 'MIT' },
      },
      {
        version: '1.2.3',
        publishId: 'pub-123',
        status: 'public',
        tarballUrl: 'https://registry.example.com/@scope/pkg/-/pkg-1.2.3.tgz',
        integrity: 'sha512-new',
        shasum: 'bbb',
        unpackedSize: 1200,
        fileCount: 6,
        signatures: [{ keyid: 'key1', sig: 'sig1' }],
        metadata: { main: 'index.js', license: 'MIT' },
      },
      {
        version: '1.2.4',
        publishId: 'pub-124',
        status: 'staged_public',
        tarballUrl: 'https://registry.example.com/@scope/pkg/-/pkg-1.2.4.tgz',
        integrity: 'sha512-next',
        metadata: { main: 'index.js', license: 'MIT' },
      },
      {
        version: '1.0.0',
        publishId: 'pub-100',
        status: 'retracted',
        tarballUrl: 'https://registry.example.com/@scope/pkg/-/pkg-1.0.0.tgz',
        integrity: 'sha512-retracted',
        metadata: { main: 'index.js' },
      },
      {
        version: '0.9.0',
        publishId: 'pub-090',
        status: 'deprecated',
        deprecated: 'use 1.x',
        tarballUrl: 'https://registry.example.com/@scope/pkg/-/pkg-0.9.0.tgz',
        integrity: 'sha512-dep',
        metadata: { main: 'index.js' },
      },
      {
        version: '0.1.0',
        publishId: 'pub-010',
        status: 'quarantined',
        tarballUrl: 'https://registry.example.com/@scope/pkg/-/pkg-0.1.0.tgz',
        integrity: 'sha512-quar',
        metadata: { main: 'index.js' },
      },
    ],
    time: { created: '2020-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
    maintainers: [{ name: 'alice', email: 'alice@example.com' }],
  };
}

describe('generatePackument', () => {
  it('includes dist-tags pointing to visible versions', () => {
    const p = generatePackument(makePackage());
    expect(p['dist-tags']?.latest).toBe('1.2.3');
    expect(p['dist-tags']?.next).toBe('1.2.4');
  });

  it('excludes retracted and quarantined versions by default', () => {
    const p = generatePackument(makePackage());
    expect(Object.keys(p.versions ?? {}).sort()).toEqual(
      ['0.9.0', '1.2.2', '1.2.3', '1.2.4'].sort(),
    );
  });

  it('includes retracted versions when includeRetracted is set', () => {
    const p = generatePackument(makePackage(), { includeRetracted: true });
    expect(p.versions?.['1.0.0']).toBeDefined();
    // quarantined is still excluded
    expect(p.versions?.['0.1.0']).toBeUndefined();
  });

  it('includes deprecation warnings for deprecated versions', () => {
    const p = generatePackument(makePackage());
    expect(p.versions?.['0.9.0']?.deprecated).toBe('use 1.x');
  });

  it('includes dist.tarball, integrity, shasum, and signatures', () => {
    const p = generatePackument(makePackage());
    const v = p.versions?.['1.2.3'];
    expect(v?.dist?.tarball).toBe('https://registry.example.com/@scope/pkg/-/pkg-1.2.3.tgz');
    expect(v?.dist?.integrity).toBe('sha512-new');
    expect(v?.dist?.shasum).toBe('bbb');
    expect(v?.dist?.unpackedSize).toBe(1200);
    expect(v?.dist?.fileCount).toBe(6);
    expect(v?.dist?.signatures).toEqual([{ keyid: 'key1', sig: 'sig1' }]);
  });

  it('omits signatures when absent', () => {
    const p = generatePackument(makePackage());
    expect(p.versions?.['1.2.2']?.dist?.signatures).toBeUndefined();
  });

  it('removes dist-tags whose target version is not visible', () => {
    const pkg = makePackage();
    pkg.distTags = [{ tag: 'latest', version: '1.0.0', publishId: 'pub-100' }];
    const p = generatePackument(pkg);
    expect(p['dist-tags']?.latest).toBeUndefined();
  });

  it('snapshot matches', () => {
    expect(generatePackument(makePackage())).toMatchInlineSnapshot(`
      {
        "dist-tags": {
          "latest": "1.2.3",
          "next": "1.2.4",
        },
        "maintainers": [
          {
            "email": "alice@example.com",
            "name": "alice",
          },
        ],
        "name": "@scope/pkg",
        "time": {
          "created": "2020-01-01T00:00:00.000Z",
          "modified": "2026-01-01T00:00:00.000Z",
        },
        "versions": {
          "0.9.0": {
            "deprecated": "use 1.x",
            "dist": {
              "integrity": "sha512-dep",
              "tarball": "https://registry.example.com/@scope/pkg/-/pkg-0.9.0.tgz",
            },
            "main": "index.js",
            "name": "@scope/pkg",
            "version": "0.9.0",
          },
          "1.2.2": {
            "dist": {
              "fileCount": 5,
              "integrity": "sha512-old",
              "shasum": "aaa",
              "tarball": "https://registry.example.com/@scope/pkg/-/pkg-1.2.2.tgz",
              "unpackedSize": 1000,
            },
            "license": "MIT",
            "main": "index.js",
            "name": "@scope/pkg",
            "version": "1.2.2",
          },
          "1.2.3": {
            "dist": {
              "fileCount": 6,
              "integrity": "sha512-new",
              "shasum": "bbb",
              "signatures": [
                {
                  "keyid": "key1",
                  "sig": "sig1",
                },
              ],
              "tarball": "https://registry.example.com/@scope/pkg/-/pkg-1.2.3.tgz",
              "unpackedSize": 1200,
            },
            "license": "MIT",
            "main": "index.js",
            "name": "@scope/pkg",
            "version": "1.2.3",
          },
          "1.2.4": {
            "dist": {
              "integrity": "sha512-next",
              "tarball": "https://registry.example.com/@scope/pkg/-/pkg-1.2.4.tgz",
            },
            "license": "MIT",
            "main": "index.js",
            "name": "@scope/pkg",
            "version": "1.2.4",
          },
        },
      }
    `);
  });
});

describe('tarballFileName', () => {
  it('uses unscoped name and version', () => {
    expect(
      tarballFileName('@scope/pkg', {
        version: '1.2.3',
        publishId: 'p',
        status: 'public',
        tarballUrl: '',
        metadata: {},
      }),
    ).toBe('pkg-1.2.3.tgz');
  });
});
