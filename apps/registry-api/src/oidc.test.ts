import { describe, expect, it } from 'vitest';
import { MockOidcVerifier, verifyTrustedPublisher, type OidcClaims } from './oidc.js';

describe('MockOidcVerifier', () => {
  it('returns pre-configured claims', async () => {
    const claims: OidcClaims = {
      issuer: 'https://github.com',
      subject: 'repo:owner/repo:workflow:publish',
      audience: 'safe-npm',
      expiresAt: Date.now() / 1000 + 3600,
      repository: 'owner/repo',
      workflow: 'publish.yml',
      environment: 'production',
    };
    const verifier = new MockOidcVerifier(claims);
    const result = await verifier.verify('test-token');
    expect(result).toEqual(claims);
  });
});

describe('verifyTrustedPublisher', () => {
  const validClaims: OidcClaims = {
    issuer: 'https://github.com',
    subject: 'repo:owner/repo:workflow:publish',
    audience: 'safe-npm',
    expiresAt: Date.now() / 1000 + 3600,
    repository: 'owner/repo',
    workflow: 'publish.yml',
    environment: 'production',
  };

  // Mock DB with trusted publisher configs.
  function mockDb(configs: Array<Record<string, unknown>>) {
    return {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(configs),
        }),
      }),
    } as unknown as import('@safe-npm/db').DbClient;
  }

  it('verifies when OIDC claims match a trusted publisher config', async () => {
    const db = mockDb([{
      id: 'tp-1',
      packageId: null,
      provider: 'github-actions',
      repository: 'owner/repo',
      workflow: 'publish.yml',
      environment: 'production',
      allowedActions: ['publish', 'stage'],
      createdAt: new Date(),
    }]);
    const verifier = new MockOidcVerifier(validClaims);
    const result = await verifyTrustedPublisher('token', verifier, db);
    expect(result.verified).toBe(true);
    expect(result.matchedConfig?.repository).toBe('owner/repo');
  });

  it('rejects when repository does not match', async () => {
    const db = mockDb([{
      id: 'tp-1',
      packageId: null,
      provider: 'github-actions',
      repository: 'different/repo',
      workflow: 'publish.yml',
      environment: 'production',
      allowedActions: ['publish'],
      createdAt: new Date(),
    }]);
    const verifier = new MockOidcVerifier(validClaims);
    const result = await verifyTrustedPublisher('token', verifier, db);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('no matching');
  });

  it('rejects when workflow does not match', async () => {
    const db = mockDb([{
      id: 'tp-1',
      packageId: null,
      provider: 'github-actions',
      repository: 'owner/repo',
      workflow: 'different.yml',
      environment: 'production',
      allowedActions: ['publish'],
      createdAt: new Date(),
    }]);
    const verifier = new MockOidcVerifier(validClaims);
    const result = await verifyTrustedPublisher('token', verifier, db);
    expect(result.verified).toBe(false);
  });

  it('rejects expired tokens', async () => {
    const expiredClaims: OidcClaims = {
      ...validClaims,
      expiresAt: Date.now() / 1000 - 3600, // expired 1 hour ago.
    };
    const db = mockDb([{
      id: 'tp-1',
      provider: 'github-actions',
      repository: 'owner/repo',
      allowedActions: ['publish'],
      createdAt: new Date(),
    }]);
    const verifier = new MockOidcVerifier(expiredClaims);
    const result = await verifyTrustedPublisher('token', verifier, db);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('rejects unknown OIDC issuers', async () => {
    const unknownClaims: OidcClaims = {
      ...validClaims,
      issuer: 'https://unknown-provider.com',
    };
    const db = mockDb([]);
    const verifier = new MockOidcVerifier(unknownClaims);
    const result = await verifyTrustedPublisher('token', verifier, db);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('unknown OIDC issuer');
  });

  it('rejects when no trusted publisher configs exist', async () => {
    const db = mockDb([]);
    const verifier = new MockOidcVerifier(validClaims);
    const result = await verifyTrustedPublisher('token', verifier, db);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('no trusted publisher configs');
  });
});
