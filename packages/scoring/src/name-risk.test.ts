import { describe, expect, it } from 'vitest';
import { editDistance, jaroWinkler, computeNameRisk } from './name-risk.js';
import { PopularPackageCorpus } from './name-corpus.js';

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('hello', 'hello')).toBe(0);
  });

  it('returns length for empty string', () => {
    expect(editDistance('', 'hello')).toBe(5);
    expect(editDistance('hello', '')).toBe(5);
  });

  it('computes single substitution', () => {
    expect(editDistance('is-odd', 'is-0dd')).toBe(1);
  });

  it('computes single insertion', () => {
    expect(editDistance('cat', 'cats')).toBe(1);
  });

  it('computes single deletion', () => {
    expect(editDistance('cats', 'cat')).toBe(1);
  });
});

describe('jaroWinkler', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1);
  });

  it('returns high similarity for close matches', () => {
    expect(jaroWinkler('is-odd', 'is-0dd')).toBeGreaterThan(0.9);
  });

  it('returns lower similarity for different strings', () => {
    expect(jaroWinkler('react', 'angular')).toBeLessThan(0.7);
  });
});

describe('computeNameRisk', () => {
  const corpus = new PopularPackageCorpus();

  it('returns no risk for popular packages', () => {
    const result = computeNameRisk('react', corpus);
    expect(result.isTyposquat).toBe(false);
    expect(result.confidence).toBe('none');
    expect(result.deduction).toBe(0);
  });

  it('flags is-0dd as similar to is-odd (Definition of done)', () => {
    const result = computeNameRisk('is-0dd', corpus);
    expect(result.isTyposquat).toBe(true);
    expect(result.similarTo).toBe('is-odd');
    expect(result.confidence).toBe('high');
    expect(result.deduction).toBe(40);
  });

  it('flags 1odash as similar to lodash', () => {
    const result = computeNameRisk('1odash', corpus);
    expect(result.isTyposquat).toBe(true);
    expect(result.similarTo).toBe('lodash');
  });

  it('flags is_odd as similar to is-odd', () => {
    const result = computeNameRisk('is_odd', corpus);
    expect(result.isTyposquat).toBe(true);
    expect(result.similarTo).toBe('is-odd');
  });

  it('returns low risk for unrelated names', () => {
    const result = computeNameRisk('completely-unrelated-name', corpus);
    expect(result.isTyposquat).toBe(false);
    expect(result.confidence).toBe('none');
    expect(result.deduction).toBe(0);
  });

  it('handles scoped packages', () => {
    const result = computeNameRisk('@scope/react', corpus);
    // Scoped packages are compared only within the same scope.
    // Since no popular package has @scope, this should be low risk.
    expect(result.isTyposquat).toBe(false);
  });
});
