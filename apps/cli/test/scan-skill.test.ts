import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  scanSkillMarkdown,
  scanSkillFile,
  scanAndPreflight,
  scanExitCode,
  isValidPackageSpec,
} from '../src/scan-skill.js';

const SKILL_MD = `# Skill

Some intro text.

\`\`\`bash
npx some-tool@latest --fix
npm exec create-app@1.2.0 -- foo
npm x other-tool
pnpm dlx @scope/pkg@^1.0.0
yarn dlx yarn-tool
bunx bun-tool@1.0.0
echo "not a package command"
\`\`\`

Inline \`npx inline-tool\` should not be detected outside code blocks.

\`\`\`js
// this is js, not shell, but commands still scanned
npx js-tool
\`\`\`
`;

describe('scanSkillMarkdown', () => {
  test('detects npx, npm exec, npm x, pnpm dlx, yarn dlx, bunx', () => {
    const commands = scanSkillMarkdown(SKILL_MD);
    const tools = commands.map((c) => c.tool);
    assert.ok(tools.includes('npx'));
    assert.ok(tools.includes('npm exec'));
    assert.ok(tools.includes('npm x'));
    assert.ok(tools.includes('pnpm dlx'));
    assert.ok(tools.includes('yarn dlx'));
    assert.ok(tools.includes('bunx'));
  });

  test('preserves line number and raw command', () => {
    const commands = scanSkillMarkdown(SKILL_MD);
    const npxCmd = commands.find((c) => c.tool === 'npx');
    assert.ok(npxCmd);
    assert.ok(npxCmd!.line > 0);
    assert.match(npxCmd!.raw, /npx some-tool@latest/);
  });

  test('parses package and specifier', () => {
    const commands = scanSkillMarkdown(SKILL_MD);
    const npxCmd = commands.find((c) => c.tool === 'npx' && c.package === 'some-tool');
    assert.ok(npxCmd);
    assert.equal(npxCmd!.specifier, 'latest');
    assert.equal(npxCmd!.spec, 'some-tool@latest');
  });

  test('ignores commands outside code blocks', () => {
    const commands = scanSkillMarkdown('npx outside-tool\n');
    assert.equal(commands.length, 0);
  });

  test('detects scoped package', () => {
    const commands = scanSkillMarkdown(SKILL_MD);
    const scoped = commands.find((c) => c.package === '@scope/pkg');
    assert.ok(scoped);
    assert.equal(scoped!.specifier, '^1.0.0');
  });
});

describe('scanSkillFile', () => {
  test('reads file and returns commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scan-skill-'));
    const file = join(dir, 'SKILL.md');
    await writeFile(file, SKILL_MD, 'utf8');
    try {
      const { file: f, commands } = await scanSkillFile(file);
      assert.equal(f, file);
      assert.ok(commands.length >= 6);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('scanAndPreflight', () => {
  test('deduplicates and runs preflight per command', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scan-skill-'));
    const file = join(dir, 'SKILL.md');
    await writeFile(file, '```bash\nnpx dup-tool\nnpx dup-tool\nnpx ok-tool\n```\n', 'utf8');
    try {
      const result = await scanAndPreflight(file, async (spec) => {
        if (spec === 'dup-tool') return { decision: 'blocked' as const, reason: 'typosquat' };
        return { decision: 'allow' as const };
      });
      // dup-tool appears once (deduped)
      const dupCount = result.commands.filter((c) => c.spec === 'dup-tool').length;
      assert.equal(dupCount, 1);
      assert.equal(result.commands.find((c) => c.spec === 'dup-tool')!.decision, 'blocked');
      assert.equal(result.commands.find((c) => c.spec === 'ok-tool')!.decision, 'allow');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('preflight error becomes blocked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scan-skill-'));
    const file = join(dir, 'SKILL.md');
    await writeFile(file, '```bash\nnpx err-tool\n```\n', 'utf8');
    try {
      const result = await scanAndPreflight(file, async () => {
        throw new Error('resolve failed');
      });
      assert.equal(result.commands[0]!.decision, 'blocked');
      assert.match(result.commands[0]!.reason ?? '', /resolve failed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('scanExitCode', () => {
  test('11 if any blocked', () => {
    assert.equal(
      scanExitCode({
        file: 'x',
        commands: [
          { line: 1, raw: 'npx a', tool: 'npx', package: 'a', spec: 'a', decision: 'blocked' },
          { line: 2, raw: 'npx b', tool: 'npx', package: 'b', spec: 'b', decision: 'allow' },
        ],
      }),
      11,
    );
  });
  test('10 if any requires_approval and none blocked', () => {
    assert.equal(
      scanExitCode({
        file: 'x',
        commands: [
          { line: 1, raw: 'npx a', tool: 'npx', package: 'a', spec: 'a', decision: 'requires_approval' },
          { line: 2, raw: 'npx b', tool: 'npx', package: 'b', spec: 'b', decision: 'allow' },
        ],
      }),
      10,
    );
  });
  test('0 if all allow', () => {
    assert.equal(
      scanExitCode({
        file: 'x',
        commands: [{ line: 1, raw: 'npx a', tool: 'npx', package: 'a', spec: 'a', decision: 'allow' }],
      }),
      0,
    );
  });
});

describe('isValidPackageSpec', () => {
  test('valid spec', () => {
    assert.equal(isValidPackageSpec('is-odd@1.0.0'), true);
  });
  test('invalid spec', () => {
    assert.equal(isValidPackageSpec(''), false);
  });
});
