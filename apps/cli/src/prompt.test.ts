import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runSafeNpx, runSafeNpm } from '../src/index.js';
import { runPreflight, type PreflightResult } from '../src/preflight.js';
import { resolveBin } from '@safe-npm/npm-compat';
import type { RiskReport, PolicyDecision } from '@safe-npm/core-types';

// Mock the preflight to avoid network calls.
vi.mock('../src/preflight.js', () => ({
  runPreflight: vi.fn(),
  renderTty: vi.fn(() => 'mock tty'),
  inferPermissions: vi.fn(() => ({})),
  PreflightError: class extends Error {
    code: string;
    constructor(m: string, c: string) { super(m); this.code = c; }
  },
}));

const mockRunPreflight = vi.mocked(runPreflight);

function makeMockResult(overrides: Partial<PreflightResult> = {}): PreflightResult {
  return {
    spec: { raw: 'test-pkg', name: 'test-pkg', specifier: '', source: 'registry' },
    resolvedVersion: '1.0.0',
    binCommand: 'test-pkg',
    analysisReport: {
      package: 'test-pkg',
      version: '1.0.0',
      publishId: 'pub-1',
      tarballDigest: 'sha512-test',
      analyzerVersion: '0.1.0',
      generatedAt: '2026-06-28T00:00:00.000Z',
      tarball: { sizeBytes: 100, unpackedSizeBytes: 200, fileCount: 2 },
      metadata: { name: 'test-pkg', version: '1.0.0', scripts: {}, dependencies: {}, devDependencies: {}, optionalDependencies: {}, peerDependencies: {}, bundledDependencies: [], files: [], contributors: [], maintainers: [] },
      lifecycleScripts: [],
      staticFindings: [],
      readability: { likelyMinified: false, likelyObfuscated: false, sourceMapsPresent: false, humanReadableFileRatio: 1, minifiedLineRatio: 0, giantStringArrays: false },
      nativeArtifacts: [],
      builtinsUsed: [],
    } as never,
    riskReport: { package: 'test-pkg', version: '1.0.0', publishId: 'pub-1', score: 90, tier: 'excellent', confidence: 95, generatedAt: '2026-06-28T00:00:00.000Z', analyzerVersion: '0.1.0', evidenceDigest: 'sha256:abc', blockers: [], warnings: [], facts: {}, components: [] } as RiskReport,
    policyDecision: null,
    tarballPath: '/tmp/test.tgz',
    ...overrides,
  } as PreflightResult;
}

let exitCode: number | undefined;

beforeEach(() => {
  exitCode = undefined;
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    exitCode = code;
    return undefined as never;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('safe-npx exit codes', () => {
  it('exits with code 11 when policy blocks', async () => {
    mockRunPreflight.mockResolvedValue(
      makeMockResult({
        policyDecision: {
          allow: false,
          decision: 'block',
          action: 'exec',
          matchedRules: [{ path: 'exec.minimumScore', expected: '>= 75', actual: 50 }],
          overridesAvailable: ['--force'],
          reason: 'exec.minimumScore',
        } as PolicyDecision,
      }),
    );

    await runSafeNpx(['test-pkg', '--agent', '--json']);
    expect(exitCode).toBe(11);
  });

  it('exits with code 10 when policy requires approval in agent mode', async () => {
    mockRunPreflight.mockResolvedValue(
      makeMockResult({
        riskReport: { score: 60, tier: 'caution' } as Partial<RiskReport> as RiskReport,
        policyDecision: {
          allow: false,
          decision: 'requires_approval',
          action: 'exec',
          matchedRules: [{ path: 'exec.cautionTier', expected: 'not caution', actual: 'caution' }],
          overridesAvailable: ['--yes'],
          reason: 'exec.cautionTier',
        } as PolicyDecision,
      }),
    );

    await runSafeNpx(['test-pkg', '--agent', '--json']);
    expect(exitCode).toBe(10);
  });

  it('exits with code 0 when --yes bypasses approval', async () => {
    mockRunPreflight.mockResolvedValue(
      makeMockResult({
        riskReport: { score: 60, tier: 'caution' } as Partial<RiskReport> as RiskReport,
        policyDecision: {
          allow: false,
          decision: 'requires_approval',
          action: 'exec',
          matchedRules: [{ path: 'exec.cautionTier', expected: 'not caution', actual: 'caution' }],
          overridesAvailable: ['--yes'],
          reason: 'exec.cautionTier',
        } as PolicyDecision,
      }),
    );

    await runSafeNpx(['test-pkg', '--agent', '--yes', '--json']);
    expect(exitCode).toBe(0);
  });

  it('exits with code 0 when policy allows', async () => {
    mockRunPreflight.mockResolvedValue(
      makeMockResult({
        policyDecision: {
          allow: true,
          decision: 'allow',
          action: 'exec',
          matchedRules: [],
          overridesAvailable: [],
        } as PolicyDecision,
      }),
    );

    await runSafeNpx(['test-pkg', '--json']);
    expect(exitCode).toBe(0);
  });
});

describe('JSON error output', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      return undefined as never;
    });
  });

  it('outputs structured JSON for CliError', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // --registry without a value triggers CliError (MISSING_FLAG_VALUE).
    await runSafeNpx(['--json', '--registry']);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('"error"');
    expect(output).toContain('"code"');
    logSpy.mockRestore();
  });

  it('outputs structured JSON for unknown command', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runSafeNpm(['unknown-command', '--json']);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('"error"');
    expect(output).toContain('unknown command');
    logSpy.mockRestore();
  });
});

describe('bin resolution at CLI level', () => {
  it('resolves single string bin', () => {
    const v = { name: 'x', version: '1.0.0', bin: 'cli.js' } as never;
    expect(resolveBin(v, 'x')).toEqual({ binName: 'x', binPath: 'cli.js' });
  });

  it('resolves single object bin entry', () => {
    const v = { name: 'x', version: '1.0.0', bin: { tool: 'cli.js' } } as never;
    expect(resolveBin(v, 'x')).toEqual({ binName: 'tool', binPath: 'cli.js' });
  });

  it('resolves multi-bin matching unscoped package name', () => {
    const v = { name: 'x', version: '1.0.0', bin: { other: 'o.js', x: 'cli.js' } } as never;
    expect(resolveBin(v, 'x')).toEqual({ binName: 'x', binPath: 'cli.js' });
  });

  it('returns null for ambiguous bins with no name match', () => {
    const v = { name: 'x', version: '1.0.0', bin: { a: 'a.js', b: 'b.js' } } as never;
    expect(resolveBin(v, 'x')).toBeNull();
  });

  it('resolves scoped package bin to unscoped name', () => {
    const v = { name: 'x', version: '1.0.0', bin: 'cli.js' } as never;
    expect(resolveBin(v, '@scope/x')).toEqual({ binName: 'x', binPath: 'cli.js' });
  });
});
