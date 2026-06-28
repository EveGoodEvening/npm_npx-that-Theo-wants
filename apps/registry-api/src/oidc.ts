/**
 * OIDC trusted publisher verification (design 16.3).
 *
 * Verifies OIDC tokens from CI/CD providers (GitHub Actions, GitLab CI)
 * against trusted publisher configurations.
 */
import { schema, type DbClient } from '@safe-npm/db';
import { eq } from 'drizzle-orm';

export interface OidcClaims {
  /** Token issuer. */
  issuer: string;
  /** Subject (workflow identity). */
  subject: string;
  /** Audience. */
  audience: string;
  /** Expiry time. */
  expiresAt: number;
  /** Provider-specific claims. */
  repository?: string;
  workflow?: string;
  environment?: string;
  actor?: string;
  ref?: string;
  sha?: string;
}

export interface TrustedPublisherConfig {
  provider: string;
  repository: string;
  workflow?: string;
  environment?: string;
  allowedActions: string[];
}

export interface OidcVerificationResult {
  verified: boolean;
  claims?: OidcClaims;
  matchedConfig?: TrustedPublisherConfig;
  reason?: string;
}

/**
 * OIDC token verifier interface.
 * In production, this would verify JWT signatures against the provider's JWKS.
 */
export interface OidcVerifier {
  verify(token: string): Promise<OidcClaims | null>;
}

/**
 * Mock OIDC verifier for testing.
 * Accepts pre-configured claims without signature verification.
 */
export class MockOidcVerifier implements OidcVerifier {
  constructor(private claims: OidcClaims) {}

  async verify(_token: string): Promise<OidcClaims | null> {
    return this.claims;
  }
}

/**
 * Verify an OIDC token against trusted publisher configurations.
 */
export async function verifyTrustedPublisher(
  token: string,
  verifier: OidcVerifier,
  db: DbClient,
): Promise<OidcVerificationResult> {
  const claims = await verifier.verify(token);
  if (!claims) {
    return { verified: false, reason: 'OIDC token verification failed' };
  }

  // Check expiry.
  if (claims.expiresAt < Date.now() / 1000) {
    return { verified: false, claims, reason: 'OIDC token expired' };
  }

  // Map issuer to provider name.
  const provider = issuerToProvider(claims.issuer);
  if (!provider) {
    return { verified: false, claims, reason: `unknown OIDC issuer: ${claims.issuer}` };
  }

  // Look up trusted publisher configs.
  const configs = await db.select().from(schema.trustedPublishers)
    .where(eq(schema.trustedPublishers.provider, provider));

  if (configs.length === 0) {
    return { verified: false, claims, reason: 'no trusted publisher configs for provider' };
  }

  // Match against repository, workflow, environment.
  for (const config of configs) {
    const matched = matchConfig(config, claims);
    if (matched) {
      return {
        verified: true,
        claims,
        matchedConfig: {
          provider: config.provider,
          repository: config.repository,
          workflow: config.workflow ?? undefined,
          environment: config.environment ?? undefined,
          allowedActions: (config.allowedActions as string[]) ?? [],
        },
      };
    }
  }

  return { verified: false, claims, reason: 'no matching trusted publisher config' };
}

function issuerToProvider(issuer: string): string | null {
  if (issuer.includes('github.com')) return 'github-actions';
  if (issuer.includes('gitlab.com')) return 'gitlab-ci';
  return null;
}

function matchConfig(
  config: typeof schema.trustedPublishers.$inferSelect,
  claims: OidcClaims,
): boolean {
  if (config.repository !== claims.repository) return false;
  if (config.workflow && config.workflow !== claims.workflow) return false;
  if (config.environment && config.environment !== claims.environment) return false;
  return true;
}
