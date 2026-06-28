import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  levenshtein,
  jaroWinkler,
  computeNameRisk,
  nameGate,
  DEFAULT_POPULAR_CORPUS,
} from '../src/namerisk.js';

describe('normalizeName', () => {
  test('strips scope and lowercases', () => {
    assert.equal(normalizeName('@scope/IsOdd'), 'isodd');
  });
  test('collapses punctuation', () => {
    assert.equal(normalizeName('is-odd'), 'isodd');
    assert.equal(normalizeName('is.odd'), 'isodd');
    assert.equal(normalizeName('is_odd'), 'isodd');
  });
  test('applies confusable substitutions', () => {
    assert.equal(normalizeName('is-0dd'), 'isodd');
    assert.equal(normalizeName('l0dash'), 'lodash');
  });
});

describe('levenshtein', () => {
  test('identical strings', () => {
    assert.equal(levenshtein('abc', 'abc'), 0);
  });
  test('one edit', () => {
    assert.equal(levenshtein('isodd', 'is0dd'), 1);
  });
  test('empty', () => {
    assert.equal(levenshtein('', 'abc'), 3);
  });
});

describe('jaroWinkler', () => {
  test('identical strings = 1', () => {
    assert.equal(jaroWinkler('isodd', 'isodd'), 1);
  });
  test('similar strings high score', () => {
    assert.ok(jaroWinkler('isodd', 'is0dd') > 0.8);
  });
});

describe('computeNameRisk', () => {
  test('is-0dd flagged as similar to is-odd', () => {
    const result = computeNameRisk({ packageName: 'is-0dd', isNewPackage: true });
    assert.ok(result.similarTo.includes('is-odd'), `similarTo: ${result.similarTo.join(',')}`);
    assert.ok(result.typosquatConfidence >= 0.6);
    assert.ok(['warn', 'block'].includes(result.action));
  });

  test('benign name not flagged', () => {
    const result = computeNameRisk({ packageName: 'totally-unique-name-xyz' });
    assert.equal(result.similarTo.length, 0);
    assert.equal(result.action, 'allow');
    assert.equal(result.score, 100);
  });

  test('high-confidence typosquat blocks', () => {
    // l0dash -> lodash (1 edit, popular rank 1)
    const result = computeNameRisk({ packageName: 'l0dash', isNewPackage: true });
    assert.ok(result.typosquatConfidence >= 0.9);
    assert.equal(result.action, 'block');
    assert.ok(result.findings.some((f) => f.code === 'TYPOSQUAT_HIGH_CONFIDENCE'));
  });

  test('author mismatch increases confidence', () => {
    const without = computeNameRisk({ packageName: 'is-0dd', isNewPackage: true });
    const withMismatch = computeNameRisk({
      packageName: 'is-0dd',
      isNewPackage: true,
      authorMismatch: true,
    });
    assert.ok(withMismatch.typosquatConfidence >= without.typosquatConfidence);
  });

  test('provenance reduces confidence', () => {
    const without = computeNameRisk({ packageName: 'is-0dd', isNewPackage: true });
    const withProv = computeNameRisk({
      packageName: 'is-0dd',
      isNewPackage: true,
      hasProvenance: true,
    });
    assert.ok(withProv.typosquatConfidence <= without.typosquatConfidence);
  });

  test('custom corpus used when provided', () => {
    const result = computeNameRisk({
      packageName: 'myapp-typo',
      corpus: [{ name: 'myapp', rank: 1 }],
      isNewPackage: true,
    });
    assert.ok(result.similarTo.includes('myapp'));
  });
});

describe('nameGate', () => {
  test('block on high-confidence typosquat', () => {
    const { decision } = nameGate({ packageName: 'l0dash', isNewPackage: true });
    assert.equal(decision, 'block');
  });

  test('require_review on medium-confidence', () => {
    const { decision } = nameGate({ packageName: 'is-0dd', isNewPackage: true });
    assert.ok(['require_review', 'block'].includes(decision));
  });

  test('allow on benign', () => {
    const { decision } = nameGate({ packageName: 'unique-xyz' });
    assert.equal(decision, 'allow');
  });
});

describe('DEFAULT_POPULAR_CORPUS', () => {
  test('contains is-odd', () => {
    assert.ok(DEFAULT_POPULAR_CORPUS.some((p) => p.name === 'is-odd'));
  });
});
