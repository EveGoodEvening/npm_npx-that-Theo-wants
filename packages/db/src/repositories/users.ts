import { eq, and } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { users, orgs, memberships } from '../schema.js';

export class UsersRepository {
  constructor(private db: DbClient) {}

  async create(data: { username: string; email?: string }): Promise<typeof users.$inferSelect> {
    const [row] = await this.db.insert(users).values({
      username: data.username,
      email: data.email,
    }).returning();
    return row!;
  }

  async findById(id: string): Promise<typeof users.$inferSelect | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  async findByUsername(username: string): Promise<typeof users.$inferSelect | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return row;
  }
}

export class OrgsRepository {
  constructor(private db: DbClient) {}

  async create(data: { name: string; defaultVisibility?: string }): Promise<typeof orgs.$inferSelect> {
    const [row] = await this.db.insert(orgs).values({
      name: data.name,
      defaultVisibility: data.defaultVisibility ?? 'private',
    }).returning();
    return row!;
  }

  async findById(id: string): Promise<typeof orgs.$inferSelect | undefined> {
    const [row] = await this.db.select().from(orgs).where(eq(orgs.id, id)).limit(1);
    return row;
  }

  async findByName(name: string): Promise<typeof orgs.$inferSelect | undefined> {
    const [row] = await this.db.select().from(orgs).where(eq(orgs.name, name)).limit(1);
    return row;
  }
}

export class MembershipsRepository {
  constructor(private db: DbClient) {}

  async create(data: { orgId: string; userId: string; role: string }): Promise<void> {
    await this.db.insert(memberships).values({
      orgId: data.orgId,
      userId: data.userId,
      role: data.role,
    }).onConflictDoNothing();
  }

  async findByOrgAndUser(orgId: string, userId: string): Promise<typeof memberships.$inferSelect | undefined> {
    const [row] = await this.db.select().from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .limit(1);
    return row;
  }

  async listByOrg(orgId: string): Promise<typeof memberships.$inferSelect[]> {
    return this.db.select().from(memberships).where(eq(memberships.orgId, orgId));
  }

  async listByUser(userId: string): Promise<typeof memberships.$inferSelect[]> {
    return this.db.select().from(memberships).where(eq(memberships.userId, userId));
  }
}
