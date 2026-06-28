/**
 * Repository for policy_sets (Section 22.1).
 */
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { policySets } from '../schema.js';

export class PolicyRepository {
  constructor(private db: DbClient) {}

  /**
   * Get a policy by scope (scopeType + scopeId).
   */
  async getPolicy(scopeType: string, scopeId: string): Promise<typeof policySets.$inferSelect | undefined> {
    const [row] = await this.db.select().from(policySets)
      .where(and(
        eq(policySets.scopeType, scopeType),
        eq(policySets.scopeId, scopeId),
      ))
      .limit(1);
    return row;
  }

  /**
   * Upsert a policy for a scope.
   */
  async upsertPolicy(scopeType: string, scopeId: string, policy: unknown, _updatedBy?: string): Promise<typeof policySets.$inferSelect> {
    const existing = await this.getPolicy(scopeType, scopeId);
    if (existing) {
      const [row] = await this.db.update(policySets).set({
        policy,
        updatedAt: new Date(),
      }).where(eq(policySets.id, existing.id)).returning();
      return row!;
    }
    const [row] = await this.db.insert(policySets).values({
      scopeType,
      scopeId,
      policy,
    }).returning();
    return row!;
  }

  /**
   * List all policies for a scope type.
   */
  async listByScopeType(scopeType: string): Promise<typeof policySets.$inferSelect[]> {
    return this.db.select().from(policySets)
      .where(eq(policySets.scopeType, scopeType));
  }

  /**
   * Delete a policy.
   */
  async deletePolicy(scopeType: string, scopeId: string): Promise<void> {
    await this.db.delete(policySets).where(and(
      eq(policySets.scopeType, scopeType),
      eq(policySets.scopeId, scopeId),
    ));
  }
}
