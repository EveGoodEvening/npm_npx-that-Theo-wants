/**
 * Publish, packument, and tarball routes (design 8.2-8.4).
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  PackagesRepository,
  PackageVersionsRepository,
  VersionAliasesRepository,
  DistTagsRepository,
  RiskReportsRepository,
  StageRecordsRepository,
  PackageAclRepository,
  AuditRepository,
  BillingRepository,
  type DbClient,
} from '@safe-npm/db';
import { ObjectStore, computeSha512 } from '@safe-npm/object-store';
import { scoreAnalysis } from '@safe-npm/scoring';
import { analyzeTarball, QuarantineCache } from '@safe-npm/analyzer';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requireScopes, SCOPES } from './auth.js';
import type { KeyManager } from './keys.js';
import { signDistMetadata } from './signing.js';

export interface RegistryRoutesOptions {
  db: DbClient;
  objectStore: ObjectStore;
  registryBaseUrl: string;
  keyManager?: KeyManager;
  /** Optional job queue for enqueueing audit jobs. */
  jobQueue?: { enqueue: (type: string, payload: unknown, options?: { idempotencyKey?: string }) => unknown };
}

export async function registerRegistryRoutes(
  app: FastifyInstance,
  options: RegistryRoutesOptions,
): Promise<void> {
  const { db, objectStore, registryBaseUrl } = options;
  const keyManager = options.keyManager;
  const jobQueue = options.jobQueue;

  // --- 8.2: Publish API ---

  app.put('/v1/packages/:name', {
    preHandler: requireScopes(SCOPES.PUBLISH),
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const body = request.body as PublishBody;

    // Validate package name.
    if (!body.name || body.name !== name) {
      reply.status(400);
      return { error: 'package name mismatch', statusCode: 400, requestId: request.id };
    }

    // Validate version.
    const version = Object.keys(body.versions ?? {})[0];
    if (!version) {
      reply.status(400);
      return { error: 'no version provided', statusCode: 400, requestId: request.id };
    }

    const versionData = body.versions![version]!;
    const attachmentKey = Object.keys(body._attachments ?? {})[0];
    if (!attachmentKey) {
      reply.status(400);
      return { error: 'no tarball attachment provided', statusCode: 400, requestId: request.id };
    }

    const attachment = body._attachments![attachmentKey]!;
    const tarballBuffer = Buffer.from(attachment.data, 'base64');

    // Validate integrity.
    const computedSha512 = computeSha512(tarballBuffer);
    const dist = (versionData.dist ?? {}) as { integrity?: string; shasum?: string; unpackedSize?: number; fileCount?: number };
    if (dist.integrity && dist.integrity !== computedSha512) {
      reply.status(400);
      return { error: 'integrity mismatch', statusCode: 400, requestId: request.id };
    }

    // Determine visibility.
    const visibility = (body._safeNpm?.visibility as string) ?? 'private';

    // Store tarball in object storage.
    const tarballKey = ObjectStore.tarballKey(computedSha512);
    await objectStore.putObject(tarballKey, tarballBuffer, {
      contentType: 'application/gzip',
    });

    // Create or find package.
    const packagesRepo = new PackagesRepository(db);
    let pkg = await packagesRepo.findByName(name);
    if (!pkg) {
      pkg = await packagesRepo.create({
        name,
        scope: name.startsWith('@') ? name.split('/')[0] : undefined,
        ownerUserId: request.user!.userId,
        visibility,
      });
    }

    // Create package version with new publish_id.
    const publishId = randomUUID();
    const versionsRepo = new PackageVersionsRepository(db);
    const pv = await versionsRepo.create({
      packageId: pkg.id,
      version,
      publishId,
      status: visibility,
      publisherUserId: request.user!.userId,
      tarballObjectKey: tarballKey,
      tarballSha512: computedSha512,
      tarballShasum: dist.shasum,
      unpackedSizeBytes: dist.unpackedSize,
      fileCount: dist.fileCount,
      metadata: versionData,
    });

    // Set version alias.
    const aliasesRepo = new VersionAliasesRepository(db);
    await aliasesRepo.upsert({
      packageId: pkg.id,
      version,
      activePublishId: publishId,
    });

    // Set default dist-tag.
    const distTagsRepo = new DistTagsRepository(db);
    const tag = Object.keys(body['dist-tags'] ?? {})[0] ?? 'latest';
    await distTagsRepo.upsert({
      packageId: pkg.id,
      tag,
      version,
      publishId,
    });

    // Run analysis and store risk report.
    try {
      const tmpDir = await mkdtemp(join(tmpdir(), 'safe-npm-publish-'));
      const tarballPath = join(tmpDir, attachmentKey);
      try {
        await writeFile(tarballPath, tarballBuffer);
        const cache = new QuarantineCache();
        const analysisReport = await analyzeTarball({
          tarballPath,
          integrity: computedSha512,
          packageName: name,
          packageVersion: version,
          cache,
        });
        const riskReport = scoreAnalysis(analysisReport);

        const riskRepo = new RiskReportsRepository(db);
        await riskRepo.create({
          packageVersionId: pv.id,
          score: riskReport.score,
          tier: riskReport.tier,
          confidence: riskReport.confidence,
          analyzerVersion: riskReport.analyzerVersion,
          evidenceDigest: riskReport.evidenceDigest,
          report: riskReport as unknown as Record<string, unknown>,
        });

        // Store analysis in object storage.
        const analysisKey = ObjectStore.analysisKey(computedSha512, analysisReport.analyzerVersion);
        await objectStore.putObject(analysisKey, Buffer.from(JSON.stringify(analysisReport)), {
          contentType: 'application/json',
        });
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch {
      // Analysis failure is non-fatal for publish; enqueue for later.
      request.log.warn({ name, version }, 'analysis failed during publish; will be enqueued');
    }

    return {
      ok: true,
      package: name,
      version,
      publishId,
      visibility,
      tarballUrl: `${registryBaseUrl}/${name}/-/${attachmentKey}`,
    };
  });

  // --- 8.3: Packument endpoint ---

  app.get('/:name', {
    // Public read for public packages; auth required for private.
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    const packagesRepo = new PackagesRepository(db);
    const pkg = await packagesRepo.findByName(name);
    if (!pkg) {
      reply.status(404);
      return { error: 'not found', statusCode: 404, requestId: request.id };
    }

    // ACL: private packages require auth.
    if (pkg.visibility === 'private') {
      if (!request.user) {
        reply.status(401);
        return { error: 'authentication required for private package', statusCode: 401, requestId: request.id };
      }
      // TODO: Check org membership for ACL.
    }

    const versionsRepo = new PackageVersionsRepository(db);
    const aliasesRepo = new VersionAliasesRepository(db);
    const distTagsRepo = new DistTagsRepository(db);

    const allVersions = await versionsRepo.listByPackage(pkg.id);
    const aliases = await aliasesRepo.listByPackage(pkg.id);
    const tags = await distTagsRepo.listByPackage(pkg.id);

    // Filter: exclude retracted/deleted versions.
    const visibleStatuses = ['private', 'staged_public', 'public', 'deprecated', 'quarantined'];
    const visibleVersions = allVersions.filter((v) => visibleStatuses.includes(v.status));

    // Build packument.
    const versionsMap: Record<string, unknown> = {};
    for (const v of visibleVersions) {
      const meta = v.metadata as Record<string, unknown>;
      const dist: Record<string, unknown> = {
        tarball: `${registryBaseUrl}/${name}/-/${name}-${v.version}.tgz`,
        integrity: v.tarballSha512,
        shasum: v.tarballShasum,
        unpackedSize: v.unpackedSizeBytes,
        fileCount: v.fileCount,
      };

      // Include signature if key manager is configured (design 9.2).
      if (keyManager) {
        try {
          const sig = signDistMetadata(
            {
              packageName: name,
              version: v.version,
              publishId: v.publishId,
              tarballIntegrity: v.tarballSha512,
            },
            keyManager,
          );
          dist.signatures = { [sig.keyId]: sig.signature };
        } catch {
          // Signing failure is non-fatal.
        }
      }

      versionsMap[v.version] = {
        ...meta,
        dist,
      };
    }

    const distTagsMap: Record<string, string> = {};
    for (const t of tags) {
      distTagsMap[t.tag] = t.version;
    }

    return {
      name,
      'dist-tags': distTagsMap,
      versions: versionsMap,
      time: {}, // TODO: populate from published_at
      _safeNpm: {
        visibility: pkg.visibility,
        aliases: aliases.map((a) => ({ version: a.version, publishId: a.activePublishId })),
      },
    };
  });

  // --- 8.4: Tarball endpoint ---

  app.get('/:name/-/:tarball', async (request, reply) => {
    const { name, tarball } = request.params as { name: string; tarball: string };

    const packagesRepo = new PackagesRepository(db);
    const pkg = await packagesRepo.findByName(name);
    if (!pkg) {
      reply.status(404);
      return { error: 'not found', statusCode: 404, requestId: request.id };
    }

    // ACL for private packages.
    if (pkg.visibility === 'private' && !request.user) {
      reply.status(401);
      return { error: 'authentication required', statusCode: 401, requestId: request.id };
    }

    // Find the version that matches this tarball.
    const versionsRepo = new PackageVersionsRepository(db);
    const allVersions = await versionsRepo.listByPackage(pkg.id);

    // The tarball filename is typically <name>-<version>.tgz
    // Extract version from tarball name.
    const versionMatch = tarball.match(/-(\d+\.\d+\.\d+[^.]*)\.tgz$/);
    if (!versionMatch) {
      reply.status(404);
      return { error: 'tarball not found', statusCode: 404, requestId: request.id };
    }
    const targetVersion = versionMatch[1];

    const version = allVersions.find((v) => v.version === targetVersion);
    if (!version) {
      reply.status(404);
      return { error: 'version not found', statusCode: 404, requestId: request.id };
    }

    // Stream from object storage.
    try {
      const obj = await objectStore.getObject(version.tarballObjectKey);
      const { Readable } = await import('node:stream');
      reply.header('content-type', 'application/gzip');
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      return reply.send(Readable.fromWeb(obj.body as unknown as import('node:stream/web').ReadableStream));
    } catch {
      reply.status(404);
      return { error: 'tarball object not found', statusCode: 404, requestId: request.id };
    }
  });

  // --- 9.1: Keys endpoint ---

  app.get('/-/npm/v1/keys', async () => {
    if (!keyManager) {
      return { keys: [] };
    }
    const publicKeys = keyManager.getPublicKeys();
    return {
      keys: publicKeys.map((k) => ({
        keyid: k.keyId,
        key: k.publicKeyPem,
        expires: null,
      })),
    };
  });

  // --- 14.4: Retraction API ---

  app.post('/v1/packages/:name/versions/:version/retract', {
    preHandler: requireScopes(SCOPES.ADMIN),
  }, async (request, reply) => {
    const { name, version } = request.params as { name: string; version: string };
    const body = request.body as { reason?: string };

    if (!body?.reason) {
      reply.status(400);
      return { error: 'reason is required', statusCode: 400, requestId: request.id };
    }

    const packagesRepo = new PackagesRepository(db);
    const pkg = await packagesRepo.findByName(name);
    if (!pkg) {
      reply.status(404);
      return { error: 'package not found', statusCode: 404, requestId: request.id };
    }

    const versionsRepo = new PackageVersionsRepository(db);
    const allVersions = await versionsRepo.listByPackage(pkg.id);
    const targetVersion = allVersions.find((v) => v.version === version);
    if (!targetVersion) {
      reply.status(404);
      return { error: 'version not found', statusCode: 404, requestId: request.id };
    }

    // Check eligibility: observed_installs < 100 OR age < 5h.
    const publishedAt = targetVersion.publishedAt;
    const ageMs = Date.now() - new Date(publishedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const observedInstalls = 0; // TODO: query from event store/rollups.

    const eligible = observedInstalls < 100 || ageHours < 5;

    if (!eligible) {
      reply.status(409);
      return {
        error: 'RETRACTION_NOT_ELIGIBLE',
        statusCode: 409,
        requestId: request.id,
        facts: {
          observedInstalls,
          ageHours,
          threshold: { maxInstalls: 100, maxAgeHours: 5 },
        },
      };
    }

    // Mark version as retracted.
    await versionsRepo.updateStatus(targetVersion.id, 'retracted');

    // Remove active alias if it points to this publish ID.
    const aliasesRepo = new VersionAliasesRepository(db);
    const alias = await aliasesRepo.find(pkg.id, version);
    if (alias && alias.activePublishId === targetVersion.publishId) {
      // Move dist-tag to previous eligible version or remove.
      const distTagsRepo = new DistTagsRepository(db);
      const tags = await distTagsRepo.listByPackage(pkg.id);
      for (const tag of tags) {
        if (tag.version === version) {
          // Find previous version to move tag to.
          const previousVersion = allVersions
            .filter((v) => v.version !== version && v.status !== 'retracted')
            .sort((a, b) => b.version.localeCompare(a.version))[0];
          if (previousVersion) {
            await distTagsRepo.upsert({
              packageId: pkg.id,
              tag: tag.tag,
              version: previousVersion.version,
              publishId: previousVersion.publishId,
            });
          }
        }
      }
    }

    return {
      ok: true,
      package: name,
      version,
      status: 'retracted',
      reason: body.reason,
      facts: { observedInstalls, ageHours },
    };
  });

  // --- 15.2: Stage API ---

  const stageRepo = new StageRecordsRepository(db);

  // POST /v1/stage — create a stage record for a package version.
  app.post('/v1/stage', {
    preHandler: requireScopes(SCOPES.PUBLISH),
  }, async (request, reply) => {
    const body = request.body as { packageId?: string; packageVersionId?: string };
    if (!body?.packageId || !body?.packageVersionId) {
      reply.status(400);
      return { error: 'packageId and packageVersionId are required', statusCode: 400, requestId: request.id };
    }

    const stage = await stageRepo.create({
      packageId: body.packageId,
      packageVersionId: body.packageVersionId,
      createdBy: request.user!.userId,
    });

    return { ok: true, stageId: stage.id, status: stage.status };
  });

  // GET /v1/stage — list pending stage records.
  app.get('/v1/stage', {
    preHandler: requireScopes(SCOPES.READ),
  }, async () => {
    const pending = await stageRepo.listPending();
    return { stages: pending };
  });

  // GET /v1/stage/:stageId — get a specific stage record.
  app.get('/v1/stage/:stageId', {
    preHandler: requireScopes(SCOPES.READ),
  }, async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const stage = await stageRepo.findById(stageId);
    if (!stage) {
      reply.status(404);
      return { error: 'stage not found', statusCode: 404, requestId: request.id };
    }
    return { stage };
  });

  // DELETE /v1/stage/:stageId — cancel a pending stage.
  app.delete('/v1/stage/:stageId', {
    preHandler: requireScopes(SCOPES.PUBLISH),
  }, async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const stage = await stageRepo.findById(stageId);
    if (!stage) {
      reply.status(404);
      return { error: 'stage not found', statusCode: 404, requestId: request.id };
    }
    if (stage.status !== 'pending') {
      reply.status(409);
      return { error: 'stage is not pending', statusCode: 409, requestId: request.id };
    }
    await stageRepo.cancel(stageId);
    return { ok: true, status: 'cancelled' };
  });

  // POST /v1/stage/:stageId/approve — approve a stage (promote to public).
  app.post('/v1/stage/:stageId/approve', {
    preHandler: requireScopes(SCOPES.ADMIN),
  }, async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const body = request.body as { reviewNotes?: string };
    const stage = await stageRepo.findById(stageId);
    if (!stage) {
      reply.status(404);
      return { error: 'stage not found', statusCode: 404, requestId: request.id };
    }
    if (stage.status !== 'pending') {
      reply.status(409);
      return { error: 'stage is not pending', statusCode: 409, requestId: request.id };
    }

    // TODO: Require risk report before approval (design 15.2).
    // TODO: Require policy pass or recorded waiver.

    await stageRepo.approve(stageId, request.user!.userId, body?.reviewNotes);

    // Update package version status to public.
    const versionsRepo = new PackageVersionsRepository(db);
    await versionsRepo.updateStatus(stage.packageVersionId, 'public');

    // Update package visibility to staged_public or public.
    const packagesRepo = new PackagesRepository(db);
    await packagesRepo.updateVisibility(stage.packageId, 'public');

    return { ok: true, status: 'approved', stageId };
  });

  // POST /v1/stage/:stageId/reject — reject a stage.
  app.post('/v1/stage/:stageId/reject', {
    preHandler: requireScopes(SCOPES.ADMIN),
  }, async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const body = request.body as { reviewNotes?: string };
    const stage = await stageRepo.findById(stageId);
    if (!stage) {
      reply.status(404);
      return { error: 'stage not found', statusCode: 404, requestId: request.id };
    }
    if (stage.status !== 'pending') {
      reply.status(409);
      return { error: 'stage is not pending', statusCode: 409, requestId: request.id };
    }
    await stageRepo.reject(stageId, request.user!.userId, body?.reviewNotes);
    return { ok: true, status: 'rejected', stageId };
  });

  // --- 17.2: Share API ---

  const aclRepo = new PackageAclRepository(db);

  // POST /v1/shares — grant access to a package.
  app.post('/v1/shares', {
    preHandler: requireScopes(SCOPES.ADMIN),
  }, async (request, reply) => {
    const body = request.body as {
      packageId?: string;
      principalType?: string;
      principalId?: string;
      role?: string;
    };
    if (!body?.packageId || !body?.principalType || !body?.principalId || !body?.role) {
      reply.status(400);
      return { error: 'packageId, principalType, principalId, and role are required', statusCode: 400, requestId: request.id };
    }

    const validRoles = ['read', 'write', 'admin'];
    if (!validRoles.includes(body.role)) {
      reply.status(400);
      return { error: 'role must be read, write, or admin', statusCode: 400, requestId: request.id };
    }

    const validPrincipalTypes = ['user', 'org', 'team', 'token'];
    if (!validPrincipalTypes.includes(body.principalType)) {
      reply.status(400);
      return { error: 'principalType must be user, org, team, or token', statusCode: 400, requestId: request.id };
    }

    const acl = await aclRepo.grant({
      packageId: body.packageId,
      principalType: body.principalType,
      principalId: body.principalId,
      role: body.role,
      grantedBy: request.user!.userId,
    });

    return { ok: true, shareId: acl.id, role: acl.role };
  });

  // DELETE /v1/shares/:shareId — revoke access.
  app.delete('/v1/shares/:shareId', {
    preHandler: requireScopes(SCOPES.ADMIN),
  }, async (request) => {
    const { shareId } = request.params as { shareId: string };
    await aclRepo.revoke(shareId);
    return { ok: true };
  });

  // GET /v1/packages/:name/shares — list shares for a package.
  app.get('/v1/packages/:name/shares', {
    preHandler: requireScopes(SCOPES.READ),
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const packagesRepo = new PackagesRepository(db);
    const pkg = await packagesRepo.findByName(name);
    if (!pkg) {
      reply.status(404);
      return { error: 'package not found', statusCode: 404, requestId: request.id };
    }
    const shares = await aclRepo.listByPackage(pkg.id);
    return { shares };
  });

  // --- 20.1: Audit API ---

  const auditRepo = new AuditRepository(db);
  const billingRepo = new BillingRepository(db);
  const AUDIT_COST = 100; // Fake cost in credits.

  // POST /v1/audits — request a paid audit.
  app.post('/v1/audits', {
    preHandler: requireScopes(SCOPES.PUBLISH),
  }, async (request, reply) => {
    const body = request.body as {
      package?: string;
      version?: string;
      provider?: string;
      idempotencyKey?: string;
    };

    if (!body?.package || !body?.version || !body?.provider || !body?.idempotencyKey) {
      reply.status(400);
      return { error: 'package, version, provider, and idempotencyKey are required', statusCode: 400, requestId: request.id };
    }

    // Validate package/version access.
    const packagesRepo = new PackagesRepository(db);
    const versionsRepo = new PackageVersionsRepository(db);
    const pkg = await packagesRepo.findByName(body.package);
    if (!pkg) {
      reply.status(404);
      return { error: 'package not found', statusCode: 404, requestId: request.id };
    }

    const versions = await versionsRepo.findByPackageAndVersion(pkg.id, body.version);
    const version = versions[0];
    if (!version) {
      reply.status(404);
      return { error: 'version not found', statusCode: 404, requestId: request.id };
    }

    // Check idempotency: if a job with this key exists, return it.
    const existing = await auditRepo.findJobByIdempotencyKey(body.idempotencyKey);
    if (existing) {
      return { auditId: existing.id, status: existing.status, existing: true };
    }

    // Reserve credits.
    const account = await billingRepo.findOrCreateAccount(request.user!.userId);
    const reserved = await billingRepo.reserve(account.id, AUDIT_COST, body.idempotencyKey);
    if (!reserved) {
      reply.status(402);
      return { error: 'insufficient credit balance', statusCode: 402, requestId: request.id };
    }

    // Create audit job.
    const tarballDigest = version.tarballSha512 ?? 'unknown';
    const job = await auditRepo.createJob({
      packageVersionId: version.id,
      provider: body.provider,
      idempotencyKey: body.idempotencyKey,
      tarballDigest,
      requesterUserId: request.user!.userId,
      costCents: AUDIT_COST,
    });

    // Enqueue audit job.
    if (jobQueue) {
      jobQueue.enqueue('audit-package', {
        auditJobId: job.id,
        packageVersionId: version.id,
        packageName: body.package,
        version: body.version,
        tarballDigest,
      }, { idempotencyKey: body.idempotencyKey });
    }

    return { auditId: job.id, status: 'pending', cost: AUDIT_COST };
  });

  // GET /v1/audits/:auditId — get audit job status.
  app.get('/v1/audits/:auditId', {
    preHandler: requireScopes(SCOPES.READ),
  }, async (request, reply) => {
    const { auditId } = request.params as { auditId: string };
    const job = await auditRepo.findJobById(auditId);
    if (!job) {
      reply.status(404);
      return { error: 'audit job not found', statusCode: 404, requestId: request.id };
    }
    return {
      auditId: job.id,
      status: job.status,
      provider: job.provider,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  });

  // GET /v1/audit-attestations/:digest — get attestation by tarball digest.
  app.get('/v1/audit-attestations/:digest', {
    preHandler: requireScopes(SCOPES.READ),
  }, async (request, reply) => {
    const { digest } = request.params as { digest: string };
    const attestation = await auditRepo.findAttestationByDigest(digest);
    if (!attestation) {
      reply.status(404);
      return { error: 'attestation not found', statusCode: 404, requestId: request.id };
    }
    return { attestation };
  });
}

interface PublishBody {
  name: string;
  versions: Record<string, Record<string, unknown>>;
  'dist-tags': Record<string, string>;
  _attachments: Record<string, { content_type: string; data: string; length: number }>;
  _safeNpm?: {
    visibility?: string;
    riskReport?: Record<string, unknown>;
  };
}
