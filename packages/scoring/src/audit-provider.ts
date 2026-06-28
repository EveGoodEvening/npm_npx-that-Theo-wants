/**
 * Paid audit provider adapter interface and mock provider (Section 20.2).
 *
 * The provider contract (design 11.4):
 *   POST /audit-jobs
 *   GET  /audit-jobs/:id
 *   POST /audit-jobs/:id/cancel
 *   GET  /public-keys
 */
import { sign, verify, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { randomUUID } from 'node:crypto';

export type AuditJudgment = 'pass' | 'warn' | 'fail';

export interface AuditFinding {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  evidence: string[];
  summary: string;
}

export interface ProviderAuditResult {
  provider: string;
  providerVersion: string;
  package: string;
  version: string;
  tarballDigest: string;
  judgment: AuditJudgment;
  scoreAdjustment: number;
  findings: AuditFinding[];
  signedAt: string;
  signature: string;
}

export interface ProviderSubmitRequest {
  package: string;
  version: string;
  tarballDigest: string;
  evidenceBundle?: unknown;
}

export interface ProviderPublicKey {
  id: string;
  algorithm: string;
  pem: string;
}

export interface AuditProvider {
  /** Submit an audit job. Returns a job ID. */
  submit(req: ProviderSubmitRequest): Promise<{ jobId: string }>;
  /** Poll for a result. Returns undefined if not ready. */
  getResult(jobId: string): Promise<ProviderAuditResult | undefined>;
  /** Cancel a job. */
  cancel(jobId: string): Promise<void>;
  /** Get the provider's public keys for signature verification. */
  getPublicKeys(): Promise<ProviderPublicKey[]>;
  /** Verify a provider signature. */
  verifyResult(result: ProviderAuditResult): Promise<boolean>;
}

export interface MockProviderOptions {
  /** Deterministic results from fixtures keyed by tarball digest. */
  fixtures?: Map<string, {
    judgment: AuditJudgment;
    scoreAdjustment: number;
    findings: AuditFinding[];
  }>;
  /** Simulate delay before results are available (ms). */
  delayMs?: number;
}

/**
 * Mock audit provider that returns deterministic results from fixtures.
 *
 * Generates an Ed25519 key pair on construction for signing/verifying results.
 */
export class MockAuditProvider implements AuditProvider {
  readonly provider = 'mock-auditor';
  readonly providerVersion = '2026.06.1';
  private privateKey: KeyObject;
  private publicKey: KeyObject;
  private publicKeyId: string;
  private jobs = new Map<string, { req: ProviderSubmitRequest; submittedAt: number; result?: ProviderAuditResult }>();
  private fixtures: Map<string, { judgment: AuditJudgment; scoreAdjustment: number; findings: AuditFinding[] }>;
  private delayMs: number;

  constructor(options: MockProviderOptions = {}) {
    // Generate a new Ed25519 key pair for each provider instance.
    // This is fine for a mock provider used in tests.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.publicKeyId = 'mock-key-1';
    this.fixtures = options.fixtures ?? new Map();
    this.delayMs = options.delayMs ?? 0;
  }

  async submit(req: ProviderSubmitRequest): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    this.jobs.set(jobId, { req, submittedAt: Date.now() });
    return { jobId };
  }

  async getResult(jobId: string): Promise<ProviderAuditResult | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    // Simulate delay.
    if (this.delayMs > 0 && Date.now() - job.submittedAt < this.delayMs) {
      return undefined;
    }

    if (job.result) return job.result;

    // Generate deterministic result from fixture or default.
    const fixture = this.fixtures.get(job.req.tarballDigest);
    const judgment = fixture?.judgment ?? 'pass';
    const scoreAdjustment = fixture?.scoreAdjustment ?? 0;
    const findings = fixture?.findings ?? [];

    const signedAt = new Date().toISOString();
    const payload = this.canonicalPayload({
      provider: this.provider,
      providerVersion: this.providerVersion,
      package: job.req.package,
      version: job.req.version,
      tarballDigest: job.req.tarballDigest,
      judgment,
      scoreAdjustment,
      findings,
      signedAt,
    });

    const signature = sign(null, Buffer.from(payload), this.privateKey).toString('base64');

    const result: ProviderAuditResult = {
      provider: this.provider,
      providerVersion: this.providerVersion,
      package: job.req.package,
      version: job.req.version,
      tarballDigest: job.req.tarballDigest,
      judgment,
      scoreAdjustment,
      findings,
      signedAt,
      signature,
    };

    job.result = result;
    return result;
  }

  async cancel(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async getPublicKeys(): Promise<ProviderPublicKey[]> {
    return [{
      id: this.publicKeyId,
      algorithm: 'ed25519',
      pem: this.publicKey.export({ type: 'spki', format: 'pem' }) as string,
    }];
  }

  async verifyResult(result: ProviderAuditResult): Promise<boolean> {
    const payload = this.canonicalPayload(result);
    return verify(null, Buffer.from(payload), this.publicKey, Buffer.from(result.signature, 'base64'));
  }

  getPublicKeyId(): string {
    return this.publicKeyId;
  }

  private canonicalPayload(result: Omit<ProviderAuditResult, 'signature'>): string {
    return JSON.stringify({
      provider: result.provider,
      providerVersion: result.providerVersion,
      package: result.package,
      version: result.version,
      tarballDigest: result.tarballDigest,
      judgment: result.judgment,
      scoreAdjustment: result.scoreAdjustment,
      findings: result.findings,
      signedAt: result.signedAt,
    }, Object.keys(result).sort());
  }
}
