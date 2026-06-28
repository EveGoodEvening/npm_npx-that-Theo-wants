import { describe, expect, it, vi } from 'vitest';
import { extractRepoUrl, normalizeRepoUrl, lookupScorecard, repoHealthScore } from './repo-health.js';

describe('extractRepoUrl', () => {
  it('extracts URL from string', () => {
    expect(extractRepoUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
  });

  it('extracts URL from object', () => {
    expect(extractRepoUrl({ type: 'git', url: 'https://github.com/owner/repo' })).toBe('https://github.com/owner/repo');
  });

  it('returns undefined for missing repo', () => {
    expect(extractRepoUrl(undefined)).toBeUndefined();
  });
});

describe('normalizeRepoUrl', () => {
  it('normalizes git+https:// prefix', () => {
    const result = normalizeRepoUrl('git+https://github.com/owner/repo.git');
    expect(result.platform).toBe('github');
    expect(result.normalizedUrl).toBe('https://github.com/owner/repo');
  });

  it('normalizes ssh://git@ prefix', () => {
    const result = normalizeRepoUrl('ssh://git@github.com/owner/repo.git');
    expect(result.platform).toBe('github');
    expect(result.normalizedUrl).toBe('https://github.com/owner/repo');
  });

  it('normalizes git@ prefix', () => {
    const result = normalizeRepoUrl('git@github.com:owner/repo.git');
    expect(result.platform).toBe('github');
    expect(result.normalizedUrl).toBe('https://github.com/owner/repo');
  });

  it('detects gitlab platform', () => {
    const result = normalizeRepoUrl('https://gitlab.com/owner/repo');
    expect(result.platform).toBe('gitlab');
  });

  it('detects bitbucket platform', () => {
    const result = normalizeRepoUrl('https://bitbucket.org/owner/repo');
    expect(result.platform).toBe('bitbucket');
  });

  it('returns other for unknown platforms', () => {
    const result = normalizeRepoUrl('https://example.com/owner/repo');
    expect(result.platform).toBe('other');
  });
});

describe('lookupScorecard', () => {
  it('returns scorecard data for GitHub repos', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ score: 7.5, grade: 'B' }),
    });
    const result = await lookupScorecard('https://github.com/owner/repo', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.scorecardScore).toBe(7.5);
    expect(result.scorecardGrade).toBe('B');
  });

  it('returns neutral result for non-GitHub repos', async () => {
    const result = await lookupScorecard('https://gitlab.com/owner/repo');
    expect(result.platform).toBe('gitlab');
    expect(result.scorecardScore).toBeUndefined();
  });

  it('handles API errors gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await lookupScorecard('https://github.com/owner/repo', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.error).toBeTruthy();
    expect(result.scorecardScore).toBeUndefined();
  });
});

describe('repoHealthScore', () => {
  it('returns scaled score for valid scorecard data', () => {
    expect(repoHealthScore({ url: '', platform: 'github', normalizedUrl: '', scorecardScore: 8 })).toBe(80);
  });

  it('returns 50 for missing scorecard data', () => {
    expect(repoHealthScore({ url: '', platform: 'github', normalizedUrl: '', error: 'no data' })).toBe(50);
  });

  it('caps at 100', () => {
    expect(repoHealthScore({ url: '', platform: 'github', normalizedUrl: '', scorecardScore: 15 })).toBe(100);
  });
});
