import { describe, expect, it } from 'vitest';
import { normalizeName, splitScope } from './name-normalize.js';

describe('normalizeName', () => {
  it('lowercases the name', () => {
    expect(normalizeName('React')).toBe('react');
    expect(normalizeName('IS-ODD')).toBe('is-odd');
  });

  it('replaces 0 with o', () => {
    expect(normalizeName('is-0dd')).toBe('is-odd');
  });

  it('replaces 1 with l', () => {
    expect(normalizeName('1odash')).toBe('lodash');
  });

  it('replaces _ with -', () => {
    expect(normalizeName('is_odd')).toBe('is-odd');
  });

  it('replaces . with -', () => {
    expect(normalizeName('is.odd')).toBe('is-odd');
  });

  it('strips punctuation variants', () => {
    expect(normalizeName('react!')).toBe('react');
    expect(normalizeName('react#')).toBe('react');
  });

  it('normalizes Cyrillic confusables', () => {
    // Cyrillic 'а' (U+0430) should be normalized to Latin 'a'
    expect(normalizeName('reаct')).toBe('react');
  });

  it('preserves scope separator', () => {
    expect(normalizeName('@scope/pkg')).toBe('@scope/pkg');
  });
});

describe('splitScope', () => {
  it('extracts scope from scoped package', () => {
    const result = splitScope('@scope/pkg');
    expect(result.scope).toBe('@scope');
    expect(result.name).toBe('pkg');
  });

  it('returns undefined scope for unscoped package', () => {
    const result = splitScope('react');
    expect(result.scope).toBeUndefined();
    expect(result.name).toBe('react');
  });

  it('handles malformed scope', () => {
    const result = splitScope('@scope');
    expect(result.scope).toBeUndefined();
    expect(result.name).toBe('@scope');
  });
});
