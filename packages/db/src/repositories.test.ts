import { describe, expect, it } from 'vitest';
import { AuthTokensRepository } from '../src/index.js';

describe('AuthTokensRepository.hashToken', () => {
  it('produces a sha256-prefixed hash', () => {
    const hash = AuthTokensRepository.hashToken('my-secret-token');
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(AuthTokensRepository.hashToken('token-x')).toBe(AuthTokensRepository.hashToken('token-x'));
  });

  it('produces different hashes for different tokens', () => {
    expect(AuthTokensRepository.hashToken('a')).not.toBe(AuthTokensRepository.hashToken('b'));
  });
});
