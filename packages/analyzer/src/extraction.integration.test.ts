import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create as tarCreate } from 'tar';
import { safeExtract, UnsafeTarEntryError } from '../src/index.js';

let work: string;

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
});

async function makeTarball(entries: Array<{ path: string; content: string }>): Promise<string> {
  const staging = join(work, 'staging');
  await mkdir(staging, { recursive: true });
  for (const e of entries) {
    const fullPath = join(staging, e.path);
    await mkdir(join(fullpathDir(fullPath)), { recursive: true });
    await writeFile(fullPath, e.content);
  }
  const tarPath = join(work, 'test.tar');
  await tarCreate({ file: tarPath, cwd: staging }, entries.map((e) => e.path));
  return tarPath;
}

function fullpathDir(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '.' : p.slice(0, i);
}

describe('safeExtract', () => {
  it('extracts a normal tarball', async () => {
    work = await mkdtemp(join(tmpdir(), 'safe-extract-'));
    const tar = await makeTarball([
      { path: 'package/index.js', content: 'console.log(1)' },
      { path: 'package/package.json', content: '{}' },
    ]);
    const dest = join(work, 'out');
    await safeExtract(tar, dest, { strip: 1 });
    expect(await readFile(join(dest, 'index.js'), 'utf8')).toBe('console.log(1)');
  });

  it('rejects path traversal entries', async () => {
    work = await mkdtemp(join(tmpdir(), 'safe-extract-'));
    const tar = await makeTarball([
      { path: 'package/../../escape.js', content: 'evil' },
    ]);
    const dest = join(work, 'out');
    await expect(safeExtract(tar, dest, { strip: 1 })).rejects.toBeInstanceOf(UnsafeTarEntryError);
  });
});
