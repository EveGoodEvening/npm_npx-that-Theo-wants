/**
 * Audit log repository (Section 25.1).
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { auditLogs, auditLogAction } from '../schema.js';

export type AuditLogAction = typeof auditLogAction.enumValues[number];

export interface AuditLogEntry {
  action: AuditLogAction;
  actorUserId?: string;
  actorScopes?: string;
  targetType: string;
  targetId?: string;
  packageId?: string;
  versionId?: string;
  detail?: Record<string, unknown>;
  requestId?: string;
}

export class AuditLogRepository {
  constructor(private db: DbClient) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await this.db.insert(auditLogs).values({
      action: entry.action,
      actorUserId: entry.actorUserId,
      actorScopes: entry.actorScopes,
      targetType: entry.targetType,
      targetId: entry.targetId,
      packageId: entry.packageId,
      versionId: entry.versionId,
      detail: entry.detail,
      requestId: entry.requestId,
    });
  }

  async listByAction(action: AuditLogAction, limit = 100): Promise<typeof auditLogs.$inferSelect[]> {
    return this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, action))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async listByActor(userId: string, limit = 100): Promise<typeof auditLogs.$inferSelect[]> {
    return this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async listByTarget(targetType: string, targetId: string, limit = 100): Promise<typeof auditLogs.$inferSelect[]> {
    return this.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, targetType), eq(auditLogs.targetId, targetId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async listSince(since: Date, limit = 1000): Promise<typeof auditLogs.$inferSelect[]> {
    return this.db
      .select()
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, since))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }
}
