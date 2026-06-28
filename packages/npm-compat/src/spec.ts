import npa, { type AliasResult } from 'npm-package-arg';
import { PackageName, PackageSpec, type PackageSpec as PackageSpecType } from '@safe-npm/core-types';

/**
 * Parse an npm package specifier into a normalized {@link PackageSpec}.
 *
 * Wraps `npm-package-arg` so the rest of the codebase depends on our own
 * typed schema. In strict mode, non-registry sources (git, file, directory,
 * remote tarball) are rejected.
 */
export function parsePackageSpec(input: string, strict = false): PackageSpecType {
  let result: npa.Result;
  try {
    result = npa(input);
  } catch (err) {
    throw new InvalidSpecError(
      input,
      err instanceof Error ? err.message : 'invalid package specifier',
    );
  }

  const source = sourceTypeOf(result);
  if (strict && source !== 'registry') {
    throw new UnsupportedSourceError(input, source);
  }

  const name = result.name ?? '';
  // Validate registry names strictly; non-registry sources may have no name.
  if (source === 'registry' && !PackageName.safeParse(name).success) {
    throw new InvalidSpecError(input, `invalid package name "${name}"`);
  }

  try {
    return PackageSpec.parse({
      raw: input,
      name,
      specifier: specifierOf(result),
      source,
    });
  } catch (err) {
    throw new InvalidSpecError(
      input,
      err instanceof Error ? err.message : 'schema validation failed',
    );
  }
}

export class InvalidSpecError extends Error {
  readonly input: string;
  constructor(input: string, message: string) {
    super(`Invalid package specifier "${input}": ${message}`);
    this.name = 'InvalidSpecError';
    this.input = input;
  }
}

export class UnsupportedSourceError extends Error {
  readonly input: string;
  readonly source: string;
  constructor(input: string, source: string) {
    super(`Unsupported package source "${source}" for "${input}" in strict mode`);
    this.name = 'UnsupportedSourceError';
    this.input = input;
    this.source = source;
  }
}

function sourceTypeOf(result: npa.Result): 'registry' | 'git' | 'file' | 'directory' | 'remote' {
  switch (result.type) {
    case 'range':
    case 'version':
    case 'tag':
    case 'alias':
      return 'registry';
    case 'git':
      return 'git';
    case 'file':
      return 'file';
    case 'directory':
      return 'directory';
    case 'remote':
      return 'remote';
    default:
      return 'registry';
  }
}

function specifierOf(result: npa.Result): string {
  if (result.type === 'alias') {
    // alias sub-argument carries the real spec; expose its raw form.
    const alias = result as AliasResult;
    return alias.subSpec ? specifierOf(alias.subSpec) : '';
  }
  if (result.type === 'range' || result.type === 'version' || result.type === 'tag') {
    return result.fetchSpec ?? '';
  }
  // For non-registry sources, keep the raw input as the specifier.
  return result.raw ?? '';
}
