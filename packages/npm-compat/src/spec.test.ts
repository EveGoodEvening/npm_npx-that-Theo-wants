import { describe, expect, it } from 'vitest';
import { parsePackageSpec, InvalidSpecError, UnsupportedSourceError } from '../src/index.js';

describe('parsePackageSpec', () => {
  it('parses unscoped name with no specifier (defaults to empty/latest)', () => {
    const spec = parsePackageSpec('is-odd');
    expect(spec.name).toBe('is-odd');
    expect(spec.source).toBe('registry');
  });

  it('parses scoped names', () => {
    const spec = parsePackageSpec('@scope/pkg');
    expect(spec.name).toBe('@scope/pkg');
    expect(spec.source).toBe('registry');
  });

  it('parses exact versions', () => {
    const spec = parsePackageSpec('is-odd@3.0.1');
    expect(spec.name).toBe('is-odd');
    expect(spec.specifier).toBe('3.0.1');
    expect(spec.source).toBe('registry');
  });

  it('parses dist-tags', () => {
    const spec = parsePackageSpec('is-odd@latest');
    expect(spec.specifier).toBe('latest');
  });

  it('parses semver ranges', () => {
    const spec = parsePackageSpec('is-odd@^3.0.0');
    expect(spec.specifier).toBe('^3.0.0');
  });

  it('parses scoped name with version', () => {
    const spec = parsePackageSpec('@scope/pkg@1.2.3');
    expect(spec.name).toBe('@scope/pkg');
    expect(spec.specifier).toBe('1.2.3');
  });

  it('rejects invalid specifiers', () => {
    expect(() => parsePackageSpec('')).toThrow(InvalidSpecError);
    expect(() => parsePackageSpec('@@invalid')).toThrow(InvalidSpecError);
  });

  it('rejects non-registry sources in strict mode', () => {
    expect(() => parsePackageSpec('git+https://github.com/x/y.git', true)).toThrow(
      UnsupportedSourceError,
    );
    expect(() => parsePackageSpec('file:./pkg', true)).toThrow(UnsupportedSourceError);
    expect(() => parsePackageSpec('https://example.com/pkg.tgz', true)).toThrow(
      UnsupportedSourceError,
    );
  });

  it('allows registry specs in strict mode', () => {
    expect(() => parsePackageSpec('is-odd@3.0.1', true)).not.toThrow();
    expect(() => parsePackageSpec('is-odd@latest', true)).not.toThrow();
    expect(() => parsePackageSpec('is-odd@^1.0.0', true)).not.toThrow();
  });

  it('classifies non-registry sources when not strict', () => {
    expect(parsePackageSpec('git+https://github.com/x/y.git').source).toBe('git');
    expect(parsePackageSpec('file:./pkg.tgz').source).toBe('file');
    expect(parsePackageSpec('file:./pkg').source).toBe('directory');
    expect(parsePackageSpec('https://example.com/pkg.tgz').source).toBe('remote');
  });
});
