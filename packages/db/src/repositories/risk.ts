import { eq, desc } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { riskReports, permissionReports, authTokens } from '../schema.js';
import { createHash } from 'node:crypto';

export class RiskReportsRepository {
  constructor(private db: DbClient) {}

  async create(data: {
    packageVersionId: string;
    score: number;
    tier: string;
    confidence: number;
    analyzerVersion: string;
    evidenceDigest: string;
    report: Record<string, unknown>;
  }): Promise<typeof riskReports.$inferSelect> {
    const [row] = await this.db.insert(riskReports).values({
      packageVersionId: data.packageVersionId,
      score: data.score,
      tier: data.tier,
      confidence: data.confidence,
      analyzerVersion: data.analyzerVersion,
      evidenceDigest: data.evidenceDigest,
      report: data.report,
    }).returning();
    return row!;
  }

  async findById(id: string): Promise<typeof riskReports.$inferSelect | undefined> {
    const [row] = await this.db.select().from(riskReports).where(eq(riskReports.id, id)).limit(1);
    return row;
  }

  async findLatestByVersion(packageVersionId: string): Promise<typeof riskReports.$inferSelect | undefined> {
    const [row] = await this.db.select().from(riskReports)
      .where(eq(riskReports.packageVersionId, packageVersionId))
      .orderBy(desc(riskReports.generatedAt))
      .limit(1);
    return row;
  }

  async listByVersion(packageVersionId: string): Promise<typeof riskReports.$inferSelect[]> {
    return this.db.select().from(riskReports)
      .where(eq(riskReports.packageVersionId, packageVersionId))
      .orderBy(desc(riskReports.generatedAt));
  }
}

export class PermissionReportsRepository {
  constructor(private db: DbClient) {}

  async create(data: {
    packageVersionId: string;
    declaredPermissions?: Record<string, unknown>;
    inferredPermissions?: Record<string, unknown>;
    enforceability?: Record<string, unknown>;
  }): Promise<typeof permissionReports.$inferSelect> {
    const [row] = await this.db.insert(permissionReports).values({
      packageVersionId: data.packageVersionId,
      declaredPermissions: data.declaredPermissions ?? {},
      inferredPermissions: data.inferredPermissions ?? {},
      enforceability: data.enforceability ?? {},
    }).returning();
    return row!;
  }

  async findLatestByVersion(packageVersionId: string): Promise<typeof permissionReports.$inferSelect | undefined> {
    const [row] = await this.db.select().from(permissionReports)
      .where(eq(permissionReports.packageVersionId, packageVersionId))
      .orderBy(desc(permissionReports.generatedAt))
      .limit(1);
    return row;
  }
}

/**
 * Auth tokens repository. Tokens are hashed at rest using SHA-256.
 * The plaintext token is only shown once at creation time.
 */
export class AuthTokensRepository {
  constructor(private db: DbClient) {}

  /** Hash a plaintext token for storage. */
  static hashToken(plaintext: string): string {
    return `sha256:${createHash('sha256').update(plaintext).digest('hex')}`;
  }

  async create(data: {
    userId: string;
    plaintext: string;
    scopes?: string[];
    label?: string;
    expiresAt?: Date;
  }): Promise<{ token: typeof authTokens.$inferSelect; plaintext: string }> {
    const tokenHash = AuthTokensRepository.hashToken(data.plaintext);
    const [row] = await this.db.insert(authTokens).values({
      userId: data.userId,
      tokenHash,
      scopes: data.scopes ?? [],
      label: data.label,
      expiresAt: data.expiresAt,
    }).returning();
    return { token: row!, plaintext: data.plaintext };
  }

  async findByHash(tokenHash: string): Promise<typeof authTokens.$inferSelect | undefined> {
    const [row] = await this.db.select().from(authTokens).where(eq(authTokens.tokenHash, tokenHash)).limit(1);
    return row;
  }

  /** Look up a token by plaintext (hashes and queries). */
  async findByPlaintext(plaintext: string): Promise<typeof authTokens.$inferSelect | undefined> {
    const tokenHash = AuthTokensRepository.hashToken(plaintext);
    return this.findByHash(tokenHash);
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db.update(authTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(authTokens.id, id));
  }

  async listByUser(userId: string): Promise<typeof authTokens.$inferSelect[]> {
    return this.db.select().from(authTokens).where(eq(authTokens.userId, userId));
  }

  async revoke(id: string): Promise<void> {
    await this.db.delete(authTokens).where(eq(authTokens.id, id));
  }
}
