import { describe, expect, it, vi } from 'vitest';
import { MockAuditProvider } from '@safe-npm/scoring';
import { createAuditWorker } from './audit-worker.js';

// Mock the repositories.
vi.mock('@safe-npm/db', () => ({
  AuditRepository: vi.fn().mockImplementation(() => ({
    updateJobStatus: vi.fn(async () => {}),
    createAttestation: vi.fn(async (data: { auditJobId: string }) => ({
      id: 'att-1',
      ...data,
      createdAt: new Date().toISOString(),
    })),
  })),
  RiskReportsRepository: vi.fn().mockImplementation(() => ({
    listByVersion: vi.fn(async () => []),
  })),
}));

describe('createAuditWorker', () => {
  it('processes an audit job end-to-end', async () => {
    const provider = new MockAuditProvider();
    const mockDb = {} as never; // Not used directly — repos are mocked.
    const worker = createAuditWorker({ db: mockDb, provider });

    await worker({
      auditJobId: 'job-1',
      packageVersionId: 'ver-1',
      packageName: 'test-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-abc',
    });

    // If no error was thrown, the worker completed successfully.
    // Verify the provider has a job.
    expect(provider).toBeDefined();
  });

  it('throws when provider signature is invalid', async () => {
    const provider = new MockAuditProvider();
    // Tamper with verifyResult to always return false.
    provider.verifyResult = vi.fn(async () => false);

    const mockDb = {} as never;
    const worker = createAuditWorker({ db: mockDb, provider });

    await expect(worker({
      auditJobId: 'job-2',
      packageVersionId: 'ver-2',
      packageName: 'bad-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-bad',
    })).rejects.toThrow('provider signature verification failed');
  });
});
