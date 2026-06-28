import { describe, expect, it } from 'vitest';
import { analyzeStaticFiles } from '../src/index.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'static-analyzer-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('analyzeStaticFiles', () => {
  it('detects fs and child_process imports', async () => {
    await withRoot(async (root) => {
      await writeFile(
        join(root, 'a.js'),
        "import fs from 'fs';\nimport { exec } from 'child_process';\n",
      );
      const res = await analyzeStaticFiles(root, ['a.js']);
      expect(res.builtinsUsed).toContain('fs');
      expect(res.builtinsUsed).toContain('child_process');
      expect(res.findings.some((f) => f.code === 'BUILTIN_FS')).toBe(true);
      expect(res.findings.some((f) => f.code === 'BUILTIN_CHILD_PROCESS')).toBe(true);
    });
  });

  it('detects node: prefixed builtins', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'b.js'), "const https = require('node:https');\n");
      const res = await analyzeStaticFiles(root, ['b.js']);
      expect(res.builtinsUsed).toContain('https');
    });
  });

  it('detects process.env access and secret names', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'c.js'), 'const t = process.env.GITHUB_TOKEN;\n');
      const res = await analyzeStaticFiles(root, ['c.js']);
      expect(res.findings.some((f) => f.code === 'PROCESS_ENV_ACCESS')).toBe(true);
      expect(res.findings.some((f) => f.code === 'SECRET_NAME_ACCESS')).toBe(true);
    });
  });

  it('detects eval and new Function', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'd.js'), 'eval("1+1");\nconst f = new Function("x", "return x");\n');
      const res = await analyzeStaticFiles(root, ['d.js']);
      expect(res.findings.some((f) => f.code === 'EVAL')).toBe(true);
      expect(res.findings.some((f) => f.code === 'NEW_FUNCTION')).toBe(true);
    });
  });

  it('detects dynamic import with non-literal argument', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'e.js'), 'const name = "x";\nimport(name);\n');
      const res = await analyzeStaticFiles(root, ['e.js']);
      expect(res.findings.some((f) => f.code === 'DYNAMIC_IMPORT_NONLITERAL')).toBe(true);
    });
  });

  it('emits PARSE_FAILURE without aborting for unparseable files', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'f.js'), 'function {{{ totally broken');
      const res = await analyzeStaticFiles(root, ['f.js']);
      expect(res.findings.some((f) => f.code === 'PARSE_FAILURE')).toBe(true);
    });
  });

  it('detects base64 decode usage', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'g.js'), "const b = Buffer.from('aGVsbG8=', 'base64');\n");
      const res = await analyzeStaticFiles(root, ['g.js']);
      expect(res.findings.some((f) => f.code === 'BASE64_DECODE_EXEC')).toBe(true);
    });
  });

  it('ignores non-code files', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'readme.md'), '# hi');
      const res = await analyzeStaticFiles(root, ['readme.md']);
      expect(res.findings).toEqual([]);
      expect(res.builtinsUsed).toEqual([]);
    });
  });
});
