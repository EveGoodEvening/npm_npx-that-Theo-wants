import { describe, expect, it } from 'vitest';
import { PopularPackageCorpus, DEFAULT_POPULAR_PACKAGES } from './name-corpus.js';

describe('PopularPackageCorpus', () => {
  it('checks if a package is popular', () => {
    const corpus = new PopularPackageCorpus();
    expect(corpus.isPopular('react')).toBe(true);
    expect(corpus.isPopular('REACT')).toBe(true); // case-insensitive
    expect(corpus.isPopular('nonexistent-pkg')).toBe(false);
  });

  it('gets a package by name', () => {
    const corpus = new PopularPackageCorpus();
    const pkg = corpus.get('react');
    expect(pkg).toBeTruthy();
    expect(pkg?.name).toBe('react');
    expect(pkg?.rank).toBe(1);
  });

  it('lists all packages sorted by rank', () => {
    const corpus = new PopularPackageCorpus();
    const list = corpus.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].rank).toBeLessThanOrEqual(list[1].rank);
  });

  it('upserts a new package', () => {
    const corpus = new PopularPackageCorpus([]);
    expect(corpus.isPopular('test-pkg')).toBe(false);
    corpus.upsert({ name: 'test-pkg', rank: 100, weeklyDownloads: 1000 });
    expect(corpus.isPopular('test-pkg')).toBe(true);
  });

  it('scheduledUpdate is a no-op placeholder', async () => {
    const corpus = new PopularPackageCorpus();
    await expect(corpus.scheduledUpdate()).resolves.toBeUndefined();
  });
});

describe('DEFAULT_POPULAR_PACKAGES', () => {
  it('includes is-odd for typosquat testing', () => {
    expect(DEFAULT_POPULAR_PACKAGES.some((p) => p.name === 'is-odd')).toBe(true);
  });
});
