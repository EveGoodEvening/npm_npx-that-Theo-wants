/**
 * Security test fixtures (Section 26.1).
 *
 * Builds local fixture tarballs for security testing.
 */
import { create as tarCreate } from 'tar';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface FixtureSpec {
  name: string;
  version: string;
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  files?: Record<string, string>;
  gypFile?: boolean;
  nativeAddon?: boolean;
}

export interface BuiltFixture {
  tarPath: string;
  integrity: string;
  buffer: Buffer;
}

/**
 * Build a fixture tarball from a spec.
 */
export async function buildFixture(spec: FixtureSpec): Promise<BuiltFixture> {
  const work = await mkdtemp(join(tmpdir(), 'fixture-'));
  const staging = join(work, 'staging');
  await mkdir(staging, { recursive: true });

  const files: Array<[string, string]> = [];

  // package.json
  const pkgJson: Record<string, unknown> = {
    name: spec.name,
    version: spec.version,
  };
  if (spec.bin) pkgJson.bin = spec.bin;
  if (spec.scripts) pkgJson.scripts = spec.scripts;
  files.push(['package/package.json', JSON.stringify(pkgJson, null, 2)]);

  // index.js (default)
  const indexContent = spec.files?.['index.js'] ?? 'module.exports = {};\n';
  files.push(['package/index.js', indexContent]);

  // Additional files
  for (const [filename, content] of Object.entries(spec.files ?? {})) {
    if (filename === 'index.js') continue;
    files.push([`package/${filename}`, content]);
  }

  // binding.gyp
  if (spec.gypFile) {
    files.push(['package/binding.gyp', JSON.stringify({
      targets: [{ target_name: 'addon', sources: ['src/addon.cc'] }],
    }, null, 2)]);
  }

  // .node native addon placeholder
  if (spec.nativeAddon) {
    files.push(['package/build/Release/addon.node', 'fake native addon']);
  }

  // Write all files
  for (const [path, content] of files) {
    const fullPath = join(staging, path);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content);
  }

  const tarPath = join(work, 'fixture.tgz');
  await tarCreate(
    { file: tarPath, cwd: staging, gzip: true, portable: true },
    files.map(([p]) => p),
  );

  const buffer = await readFile(tarPath);
  const integrity = `sha512-${createHash('sha512').update(buffer).digest('base64')}`;

  return { tarPath, integrity, buffer };
}

/**
 * Clean up a built fixture's temp directory.
 */
export async function cleanupFixture(tarPath: string): Promise<void> {
  // tarPath is /tmp/fixture-XXX/fixture.tgz — remove /tmp/fixture-XXX
  const dir = join(tarPath, '..');
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

// --- Fixture definitions ---

export const BENIGN_FIXTURE: FixtureSpec = {
  name: 'benign-pkg',
  version: '1.0.0',
  bin: { 'benign-pkg': './index.js' },
  files: {
    'index.js': '#!/usr/bin/env node\nconsole.log("hello");\n',
  },
};

export const POSTINSTALL_FIXTURE: FixtureSpec = {
  name: 'postinstall-pkg',
  version: '1.0.0',
  scripts: { postinstall: 'node ./install.js' },
  files: {
    'install.js': 'console.log("postinstall ran");\n',
  },
};

export const ENV_TOKEN_FIXTURE: FixtureSpec = {
  name: 'env-token-pkg',
  version: '1.0.0',
  files: {
    'index.js': 'const t = process.env.GITHUB_TOKEN; console.log(t);\n',
  },
};

export const CHILD_PROCESS_FIXTURE: FixtureSpec = {
  name: 'child-process-pkg',
  version: '1.0.0',
  files: {
    'index.js': 'const { exec } = require("child_process"); exec("ls", () => {});\n',
  },
};

export const HTTPS_REQUEST_FIXTURE: FixtureSpec = {
  name: 'https-request-pkg',
  version: '1.0.0',
  files: {
    'index.js': 'const https = require("https"); https.request("https://evil.example.com");\n',
  },
};

export const OBFUSCATED_FIXTURE: FixtureSpec = {
  name: 'obfuscated-pkg',
  version: '1.0.0',
  files: {
    'index.js': 'var _0x1a2b=["\x68\x65\x6c\x6c\x6f"];eval(_0x1a2b[0]);\n',
  },
};

export const NATIVE_ADDON_FIXTURE: FixtureSpec = {
  name: 'native-addon-pkg',
  version: '1.0.0',
  nativeAddon: true,
  gypFile: true,
  files: {
    'src/addon.cc': '// native addon placeholder\n',
  },
};

export const BINDING_GYP_FIXTURE: FixtureSpec = {
  name: 'binding-gyp-pkg',
  version: '1.0.0',
  gypFile: true,
};

export const AMBIGUOUS_BINS_FIXTURE: FixtureSpec = {
  name: 'ambiguous-bins-pkg',
  version: '1.0.0',
  bin: { 'pkg-a': './a.js', 'pkg-b': './b.js' },
  files: {
    'a.js': 'console.log("a");\n',
    'b.js': 'console.log("b");\n',
  },
};

export const TYPOSQUAT_FIXTURE: FixtureSpec = {
  name: 'lodsh',
  version: '1.0.0',
  files: {
    'index.js': 'module.exports = {};\n',
  },
};

export const ALL_FIXTURES: Record<string, FixtureSpec> = {
  benign: BENIGN_FIXTURE,
  postinstall: POSTINSTALL_FIXTURE,
  envToken: ENV_TOKEN_FIXTURE,
  childProcess: CHILD_PROCESS_FIXTURE,
  httpsRequest: HTTPS_REQUEST_FIXTURE,
  obfuscated: OBFUSCATED_FIXTURE,
  nativeAddon: NATIVE_ADDON_FIXTURE,
  bindingGyp: BINDING_GYP_FIXTURE,
  ambiguousBins: AMBIGUOUS_BINS_FIXTURE,
  typosquat: TYPOSQUAT_FIXTURE,
};
