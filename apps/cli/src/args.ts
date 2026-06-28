/**
 * Lightweight CLI argument parser. No external dependency — keeps the CLI
 * bundle small and avoids pulling in a framework for the MVP.
 */

export interface GlobalFlags {
  json: boolean;
  registry: string | undefined;
  policyPath: string | undefined;
  agent: boolean;
  yes: boolean;
  no: boolean;
  verbose: boolean;
  debug: boolean;
}

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: GlobalFlags;
  /** Remaining unknown flags as raw key-value pairs. */
  unknown: Record<string, string | boolean>;
}

const FLAG_MAP: Record<string, keyof GlobalFlags> = {
  '--json': 'json',
  '--agent': 'agent',
  '--yes': 'yes',
  '--no': 'no',
  '--verbose': 'verbose',
  '--debug': 'debug',
};

const VALUE_FLAGS = new Set(['--registry', '--policy']);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: GlobalFlags = {
    json: false,
    registry: undefined,
    policyPath: undefined,
    agent: false,
    yes: false,
    no: false,
    verbose: false,
    debug: false,
  };
  const positional: string[] = [];
  const unknown: Record<string, string | boolean> = {};
  let command: string | undefined;

  let i = 0;
  let positionalIndex = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === '--') {
      // Everything after -- is positional.
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new CliError(`flag ${arg} requires a value`, 'MISSING_FLAG_VALUE');
      }
      if (arg === '--registry') flags.registry = value;
      else if (arg === '--policy') flags.policyPath = value;
      i += 2;
      continue;
    }

    const boolKey = FLAG_MAP[arg] as keyof GlobalFlags | undefined;
    if (boolKey) {
      (flags as unknown as Record<string, unknown>)[boolKey] = true;
      i++;
      continue;
    }

    // Handle --flag=value syntax for value flags.
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        const key = arg.slice(0, eqIdx);
        const value = arg.slice(eqIdx + 1);
        if (key === '--registry') {
          flags.registry = value;
        } else if (key === '--policy') {
          flags.policyPath = value;
        } else {
          unknown[key] = value;
        }
        i++;
        continue;
      }
      // Unknown boolean flag.
      unknown[arg] = true;
      i++;
      continue;
    }

    // Positional argument.
    if (positionalIndex === 0) {
      command = arg;
    } else {
      positional.push(arg);
    }
    positionalIndex++;
    i++;
  }

  return { command, positional, flags, unknown };
}

export class CliError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

/** Default registry URL (overridable via --registry or SAFE_NPM_REGISTRY env). */
export function defaultRegistryUrl(): string {
  return process.env.SAFE_NPM_REGISTRY ?? 'https://registry.npmjs.org';
}
