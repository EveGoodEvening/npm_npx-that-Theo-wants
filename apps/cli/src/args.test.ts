import { describe, expect, it } from 'vitest';
import { parseArgs, CliError } from '../src/index.js';

describe('parseArgs', () => {
  it('parses command and positional args', () => {
    const r = parseArgs(['view', 'is-odd', '--risk']);
    expect(r.command).toBe('view');
    expect(r.positional).toEqual(['is-odd']);
  });

  it('parses boolean flags', () => {
    const r = parseArgs(['--json', '--agent', '--verbose']);
    expect(r.flags.json).toBe(true);
    expect(r.flags.agent).toBe(true);
    expect(r.flags.verbose).toBe(true);
  });

  it('parses value flags', () => {
    const r = parseArgs(['--registry', 'https://custom.registry.com', '--policy', './policy.json']);
    expect(r.flags.registry).toBe('https://custom.registry.com');
    expect(r.flags.policyPath).toBe('./policy.json');
  });

  it('parses --flag=value syntax', () => {
    const r = parseArgs(['--registry=https://custom.registry.com']);
    expect(r.flags.registry).toBe('https://custom.registry.com');
  });

  it('parses --yes and --no', () => {
    const r = parseArgs(['--yes']);
    expect(r.flags.yes).toBe(true);
    expect(r.flags.no).toBe(false);
  });

  it('parses --debug flag', () => {
    const r = parseArgs(['--debug']);
    expect(r.flags.debug).toBe(true);
  });

  it('parses all flags together', () => {
    const r = parseArgs(['--json', '--agent', '--yes', '--verbose', '--debug', '--no']);
    expect(r.flags.json).toBe(true);
    expect(r.flags.agent).toBe(true);
    expect(r.flags.yes).toBe(true);
    expect(r.flags.verbose).toBe(true);
    expect(r.flags.debug).toBe(true);
    expect(r.flags.no).toBe(true);
  });

  it('handles -- separator', () => {
    const r = parseArgs(['exec', '--', '--arg1', '--arg2']);
    expect(r.command).toBe('exec');
    expect(r.positional).toEqual(['--arg1', '--arg2']);
  });

  it('collects unknown flags', () => {
    const r = parseArgs(['--unknown-flag']);
    expect(r.unknown['--unknown-flag']).toBe(true);
  });

  it('throws on missing value for value flag', () => {
    expect(() => parseArgs(['--registry'])).toThrow(CliError);
  });
});
