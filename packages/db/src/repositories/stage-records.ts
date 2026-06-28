/**
 * Repository for stage_records (Section 15.1).
 */
import { eq, desc, and } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { stageRecords } from '../schema.js';

export class StageRecordsRepository {
  constructor(private db: DbClient) {}

  async create(data: {
    packageId: string;
    packageVersionId: string;
    createdBy?: string;
  }): Promise<typeof stageRecords.$inferSelect> {
    const [row] = await this.db.insert(stageRecords).values({
      packageId: data.packageId,
      packageVersionId: data.packageVersionId,
      createdBy: data.createdBy,
    }).returning();
    return row!;
  }

  async findById(id: string): Promise<typeof stageRecords.$inferSelect | undefined> {
    const [row] = await this.db.select().from(stageRecords)
      .where(eq(stageRecords.id, id))
      .limit(1);
    return row;
  }

  async listPending(): Promise<typeof stageRecords.$inferSelect[]> {
    return this.db.select().from(stageRecords)
      .where(eq(stageRecords.status, 'pending'))
      .orderBy(desc(stageRecords.createdAt));
  }

  async listByPackage(packageId: string): Promise<typeof stageRecords.$inferSelect[]> {
    return this.db.select().from(stageRecords)
      .where(eq(stageRecords.packageId, packageId))
      .orderBy(desc(stageRecords.createdAt));
  }

  async approve(id: string, approvedBy: string, reviewNotes?: string): Promise<void> {
    await this.db.update(stageRecords)
      .set({
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
        reviewNotes,
      })
      .where(eq(stageRecords.id, id));
  }

  async reject(id: string, rejectedBy: string, reviewNotes?: string): Promise<void> {
    await this.db.update(stageRecords)
      .set({
        status: 'rejected',
        rejectedBy,
        rejectedAt: new Date(),
        reviewNotes,
      })
      .where(eq(stageRecords.id, id));
  }

  async cancel(id: string): Promise<void> {
    await this.db.update(stageRecords)
      .set({ status: 'cancelled' })
      .where(and(eq(stageRecords.id, id), eq(stageRecords.status, 'pending')));
  }
}
