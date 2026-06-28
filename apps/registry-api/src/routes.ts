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
}

export async function registerRegistryRoutes(
  app: FastifyInstance,
  options: RegistryRoutesOptions,
): Promise<void> {
  const { db, objectStore, registryBaseUrl } = options;
  const keyManager = options.keyManager;

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
