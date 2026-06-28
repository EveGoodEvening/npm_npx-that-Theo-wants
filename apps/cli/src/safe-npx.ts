#!/usr/bin/env node
import { parseGlobalFlags, preflightCommand, execPreflightCommand, scanSkillCommand } from './commands.js';
import { listTrustEntries, revokeTrustEntry, cleanExecCache, createExecCache } from './execution.js';
import { createInterface } from 'node:readline/promises';
import type { RiskReport, AnalysisReport } from '@safe-npm/core-types';

const args = process.argv.slice(2);
const { flags, rest } = parseGlobalFlags(args);

const cmd = rest[0];

async function main(): Promise<void> {
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write('safe-npx 0.0.0\n');
    process.exit(0);
  }
  if (cmd === 'preflight') {
    const pkgSpec = rest[1];
    if (!pkgSpec) {
      process.stderr.write('usage: safe-npx preflight <pkg>[@version] [--json]\n');
      process.exit(1);
    }
    const code = await preflightCommand(pkgSpec, flags);
    process.exit(code);
  }
  if (cmd === 'scan-skill') {
    const skillPath = rest[1];
    if (!skillPath) {
      process.stderr.write('usage: safe-npx scan-skill <path> [--json]\n');
      process.exit(1);
    }
    const code = await scanSkillCommand(skillPath, flags);
    process.exit(code);
  }
  if (cmd === 'trust') {
    const sub = rest[1];
    if (sub === 'list') {
      const entries = await listTrustEntries();
      if (flags.json) {
        process.stdout.write(JSON.stringify({ entries }, null, 2) + '\n');
      } else {
        for (const e of entries) {
          process.stdout.write(`${e.packageName}@${e.version} [${e.scope}] digest=${e.tarballDigest}\n`);
        }
      }
      process.exit(0);
    }
    if (sub === 'revoke') {
      const pkg = rest[2];
      const version = rest[3];
      if (!pkg) {
        process.stderr.write('usage: safe-npx trust revoke <pkg> [version]\n');
        process.exit(1);
      }
      await revokeTrustEntry(pkg, version);
      process.stdout.write(`revoked trust for ${pkg}${version ? '@' + version : ''}\n`);
      process.exit(0);
    }
    process.stderr.write('usage: safe-npx trust list | safe-npx trust revoke <pkg> [version]\n');
    process.exit(1);
  }
  if (cmd === 'cache') {
    const sub = rest[1];
    if (sub === 'clean') {
      await cleanExecCache(await createExecCache());
      process.stdout.write('execution cache cleaned\n');
      process.exit(0);
    }
    process.stderr.write('usage: safe-npx cache clean\n');
    process.exit(1);
  }
  if (cmd && !cmd.startsWith('-')) {
    const pkgSpec = cmd;
    const execArgs = rest.slice(1);
    const code = await execPreflightCommand(pkgSpec, flags, ttyPrompt, {
      execute: true,
      execArgs,
    });
    process.exit(code);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: `command ${cmd ?? '<none>'} not implemented in MVP` } }, null, 2) + '\n');
  } else {
    process.stderr.write(`usage: safe-npx <pkg>[@version] [args...] | safe-npx preflight <pkg>[@version]\n`);
  }
  process.exit(1);
}

/** TTY prompt supporting yes/no/details. */
async function ttyPrompt(
  _report: RiskReport,
  _analysis: AnalysisReport,
): Promise<'yes' | 'no' | 'details'> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Proceed? [y]es [n]o [d]etails ')).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return 'yes';
    if (answer === 'd' || answer === 'details') return 'details';
    return 'no';
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
