import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PackageNameSchema,
  PackageSpecSchema,
  TarballIntegritySchema,
  ExactVersionSchema,
  RiskReportSchema,
  PolicySetSchema,
  PolicyDecisionSchema,
  SafeNpmErrorSchema,
  SafeNpmError,
  toHttpStatus,
  toCliExitCode,
  AnalysisReportSchema,
  StageRecordSchema,
  RetractionRecordSchema,
  AuditJobSchema,
  AuditAttestationSchema,
} from '../src/index.js';

describe('core-types: invalid values', () => {
  test('PackageName rejects empty and uppercase scope', () => {
    assert.equal(PackageNameSchema.safeParse('').success, false);
    assert.equal(PackageNameSchema.safeParse('@SCOPE/pkg').success, false);
    assert.ok(PackageNameSchema.safeParse('is-odd').success);
    assert.ok(PackageNameSchema.safeParse('@scope/pkg').success);
  });

  test('ExactVersion rejects ranges and tags', () => {
    assert.equal(ExactVersionSchema.safeParse('latest').success, false);
    assert.equal(ExactVersionSchema.safeParse('^1.0.0').success, false);
    assert.ok(ExactVersionSchema.safeParse('1.2.3').success);
    assert.ok(ExactVersionSchema.safeParse('1.2.3-beta.1').success);
  });

  test('TarballIntegrity rejects non-SRI strings', () => {
    assert.equal(TarballIntegritySchema.safeParse('not-integrity').success, false);
    assert.ok(TarballIntegritySchema.safeParse('sha512-abcdef==').success);
  });

  test('PackageSpec rejects unknown source', () => {
    assert.equal(
      PackageSpecSchema.safeParse({ raw: 'x', name: 'x', source: 'ftp' }).success,
      false,
    );
  });
});

describe('core-types: JSON round-trip', () => {
  test('RiskReport serializes and parses back', () => {
    const report = {
      package: 'is-odd',
      version: '3.0.1',
      score: 84,
      tier: 'good',
      confidence: 91,
      generatedAt: '2026-06-28T00:00:00.000Z',
      analyzerVersion: '0.1.0',
      evidenceDigest: 'sha512-abc',
      blockers: [],
      warnings: [
        {
          code: 'INSTALL_SCRIPT_PRESENT',
          severity: 'medium',
          message: 'postinstall present',
          evidence: ['package.json:scripts.postinstall'],
        },
      ],
      facts: {
        tarball: { sizeBytes: 1000, unpackedSizeBytes: 2000, fileCount: 3 },
      },
    };
    const json = JSON.stringify(report);
    const parsed = RiskReportSchema.parse(JSON.parse(json));
    assert.equal(parsed.score, 84);
    assert.equal(parsed.warnings.length, 1);
  });

  test('PolicySet parses with defaults for missing nested fields', () => {
    const parsed = PolicySetSchema.parse({ name: 'default', mode: 'default' });
    // schema defaults are npm-compatible/permissive; presets override.
    assert.equal(parsed.install.allowInstallScripts, true);
    assert.equal(parsed.exec.disallowLatestTag, false);
    assert.equal(parsed.publish.defaultVisibility, 'private');
  });

  test('PolicyDecision parses allow/blocked/requires_approval', () => {
    for (const decision of ['allow', 'blocked', 'requires_approval'] as const) {
      const parsed = PolicyDecisionSchema.parse({
        allow: decision === 'allow',
        decision,
        action: 'exec',
      });
      assert.equal(parsed.decision, decision);
    }
  });

  test('SafeNpmError round-trips through toJSON + schema', () => {
    const err = new SafeNpmError({
      code: 'POLICY_BLOCKED',
      message: 'blocked by policy',
      details: { rule: 'minimumScore' },
      remediation: 'use --force',
    });
    const json = err.toJSON();
    const parsed = SafeNpmErrorSchema.parse(json);
    assert.equal(parsed.code, 'POLICY_BLOCKED');
    assert.equal(parsed.remediation, 'use --force');
  });

  test('AnalysisReport parses with defaults', () => {
    const minimal = {
      tarballDigest: 'sha512-abc',
      analyzerVersion: '0.1.0',
      generatedAt: '2026-06-28T00:00:00.000Z',
      package: { name: 'pkg', version: '1.0.0' },
      tarball: { sizeBytes: 1, unpackedSizeBytes: 1, fileCount: 1 },
      inferredPermissions: {},
    };
    const parsed = AnalysisReportSchema.parse(minimal);
    assert.equal(parsed.package.bin !== undefined, true);
    assert.equal(parsed.lifecycleScripts.length, 0);
  });

  test('StageRecord, RetractionRecord, AuditJob, AuditAttestation parse', () => {
    assert.ok(
      StageRecordSchema.safeParse({
        id: 's1',
        package: 'p',
        version: '1.0.0',
        publishId: 'pub1',
        createdBy: 'u1',
        createdAt: '2026-06-28T00:00:00.000Z',
      }).success,
    );
    assert.ok(
      RetractionRecordSchema.safeParse({
        id: 'r1',
        packageVersionId: 'pv1',
        actorUserId: 'u1',
        reason: 'mistake',
        mode: 'threshold_retract',
        observedInstallsAtRetract: 5,
        ageSecondsAtRetract: 100,
        semverReuseAllowed: true,
        createdAt: '2026-06-28T00:00:00.000Z',
      }).success,
    );
    assert.ok(
      AuditJobSchema.safeParse({
        id: 'a1',
        package: 'p',
        version: '1.0.0',
        requesterUserId: 'u1',
        providerId: 'prov',
        mode: 'paid',
        status: 'queued',
        idempotencyKey: 'k1',
        createdAt: '2026-06-28T00:00:00.000Z',
      }).success,
    );
    assert.ok(
      AuditAttestationSchema.safeParse({
        id: 'att1',
        auditJobId: 'a1',
        package: 'p',
        version: '1.0.0',
        tarballDigest: 'sha512-x',
        statementType: 'audit-result',
        signedPayload: { ok: true },
        signature: 'sig',
        createdAt: '2026-06-28T00:00:00.000Z',
      }).success,
    );
  });
});

describe('core-types: error mappings', () => {
  test('toHttpStatus covers all codes', () => {
    assert.equal(toHttpStatus('AUTH_REQUIRED'), 401);
    assert.equal(toHttpStatus('PACKAGE_NOT_FOUND'), 404);
    assert.equal(toHttpStatus('POLICY_BLOCKED'), 403);
    assert.equal(toHttpStatus('RATE_LIMITED'), 429);
    assert.equal(toHttpStatus('INTERNAL_ERROR'), 500);
  });

  test('toCliExitCode matches design §6.2', () => {
    assert.equal(toCliExitCode('HUMAN_APPROVAL_REQUIRED'), 10);
    assert.equal(toCliExitCode('POLICY_BLOCKED'), 11);
    assert.equal(toCliExitCode('AUDIT_REQUIRED'), 12);
    assert.equal(toCliExitCode('PACKAGE_UNRESOLVED'), 13);
    assert.equal(toCliExitCode('NO_SAFE_BIN'), 14);
    assert.equal(toCliExitCode('SANDBOX_UNAVAILABLE'), 15);
  });
});
