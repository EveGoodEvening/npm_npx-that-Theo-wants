import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';

/**
 * Build a tarball from an in-memory file map (relative path -> content).
 * Returns the path to the created .tgz. Does not execute any package code.
 */
export async function buildFixtureTarball(
  files: Record<string, string | Buffer>,
  name = 'fixture',
): Promise<{ tarballPath: string; stagingDir: string; cleanup: () => Promise<void> }> {
  const stagingDir = await mkdtemp(join(tmpdir(), `safe-fix-${name}-`));
  const pkgDir = join(stagingDir, 'package');
  await mkdir(pkgDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(pkgDir, rel);
    const dir = full.slice(0, full.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(full, content);
  }
  const tarballPath = join(stagingDir, `${name}.tgz`);
  await tar.c(
    {
      file: tarballPath,
      cwd: stagingDir,
      gzip: true,
      sync: true,
    },
    ['package'],
  );
  return {
    tarballPath,
    stagingDir,
    cleanup: async () => {
      await rm(stagingDir, { recursive: true, force: true });
    },
  };
}
