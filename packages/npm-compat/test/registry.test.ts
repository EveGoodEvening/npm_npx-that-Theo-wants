import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVersion, encodePackageName, type Packument } from '../src/registry.js';
import { parsePackageSpec } from '../src/spec.js';

const fixturePackument: Packument = {
  name: 'is-odd',
  'dist-tags': { latest: '3.0.1', next: '3.1.0-beta.0' },
  versions: {
    '2.0.0': { name: 'is-odd', version: '2.0.0', dist: { tarball: 'https://x/is-odd-2.0.0.tgz' } },
    '3.0.0': { name: 'is-odd', version: '3.0.0', dist: { tarball: 'https://x/is-odd-3.0.0.tgz' } },
    '3.0.1': { name: 'is-odd', version: '3.0.1', dist: { tarball: 'https://x/is-odd-3.0.1.tgz' } },
    '3.1.0-beta.0': {
      name: 'is-odd',
      version: '3.1.0-beta.0',
      dist: { tarball: 'https://x/is-odd-3.1.0-beta.0.tgz' },
    },
  },
};

describe('resolveVersion', () => {
  test('bare name resolves to latest dist-tag', () => {
    const spec = parsePackageSpec('is-odd');
    const { version } = resolveVersion(fixturePackument, spec);
    assert.equal(version, '3.0.1');
  });

  test('dist-tag resolves', () => {
    const spec = parsePackageSpec('is-odd@next');
    const { version } = resolveVersion(fixturePackument, spec);
    assert.equal(version, '3.1.0-beta.0');
  });

  test('exact version resolves', () => {
    const spec = parsePackageSpec('is-odd@2.0.0');
    const { version } = resolveVersion(fixturePackument, spec);
    assert.equal(version, '2.0.0');
  });

  test('caret range resolves to highest satisfying', () => {
    const spec = parsePackageSpec('is-odd@^3.0.0');
    const { version } = resolveVersion(fixturePackument, spec);
    assert.equal(version, '3.0.1');
  });

  test('range excluding pre-releases', () => {
    const spec = parsePackageSpec('is-odd@~3.0.0');
    const { version } = resolveVersion(fixturePackument, spec);
    assert.equal(version, '3.0.1');
  });

  test('unsatisfiable range throws', () => {
    const spec = parsePackageSpec('is-odd@^99.0.0');
    assert.throws(() => resolveVersion(fixturePackument, spec), /no version/);
  });

  test('unknown dist-tag throws', () => {
    const spec = parsePackageSpec('is-odd@nonexistent');
    assert.throws(() => resolveVersion(fixturePackument, spec), /dist-tag/);
  });
});

describe('encodePackageName', () => {
  test('unscoped name', () => {
    assert.equal(encodePackageName('is-odd'), 'is-odd');
  });
  test('scoped name encodes slash', () => {
    assert.equal(encodePackageName('@scope/pkg'), '@scope%2fpkg');
  });
});
