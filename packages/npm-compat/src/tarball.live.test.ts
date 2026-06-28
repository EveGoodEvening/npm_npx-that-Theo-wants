import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadTarball, fetchPackument, resolveVersion } from '../src/index.js';

/**
 * Live integration test against the real public npm registry.
 *
 * Skipped unless `SAFE_NPM_RUN_NETWORK_TESTS=1` is set, so it does not run in
 * normal `pnpm check` / CI. Run locally with:
 *   SAFE_NPM_RUN_NETWORK_TESTS=1 pnpm --filter @safe-npm/npm-compat test
 *
 * Verifies the DoD: "The package can resolve and download a public npm tarball
 * without executing code."
 */
const RUN_NETWORK = process.env.SAFE_NPM_RUN_NETWORK_TESTS === '1';
const describeNetwork = RUN_NETWORK ? describe : describe.skip;

describeNetwork('live npm registry integration', () => {
  let tmp: string;

  it('resolves and downloads is-odd@latest without executing code', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'safe-npm-live-'));
    try {
      const registry = 'https://registry.npmjs.org';
      const fetched = await fetchPackument(registry, 'is-odd');
      expect(fetched.packument).not.toBeNull();
      const version = resolveVersion(fetched.packument!, 'latest');
      expect(version).toBeTruthy();
      const ver = fetched.packument!.versions![version!];
      expect(ver.dist?.tarball).toBeTruthy();
      expect(ver.dist?.integrity).toBeTruthy();

      const dest = join(tmp, 'is-odd.tgz');
      const res = await downloadTarball(ver.dist!.tarball!, dest, {
        expectedIntegrity: ver.dist!.integrity,
        maxBytes: 10_000_000,
      });
      expect(res.size).toBeGreaterThan(0);
      expect(res.integrity).toBe(ver.dist!.integrity);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
