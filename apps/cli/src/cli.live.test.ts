import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Live CLI integration tests against the real public npm registry.
 *
 * Skipped unless `SAFE_NPM_RUN_NETWORK_TESTS=1` is set. Verifies the Section 6
 * DoD items:
 *   - `safe-npx preflight is-odd@latest --json` returns valid JSON.
 *   - `safe-npm view is-odd --risk` renders a human risk card.
 *   - `safe-npx is-odd@latest --agent` exits deterministically based on policy.
 */
const RUN_NETWORK = process.env.SAFE_NPM_RUN_NETWORK_TESTS === '1';
const describeNetwork = RUN_NETWORK ? describe : describe.skip;

const SAFE_NPX_BIN = join(fileURLToPath(new URL('../dist/bin/safe-npx.js', import.meta.url)));
const SAFE_NPM_BIN = join(fileURLToPath(new URL('../dist/bin/safe-npm.js', import.meta.url)));

async function runCli(bin: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [bin, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SAFE_NPM_REGISTRY: 'https://registry.npmjs.org' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });
}

describeNetwork('safe-npx preflight (live)', () => {
  it('returns valid JSON for is-odd@latest', async () => {
    const { exitCode, stdout } = await runCli(SAFE_NPX_BIN, ['preflight', 'is-odd@latest', '--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.package).toBe('is-odd');
    expect(parsed.version).toBeTruthy();
    expect(parsed.riskReport.score).toBeGreaterThanOrEqual(0);
    expect(parsed.riskReport.tier).toBeTruthy();
  });
});

describeNetwork('safe-npm view --risk (live)', () => {
  it('renders a human risk card for is-odd', async () => {
    const { exitCode, stdout } = await runCli(SAFE_NPM_BIN, ['view', 'is-odd', '--risk']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('is-odd');
    expect(stdout).toContain('Score:');
    expect(stdout).toContain('/100');
  });
});

describeNetwork('safe-npx --agent (live)', () => {
  it('exits deterministically based on policy', async () => {
    const { exitCode } = await runCli(SAFE_NPX_BIN, ['is-odd@latest', '--agent', '--json']);
    // Agent policy blocks because is-odd@latest uses latest tag and agent requires exact version.
    expect(exitCode).toBe(11);
  });
});
