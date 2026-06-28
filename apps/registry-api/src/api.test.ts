import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createApp, type AppInstance } from '../src/app.js';
import { generateToken, SCOPES, requireScopes } from '../src/auth.js';

/**
 * API scaffold + auth + registry routes tests (Section 7.3-7.4 + 8.2-8.4).
 * Uses a mock db to avoid requiring a live PostgreSQL.
 */

vi.mock('@safe-npm/db', () => {
  const users = new Map();
  const tokens = new Map();
  const packages = new Map();
  const versions = new Map();
  const aliases = new Map();
  const distTags = new Map();
  const riskReports = new Map();
  let userSeq = 0;
  let tokenSeq = 0;
  let pkgSeq = 0;
  let verSeq = 0;

  return {
    createDb: () => ({
      db: {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: () => ({ from: () => ({ where: () => ({ limit: () => [], orderBy: () => ({ limit: () => [] }) }) }) }),
        insert: () => ({
          values: () => ({
            returning: vi.fn((data) => {
              if (data.username) { const id = `user-${++userSeq}`; users.set(id, data); return [{ id, ...data }]; }
              if (data.name) { const id = `pkg-${++pkgSeq}`; packages.set(data.name, { id, ...data }); return [{ id, ...data }]; }
              if (data.packageId) { const id = `ver-${++verSeq}`; versions.set(id, { id, ...data }); return [{ id, ...data }]; }
              if (data.packageVersionId) { const id = `rr-${++tokenSeq}`; riskReports.set(id, { id, ...data }); return [{ id, ...data }]; }
              return [data];
            }),
            onConflictDoNothing: () => {},
            onConflictDoUpdate: () => {},
          }),
        }),
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
    PackagesRepository: vi.fn().mockImplementation(() => ({
      findByName: vi.fn(async (name: string) => packages.get(name) ?? null),
      findById: vi.fn(async (id: string) => { for (const [, v] of packages) { if (v.id === id) return v; } return null; }),
      create: vi.fn(async (data: { name: string; visibility?: string }) => {
        const id = `pkg-${++pkgSeq}`;
        const pkg = { id, name: data.name, visibility: data.visibility ?? 'private', scope: data.scope, ownerUserId: data.ownerUserId };
        packages.set(data.name, pkg);
        return pkg;
      }),
      updateVisibility: vi.fn(async () => {}),
    })),
    PackageVersionsRepository: vi.fn().mockImplementation(() => ({
      create: vi.fn(async (data: { packageId: string; version: string; publishId: string; tarballObjectKey: string; tarballSha512: string; status?: string }) => {
        const id = `ver-${++verSeq}`;
        const v = { id, ...data, status: data.status ?? 'private', metadata: data.metadata ?? {} };
        versions.set(id, v);
        return v;
      }),
      findById: vi.fn(async () => null),
      findByPackageAndVersion: vi.fn(async () => []),
      listByPackage: vi.fn(async (pkgId: string) => { return [...versions.values()].filter((v) => v.packageId === pkgId); }),
      updateStatus: vi.fn(async () => {}),
    })),
    VersionAliasesRepository: vi.fn().mockImplementation(() => ({
      upsert: vi.fn(async (data: { packageId: string; version: string; activePublishId: string }) => {
        aliases.set(`${data.packageId}:${data.version}`, data);
      }),
      find: vi.fn(async () => null),
      listByPackage: vi.fn(async (pkgId: string) => { return [...aliases.values()].filter((a) => a.packageId === pkgId); }),
    })),
    DistTagsRepository: vi.fn().mockImplementation(() => ({
      upsert: vi.fn(async (data: { packageId: string; tag: string; version: string }) => {
        distTags.set(`${data.packageId}:${data.tag}`, data);
      }),
      find: vi.fn(async () => null),
      listByPackage: vi.fn(async (pkgId: string) => { return [...distTags.values()].filter((t) => t.packageId === pkgId); }),
    })),
    RiskReportsRepository: vi.fn().mockImplementation(() => ({
      create: vi.fn(async (data: { packageVersionId: string; score: number; tier: string }) => {
        const id = `rr-${++tokenSeq}`;
        const r = { id, ...data };
        riskReports.set(id, r);
        return r;
      }),
      findById: vi.fn(async () => null),
      findLatestByVersion: vi.fn(async () => null),
      listByVersion: vi.fn(async () => []),
    })),
  };
});

vi.mock('@safe-npm/object-store', () => ({
  createObjectStoreFromEnv: () => ({
    putObject: vi.fn(async () => 'key'),
    getObject: vi.fn(async () => ({ body: { pipe: vi.fn() }, contentType: 'application/gzip' })),
    headObject: vi.fn(async () => true),
    deleteObject: vi.fn(async () => {}),
    putTarball: vi.fn(async () => 'key'),
    putAnalysis: vi.fn(async () => 'key'),
  }),
  ObjectStore: { tarballKey: (s: string) => `tarballs/${s}.tgz`, analysisKey: (s: string, v: string) => `analysis/${s}/${v}.json`, attestationKey: (s: string) => `attestations/${s}.json` },
  computeSha512: (data: Buffer) => `sha512-${createHash('sha512').update(data).digest('base64')}`,
}));

vi.mock('@safe-npm/analyzer', () => ({
  analyzeTarball: vi.fn(async (opts: { packageName: string; packageVersion: string }) => ({
    package: opts.packageName,
    version: opts.packageVersion,
    publishId: 'pub-test',
    tarballDigest: 'sha512-test',
    analyzerVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    tarball: { sizeBytes: 100, unpackedSizeBytes: 200, fileCount: 2 },
    metadata: { name: opts.packageName, version: opts.packageVersion, scripts: {}, dependencies: {}, devDependencies: {}, optionalDependencies: {}, peerDependencies: {}, bundledDependencies: [], files: [], contributors: [], maintainers: [] },
    lifecycleScripts: [],
    staticFindings: [],
    readability: { likelyMinified: false, likelyObfuscated: false, sourceMapsPresent: false, humanReadableFileRatio: 1, minifiedLineRatio: 0, giantStringArrays: false },
    nativeArtifacts: [],
    builtinsUsed: [],
  })),
  QuarantineCache: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@safe-npm/scoring', () => ({
  scoreAnalysis: vi.fn(() => ({
    package: 'test', version: '1.0.0', publishId: 'pub-1', score: 90, tier: 'excellent',
    confidence: 95, generatedAt: new Date().toISOString(), analyzerVersion: '0.1.0',
    evidenceDigest: 'sha256:abc', blockers: [], warnings: [], facts: {}, components: [],
  })),
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
    const resp = await app.inject({ method: 'DELETE', url: '/nonexistent-path-xyz' });
    expect(resp.statusCode).toBe(404);
    expect(resp.json().error).toBe('not found');
    expect(resp.json().requestId).toBeTruthy();
  });
});

describe('error handler', () => {
  it('returns structured error for thrown errors', async () => {
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

describe('publish API (8.2)', () => {
  it('PUT /v1/packages/:name without auth returns 401', async () => {
    const tarballData = Buffer.from('fake-tarball').toString('base64');
    const resp = await app.inject({
      method: 'PUT',
      url: '/v1/packages/test-publish-pkg',
      payload: {
        name: 'test-publish-pkg',
        versions: { '1.0.0': { name: 'test-publish-pkg', version: '1.0.0', dist: { integrity: computeSha512(Buffer.from('fake-tarball')) } } },
        'dist-tags': { latest: '1.0.0' },
        _attachments: { 'test-publish-pkg-1.0.0.tgz': { content_type: 'application/octet-stream', data: tarballData, length: 12 } },
      },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('PUT /v1/packages/:name with auth publishes a package', async () => {
    // Login first.
    const loginResp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { token: 'dev-local-admin-token' },
    });
    const token = loginResp.json().token;

    const tarballData = Buffer.from('fake-tarball');
    const resp = await app.inject({
      method: 'PUT',
      url: '/v1/packages/test-publish-pkg',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'test-publish-pkg',
        versions: { '1.0.0': { name: 'test-publish-pkg', version: '1.0.0', dist: { integrity: computeSha512(tarballData) } } },
        'dist-tags': { latest: '1.0.0' },
        _attachments: { 'test-publish-pkg-1.0.0.tgz': { content_type: 'application/octet-stream', data: tarballData.toString('base64'), length: tarballData.length } },
        _safeNpm: { visibility: 'private' },
      },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(body.ok).toBe(true);
    expect(body.package).toBe('test-publish-pkg');
    expect(body.version).toBe('1.0.0');
    expect(body.publishId).toBeTruthy();
    expect(body.visibility).toBe('private');
  });

  it('rejects integrity mismatch', async () => {
    const loginResp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { token: 'dev-local-admin-token' },
    });
    const token = loginResp.json().token;

    const tarballData = Buffer.from('fake-tarball');
    const resp = await app.inject({
      method: 'PUT',
      url: '/v1/packages/test-integrity-fail',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'test-integrity-fail',
        versions: { '1.0.0': { name: 'test-integrity-fail', version: '1.0.0', dist: { integrity: 'sha512-wrong' } } },
        'dist-tags': { latest: '1.0.0' },
        _attachments: { 'test-integrity-fail-1.0.0.tgz': { content_type: 'application/octet-stream', data: tarballData.toString('base64'), length: tarballData.length } },
      },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error).toContain('integrity');
  });
});

describe('packument endpoint (8.3)', () => {
  it('GET /:name returns 404 for non-existent package', async () => {
    const resp = await app.inject({ method: 'GET', url: '/nonexistent-pkg-xyz' });
    expect(resp.statusCode).toBe(404);
  });

  it('GET /:name returns packument for published package', async () => {
    // First publish.
    const loginResp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { token: 'dev-local-admin-token' },
    });
    const token = loginResp.json().token;

    const tarballData = Buffer.from('fake-tarball');
    await app.inject({
      method: 'PUT',
      url: '/v1/packages/test-packument-pkg',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'test-packument-pkg',
        versions: { '1.0.0': { name: 'test-packument-pkg', version: '1.0.0', dist: { integrity: computeSha512(tarballData) } } },
        'dist-tags': { latest: '1.0.0' },
        _attachments: { 'test-packument-pkg-1.0.0.tgz': { content_type: 'application/octet-stream', data: tarballData.toString('base64'), length: tarballData.length } },
      },
    });

    // Then fetch packument (with auth since it's private).
    const resp = await app.inject({
      method: 'GET',
      url: '/test-packument-pkg',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(body.name).toBe('test-packument-pkg');
    expect(body.versions).toBeTruthy();
    expect(body['dist-tags']).toBeTruthy();
  });

  it('GET /:name returns 401 for private package without auth', async () => {
    // First publish a private package.
    const loginResp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { token: 'dev-local-admin-token' },
    });
    const token = loginResp.json().token;

    const tarballData = Buffer.from('fake-tarball');
    await app.inject({
      method: 'PUT',
      url: '/v1/packages/test-private-pkg',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'test-private-pkg',
        versions: { '1.0.0': { name: 'test-private-pkg', version: '1.0.0', dist: { integrity: computeSha512(tarballData) } } },
        'dist-tags': { latest: '1.0.0' },
        _attachments: { 'test-private-pkg-1.0.0.tgz': { content_type: 'application/octet-stream', data: tarballData.toString('base64'), length: tarballData.length } },
        _safeNpm: { visibility: 'private' },
      },
    });

    // Fetch without auth.
    const resp = await app.inject({ method: 'GET', url: '/test-private-pkg' });
    expect(resp.statusCode).toBe(401);
  });
});

function computeSha512(data: Buffer): string {
  return `sha512-${createHash('sha512').update(data).digest('base64')}`;
}
