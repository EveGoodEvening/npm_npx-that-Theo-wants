import { describe, expect, it } from 'vitest';
import { parseProvenance, validateProvenance, provenanceScoreBonus, type ProvenanceMetadata } from './provenance.js';

describe('parseProvenance', () => {
  it('parses valid provenance metadata', () => {
    const provenanceField = {
      provenance: {
        metadata: {
          subjectDigest: 'sha512:abc123',
          materials: [{ uri: 'https://github.com/owner/repo' }],
          buildStartedOn: 'abc123',
        },
        builder: { id: 'https://github.com/actions/runner' },
      },
    };
    const result = parseProvenance(provenanceField);
    expect(result).not.toBeNull();
    expect(result?.subjectDigest).toBe('sha512:abc123');
    expect(result?.sourceRepo).toBe('https://github.com/owner/repo');
    expect(result?.builder).toBe('https://github.com/actions/runner');
  });

  it('returns null for missing provenance', () => {
    expect(parseProvenance(undefined)).toBeNull();
    expect(parseProvenance(null)).toBeNull();
    expect(parseProvenance('not-an-object')).toBeNull();
  });

  it('returns null for malformed provenance', () => {
    expect(parseProvenance({})).toBeNull();
    expect(parseProvenance({ provenance: {} })).toBeNull();
  });
});

describe('validateProvenance', () => {
  const validProvenance: ProvenanceMetadata = {
    subjectDigest: 'sha512:abc123',
    sourceRepo: 'https://github.com/owner/repo',
    sourceCommit: 'abc123',
    builder: 'https://github.com/actions/runner',
  };

  it('returns verified when digest matches', () => {
    const result = validateProvenance(validProvenance, 'sha512:abc123');
    expect(result.status).toBe('verified');
    expect(result.sourceRepo).toBe('https://github.com/owner/repo');
  });

  it('returns mismatch when digest does not match', () => {
    const result = validateProvenance(validProvenance, 'sha512:wrong');
    expect(result.status).toBe('mismatch');
    expect(result.mismatchReason).toContain('does not match');
  });

  it('returns mismatch when subject digest is missing', () => {
    const result = validateProvenance({ ...validProvenance, subjectDigest: undefined }, 'sha512:abc123');
    expect(result.status).toBe('mismatch');
    expect(result.mismatchReason).toContain('missing subject digest');
  });

  it('returns mismatch when source repo does not match', () => {
    const result = validateProvenance(validProvenance, 'sha512:abc123', 'https://github.com/different/repo');
    expect(result.status).toBe('mismatch');
    expect(result.mismatchReason).toContain('does not match package metadata');
  });

  it('returns verified when source repo matches (with normalization)', () => {
    const result = validateProvenance(
      { ...validProvenance, sourceRepo: 'git+https://github.com/owner/repo.git' },
      'sha512:abc123',
      'https://github.com/owner/repo',
    );
    expect(result.status).toBe('verified');
  });
});

describe('provenanceScoreBonus', () => {
  it('returns +10 for verified', () => {
    expect(provenanceScoreBonus('verified')).toBe(10);
  });

  it('returns 0 for missing', () => {
    expect(provenanceScoreBonus('missing')).toBe(0);
  });

  it('returns -20 for mismatch', () => {
    expect(provenanceScoreBonus('mismatch')).toBe(-20);
  });

  it('returns 0 for unsupported', () => {
    expect(provenanceScoreBonus('unsupported')).toBe(0);
  });
});
