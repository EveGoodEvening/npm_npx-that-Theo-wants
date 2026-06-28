/**
 * Repository for billing_accounts and ledger_entries (Section 20.4).
 *
 * Implements a fake credit balance with idempotent charges.
 */
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { billingAccounts, ledgerEntries } from '../schema.js';

export class BillingRepository {
  constructor(private db: DbClient) {}

  async findOrCreateAccount(userId: string): Promise<typeof billingAccounts.$inferSelect> {
    const [existing] = await this.db.select().from(billingAccounts)
      .where(eq(billingAccounts.userId, userId)).limit(1);
    if (existing) return existing;

    const [row] = await this.db.insert(billingAccounts).values({
      userId,
      creditBalance: 1000, // Fake starting credit for MVP.
    }).returning();
    return row!;
  }

  async getBalance(userId: string): Promise<number> {
    const account = await this.findOrCreateAccount(userId);
    return account.creditBalance;
  }

  /**
   * Reserve credits for an audit job. Idempotent by idempotencyKey.
   * Returns true if reserved (or already reserved), false if insufficient balance.
   */
  async reserve(accountId: string, amount: number, idempotencyKey: string, auditJobId?: string): Promise<boolean> {
    // Check if already reserved with this idempotency key.
    const [existing] = await this.db.select().from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) return true;

    const [account] = await this.db.select().from(billingAccounts)
      .where(eq(billingAccounts.id, accountId)).limit(1);
    if (!account) return false;
    if (account.creditBalance < amount) return false;

    await this.db.update(billingAccounts).set({
      creditBalance: account.creditBalance - amount,
      updatedAt: new Date(),
    }).where(eq(billingAccounts.id, accountId));

    await this.db.insert(ledgerEntries).values({
      accountId,
      auditJobId,
      type: 'reserve',
      amount,
      idempotencyKey,
      description: 'audit job reservation',
    });

    return true;
  }

  /**
   * Capture reserved credits after provider accepts/delivers.
   * Idempotent by idempotencyKey.
   */
  async capture(accountId: string, amount: number, idempotencyKey: string, auditJobId?: string): Promise<void> {
    const [existing] = await this.db.select().from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.idempotencyKey, idempotencyKey),
        eq(ledgerEntries.type, 'capture'),
      )).limit(1);
    if (existing) return;

    await this.db.insert(ledgerEntries).values({
      accountId,
      auditJobId,
      type: 'capture',
      amount,
      idempotencyKey,
      description: 'audit job captured',
    });
  }

  /**
   * Refund reserved credits after provider error.
   * Idempotent by idempotencyKey.
   */
  async refund(accountId: string, amount: number, idempotencyKey: string, auditJobId?: string): Promise<void> {
    const [existing] = await this.db.select().from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.idempotencyKey, idempotencyKey),
        eq(ledgerEntries.type, 'refund'),
      )).limit(1);
    if (existing) return;

    const [account] = await this.db.select().from(billingAccounts)
      .where(eq(billingAccounts.id, accountId)).limit(1);
    if (!account) return;

    await this.db.update(billingAccounts).set({
      creditBalance: account.creditBalance + amount,
      updatedAt: new Date(),
    }).where(eq(billingAccounts.id, accountId));

    await this.db.insert(ledgerEntries).values({
      accountId,
      auditJobId,
      type: 'refund',
      amount,
      idempotencyKey,
      description: 'audit job refund',
    });
  }

  async listLedgerEntries(accountId: string): Promise<typeof ledgerEntries.$inferSelect[]> {
    return this.db.select().from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId));
  }
}
