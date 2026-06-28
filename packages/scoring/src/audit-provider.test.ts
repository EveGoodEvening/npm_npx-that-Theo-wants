import { describe, expect, it } from 'vitest';
import { MockAuditProvider } from './audit-provider.js';

describe('MockAuditProvider', () => {
  it('submits and returns results', async () => {
    const provider = new MockAuditProvider();
    const { jobId } = await provider.submit({
      package: 'test-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-abc',
    });
    expect(jobId).toBeDefined();

    const result = await provider.getResult(jobId);
    expect(result).toBeDefined();
    expect(result?.package).toBe('test-pkg');
    expect(result?.version).toBe('1.0.0');
    expect(result?.tarballDigest).toBe('sha512-abc');
    expect(result?.judgment).toBe('pass');
    expect(result?.scoreAdjustment).toBe(0);
    expect(result?.signature).toBeDefined();
  });

  it('returns deterministic results from fixtures', async () => {
    const fixtures = new Map([
      ['sha512-bad', {
        judgment: 'fail' as const,
        scoreAdjustment: -50,
        findings: [{
          id: 'MALWARE',
          severity: 'critical' as const,
          confidence: 0.99,
          evidence: ['install.js:1'],
          summary: 'Malicious install script',
        }],
      }],
    ]);
    const provider = new MockAuditProvider({ fixtures });
    const { jobId } = await provider.submit({
      package: 'bad-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-bad',
    });
    const result = await provider.getResult(jobId);
    expect(result?.judgment).toBe('fail');
    expect(result?.scoreAdjustment).toBe(-50);
    expect(result?.findings.length).toBe(1);
    expect(result?.findings[0]?.id).toBe('MALWARE');
  });

  it('verifies valid signatures', async () => {
    const provider = new MockAuditProvider();
    const { jobId } = await provider.submit({
      package: 'test-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-abc',
    });
    const result = await provider.getResult(jobId);
    expect(result).toBeDefined();
    const valid = await provider.verifyResult(result!);
    expect(valid).toBe(true);
  });

  it('rejects tampered signatures', async () => {
    const provider = new MockAuditProvider();
    const { jobId } = await provider.submit({
      package: 'test-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-abc',
    });
    const result = await provider.getResult(jobId);
    expect(result).toBeDefined();
    // Tamper with the signature.
    const tampered = { ...result!, signature: 'invalid-signature' };
    const valid = await provider.verifyResult(tampered);
    expect(valid).toBe(false);
  });

  it('returns public keys', async () => {
    const provider = new MockAuditProvider();
    const keys = await provider.getPublicKeys();
    expect(keys.length).toBe(1);
    expect(keys[0]?.id).toBeDefined();
    expect(keys[0]?.algorithm).toBe('ed25519');
    expect(keys[0]?.pem).toContain('PUBLIC KEY');
  });

  it('returns undefined for unknown job', async () => {
    const provider = new MockAuditProvider();
    const result = await provider.getResult('unknown-id');
    expect(result).toBeUndefined();
  });

  it('cancels jobs', async () => {
    const provider = new MockAuditProvider();
    const { jobId } = await provider.submit({
      package: 'test-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-abc',
    });
    await provider.cancel(jobId);
    const result = await provider.getResult(jobId);
    expect(result).toBeUndefined();
  });

  it('simulates delay', async () => {
    const provider = new MockAuditProvider({ delayMs: 100 });
    const { jobId } = await provider.submit({
      package: 'test-pkg',
      version: '1.0.0',
      tarballDigest: 'sha512-abc',
    });
    // Immediately should not be ready.
    const immediate = await provider.getResult(jobId);
    expect(immediate).toBeUndefined();
    // After delay should be ready.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = await provider.getResult(jobId);
    expect(result).toBeDefined();
  });
});
