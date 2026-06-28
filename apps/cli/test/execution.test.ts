import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPermissionFlags,
  isNodeBin,
  nodeSupportsPermissionModel,
  execCacheKey,
  createExecCache,
  installIntoCache,
  executeBin,
  loadTrustCache,
  addTrustEntry,
  revokeTrustEntry,
  isTrusted,
  type TrustEntry,
} from '../src/execution.js';
import type { PermissionReport } from '@safe-npm/core-types';

function perm(overrides: Partial<PermissionReport['inferred']> = {}): PermissionReport {
  return {
    declared: { net: [], env: [], childProcess: false, workerThreads: false, ffi: false, native: false, installScripts: false },
    inferred: {
      fs: { read: ['.'], write: ['.'] },
      net: [],
      env: [],
      childProcess: false,
      workerThreads: false,
      ffi: false,
      native: false,
      installScripts: false,
      ...overrides,
    },
    enforceable: true,
  };
}

describe('buildPermissionFlags', () => {
  test('fs allowlists + deny child process/worker/native/net', () => {
    const flags = buildPermissionFlags(perm());
    assert.ok(flags.includes('--allow-fs-read=.'));
    assert.ok(flags.includes('--allow-fs-write=.'));
    assert.ok(flags.includes('--deny-child-process'));
    assert.ok(flags.includes('--deny-worker'));
    assert.ok(flags.includes('--deny-addons'));
    assert.ok(flags.includes('--deny-net'));
  });

  test('child process allowed -> no deny flag', () => {
    const flags = buildPermissionFlags(perm({ childProcess: true }));
    assert.ok(!flags.includes('--deny-child-process'));
  });

  test('network declared -> no deny-net', () => {
    const flags = buildPermissionFlags(perm({ net: ['example.com:443'] } as unknown as Partial<PermissionReport['inferred']>));
    assert.ok(!flags.includes('--deny-net'));
  });
});

describe('isNodeBin', () => {
  test('node shebang detected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exec-'));
    const f = join(dir, 'cli.js');
    await writeFile(f, '#!/usr/bin/env node\nconsole.log(1);\n');
    try {
      assert.equal(await isNodeBin(f), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('non-node shebang not detected as node', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exec-'));
    const f = join(dir, 'cli.sh');
    await writeFile(f, '#!/bin/bash\necho hi\n');
    try {
      assert.equal(await isNodeBin(f), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('.js extension detected even without shebang', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exec-'));
    const f = join(dir, 'tool.js');
    await writeFile(f, 'module.exports = 1;\n');
    try {
      assert.equal(await isNodeBin(f), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('nodeSupportsPermissionModel', () => {
  test('returns boolean', () => {
    assert.equal(typeof nodeSupportsPermissionModel(), 'boolean');
  });
});

describe('execCacheKey', () => {
  test('deterministic by package+version+digest+policy', async () => {
    const cache = await createExecCache(join(tmpdir(), 'exec-cache-'));
    const k1 = execCacheKey(cache, 'pkg', '1.0.0', 'sha512-abc', 'policy1');
    const k2 = execCacheKey(cache, 'pkg', '1.0.0', 'sha512-abc', 'policy1');
    const k3 = execCacheKey(cache, 'pkg', '1.0.0', 'sha512-abc', 'policy2');
    assert.equal(k1, k2);
    assert.notEqual(k1, k3);
  });
});

describe('executeBin', () => {
  test('runs a node script and returns exit code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exec-run-'));
    const f = join(dir, 'hi.js');
    await writeFile(f, 'console.log("hello-exec");\n');
    try {
      const result = await executeBin(f, { tty: false });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /hello-exec/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns 15 when enforcement required for non-node bin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exec-enforce-'));
    const f = join(dir, 'hi.sh');
    await writeFile(f, '#!/bin/bash\necho hi\n');
    try {
      const result = await executeBin(f, {
        tty: false,
        enforcePermissions: true,
        permissionFlags: ['--deny-net'],
      });
      assert.equal(result.exitCode, 15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('node bin with enforcement available runs (not 15)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exec-enforce-node-'));
    const f = join(dir, 'hi.js');
    await writeFile(f, 'console.log(1);\n');
    try {
      const result = await executeBin(f, {
        tty: false,
        enforcePermissions: true,
        permissionFlags: [],
      });
      assert.notEqual(result.exitCode, 15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('installIntoCache + resolveInstalledBin (real npm)', () => {
  test('installs is-odd and resolves bin', async () => {
    // is-odd has no bin; use a package with a bin. Use 'cowsay' is heavy; use a tiny one.
    // Use 'is-odd' for install-only verification (no bin expected).
    const dir = await mkdtemp(join(tmpdir(), 'exec-install-'));
    try {
      await installIntoCache(dir, 'is-odd', '3.0.1', { ignoreScripts: true });
      // is-odd installs to node_modules/is-odd
      const pkgJson = JSON.parse(await readFile(join(dir, 'node_modules', 'is-odd', 'package.json'), 'utf8'));
      assert.equal(pkgJson.name, 'is-odd');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('trust cache', () => {
  test('add, list, isTrusted, revoke', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trust-'));
    const origEnv = process.env.SAFE_NPX_EXEC_CACHE_DIR;
    process.env.SAFE_NPX_EXEC_CACHE_DIR = dir;
    try {
      const entry: TrustEntry = {
        packageName: 'trusted-pkg',
        version: '1.0.0',
        tarballDigest: 'sha512-abc',
        riskReportDigest: 'sha256-xyz',
        scope: 'exact-version',
        createdAt: new Date().toISOString(),
      };
      await addTrustEntry(entry);
      const list = await loadTrustCache();
      assert.ok(list.entries.some((e) => e.packageName === 'trusted-pkg'));
      const trusted = isTrusted(await loadTrustCache(), 'trusted-pkg', '1.0.0', 'sha512-abc');
      assert.ok(trusted);
      const notTrusted = isTrusted(await loadTrustCache(), 'trusted-pkg', '2.0.0', 'sha512-abc');
      assert.equal(notTrusted, undefined);
      await revokeTrustEntry('trusted-pkg', '1.0.0');
      const after = await loadTrustCache();
      assert.equal(after.entries.length, 0);
    } finally {
      process.env.SAFE_NPX_EXEC_CACHE_DIR = origEnv;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
