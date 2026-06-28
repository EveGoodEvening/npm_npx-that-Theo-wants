import { describe, expect, it } from 'vitest';
import { analyzeReadability } from '../src/index.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'readability-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('analyzeReadability', () => {
  it('marks normal readable code as not minified/obfuscated', async () => {
    await withRoot(async (root) => {
      await writeFile(
        join(root, 'index.js'),
        'function add(a, b) {\n  return a + b;\n}\nmodule.exports = add;\n',
      );
      const r = await analyzeReadability(root, ['index.js']);
      expect(r.likelyMinified).toBe(false);
      expect(r.likelyObfuscated).toBe(false);
      expect(r.humanReadableFileRatio).toBe(1);
    });
  });

  it('detects minified code via long lines', async () => {
    await withRoot(async (root) => {
      const longLine = 'var a=' + 'x'.repeat(300) + ';';
      await writeFile(join(root, 'min.js'), longLine + '\n' + longLine + '\n');
      const r = await analyzeReadability(root, ['min.js']);
      expect(r.likelyMinified).toBe(true);
      expect(r.minifiedLineRatio).toBeGreaterThan(0.5);
    });
  });

  it('detects source maps presence', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, 'index.js'), 'console.log(1);\n');
      await writeFile(join(root, 'index.js.map'), '{}');
      const r = await analyzeReadability(root, ['index.js', 'index.js.map']);
      expect(r.sourceMapsPresent).toBe(true);
    });
  });

  it('flags giant string arrays as obfuscation', async () => {
    await withRoot(async (root) => {
      const arr = 'const x = [' + Array.from({ length: 120 }, (_, i) => `"s${i}"`).join(',') + '];';
      await writeFile(join(root, 'obf.js'), arr);
      const r = await analyzeReadability(root, ['obf.js']);
      expect(r.giantStringArrays).toBe(true);
      expect(r.likelyObfuscated).toBe(true);
    });
  });
});
