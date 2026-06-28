/**
 * Auth MVP (design 7.4).
 *
 * - Local dev login endpoint (POST /v1/auth/login)
 * - Bearer token auth via Fastify hook
 * - Token hashing at rest (SHA-256, handled in AuthTokensRepository)
 * - Token scopes
 * - RBAC guard helper
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuthTokensRepository, UsersRepository, type DbClient } from '@safe-npm/db';

export interface AuthUser {
  userId: string;
  username: string;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyInstance {
    auth?: AuthService;
  }
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const SCOPES = {
  READ: 'read',
  PUBLISH: 'publish',
  ADMIN: 'admin',
  DELETE: 'delete',
} as const;

export class AuthService {
  constructor(private db: DbClient) {}

  /** Validate a bearer token and return the associated user. */
  async validateToken(plaintext: string): Promise<AuthUser | null> {
    const tokensRepo = new AuthTokensRepository(this.db);
    const usersRepo = new UsersRepository(this.db);

    const token = await tokensRepo.findByPlaintext(plaintext);
    if (!token) return null;

    // Check expiry.
    if (token.expiresAt && token.expiresAt < new Date()) return null;

    const user = await usersRepo.findById(token.userId);
    if (!user) return null;

    // Touch last used.
    await tokensRepo.touchLastUsed(token.id);

    return {
      userId: user.id,
      username: user.username,
      scopes: (token.scopes as string[]) ?? [],
    };
  }

  /** Create a token for a user (dev login). */
  async createToken(userId: string, scopes: string[], label?: string): Promise<string> {
    const tokensRepo = new AuthTokensRepository(this.db);
    const plaintext = generateToken();
    await tokensRepo.create({ userId, plaintext, scopes, label });
    return plaintext;
  }
}

/** Generate a random bearer token. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `snp_${Buffer.from(bytes).toString('hex')}`;
}

/**
 * Register auth routes and hooks on a Fastify instance.
 *
 * - POST /v1/auth/login: dev login (returns a bearer token)
 * - Bearer token auth hook: validates Authorization header on protected routes
 */
export async function registerAuth(app: FastifyInstance, db: DbClient): Promise<void> {
  const auth = new AuthService(db);
  app.decorate('auth', auth);

  // Dev login endpoint.
  app.post('/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, token } = request.body as { username?: string; token?: string };

    // In dev mode, accept the configured dev admin token directly.
    const devToken = process.env.SAFE_NPM_DEV_ADMIN_TOKEN ?? 'dev-local-admin-token';
    const devUsername = process.env.SAFE_NPM_DEV_ADMIN_USERNAME ?? 'devadmin';

    if (token === devToken) {
      // Look up or create the dev admin user.
      const usersRepo = new UsersRepository(db);
      let user = await usersRepo.findByUsername(devUsername);
      if (!user) {
        user = await usersRepo.create({ username: devUsername });
      }

      // Create a new session token.
      const sessionToken = await auth.createToken(user.id, [SCOPES.READ, SCOPES.PUBLISH, SCOPES.ADMIN], 'dev-session');
      return { token: sessionToken, user: { id: user.id, username: user.username } };
    }

    // Also accept username-based login for dev (no password in MVP).
    if (username) {
      const usersRepo = new UsersRepository(db);
      let user = await usersRepo.findByUsername(username);
      if (!user) {
        user = await usersRepo.create({ username });
      }
      const sessionToken = await auth.createToken(user.id, [SCOPES.READ], 'dev-session');
      return { token: sessionToken, user: { id: user.id, username: user.username } };
    }

    reply.status(401);
    return { error: 'invalid credentials', statusCode: 401 };
  });

  // Bearer token auth hook — runs on all /v1/* routes except /v1/auth/*.
  // For packument/tarball routes (/:name), auth is optional (public packages
  // don't require it), but if a token is present we validate and populate
  // request.user.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;
    const isV1Route = url.startsWith('/v1/');
    const isAuthRoute = url.startsWith('/v1/auth/');
    const isRegistryRoute = !url.startsWith('/v1/') && !url.startsWith('/health') && !url.startsWith('/ready');

    // Skip auth for /v1/auth/* routes.
    if (isAuthRoute) return;

    // For /v1/* routes (non-auth), auth is required.
    // For registry routes (/:name, /:name/-/:tarball), auth is optional.
    const authHeader = request.headers.authorization;

    if (isV1Route && !isAuthRoute) {
      // Required auth for /v1/* routes.
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401);
        return reply.send({ error: 'missing or invalid authorization header', statusCode: 401, requestId: request.id });
      }
    } else if (isRegistryRoute) {
      // Optional auth for registry routes.
      if (!authHeader || !authHeader.startsWith('Bearer ')) return;
    } else {
      // Non-v1, non-registry routes (health, ready) — skip.
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const user = await auth.validateToken(token);
    if (!user) {
      if (isV1Route) {
        reply.status(401);
        return reply.send({ error: 'invalid or expired token', statusCode: 401, requestId: request.id });
      }
      // For registry routes, invalid token = just don't populate user.
      return;
    }

    request.user = user;
  });
}

/**
 * RBAC guard helper. Use in route handlers to require specific scopes.
 *
 * @example
 * app.get('/v1/protected', { preHandler: requireScopes(SCOPES.ADMIN) }, handler)
 */
export function requireScopes(...requiredScopes: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      reply.status(401);
      return reply.send({ error: 'authentication required', statusCode: 401, requestId: request.id });
    }
    const hasScope = requiredScopes.some((s) => request.user!.scopes.includes(s) || request.user!.scopes.includes(SCOPES.ADMIN));
    if (!hasScope) {
      reply.status(403);
      return reply.send({ error: 'insufficient permissions', statusCode: 403, requestId: request.id });
    }
  };
}
