import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackageSpec, isDistTag, isSemverRange } from '../src/spec.js';

describe('parsePackageSpec', () => {
  test('unscoped bare name', () => {
    const s = parsePackageSpec('is-odd');
    assert.equal(s.name, 'is-odd');
    assert.equal(s.specifier, undefined);
    assert.equal(s.source, 'registry');
  });

  test('scoped bare name', () => {
    const s = parsePackageSpec('@scope/pkg');
    assert.equal(s.name, '@scope/pkg');
    assert.equal(s.specifier, undefined);
    assert.equal(s.source, 'registry');
  });

  test('unscoped exact version', () => {
    const s = parsePackageSpec('is-odd@3.0.1');
    assert.equal(s.name, 'is-odd');
    assert.equal(s.specifier, '3.0.1');
    assert.equal(s.source, 'registry');
  });

  test('scoped with range', () => {
    const s = parsePackageSpec('@scope/pkg@^1.0.0');
    assert.equal(s.name, '@scope/pkg');
    assert.equal(s.specifier, '^1.0.0');
    assert.equal(s.source, 'registry');
  });

  test('dist-tag specifier', () => {
    const s = parsePackageSpec('is-odd@latest');
    assert.equal(s.specifier, 'latest');
    assert.equal(s.source, 'registry');
  });

  test('git source', () => {
    const s = parsePackageSpec('git+https://github.com/u/r.git');
    assert.equal(s.source, 'git');
  });

  test('github shorthand source', () => {
    const s = parsePackageSpec('github:user/repo');
    assert.equal(s.source, 'git');
    assert.equal(s.name, 'repo');
  });

  test('remote tarball source', () => {
    const s = parsePackageSpec('https://example.com/pkg.tgz');
    assert.equal(s.source, 'remote');
  });

  test('file source', () => {
    const s = parsePackageSpec('file:./local.tgz');
    assert.equal(s.source, 'file');
  });

  test('directory source', () => {
    const s = parsePackageSpec('./local-pkg');
    assert.equal(s.source, 'directory');
  });

  test('empty spec throws', () => {
    assert.throws(() => parsePackageSpec(''), /empty package specifier/);
  });

  test('invalid name throws', () => {
    assert.throws(() => parsePackageSpec('NOT_VALID_NAME'), /invalid package name/);
  });

  test('strict mode rejects non-registry sources', () => {
    for (const input of [
      'git+https://github.com/u/r.git',
      'github:user/repo',
      'https://example.com/pkg.tgz',
      'file:./local.tgz',
      './local-pkg',
    ]) {
      assert.throws(() => parsePackageSpec(input, { strict: true }), /non-registry source/);
    }
  });

});

describe('spec helpers', () => {
  test('isDistTag', () => {
    assert.equal(isDistTag('latest'), true);
    assert.equal(isDistTag('next'), true);
    assert.equal(isDistTag('1.2.3'), false);
    assert.equal(isDistTag('^1.0.0'), false);
    assert.equal(isDistTag(undefined), false);
  });

  test('isSemverRange', () => {
    assert.equal(isSemverRange('1.2.3'), true);
    assert.equal(isSemverRange('^1.0.0'), true);
    assert.equal(isSemverRange('~2.0.0'), true);
    assert.equal(isSemverRange('latest'), false);
    assert.equal(isSemverRange(undefined), false);
  });
});
