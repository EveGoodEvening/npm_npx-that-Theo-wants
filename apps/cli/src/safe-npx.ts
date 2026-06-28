#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { parseGlobalFlags, preflightCommand, execPreflightCommand } from './commands.js';
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
  // Default: treat first non-flag arg as a package spec to execute (no-exec prompt path).
  if (cmd && !cmd.startsWith('-')) {
    const pkgSpec = cmd;
    const code = await execPreflightCommand(pkgSpec, flags, ttyPrompt);
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
