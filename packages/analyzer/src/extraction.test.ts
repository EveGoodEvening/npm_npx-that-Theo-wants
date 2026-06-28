import { describe, expect, it } from 'vitest';
import { validateEntryPath, UnsafeTarEntryError } from '../src/index.js';

describe('validateEntryPath', () => {
  it('accepts normal relative paths', () => {
    expect(validateEntryPath('package/index.js', '/dest', 0)).toBe('package/index.js');
    expect(validateEntryPath('package/index.js', '/dest', 1)).toBe('index.js');
  });

  it('rejects absolute paths', () => {
    expect(() => validateEntryPath('/etc/passwd', '/dest', 0)).toThrow(UnsafeTarEntryError);
    expect(() => validateEntryPath('C:\\Windows\\system32', '/dest', 0)).toThrow(UnsafeTarEntryError);
  });

  it('rejects .. traversal', () => {
    expect(() => validateEntryPath('../../etc/passwd', '/dest', 0)).toThrow(UnsafeTarEntryError);
    expect(() => validateEntryPath('package/../../etc/passwd', '/dest', 0)).toThrow(
      UnsafeTarEntryError,
    );
  });

  it('handles strip producing empty path', () => {
    expect(validateEntryPath('package/', '/dest', 1)).toBe('');
  });
});
