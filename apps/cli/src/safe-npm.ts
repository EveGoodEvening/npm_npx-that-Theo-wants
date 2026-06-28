#!/usr/bin/env node
import { parseGlobalFlags, viewCommand, policyCommand, publishCommand } from './commands.js';

const args = process.argv.slice(2);
const { flags, rest } = parseGlobalFlags(args);
const cmd = rest[0];
const pkgSpec = rest[1];

async function main(): Promise<void> {
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write('safe-npm 0.0.0\n');
    process.exit(0);
  }
  if (cmd === 'view') {
    if (!pkgSpec) {
      process.stderr.write('usage: safe-npm view <pkg> [--risk] [--json]\n');
      process.exit(1);
    }
    const code = await viewCommand(pkgSpec, flags);
    process.exit(code);
  }
  if (cmd === 'policy') {
    const sub = rest[1] ?? '';
    const code = await policyCommand(sub, rest.slice(2), flags);
    process.exit(code);
  }
  if (cmd === 'publish') {
    const code = await publishCommand(rest.slice(1), flags);
    process.exit(code);
  }
  // For unimplemented commands, print a structured error.
  if (flags.json) {
    process.stdout.write(JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: `command ${cmd ?? '<none>'} not implemented in MVP` } }, null, 2) + '\n');
  } else {
    process.stderr.write(`command ${cmd ?? '<none>'} not implemented in MVP\n`);
  }
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
