/**
 * Repository for package_acl (Section 17.1).
 */
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { packageAcl } from '../schema.js';

export class PackageAclRepository {
  constructor(private db: DbClient) {}

  async grant(data: {
    packageId: string;
    principalType: string;
    principalId: string;
    role: string;
    grantedBy?: string;
    expiresAt?: Date;
  }): Promise<typeof packageAcl.$inferSelect> {
    const [row] = await this.db.insert(packageAcl).values({
      packageId: data.packageId,
      principalType: data.principalType as 'user' | 'org' | 'team' | 'token',
      principalId: data.principalId,
      role: data.role as 'read' | 'write' | 'admin',
      grantedBy: data.grantedBy,
      expiresAt: data.expiresAt,
    }).returning();
    return row!;
  }

  async revoke(id: string): Promise<void> {
    await this.db.delete(packageAcl).where(eq(packageAcl.id, id));
  }

  async listByPackage(packageId: string): Promise<typeof packageAcl.$inferSelect[]> {
    return this.db.select().from(packageAcl)
      .where(eq(packageAcl.packageId, packageId));
  }

  async findForPrincipal(
    packageId: string,
    principalType: string,
    principalId: string,
  ): Promise<typeof packageAcl.$inferSelect | undefined> {
    const [row] = await this.db.select().from(packageAcl)
      .where(and(
        eq(packageAcl.packageId, packageId),
        eq(packageAcl.principalType, principalType as 'user' | 'org' | 'team' | 'token'),
        eq(packageAcl.principalId, principalId),
      ))
      .limit(1);
    return row;
  }

  /**
   * Check if a user has access to a package with the required role.
   */
  async checkAccess(
    packageId: string,
    userId: string,
    requiredRole: 'read' | 'write' | 'admin' = 'read',
  ): Promise<boolean> {
    const acls = await this.listByPackage(packageId);
    const roleRank = { read: 1, write: 2, admin: 3 };
    const requiredRank = roleRank[requiredRole];

    for (const acl of acls) {
      if (acl.principalType === 'user' && acl.principalId === userId) {
        if (roleRank[acl.role as 'read' | 'write' | 'admin'] >= requiredRank) {
          // Check expiry.
          if (acl.expiresAt && acl.expiresAt < new Date()) continue;
          return true;
        }
      }
    }
    return false;
  }
}
