import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createApp, type AppInstance } from '../src/app.js';
import { generateToken, SCOPES, requireScopes } from '../src/auth.js';

/**
 * API scaffold + auth tests (Section 7.3 + 7.4).
 * Uses a mock db to avoid requiring a live PostgreSQL.
 */

vi.mock('@safe-npm/db', () => {
  const users = new Map();
  const tokens = new Map();
  let userSeq = 0;
  let tokenSeq = 0;

  return {
    createDb: () => ({
      db: {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: () => ({ from: () => ({ where: () => ({ limit: () => [], orderBy: () => ({ limit: () => [] }) }) }) }),
        insert: () => ({ values: () => ({ returning: () => { const id = `user-${++userSeq}`; users.set(id, { id, username: 'devadmin' }); return [{ id, username: 'devadmin' }]; }, onConflictDoNothing: () => {}, onConflictDoUpdate: () => {} }) }),
        update: () => ({ set: () => ({ where: () => {} }) }),
        delete: () => ({ where: () => {} }),
      },
      close: vi.fn(),
    }),
    UsersRepository: vi.fn().mockImplementation(() => ({
      findByUsername: vi.fn(async (u: string) => { for (const [, v] of users) { if (v.username === u) return v; } return null; }),
      findById: vi.fn(async (id: string) => users.get(id) ?? null),
      create: vi.fn(async (data: { username: string }) => { const id = `user-${++userSeq}`; const u = { id, username: data.username }; users.set(id, u); return u; }),
    })),
    OrgsRepository: vi.fn().mockImplementation(() => ({
      findByName: vi.fn(async () => null),
      create: vi.fn(async (data: { name: string }) => ({ id: 'org-1', name: data.name })),
    })),
    MembershipsRepository: vi.fn().mockImplementation(() => ({ create: vi.fn(async () => {}) })),
    AuthTokensRepository: vi.fn().mockImplementation(() => ({
      findByPlaintext: vi.fn(async (pt: string) => {
        const hash = `sha256:${createHash('sha256').update(pt).digest('hex')}`;
        for (const [, t] of tokens) { if (t.tokenHash === hash) return t; }
        return null;
      }),
      findByHash: vi.fn(async () => null),
      create: vi.fn(async (data: { userId: string; plaintext: string; scopes: string[] }) => {
        const id = `token-${++tokenSeq}`;
        const hash = `sha256:${createHash('sha256').update(data.plaintext).digest('hex')}`;
        const token = { id, userId: data.userId, tokenHash: hash, scopes: data.scopes, label: 'dev' };
        tokens.set(id, token);
        return token;
      }),
      touchLastUsed: vi.fn(async () => {}),
    })),
  };
});

vi.mock('@safe-npm/object-store', () => ({
  createObjectStoreFromEnv: () => ({ putObject: vi.fn(), getObject: vi.fn(), headObject: vi.fn(), deleteObject: vi.fn() }),
}));

let app: AppInstance;

beforeEach(async () => {
  process.env.SAFE_NPM_DEV_ADMIN_TOKEN = 'dev-local-admin-token';
  app = await createApp({ logger: false, enableRateLimit: false });
});

afterEach(async () => {
  await app.close();
});

describe('health and readiness', () => {
  it('GET /health returns ok', async () => {
    const resp = await app.inject({ method: 'GET', url: '/health' });
    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready returns ready', async () => {
    const resp = await app.inject({ method: 'GET', url: '/ready' });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().status).toBe('ready');
  });
});

describe('not found handler', () => {
  it('returns 404 with request ID', async () => {
    const resp = await app.inject({ method: 'GET', url: '/nonexistent' });
    expect(resp.statusCode).toBe(404);
    expect(resp.json().error).toBe('not found');
    expect(resp.json().requestId).toBeTruthy();
  });
});

describe('error handler', () => {
  it('returns structured error for thrown errors', async () => {
    // Register route before any inject call.
    const testApp = await createApp({ logger: false, enableRateLimit: false });
    testApp.get('/test-error', async () => {
      const err = new Error('test error') as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    });
    const resp = await testApp.inject({ method: 'GET', url: '/test-error' });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error).toBe('test error');
    expect(resp.json().requestId).toBeTruthy();
    await testApp.close();
  });
});

describe('auth', () => {
  it('POST /v1/auth/login with dev token returns session token', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { token: 'dev-local-admin-token' },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(body.token).toMatch(/^snp_/);
    expect(body.user.username).toBe('devadmin');
  });

  it('POST /v1/auth/login with invalid token returns 401', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { token: 'wrong-token' },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('GET /v1/protected without auth returns 401', async () => {
    const testApp = await createApp({ logger: false, enableRateLimit: false });
    testApp.get('/v1/protected', async (request) => ({ user: request.user }));
    const resp = await testApp.inject({ method: 'GET', url: '/v1/protected' });
    expect(resp.statusCode).toBe(401);
    expect(resp.json().error).toContain('authorization');
    await testApp.close();
  });

  it('GET /v1/protected with valid token returns 200', async () => {
    const testApp = await createApp({ logger: false, enableRateLimit: false });
    testApp.get('/v1/protected', async (request) => ({ user: request.user }));

    // Login to get a token.
    const loginResp = await testApp.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { token: 'dev-local-admin-token' },
    });
    const sessionToken = loginResp.json().token;

    const resp = await testApp.inject({
      method: 'GET',
      url: '/v1/protected',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().user).toBeTruthy();
    expect(resp.json().user.username).toBe('devadmin');
    await testApp.close();
  });

  it('GET /v1/protected with invalid token returns 401', async () => {
    const testApp = await createApp({ logger: false, enableRateLimit: false });
    testApp.get('/v1/protected2', async () => ({ ok: true }));
    const resp = await testApp.inject({
      method: 'GET',
      url: '/v1/protected2',
      headers: { authorization: 'Bearer snp_invalid' },
    });
    expect(resp.statusCode).toBe(401);
    await testApp.close();
  });
});

describe('requireScopes RBAC guard', () => {
  it('allows access when user has required scope', async () => {
    const testApp = await createApp({ logger: false, enableRateLimit: false });
    testApp.get('/v1/admin-only', { preHandler: requireScopes(SCOPES.ADMIN) }, async () => ({ ok: true }));

    const loginResp = await testApp.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { token: 'dev-local-admin-token' },
    });
    const sessionToken = loginResp.json().token;

    const resp = await testApp.inject({
      method: 'GET',
      url: '/v1/admin-only',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(resp.statusCode).toBe(200);
    await testApp.close();
  });

  it('denies access when user lacks required scope', async () => {
    const testApp = await createApp({ logger: false, enableRateLimit: false });
    testApp.get('/v1/admin-only2', { preHandler: requireScopes(SCOPES.ADMIN) }, async () => ({ ok: true }));

    // Login with username (gets read scope only).
    const loginResp = await testApp.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'limited-user' },
    });
    const sessionToken = loginResp.json().token;

    const resp = await testApp.inject({
      method: 'GET',
      url: '/v1/admin-only2',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(resp.statusCode).toBe(403);
    await testApp.close();
  });
});

describe('generateToken', () => {
  it('generates a unique token with snp_ prefix', () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).toMatch(/^snp_[0-9a-f]{64}$/);
    expect(t2).toMatch(/^snp_[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });
});
