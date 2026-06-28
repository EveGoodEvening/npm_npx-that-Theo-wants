import { describe, expect, it } from 'vitest';
import {
  AuditAttestation,
  AuditJob,
  PackageName,
  PackageSpec,
  PackageVersion,
  PolicyDecision,
  PolicySet,
  PublishId,
  RetractionRecord,
  RiskReport,
  StageRecord,
  TarballIntegrity,
  VersionStatus,
  Visibility,
  isRetractionEligible,
} from '../src/index.js';

const iso = '2026-06-28T00:00:00.000Z';

const validRiskReport = {
  package: 'is-odd',
  version: '3.0.1',
  publishId: '2ddf0aaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  score: 84,
  tier: 'good',
  confidence: 91,
  generatedAt: iso,
  analyzerVersion: '0.1.0',
  evidenceDigest: 'sha512-abc',
  blockers: [],
  warnings: [
    { code: 'INSTALL_SCRIPT_PRESENT', severity: 'medium', message: 'postinstall', evidence: ['package.json:scripts.postinstall'] },
  ],
  facts: {
    tarball: { sizeBytes: 512345, unpackedSizeBytes: 1838120, fileCount: 76, integrity: 'sha512-aaa' },
    publisher: { name: 'alice', trustedPublisher: true, strongAuth: true },
    source: { repository: 'https://github.com/org/repo', provenance: 'verified', commit: 'abc123' },
    permissions: { declared: {}, inferred: {}, enforceable: true },
  },
  components: [],
} as const;

describe('package schemas', () => {
  it('parses valid unscoped and scoped names', () => {
    expect(PackageName.parse('is-odd')).toBe('is-odd');
    expect(PackageName.parse('@scope/name')).toBe('@scope/name');
  });

  it('rejects invalid package names', () => {
    expect(() => PackageName.parse('')).toThrow();
    expect(() => PackageName.parse('_invalid')).toThrow();
    expect(() => PackageName.parse('@SCOPE/')).toThrow();
  });

  it('parses a registry PackageSpec', () => {
    const spec = PackageSpec.parse({
      raw: 'is-odd@latest',
      name: 'is-odd',
      specifier: 'latest',
      source: 'registry',
    });
    expect(spec.source).toBe('registry');
  });

  it('rejects unknown spec sources', () => {
    expect(() =>
      PackageSpec.parse({ raw: 'x', name: 'x', specifier: '', source: 'ftp' }),
    ).toThrow();
  });

  it('validates integrity strings', () => {
    expect(TarballIntegrity.parse('sha512-abc123=')).toBe('sha512-abc123=');
    expect(() => TarballIntegrity.parse('md5-abc')).toThrow();
  });

  it('parses visibility and version status enums', () => {
    expect(Visibility.parse('private')).toBe('private');
    expect(VersionStatus.parse('staged_public')).toBe('staged_public');
    expect(() => VersionStatus.parse('unknown')).toThrow();
  });

  it('accepts permissive versions and publish ids', () => {
    expect(PackageVersion.parse('1.2.3-beta.0')).toBe('1.2.3-beta.0');
    expect(PublishId.parse('publish-1')).toBe('publish-1');
  });
});

describe('risk report schema', () => {
  it('parses a valid risk report and fills defaults', () => {
    const parsed = RiskReport.parse(validRiskReport);
    expect(parsed.tier).toBe('good');
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.facts.permissions?.enforceable).toBe(true);
  });

  it('round-trips through JSON', () => {
    const parsed = RiskReport.parse(validRiskReport);
    const reparsed = RiskReport.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it('rejects out-of-range score and confidence', () => {
    expect(() => RiskReport.parse({ ...validRiskReport, score: 150 })).toThrow();
    expect(() => RiskReport.parse({ ...validRiskReport, confidence: -1 })).toThrow();
  });

  it('rejects invalid tier', () => {
    expect(() => RiskReport.parse({ ...validRiskReport, tier: 'amazing' })).toThrow();
  });
});

describe('policy schemas', () => {
  it('parses a policy set with defaults', () => {
    const policy = PolicySet.parse({ name: 'default-agent-policy', mode: 'agent' });
    expect(policy.exec.requireExactVersion).toBe(false);
    expect(policy.publish.defaultVisibility).toBe('private');
  });

  it('parses a policy decision', () => {
    const decision = PolicyDecision.parse({
      allow: false,
      decision: 'requires_approval',
      action: 'exec',
      matchedRules: [{ path: 'exec.minimumScore', expected: 90, actual: 82 }],
      overridesAvailable: ['human-approve-exact-version'],
    });
    expect(decision.decision).toBe('requires_approval');
  });
});

describe('audit schemas', () => {
  it('parses an audit job', () => {
    const job = AuditJob.parse({
      id: '00000000-0000-0000-0000-000000000001',
      package: 'is-odd',
      version: '3.0.1',
      publishId: 'pub-1',
      tarballDigest: 'sha512-abc',
      providerId: 'example-auditor',
      mode: 'paid',
      status: 'queued',
      createdAt: iso,
    });
    expect(job.findings).toEqual([]);
  });

  it('parses an audit attestation', () => {
    const att = AuditAttestation.parse({
      id: '00000000-0000-0000-0000-000000000002',
      auditJobId: '00000000-0000-0000-0000-000000000001',
      package: 'is-odd',
      version: '3.0.1',
      publishId: 'pub-1',
      tarballDigest: 'sha512-abc',
      statementType: 'https://in-toto.io/Statement/v1',
      signedPayload: { judgment: 'warn' },
      signature: 'sig',
      provider: 'example-auditor',
      providerVersion: '2026.06.1',
      createdAt: iso,
    });
    expect(att.provider).toBe('example-auditor');
  });
});

describe('stage and retraction schemas', () => {
  it('parses a stage record', () => {
    const stage = StageRecord.parse({
      id: '00000000-0000-0000-0000-000000000003',
      package: 'is-odd',
      version: '3.0.1',
      publishId: 'pub-1',
      createdBy: '00000000-0000-0000-0000-000000000004',
      status: 'pending',
      createdAt: iso,
    });
    expect(stage.status).toBe('pending');
  });

  it('parses a retraction record and checks eligibility', () => {
    const rec = RetractionRecord.parse({
      id: '00000000-0000-0000-0000-000000000005',
      package: 'is-odd',
      version: '3.0.1',
      publishId: 'pub-1',
      actorUserId: '00000000-0000-0000-0000-000000000004',
      reason: 'wrong version',
      mode: 'threshold_retract',
      observedInstallsAtRetract: 5,
      ageSecondsAtRetract: 600,
      semverReuseAllowed: true,
      createdAt: iso,
    });
    expect(rec.mode).toBe('threshold_retract');
    expect(isRetractionEligible(5, 600)).toBe(true);
    expect(isRetractionEligible(150, 6 * 3600)).toBe(false);
    expect(isRetractionEligible(150, 3600)).toBe(true);
  });
});

describe('backward-compatible optional fields', () => {
  it('risk report tolerates missing optional facts', () => {
    const minimal = {
      package: 'pkg',
      version: '1.0.0',
      publishId: 'p1',
      score: 100,
      tier: 'excellent',
      confidence: 100,
      generatedAt: iso,
      analyzerVersion: '0.1.0',
      evidenceDigest: 'sha512-x',
    } as const;
    const parsed = RiskReport.parse(minimal);
    expect(parsed.facts).toEqual({});
    expect(parsed.components).toEqual([]);
  });
});
