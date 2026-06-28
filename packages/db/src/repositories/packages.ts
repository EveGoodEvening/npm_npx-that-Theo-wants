import { eq, and } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import {
  packages,
  packageVersions,
  versionAliases,
  distTags,
} from '../schema.js';

export class PackagesRepository {
  constructor(private db: DbClient) {}

  async create(data: {
    name: string;
    scope?: string;
    ownerOrgId?: string;
    ownerUserId?: string;
    visibility?: string;
  }): Promise<typeof packages.$inferSelect> {
    const [row] = await this.db.insert(packages).values({
      name: data.name,
      scope: data.scope,
      ownerOrgId: data.ownerOrgId,
      ownerUserId: data.ownerUserId,
      visibility: data.visibility ?? 'private',
    }).returning();
    return row!;
  }

  async findById(id: string): Promise<typeof packages.$inferSelect | undefined> {
    const [row] = await this.db.select().from(packages).where(eq(packages.id, id)).limit(1);
    return row;
  }

  async findByName(name: string): Promise<typeof packages.$inferSelect | undefined> {
    const [row] = await this.db.select().from(packages).where(eq(packages.name, name)).limit(1);
    return row;
  }

  async updateVisibility(id: string, visibility: string): Promise<void> {
    await this.db.update(packages)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(packages.id, id));
  }
}

export class PackageVersionsRepository {
  constructor(private db: DbClient) {}

  async create(data: {
    packageId: string;
    version: string;
    publishId: string;
    status?: string;
    publisherUserId?: string;
    tarballObjectKey: string;
    tarballSha512: string;
    tarballShasum?: string;
    unpackedSizeBytes?: number;
    fileCount?: number;
    metadata?: Record<string, unknown>;
  }): Promise<typeof packageVersions.$inferSelect> {
    const [row] = await this.db.insert(packageVersions).values({
      packageId: data.packageId,
      version: data.version,
      publishId: data.publishId,
      status: data.status ?? 'private',
      publisherUserId: data.publisherUserId,
      tarballObjectKey: data.tarballObjectKey,
      tarballSha512: data.tarballSha512,
      tarballShasum: data.tarballShasum,
      unpackedSizeBytes: data.unpackedSizeBytes,
      fileCount: data.fileCount,
      metadata: data.metadata ?? {},
    }).returning();
    return row!;
  }

  async findById(id: string): Promise<typeof packageVersions.$inferSelect | undefined> {
    const [row] = await this.db.select().from(packageVersions).where(eq(packageVersions.id, id)).limit(1);
    return row;
  }

  async findByPackageAndVersion(packageId: string, version: string): Promise<typeof packageVersions.$inferSelect[]> {
    return this.db.select().from(packageVersions)
      .where(and(eq(packageVersions.packageId, packageId), eq(packageVersions.version, version)));
  }

  async listByPackage(packageId: string): Promise<typeof packageVersions.$inferSelect[]> {
    return this.db.select().from(packageVersions).where(eq(packageVersions.packageId, packageId));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db.update(packageVersions).set({ status }).where(eq(packageVersions.id, id));
  }
}

export class VersionAliasesRepository {
  constructor(private db: DbClient) {}

  async upsert(data: { packageId: string; version: string; activePublishId: string }): Promise<void> {
    await this.db.insert(versionAliases).values({
      packageId: data.packageId,
      version: data.version,
      activePublishId: data.activePublishId,
    }).onConflictDoUpdate({
      target: [versionAliases.packageId, versionAliases.version],
      set: { activePublishId: data.activePublishId },
    });
  }

  async find(packageId: string, version: string): Promise<typeof versionAliases.$inferSelect | undefined> {
    const [row] = await this.db.select().from(versionAliases)
      .where(and(eq(versionAliases.packageId, packageId), eq(versionAliases.version, version)))
      .limit(1);
    return row;
  }

  async listByPackage(packageId: string): Promise<typeof versionAliases.$inferSelect[]> {
    return this.db.select().from(versionAliases).where(eq(versionAliases.packageId, packageId));
  }
}

export class DistTagsRepository {
  constructor(private db: DbClient) {}

  async upsert(data: { packageId: string; tag: string; version: string; publishId: string }): Promise<void> {
    await this.db.insert(distTags).values({
      packageId: data.packageId,
      tag: data.tag,
      version: data.version,
      publishId: data.publishId,
    }).onConflictDoUpdate({
      target: [distTags.packageId, distTags.tag],
      set: { version: data.version, publishId: data.publishId, updatedAt: new Date() },
    });
  }

  async find(packageId: string, tag: string): Promise<typeof distTags.$inferSelect | undefined> {
    const [row] = await this.db.select().from(distTags)
      .where(and(eq(distTags.packageId, packageId), eq(distTags.tag, tag)))
      .limit(1);
    return row;
  }

  async listByPackage(packageId: string): Promise<typeof distTags.$inferSelect[]> {
    return this.db.select().from(distTags).where(eq(distTags.packageId, packageId));
  }
}
