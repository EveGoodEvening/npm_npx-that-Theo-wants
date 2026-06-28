import { describe, expect, it } from 'vitest';
import { parseMarkdownContent, parsePackageSpec, deduplicateCommands } from './skill-scanner.js';

describe('parseMarkdownContent', () => {
  it('extracts npx commands from code blocks', () => {
    const content = [
      'Some text',
      '',
      '```bash',
      'npx some-tool@latest',
      '```',
      '',
      'More text',
    ].join('\n');
    const commands = parseMarkdownContent(content);
    expect(commands.length).toBe(1);
    expect(commands[0]?.tool).toBe('npx');
    expect(commands[0]?.packageSpec).toBe('some-tool@latest');
    expect(commands[0]?.packageName).toBe('some-tool');
    expect(commands[0]?.version).toBe('latest');
    expect(commands[0]?.line).toBe(4);
  });

  it('extracts multiple command types', () => {
    const content = [
      '```sh',
      'npx tool-a',
      'npm exec tool-b',
      'npm x tool-c',
      'pnpm dlx tool-d',
      'yarn dlx tool-e',
      'bunx tool-f',
      '```',
    ].join('\n');
    const commands = parseMarkdownContent(content);
    expect(commands.length).toBe(6);
    expect(commands.map((c) => c.tool)).toEqual([
      'npx', 'npm exec', 'npm x', 'pnpm dlx', 'yarn dlx', 'bunx',
    ]);
  });

  it('ignores commands outside code blocks', () => {
    const content = [
      'Run npx some-tool to do things',
      '',
      'Regular text',
    ].join('\n');
    const commands = parseMarkdownContent(content);
    expect(commands.length).toBe(0);
  });

  it('preserves raw command and line number', () => {
    const content = [
      '```',
      'npx some-tool --flag',
      '```',
    ].join('\n');
    const commands = parseMarkdownContent(content);
    expect(commands[0]?.raw).toBe('npx some-tool --flag');
    expect(commands[0]?.line).toBe(2);
  });

  it('handles scoped packages', () => {
    const content = [
      '```',
      'npx @scope/tool@1.0.0',
      '```',
    ].join('\n');
    const commands = parseMarkdownContent(content);
    expect(commands[0]?.packageName).toBe('@scope/tool');
    expect(commands[0]?.version).toBe('1.0.0');
  });

  it('handles --yes flag', () => {
    const content = [
      '```',
      'npx -y some-tool',
      '```',
    ].join('\n');
    const commands = parseMarkdownContent(content);
    expect(commands[0]?.packageSpec).toBe('some-tool');
  });

  it('handles multiple code blocks', () => {
    const content = [
      '```bash',
      'npx tool-a',
      '```',
      '',
      '```',
      'npx tool-b',
      '```',
    ].join('\n');
    const commands = parseMarkdownContent(content);
    expect(commands.length).toBe(2);
  });
});

describe('parsePackageSpec', () => {
  it('parses unscoped package with version', () => {
    const { name, version } = parsePackageSpec('pkg@1.0.0');
    expect(name).toBe('pkg');
    expect(version).toBe('1.0.0');
  });

  it('parses unscoped package without version', () => {
    const { name, version } = parsePackageSpec('pkg');
    expect(name).toBe('pkg');
    expect(version).toBeUndefined();
  });

  it('parses scoped package with version', () => {
    const { name, version } = parsePackageSpec('@scope/pkg@latest');
    expect(name).toBe('@scope/pkg');
    expect(version).toBe('latest');
  });

  it('parses scoped package without version', () => {
    const { name, version } = parsePackageSpec('@scope/pkg');
    expect(name).toBe('@scope/pkg');
    expect(version).toBeUndefined();
  });
});

describe('deduplicateCommands', () => {
  it('removes duplicate package specs', () => {
    const commands = [
      { raw: 'npx tool', line: 1, tool: 'npx', packageSpec: 'tool', packageName: 'tool' },
      { raw: 'npx tool', line: 5, tool: 'npx', packageSpec: 'tool', packageName: 'tool' },
      { raw: 'npx other', line: 10, tool: 'npx', packageSpec: 'other', packageName: 'other' },
    ];
    const result = deduplicateCommands(commands);
    expect(result.length).toBe(2);
  });

  it('keeps all unique specs', () => {
    const commands = [
      { raw: 'npx tool-a', line: 1, tool: 'npx', packageSpec: 'tool-a', packageName: 'tool-a' },
      { raw: 'npx tool-b', line: 2, tool: 'npx', packageSpec: 'tool-b', packageName: 'tool-b' },
    ];
    const result = deduplicateCommands(commands);
    expect(result.length).toBe(2);
  });
});
